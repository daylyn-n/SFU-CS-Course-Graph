// Finds which courses in src/data/courses.json run this term and in upcoming
// terms SFU has already published, with each section's instructors, campus
// and meeting times. Writes src/data/offerings.json.
//
// Usage: node scripts/fetch-offerings.ts [how many terms, default 3]

import { readFile, writeFile } from 'node:fs/promises';
import type { Courses, Offerings, Section, Term } from '../src/lib/types.ts';
import { OUTLINES_API, getJson as getJsonFrom, pool } from './sfu-api.ts';

type Season = 'spring' | 'summer' | 'fall';
interface TermRef {
  year: number;
  season: Season;
}
/** One block of a section's courseSchedule in the outlines API. */
interface ScheduleBlock {
  isExam?: boolean;
  days?: string;
  startTime?: string;
  endTime?: string;
  campus?: string;
}

const MAX_TERMS = Number(process.argv[2] ?? 3);
const COURSES = new URL('../src/data/courses.json', import.meta.url);
const OUT = new URL('../src/data/offerings.json', import.meta.url);
const SEASONS: Season[] = ['spring', 'summer', 'fall'];
const getJson = (path: string) => getJsonFrom(OUTLINES_API, path);

// SFU terms: Spring Jan–Apr, Summer May–Aug, Fall Sep–Dec.
function currentTerm(date = new Date()): TermRef {
  return { year: date.getFullYear(), season: SEASONS[Math.floor(date.getMonth() / 4)] };
}

function nextTerm({ year, season }: TermRef): TermRef {
  const i = SEASONS.indexOf(season);
  return i === 2 ? { year: year + 1, season: 'spring' } : { year, season: SEASONS[i + 1] };
}

// The current term plus following terms, as long as SFU has published them.
async function availableTerms(): Promise<Term[]> {
  const terms: TermRef[] = [];
  const seasonsByYear: Record<number, string[]> = {};
  let t = currentTerm();
  while (terms.length < MAX_TERMS) {
    seasonsByYear[t.year] ??= ((await getJson(`${t.year}`)) ?? []).map((s: { value: string }) => s.value);
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

function formatSchedule(blocks: ScheduleBlock[] = []): string {
  const parts = blocks
    .filter((b) => !b.isExam && b.days)
    .map((b) => `${b.days} ${b.startTime}–${b.endTime}`);
  return [...new Set(parts)].join(', ');
}

async function fetchSection(termId: string, dept: string, num: string, section: string): Promise<Section> {
  const o = await getJson(`${termId}/${dept}/${num}/${section}`);
  // Keeps the original output shape: a failed lookup has no campus/delivery/schedule keys.
  if (!o) return { section: section.toUpperCase(), instructors: [] } as unknown as Section;
  const schedule: ScheduleBlock[] = o.courseSchedule ?? [];
  return {
    section: section.toUpperCase(),
    instructors: [
      ...new Set<string>(
        (o.instructor ?? [])
          .map((p: { commonName?: string; firstName?: string; lastName?: string }) => [p.commonName || p.firstName, p.lastName].filter(Boolean).join(' ').trim())
          .filter(Boolean),
      ),
    ],
    campus: o.info?.campus || schedule.find((b) => b.campus)?.campus || '',
    delivery: o.info?.deliveryMethod || '',
    schedule: formatSchedule(schedule),
  };
}

const { courses }: { courses: Courses } = JSON.parse(await readFile(COURSES, 'utf8'));
const wanted = new Set(Object.keys(courses));
const depts = [...new Set(Object.keys(courses).map((c) => c.split(' ')[0].toLowerCase()))];

const terms = await availableTerms();
console.log(`Terms: ${terms.map((t) => t.label).join(', ')}`);

const offerings: Offerings = {};
for (const term of terms) {
  const offered: { code: string; dept: string; num: string }[] = [];
  await pool(depts, 6, async (dept: string) => {
    for (const c of (await getJson(`${term.id}/${dept}`)) ?? []) {
      const code = `${dept.toUpperCase()} ${c.text.toUpperCase()}`;
      if (wanted.has(code)) offered.push({ code, dept, num: c.value });
    }
  });

  await pool(offered, 8, async ({ code, dept, num }) => {
    const sections = (await getJson(`${term.id}/${dept}/${num}`)) ?? [];
    // classType "e" marks the section you enrol in (lecture/seminar), not labs/tutorials.
    const enrolment = sections.filter((s: { classType: string }) => s.classType === 'e');
    const details: Section[] = [];
    for (const s of enrolment) details.push(await fetchSection(term.id, dept, num, s.value));
    (offerings[code] ??= {})[term.id] = details;
  });
  console.log(`  ${term.label}: ${offered.length} courses offered`);
}

const sorted = Object.fromEntries(
  Object.entries(offerings).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
);
await writeFile(OUT, JSON.stringify({ fetched: new Date().toISOString(), terms, offerings: sorted }, null, 1));
console.log(`Wrote offerings for ${Object.keys(sorted).length} courses to src/data/offerings.json`);
