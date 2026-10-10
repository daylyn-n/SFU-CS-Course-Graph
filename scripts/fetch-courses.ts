// Pulls course data from SFU's public academic calendar API and writes
// public/data/courses.json with each course's prerequisites parsed into an
// and/or tree.
//
// Usage: node scripts/fetch-courses.ts [year/term] [dept ...]
//   e.g. node scripts/fetch-courses.ts 2026/fall cmpt macm math stat
// With no departments given, fetches every department SFU publishes outlines for.

import { writeFile, mkdir } from 'node:fs/promises';
import type { Course, Prereq } from '../src/lib/types.ts';
import { parsePrereqs } from './parse-prereqs.ts';
import { CALENDAR_API, OUTLINES_API, getJson as getJsonFrom, missingPaths, pool } from './sfu-api.ts';

/** A department in the outlines API's current/current list. */
interface OutlineDept {
  text: string; // "CMPT"
  value: string; // "cmpt"
  name?: string; // "Computing Science"
}
/** A department or course in the calendar API's lists. */
interface CalendarItem {
  value: string;
  title?: string;
}
/** One course in the calendar API. */
interface CalendarCourse {
  title?: string;
  units: string;
  prerequisites?: string;
}

const [term = '2026/fall', ...deptArgs] = process.argv.slice(2);
const OUT = new URL('../public/data/courses.json', import.meta.url);
const getJson = (path: string) => getJsonFrom(CALENDAR_API, `${term}/courses/${path}`);

/** null = claimed/being fetched, or not in the calendar */
const courses: Record<string, Course | null> = {};

// Known department codes, so the parser can read "Math 125" as MATH 125.
const deptList: OutlineDept[] | null = await getJsonFrom(OUTLINES_API, 'current/current');
if (!deptList) throw new Error('Could not fetch the department list');
const knownDepts = new Set(deptList.map((d) => d.text.toUpperCase()));

// Department names for the frontend, from the outlines list (falling back to
// the calendar's names for departments only the calendar knows).
const calendarDepts: CalendarItem[] = (await getJson('')) ?? [];
const deptNames: Record<string, string> = Object.fromEntries(
  calendarDepts.map((d) => [d.value.toUpperCase(), decode(d.title ?? '')]),
);
for (const d of deptList) {
  const code = d.text.toUpperCase();
  deptNames[code] = d.name || deptNames[code] || code;
}

// Default: every outline department the calendar also has.
const calendarHas = new Set(calendarDepts.map((d) => d.value.toLowerCase()));
const outlineDepts = deptList.map((d) => d.value.toLowerCase());
const depts = deptArgs.length
  ? deptArgs.map((d) => d.toLowerCase())
  : outlineDepts.filter((d) => !calendarDepts.length || calendarHas.has(d));
const skipped = deptArgs.length ? [] : outlineDepts.filter((d) => !depts.includes(d));

async function fetchCourse(dept: string, number: string): Promise<void> {
  const code = `${dept.toUpperCase()} ${number.toUpperCase()}`;
  if (code in courses) return;
  courses[code] = null; // claim it so we don't fetch twice
  const c: CalendarCourse | null = await getJson(`${dept}/${number.toLowerCase()}`);
  if (!c?.title) return; // leave the null claim so later rounds don't retry it
  const text = decode(c.prerequisites || '');
  courses[code] = {
    title: decode(c.title),
    units: c.units,
    prereqText: text,
    prereq: parsePrereqs(text, { self: code, depts: knownDepts }),
  };
}

function decode(s: unknown): string {
  return String(s ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function referencedCodes(tree: Prereq | null | undefined, out = new Set<string>()): Set<string> {
  if (!tree) return out;
  if (typeof tree === 'string') out.add(tree);
  // Non-course leaves ({ other }) have no args and reference no course.
  else if ('args' in tree) tree.args.forEach((a) => referencedCodes(a, out));
  return out;
}

console.log(`Fetching ${term}: ${depts.length} departments`);
if (skipped.length) console.log(`  (not in the calendar, skipped: ${skipped.join(', ').toUpperCase()})`);
for (const [i, dept] of depts.entries()) {
  const list: CalendarItem[] = (await getJson(dept)) ?? [];
  console.log(`  [${i + 1}/${depts.length}] ${dept.toUpperCase()}: ${list.length} courses`);
  await pool(list, 8, (c) => fetchCourse(dept, c.value));
}

// Pull in prerequisites from other departments (e.g. PHYS 120) so every
// box in the chart has a title. One extra level is enough for most charts.
for (let round = 0; round < 2; round++) {
  const missing = new Set<string>();
  for (const c of Object.values(courses)) {
    for (const code of referencedCodes(c?.prereq)) {
      if (!(code in courses)) missing.add(code);
    }
  }
  if (!missing.size) break;
  console.log(`  + ${missing.size} referenced courses from other departments`);
  await pool([...missing], 8, (code) => {
    const [dept, num] = code.split(' ');
    return fetchCourse(dept.toLowerCase(), num);
  });
}

const sorted = Object.fromEntries(
  Object.entries(courses)
    .filter(([, c]) => c)
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
);
await mkdir(new URL('.', OUT), { recursive: true });
const usedDepts = new Set([...Object.keys(sorted).map((c) => c.split(' ')[0]), ...knownDepts]);
const deptMap = Object.fromEntries(
  Object.entries(deptNames)
    .filter(([code]) => usedDepts.has(code))
    .sort(([a], [b]) => a.localeCompare(b)),
);
await writeFile(
  OUT,
  JSON.stringify({ term, fetched: new Date().toISOString(), depts: deptMap, courses: sorted }),
);
const notFound = missingPaths();
if (notFound.length) {
  console.log(`  (${notFound.length} listed/referenced courses have no calendar entry: ${notFound.join(', ')})`);
}
console.log(`Wrote ${Object.keys(sorted).length} courses to public/data/courses.json`);
