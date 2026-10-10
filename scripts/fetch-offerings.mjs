// Finds which courses in public/data/courses.json run this term and in upcoming
// terms SFU has already published, with EVERY section (lectures plus the labs,
// tutorials, etc. that go with them): instructors, campus, meeting times and
// exam. Writes public/data/offerings.json.
//
// Section semantics (course-outlines API):
//   classType 'e' = the section you enrol in (LEC/SEM/IND/...), 'n' = a
//   required component (LAB/TUT/...). Components belong to the enrolment
//   section with the same associatedClass. Each section's outline only lists
//   its own meetings, so labs and tutorials need their own requests.
//
// Usage: node scripts/fetch-offerings.mjs [how many terms, default 3]

import { readFile, writeFile } from 'node:fs/promises';
import { OUTLINES_API, getJson as getJsonFrom, pool } from './sfu-api.mjs';

const MAX_TERMS = Number(process.argv[2] ?? 3);
const CONCURRENCY = 10;
const COURSES = new URL('../public/data/courses.json', import.meta.url);
const OUT = new URL('../public/data/offerings.json', import.meta.url);
const SEASONS = ['spring', 'summer', 'fall'];
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const getJson = (path) => getJsonFrom(OUTLINES_API, path);

// SFU terms: Spring Jan–Apr, Summer May–Aug, Fall Sep–Dec.
function currentTerm(date = new Date()) {
  return { year: date.getFullYear(), season: SEASONS[Math.floor(date.getMonth() / 4)] };
}

function nextTerm({ year, season }) {
  const i = SEASONS.indexOf(season);
  return i === 2 ? { year: year + 1, season: 'spring' } : { year, season: SEASONS[i + 1] };
}

// The current term plus following terms, as long as SFU has published them.
async function availableTerms() {
  const terms = [];
  const seasonsByYear = {};
  let t = currentTerm();
  while (terms.length < MAX_TERMS) {
    seasonsByYear[t.year] ??= ((await getJson(`${t.year}`)) ?? []).map((s) => s.value);
    if (!seasonsByYear[t.year].includes(t.season)) break;
    terms.push(t);
    t = nextTerm(t);
  }
  return terms.map(({ year, season }, i) => ({
    id: `${year}/${season}`,
    label: `${season[0].toUpperCase()}${season.slice(1)} ${year}`,
    short: `${season === 'summer' ? 'Su' : season.slice(0, 2).replace(/^./, (c) => c.toUpperCase())}${String(year).slice(2)}`,
    current: i === 0,
  }));
}

/** "8:30" -> "08:30"; '' if it doesn't look like a time. */
function hhmm(t = '') {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/** "Wed Sep 09 00:00:00 PDT 2026" -> "2026-09-09"; '' if unparseable. */
function isoDate(s = '') {
  const m = /^\w{3} (\w{3}) (\d{1,2}) .* (\d{4})$/.exec(s.trim());
  const mon = m && MONTHS.indexOf(m[1]);
  if (!m || mon < 0) return '';
  return `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function parseDays(s = '') {
  const set = new Set(s.split(/[\s,]+/).filter((d) => DAYS.includes(d)));
  return DAYS.filter((d) => set.has(d));
}

/** Non-exam meetings as one block per distinct (days, start, end). */
function toBlocks(schedule) {
  const blocks = new Map();
  for (const b of schedule) {
    if (b.isExam) continue;
    const days = parseDays(b.days);
    const start = hhmm(b.startTime);
    const end = hhmm(b.endTime);
    // Skip blocks with no days or times, and zero-length placeholders (e.g. 08:00–08:00).
    if (!days.length || !start || !end || start >= end) continue;
    const key = `${days.join('')} ${start} ${end}`;
    if (blocks.has(key)) continue;
    blocks.set(key, { days, start, end, ...(b.campus ? { campus: b.campus } : {}) });
  }
  return [...blocks.values()];
}

function formatSchedule(blocks) {
  return blocks.map((b) => `${b.days.join(', ')} ${b.start}–${b.end}`).join(', ');
}

function toExam(schedule) {
  const e = schedule.find((b) => b.isExam);
  if (!e) return undefined;
  const exam = { date: isoDate(e.startDate), start: hhmm(e.startTime), end: hhmm(e.endTime) };
  return exam.date || exam.start ? exam : undefined;
}

const stats = { outlines: 0, missing: 0, partialDates: 0 };

async function fetchSection(termId, dept, num, s) {
  const base = {
    section: s.text.toUpperCase(),
    type: s.sectionCode || '',
    enrol: s.classType === 'e',
    assoc: s.associatedClass ?? '',
  };
  const o = await getJson(`${termId}/${dept}/${num}/${s.value}`);
  stats.outlines++;
  if (!o) {
    stats.missing++;
    return { ...base, schedule: '', blocks: [] };
  }
  const schedule = o.courseSchedule ?? [];
  const blocks = toBlocks(schedule);
  const ranges = new Set(schedule.filter((b) => !b.isExam).map((b) => `${b.startDate}|${b.endDate}`));
  if (ranges.size > 1) stats.partialDates++;
  const instructors = [
    ...new Set(
      (o.instructor ?? [])
        .map((p) => [p.commonName || p.firstName, p.lastName].filter(Boolean).join(' ').trim())
        .filter(Boolean),
    ),
  ];
  const campus = o.info?.campus || schedule.find((b) => !b.isExam && b.campus)?.campus || '';
  const delivery = o.info?.deliveryMethod || '';
  const exam = toExam(schedule);
  return {
    ...base,
    ...(instructors.length ? { instructors } : {}),
    ...(campus ? { campus } : {}),
    ...(delivery ? { delivery } : {}),
    schedule: formatSchedule(blocks),
    blocks,
    ...(exam ? { exam } : {}),
  };
}

const started = Date.now();
const { courses } = JSON.parse(await readFile(COURSES, 'utf8'));
const wanted = new Set(Object.keys(courses));
const depts = [...new Set(Object.keys(courses).map((c) => c.split(' ')[0].toLowerCase()))].sort();

const terms = await availableTerms();
console.log(`Terms: ${terms.map((t) => t.label).join(', ')}; ${depts.length} departments`);

const offerings = {};
const notInCalendar = new Set();
let totalSections = 0;
for (const term of terms) {
  let termCourses = 0;
  let termSections = 0;
  for (const [i, dept] of depts.entries()) {
    const offered = [];
    for (const c of (await getJson(`${term.id}/${dept}`)) ?? []) {
      const code = `${dept.toUpperCase()} ${c.text.toUpperCase()}`;
      if (wanted.has(code)) offered.push({ code, num: c.value });
      else notInCalendar.add(code);
    }
    if (!offered.length) continue;

    // Section lists, then every section's outline, ~10 requests in flight.
    const jobs = [];
    await pool(offered, CONCURRENCY, async ({ code, num }) => {
      const sections = (await getJson(`${term.id}/${dept}/${num}`)) ?? [];
      const list = ((offerings[code] ??= {})[term.id] = new Array(sections.length));
      sections.forEach((s, j) => jobs.push({ list, j, num, s }));
    });
    await pool(jobs, CONCURRENCY, async ({ list, j, num, s }) => {
      list[j] = await fetchSection(term.id, dept, num, s);
    });
    termCourses += offered.length;
    termSections += jobs.length;
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `  ${term.label} [${i + 1}/${depts.length}] ${dept.toUpperCase()}: ${offered.length} courses, ${jobs.length} sections (${secs}s)`,
    );
  }
  totalSections += termSections;
  console.log(`  ${term.label}: ${termCourses} courses, ${termSections} sections`);
}

const sorted = Object.fromEntries(
  Object.entries(offerings)
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([code, byTerm]) => [code, Object.fromEntries(terms.filter((t) => byTerm[t.id]).map((t) => [t.id, byTerm[t.id]]))]),
);
await writeFile(OUT, JSON.stringify({ fetched: new Date().toISOString(), terms, offerings: sorted }));
console.log(
  `Wrote ${totalSections} sections for ${Object.keys(sorted).length} courses to public/data/offerings.json ` +
    `in ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
if (stats.missing) console.log(`  (${stats.missing} section outlines could not be fetched; kept without times)`);
if (stats.partialDates) console.log(`  (${stats.partialDates} sections meet on more than one date range)`);
if (notInCalendar.size) console.log(`  (${notInCalendar.size} offered courses skipped: not in courses.json)`);
