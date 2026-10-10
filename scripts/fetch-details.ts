// Fetches each course's calendar description, breadth/WQB designation and
// notes ("Students with credit for ...") for every course in
// public/data/courses.json, from the same calendar term that file was built
// from. Writes public/data/details.json:
//   { fetched, details: { "CMPT 120": { description, designation?, notes? } } }
//
// The calendar API's description field repeats the prerequisites, notes and
// designation at the end, so those are cut off; only the course description
// itself is kept. A "Students with credit for ..." sentence left in the
// description moves to notes when notes is empty.
//
// Usage: node scripts/fetch-details.ts

import { readFile, writeFile } from 'node:fs/promises';
import type { CourseData } from '../src/lib/types.ts';
import { CALENDAR_API, getJson, missingPaths, pool } from './sfu-api.ts';

/** One course in the calendar API (only the fields used here). */
interface CalendarCourse {
  description?: string;
  designation?: string;
  notes?: string;
  prerequisites?: string;
  corequisites?: string;
  recommended?: string;
  errorMessage?: string;
}

/** One entry of details.json; empty fields are left out. */
interface Details {
  description?: string;
  designation?: string;
  notes?: string;
}

const CONCURRENCY = 12;
const COURSES = new URL('../public/data/courses.json', import.meta.url);
const OUT = new URL('../public/data/details.json', import.meta.url);

/** Calendar HTML -> plain text on one line. */
function decode(s: unknown): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
// "Students with credit for X may not take this course for further credit."
const CREDIT = /(?:^|\s)(Students (?:with|who)\b.*?may not (?:take|complete)\b.*?credit\.)/;
// Whatever follows a "Prerequisite:"/"Corequisite:" label is requisite text.
const REQ_LABEL = /\s*\b(?:Pre-?requisites?|Co-?requisites?)\s*:/i;

function toDetails(c: CalendarCourse): Details {
  let description = decode(c.description);
  let designation = decode(c.designation);
  let notes = decode(c.notes);
  if (/^n\/?a$/i.test(designation)) designation = '';

  // Trailing designation: "... Quantitative/Breadth-Science."
  if (designation) description = description.replace(new RegExp(`\\s*${escapeRe(designation)}\\.?$`), '');
  // Trailing notes (sometimes stored without the final period).
  const n = notes.replace(/\.$/, '');
  const d = description.replace(/\.$/, '');
  if (n && d.endsWith(n)) description = d.slice(0, -n.length).trim();
  // The requisite fields, wherever they appear.
  for (const field of ['prerequisites', 'corequisites', 'recommended'] as const) {
    const t = decode(c[field]);
    if (t && description.includes(t)) description = squash(description.replace(t, ' '));
  }
  // Requisite text that didn't match its field exactly.
  const label = REQ_LABEL.exec(description);
  if (label) description = description.slice(0, label.index).trim();
  // Anti-requisite sentence: belongs in notes.
  const credit = CREDIT.exec(description);
  if (credit) {
    if (!notes) notes = credit[1];
    description = squash(description.replace(credit[1], ' '));
  }

  return {
    ...(description ? { description } : {}),
    ...(designation ? { designation } : {}),
    ...(notes ? { notes } : {}),
  };
}

const started = Date.now();
const { term, courses }: CourseData = JSON.parse(await readFile(COURSES, 'utf8'));
const byDept = new Map<string, { code: string; num: string }[]>();
for (const code of Object.keys(courses)) {
  const [dept, num] = code.split(' ');
  if (!byDept.has(dept)) byDept.set(dept, []);
  byDept.get(dept)!.push({ code, num });
}
console.log(`Term: ${term}; ${Object.keys(courses).length} courses in ${byDept.size} departments`);

const details: Record<string, Details> = {};
const designations: Record<string, number> = {};
const failed: string[] = [];
for (const [i, [dept, list]] of [...byDept].entries()) {
  let found = 0;
  await pool(list, CONCURRENCY, async ({ code, num }) => {
    const c: CalendarCourse | null = await getJson(CALENDAR_API, `${term}/courses/${dept.toLowerCase()}/${num.toLowerCase()}`);
    if (!c || c.errorMessage) {
      failed.push(code);
      return;
    }
    const d = toDetails(c);
    if (!Object.keys(d).length) return;
    details[code] = d;
    found++;
    const key = decode(c.designation) || '(empty)';
    designations[key] = (designations[key] ?? 0) + 1;
  });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`  [${i + 1}/${byDept.size}] ${dept}: ${found}/${list.length} courses (${secs}s)`);
}

const sorted = Object.fromEntries(
  Object.entries(details).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
);
const json = JSON.stringify({ fetched: new Date().toISOString(), term, details: sorted });
await writeFile(OUT, json);
console.log(
  `Wrote details for ${Object.keys(sorted).length} courses to public/data/details.json ` +
    `(${(json.length / 1024).toFixed(0)} KB) in ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
console.log('Designations:');
for (const [d, n] of Object.entries(designations).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${d}`);
if (failed.length) console.log(`  (${failed.length} courses could not be fetched: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? ', ...' : ''})`);
if (missingPaths().length) console.log(`  (${missingPaths().length} paths 404'd)`);
