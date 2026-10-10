// Choices for the "taken with" / "which course" / "term" selects in the rate
// dialog, worked out from the offerings data.
import offeringData from '../../data/offerings.json';
import type { Offerings, Term } from '../types';

const offerings = offeringData.offerings as Offerings;
const terms = offeringData.terms as Term[];

/** Everyone listed as teaching a course in the published terms. */
export function instructorsOf(code: string): string[] {
  const names = Object.values(offerings[code] ?? {}).flatMap((sections) => sections.flatMap((s) => s.instructors));
  return [...new Set(names)].sort();
}

/** Courses a prof is listed as teaching in the published terms. */
export function coursesTaughtBy(name: string): string[] {
  return Object.entries(offerings)
    .filter(([, byTerm]) => Object.values(byTerm).some((ss) => ss.some((s) => s.instructors.includes(name))))
    .map(([code]) => code)
    .sort();
}

const SEASONS = ['spring', 'summer', 'fall'] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * The term `from` (e.g. "2026/fall") and the `count - 1` terms before it,
 * newest first, as { id, label } pairs.
 */
export function recentTerms(from: string, count: number): { id: string; label: string }[] {
  const [y, season] = from.split('/');
  let year = Number(y);
  let i = SEASONS.indexOf(season as (typeof SEASONS)[number]);
  if (!Number.isInteger(year) || i < 0) return [];
  const out = [];
  for (let n = 0; n < count; n++) {
    out.push({ id: `${year}/${SEASONS[i]}`, label: `${cap(SEASONS[i])} ${year}` });
    if (--i < 0) {
      i = SEASONS.length - 1;
      year--;
    }
  }
  return out;
}

/** Terms someone could have taken a course in: this term and the last three years. */
export const termOptions = recentTerms((terms.find((t) => t.current) ?? terms[0])?.id ?? '', 10);

/** "2026/fall" -> "Fall 2026"; anything else is shown as is. */
export function termLabel(id: string): string {
  const m = id.match(/^(\d{4})\/(spring|summer|fall)$/);
  return m ? `${cap(m[2])} ${m[1]}` : id;
}
