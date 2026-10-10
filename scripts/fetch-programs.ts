// Pulls every SFU undergraduate program (majors, honours, minors, joint
// majors, certificates, diplomas) from the public academic calendar API,
// converts each one's requirements into the degree model, and writes:
//   public/data/programs/index.json   the list, for the program picker
//   public/data/programs/<id>.json    one converted Program per program
// The app only ever downloads the chosen program's file.
//
// Usage: node scripts/fetch-programs.ts [year/term]   e.g. 2026/fall
// With no term given, uses the calendar term public/data/courses.json was
// built from, so programs and courses always come from the same calendar.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { convertProgram, shortCredential, type RawProgram } from '../src/lib/programs/convert.ts';
import { CURATED_CALENDAR_IDS, calendarUrl, programIdFromValue, type ProgramIndexEntry } from '../src/lib/programs/ids.ts';
import { CALENDAR_API, getJson as getJsonFrom, pool } from './sfu-api.ts';

const OUT = new URL('../public/data/programs/', import.meta.url);
const COURSES = new URL('../public/data/courses.json', import.meta.url);
const term: string = process.argv[2] || JSON.parse(await readFile(COURSES, 'utf8')).term;
const [year, season] = term.split('/');
const calendarName = `${season.charAt(0).toUpperCase()}${season.slice(1)} ${year}`;
const getJson = (path: string) => getJsonFrom(CALENDAR_API, `${term}/${path}`);

interface Area {
  title: string;
  value: string;
}

/** Fetch text (an HTML page), retrying; '' if it never succeeds. */
async function getText(url: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return '';
}

// Subject names, so prose like "18 units of history courses" can be read.
let depts: Record<string, string> = {};
try {
  depts = JSON.parse(await readFile(COURSES, 'utf8')).depts ?? {};
} catch {
  console.warn('  (public/data/courses.json not found: subject names in prose will not be recognized)');
}

// 1. Every program value, from each area's API listing plus its calendar page
// (the API's listing for some areas, e.g. Business, is incomplete).
const areas: Area[] = (await getJson('areas-of-study')) ?? [];
if (!areas.length) throw new Error('Could not fetch the areas of study');
console.log(`Fetching ${term}: ${areas.length} areas of study`);
const programArea = new Map<string, string>(); // program value -> first area listing it
let fromPages = 0;
await pool(areas, 6, async (area) => {
  const detail: { programs?: { value: string }[] } | null = await getJson(`areas-of-study/${area.value}`);
  for (const p of detail?.programs ?? []) if (!programArea.has(p.value)) programArea.set(p.value, area.value);
  const html = await getText(`https://www.sfu.ca/students/calendar/${term}/areas-of-study/${area.value}.html`);
  const re = new RegExp(`/calendar/${term}/programs/([a-z0-9/-]+)\\.html`, 'g');
  for (const m of html.matchAll(re)) {
    if (!programArea.has(m[1])) {
      programArea.set(m[1], area.value);
      fromPages++;
    }
  }
});
console.log(`  ${programArea.size} programs listed (${fromPages} only on the calendar pages)`);

// The listings sometimes miss programs under load, which would silently drop
// them from the app. So everything in the previous index is fetched too; a
// program SFU really removed still drops out (fetchProgram finds nothing).
let carried = 0;
let previous: ProgramIndexEntry[] = [];
try {
  previous = JSON.parse(await readFile(new URL('index.json', OUT), 'utf8'));
  for (const e of previous) {
    const value = e.id.replaceAll('~', '/');
    if (!programArea.has(value)) {
      programArea.set(value, e.area ?? '');
      carried++;
    }
  }
} catch {
  // No previous index (first run).
}
if (carried) console.log(`  + ${carried} programs from the previous index that the listings missed`);

// 2. Each program; keep undergraduate degree programs, minors, certificates
// and diplomas (not co-op programs or graduate programs).
const raws = new Map<string, RawProgram>();
let done = 0;
let skipped = 0;
const slug = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Under load the API sometimes answers with a different program (e.g. the
// CS and Linguistics joint major for software-systems/major/...). Check the
// answer's own `value` (the last path segment) and title against the request.
const looksRight = (value: string, raw: RawProgram & { value?: string }) =>
  raw.value === value.split('/').pop() && value.startsWith(slug(raw.title ?? '').slice(0, 10));
async function fetchProgram(value: string): Promise<(RawProgram & { errorMessage?: string; value?: string }) | null> {
  let raw: (RawProgram & { errorMessage?: string; value?: string }) | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    raw = await getJson(`programs/${value}`);
    if (!raw || Array.isArray(raw) || raw.errorMessage || !raw.title) return null;
    if (looksRight(value, raw)) return raw;
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  // Still odd: trust it only if at least the value segment matches (titles can differ from slugs).
  if (raw && raw.value === value.split('/').pop()) return raw;
  console.warn(`  ! ${value}: the API keeps returning "${raw?.fullTitle ?? raw?.title}", skipped`);
  return null;
}
await pool(programArea.keys(), 6, async (value) => {
  const raw = await fetchProgram(value);
  if (++done % 100 === 0) console.log(`  ${done}/${programArea.size}`);
  if (!raw) return void skipped++;
  if (raw.degreeLevel !== 'Undergraduate' || /co-operative|practicum/i.test(raw.awardType ?? '')) return;
  raws.set(value, raw);
});
// Programs we had last time but couldn't fetch now: the API fails under
// load, so try again one at a time before letting any of them drop out.
const retry = previous.map((e) => e.id.replaceAll('~', '/')).filter((v) => !raws.has(v));
let recovered = 0;
for (const value of retry) {
  for (let attempt = 1; attempt <= 3 && !raws.has(value); attempt++) {
    await new Promise((r) => setTimeout(r, 800 * attempt));
    const raw = await fetchProgram(value);
    if (raw && raw.degreeLevel === 'Undergraduate' && !/co-operative|practicum/i.test(raw.awardType ?? '')) {
      raws.set(value, raw);
      recovered++;
      skipped--;
    }
  }
  if (!raws.has(value)) console.warn(`  ! ${value}: in the previous index but not available now, dropped`);
}
if (recovered) console.log(`  recovered ${recovered} program(s) on retry`);
if (skipped) console.log(`  (${skipped} listed programs had no usable calendar entry)`);

// 3. Convert and write.
await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith('.json')) await rm(new URL(f, OUT));
const curatedFor = new Map(Object.entries(CURATED_CALENDAR_IDS).map(([curated, cal]) => [cal, curated]));
const index: ProgramIndexEntry[] = [];
let understood = 0;
let manual = 0;
let bytes = 0;
let largest = { id: '', size: 0 };
for (const [value, raw] of raws) {
  const id = programIdFromValue(value);
  const { program, stats } = convertProgram(raw, {
    id,
    source: calendarUrl(term, value),
    calendar: calendarName,
    depts,
  });
  understood += stats.understood;
  manual += stats.manual;
  const json = JSON.stringify(program);
  await writeFile(new URL(`${id}.json`, OUT), json);
  bytes += json.length;
  if (json.length > largest.size) largest = { id, size: json.length };
  const curated = curatedFor.get(id);
  index.push({
    id,
    title: (raw.title ?? '').trim(),
    fullTitle: program.name,
    credential: shortCredential(raw),
    awardType: (raw.awardType ?? '').trim(),
    faculty: program.faculty ?? '',
    area: programArea.get(value) ?? '',
    ...(curated ? { curated } : {}),
  });
}
index.sort((a, b) => a.faculty.localeCompare(b.faculty) || a.fullTitle.localeCompare(b.fullTitle) || a.id.localeCompare(b.id));
const indexJson = JSON.stringify(index);
await writeFile(new URL('index.json', OUT), indexJson);

const missingCurated = Object.values(CURATED_CALENDAR_IDS).filter((id) => !index.some((p) => p.id === id));
if (missingCurated.length) console.warn(`  ! curated programs not in the calendar: ${missingCurated.join(', ')}`);
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(`Wrote ${index.length} programs to public/data/programs/`);
console.log(`  index.json ${kb(indexJson.length)}; program files ${kb(bytes)} total, ${kb(bytes / index.length)} average, largest ${largest.id} ${kb(largest.size)}`);
console.log(`  requirements understood: ${understood}, left for an advisor: ${manual} (${((100 * understood) / (understood + manual)).toFixed(1)}% automatic)`);
