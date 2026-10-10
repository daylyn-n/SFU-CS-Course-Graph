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
// Usage: node scripts/fetch-offerings.ts [how many terms, default 3]

import { readFile, writeFile } from 'node:fs/promises';
import type { Block, CourseData, Offerings, Section, Term } from '../src/lib/types.ts';
import { OUTLINES_API, getJson as getJsonFrom, pool } from './sfu-api.ts';
import { currentTerm, nextTerm, type TermRef } from './terms.ts';

/** An entry in an outlines API list (years, terms, departments, courses). */
interface ListItem {
  text: string;
  value: string;
}
/** A section in a course's section list in the outlines API. */
interface SectionItem extends ListItem {
  sectionCode?: string;
  classType?: string;
  associatedClass?: string;
}
/** One block of a section's courseSchedule in the outlines API. */
interface ScheduleBlock {
  isExam?: boolean;
  days?: string;
  startTime?: string;
  endTime?: string;
  startDate?: string;
  endDate?: string;
  campus?: string;
}
/** A section's outline in the outlines API (only the fields used here). */
interface Outline {
  courseSchedule?: ScheduleBlock[];
  instructor?: { commonName?: string; firstName?: string; lastName?: string }[];
  info?: { campus?: string; deliveryMethod?: string };
}

const MAX_TERMS = Number(process.argv[2] ?? 3);
const CONCURRENCY = 10;
const COURSES = new URL('../public/data/courses.json', import.meta.url);
const OUT = new URL('../public/data/offerings.json', import.meta.url);
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const getJson = (path: string) => getJsonFrom(OUTLINES_API, path);

// The current term plus following terms, as long as SFU has published them.
async function availableTerms(): Promise<Term[]> {
  const terms: TermRef[] = [];
  const seasonsByYear: Record<number, string[]> = {};
  let t = currentTerm();
  while (terms.length < MAX_TERMS) {
    seasonsByYear[t.year] ??= (((await getJson(`${t.year}`)) ?? []) as ListItem[]).map((s) => s.value);
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
function hhmm(t = ''): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/** "Wed Sep 09 00:00:00 PDT 2026" -> "2026-09-09"; '' if unparseable. */
function isoDate(s = ''): string {
  const m = /^\w{3} (\w{3}) (\d{1,2}) .* (\d{4})$/.exec(s.trim());
  const mon = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || mon < 0) return '';
  return `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function parseDays(s = ''): string[] {
  const set = new Set(s.split(/[\s,]+/).filter((d) => DAYS.includes(d)));
  return DAYS.filter((d) => set.has(d));
}

/** Non-exam meetings as one block per distinct (days, start, end). */
function toBlocks(schedule: ScheduleBlock[]): Block[] {
  const blocks = new Map<string, Block>();
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

function formatSchedule(blocks: Block[]): string {
  return blocks.map((b) => `${b.days.join(', ')} ${b.start}–${b.end}`).join(', ');
}

function toExam(schedule: ScheduleBlock[]): Section['exam'] {
  const e = schedule.find((b) => b.isExam);
  if (!e) return undefined;
  const exam = { date: isoDate(e.startDate), start: hhmm(e.startTime), end: hhmm(e.endTime) };
  return exam.date || exam.start ? exam : undefined;
}

const stats = { outlines: 0, missing: 0, partialDates: 0 };

async function fetchSection(termId: string, dept: string, num: string, s: SectionItem): Promise<Section> {
  const base = {
    section: s.text.toUpperCase(),
    type: s.sectionCode || '',
    enrol: s.classType === 'e',
    assoc: s.associatedClass ?? '',
  };
  const o: Outline | null = await getJson(`${termId}/${dept}/${num}/${s.value}`);
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
const { courses }: CourseData = JSON.parse(await readFile(COURSES, 'utf8'));
const wanted = new Set(Object.keys(courses));
const depts = [...new Set(Object.keys(courses).map((c) => c.split(' ')[0].toLowerCase()))].sort();

const terms = await availableTerms();
console.log(`Terms: ${terms.map((t) => t.label).join(', ')}; ${depts.length} departments`);

const offerings: Offerings = {};
const notInCalendar = new Set<string>();
let totalSections = 0;
for (const term of terms) {
  let termCourses = 0;
  let termSections = 0;
  for (const [i, dept] of depts.entries()) {
    const offered: { code: string; num: string }[] = [];
    for (const c of ((await getJson(`${term.id}/${dept}`)) ?? []) as ListItem[]) {
      const code = `${dept.toUpperCase()} ${c.text.toUpperCase()}`;
      if (wanted.has(code)) offered.push({ code, num: c.value });
      else notInCalendar.add(code);
    }
    if (!offered.length) continue;

    // Section lists, then every section's outline, ~10 requests in flight.
    const jobs: { list: Section[]; j: number; num: string; s: SectionItem }[] = [];
    await pool(offered, CONCURRENCY, async ({ code, num }) => {
      const sections: SectionItem[] = (await getJson(`${term.id}/${dept}/${num}`)) ?? [];
      const list = ((offerings[code] ??= {})[term.id] = new Array<Section>(sections.length));
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

const sorted: Offerings = Object.fromEntries(
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
