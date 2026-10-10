// Turn what someone typed into a course code: "cmpt225", "CMPT 225 — Data
// Structures…", or a title like "machine learning" (if only one course matches).
// Ranking comes from fuzzy.ts, the app's one search engine; this adds the
// "is it an exact match?" rules on top.

import { rankCourses } from './fuzzy';
import type { Courses } from './types';

export interface SearchHit {
  code: string;
  /** fuzzy score, higher is better */
  score: number;
  /** the query is the course's code (any spacing/case) or its full title */
  exact: boolean;
}

const CODE = /^([A-Za-z]{2,5})\s*(\d{3}[A-Za-z]?)\b/;

export function matchCourse(query: string, courses: Courses): string | null {
  const q = query.trim();
  if (!q) return null;
  const m = q.match(CODE);
  if (m) {
    const code = `${m[1]} ${m[2]}`.toUpperCase();
    if (code in courses) return code;
  }
  const hits = searchCourses(q, courses, 2);
  return hits.length === 1 || hits[0]?.exact ? hits[0].code : null;
}

/**
 * Courses matching by code or by name, best first (exact matches always
 * lead). Title words can come in any order and be abbreviated, so "intro
 * prog" finds "Introduction to Computing Science and Programming I".
 */
export function searchCourses(query: string, courses: Courses, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const compact = q.replace(/\s/g, '');
  const isExact = (code: string, title: string) =>
    code.toLowerCase().replace(' ', '') === compact || title.toLowerCase() === q;
  // Rank everything so an exact title match can't fall outside the limit.
  return rankCourses(q, courses, Infinity)
    .map((m) => ({ code: m.code, score: m.score, exact: isExact(m.code, m.title) }))
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .slice(0, limit);
}
