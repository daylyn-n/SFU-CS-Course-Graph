// Pulls course data from SFU's public academic calendar API and writes
// src/data/courses.json with each course's prerequisites parsed into an
// and/or tree.
//
// Usage: node scripts/fetch-courses.mjs [year/term] [dept ...]
//   e.g. node scripts/fetch-courses.mjs 2026/fall cmpt macm math stat

import { writeFile, mkdir } from 'node:fs/promises';
import { parsePrereqs } from './parse-prereqs.mjs';
import { CALENDAR_API, getJson as getJsonFrom, missingPaths, pool } from './sfu-api.mjs';

const [term = '2026/fall', ...deptArgs] = process.argv.slice(2);
const depts = deptArgs.length ? deptArgs : ['cmpt', 'macm', 'math', 'stat'];
const OUT = new URL('../src/data/courses.json', import.meta.url);
const getJson = (path) => getJsonFrom(CALENDAR_API, `${term}/courses/${path}`);

const courses = {};

async function fetchCourse(dept, number) {
  const code = `${dept.toUpperCase()} ${number.toUpperCase()}`;
  if (code in courses) return;
  courses[code] = null; // claim it so we don't fetch twice
  const c = await getJson(`${dept}/${number.toLowerCase()}`);
  if (!c) return; // leave the null claim so later rounds don't retry it
  const text = decode(c.prerequisites || '');
  courses[code] = {
    title: decode(c.title),
    units: c.units,
    prereqText: text,
    prereq: parsePrereqs(text),
  };
}

function decode(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function referencedCodes(tree, out = new Set()) {
  if (!tree) return out;
  if (typeof tree === 'string') out.add(tree);
  else tree.args.forEach((a) => referencedCodes(a, out));
  return out;
}

console.log(`Fetching ${term}: ${depts.join(', ')}`);
for (const dept of depts) {
  const list = (await getJson(dept)) ?? [];
  console.log(`  ${dept.toUpperCase()}: ${list.length} courses`);
  await pool(list, 6, (c) => fetchCourse(dept, c.value));
}

// Pull in prerequisites from other departments (e.g. PHYS 120) so every
// box in the chart has a title. One extra level is enough for most charts.
for (let round = 0; round < 2; round++) {
  const missing = new Set();
  for (const c of Object.values(courses)) {
    for (const code of referencedCodes(c?.prereq)) {
      if (!(code in courses)) missing.add(code);
    }
  }
  if (!missing.size) break;
  console.log(`  + ${missing.size} referenced courses from other departments`);
  await pool([...missing], 6, (code) => {
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
await writeFile(OUT, JSON.stringify({ term, fetched: new Date().toISOString(), courses: sorted }, null, 1));
const notFound = missingPaths();
if (notFound.length) {
  console.log(`  (${notFound.length} listed/referenced courses have no calendar entry: ${notFound.join(', ')})`);
}
console.log(`Wrote ${Object.keys(sorted).length} courses to src/data/courses.json`);
