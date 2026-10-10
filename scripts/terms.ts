// SFU terms, shared by the data scripts. Spring is Jan–Apr, Summer May–Aug,
// Fall Sep–Dec; ids look like "2026/fall", as both SFU APIs spell them.

import { CALENDAR_API, getJson } from './sfu-api.ts';

export type Season = 'spring' | 'summer' | 'fall';
export interface TermRef {
  year: number;
  season: Season;
}

export const SEASONS: Season[] = ['spring', 'summer', 'fall'];

export function currentTerm(date = new Date()): TermRef {
  return { year: date.getFullYear(), season: SEASONS[Math.floor(date.getMonth() / 4)] };
}

export function nextTerm({ year, season }: TermRef): TermRef {
  const i = SEASONS.indexOf(season);
  return i === 2 ? { year: year + 1, season: 'spring' } : { year, season: SEASONS[i + 1] };
}

export function prevTerm({ year, season }: TermRef): TermRef {
  const i = SEASONS.indexOf(season);
  return i === 0 ? { year: year - 1, season: 'fall' } : { year, season: SEASONS[i - 1] };
}

export const termId = ({ year, season }: TermRef): string => `${year}/${season}`;

/** "2026/fall" -> { year: 2026, season: 'fall' }; null if it isn't a term id. */
export function parseTermId(id: string): TermRef | null {
  const m = /^(\d{4})\/(spring|summer|fall)$/.exec(id);
  return m ? { year: Number(m[1]), season: m[2] as Season } : null;
}

/** Has the term finished (its last month is over) as of `date`? */
export function termEnded(id: string, date = new Date()): boolean {
  const t = parseTermId(id);
  if (!t) return false;
  // First day after the term: May 1, Sep 1 or Jan 1 of the next year.
  const after = new Date(t.year, (SEASONS.indexOf(t.season) + 1) * 4, 1);
  return date >= after;
}

/**
 * The academic calendar to build from: the current term's, or, if SFU hasn't
 * published that one yet (the API lists no departments for it), the latest
 * earlier one that is.
 */
export async function calendarTerm(date = new Date()): Promise<string> {
  let t = currentTerm(date);
  for (let tries = 0; tries < 3; tries++, t = prevTerm(t)) {
    const depts = await getJson(CALENDAR_API, `${termId(t)}/courses`);
    if (Array.isArray(depts) && depts.length) return termId(t);
    console.log(`  (no ${termId(t)} calendar published yet)`);
  }
  throw new Error(`No academic calendar found for ${termId(currentTerm(date))} or the two terms before it`);
}
