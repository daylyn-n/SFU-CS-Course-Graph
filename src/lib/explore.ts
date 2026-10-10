import { codesIn, courseStatus, satisfied } from './graph';
import type { Courses, Prereq, Taken } from './types';

/** course code -> courses that mention it as a prerequisite */
export type ReverseIndex = ReadonlyMap<string, readonly string[]>;

export interface ExploreEntry {
  code: string;
  /** untaken courses that become ready once this one is taken */
  unlocks: string[];
  /** untaken courses that still aren't ready, but need fewer courses after this one */
  closer: string[];
  /** unlocks + closer */
  score: number;
  /** For "almost ready" courses: taking any one of these makes it ready. Empty when ready. */
  missing: string[];
  /**
   * Ready only if a requirement that isn't an SFU course is met (Pre-Calculus
   * 12, "60 units"): courseStatus 'unknown'.
   */
  check?: boolean;
}

export interface ExploreResult {
  ready: ExploreEntry[];
  almost: ExploreEntry[];
}

/** Which courses list each course as a prerequisite? */
export function reverseIndex(courses: Courses): ReverseIndex {
  const index = new Map<string, string[]>();
  for (const [code, c] of Object.entries(courses)) {
    for (const ref of new Set(codesIn(c.prereq))) {
      if (ref === code) continue;
      const list = index.get(ref);
      if (list) list.push(code);
      else index.set(ref, [code]);
    }
  }
  return index;
}

/**
 * Fewest untaken courses that would satisfy a tree. Courses shared between
 * AND branches are counted once per branch, so it's an upper bound, but it's
 * only used to tell whether a course got closer.
 */
export function coursesNeeded(tree: Prereq | null | undefined, done: Taken): number {
  if (tree == null) return 0;
  if (typeof tree === 'string') return done.has(tree) ? 0 : 1;
  // Non-course requirements (Pre-Calculus 12, a program) are assumed met
  // here, as they are for the 'unknown' status: no courses needed.
  if ('other' in tree) return 0;
  const costs = tree.args.map((a) => coursesNeeded(a, done));
  return tree.op === 'and' ? costs.reduce((a, b) => a + b, 0) : Math.min(...costs);
}

const plus = (done: Taken, code: string): Taken => new Set(done).add(code);

/** What taking `code` would do for the courses that build on it. */
export function unlockScore(
  code: string,
  courses: Courses,
  done: Taken,
  index: ReverseIndex = reverseIndex(courses),
): Pick<ExploreEntry, 'unlocks' | 'closer' | 'score'> {
  const after = plus(done, code);
  const unlocks: string[] = [];
  const closer: string[] = [];
  for (const next of index.get(code) ?? []) {
    const tree = courses[next].prereq;
    // Non-course requirements count as met (true), like the 'unknown' status.
    if (done.has(next) || satisfied(tree, done, true)) continue;
    if (satisfied(tree, after, true)) unlocks.push(next);
    else if (coursesNeeded(tree, after) < coursesNeeded(tree, done)) closer.push(next);
  }
  return { unlocks, closer, score: unlocks.length + closer.length };
}

/**
 * Courses you could take now ("ready"), and ones one course away ("almost"):
 * a single missing course, or a single "one of" group where any option will do.
 */
export function explore(courses: Courses, done: Taken, index: ReverseIndex = reverseIndex(courses)): ExploreResult {
  const ready: ExploreEntry[] = [];
  const almost: ExploreEntry[] = [];
  for (const [code, course] of Object.entries(courses)) {
    if (done.has(code)) continue;
    const tree = course.prereq;
    const status = courseStatus(code, courses, done);
    if (status === 'ready' || status === 'unknown') {
      ready.push({ code, ...unlockScore(code, courses, done, index), missing: [], check: status === 'unknown' });
      continue;
    }
    const candidates = new Set(codesIn(tree).filter((c) => !done.has(c) && c !== code));
    const missing = [...candidates].filter((c) => satisfied(tree, plus(done, c), true)).sort();
    if (missing.length) almost.push({ code, ...unlockScore(code, courses, done, index), missing });
  }
  return { ready, almost };
}

/** "CMPT 225" -> "CMPT" */
export const department = (code: string): string => code.split(' ')[0];

/** "CMPT 225" -> 200 */
export function level(code: string): number {
  const n = code.match(/\d{3}/)?.[0];
  return n ? Number(n[0]) * 100 : 0;
}

export type SortKey = 'score' | 'code' | 'level';

/** Sort entries in place: score is highest first, the others ascending. */
export function sortEntries(entries: ExploreEntry[], by: SortKey): ExploreEntry[] {
  const byCode = (a: ExploreEntry, b: ExploreEntry) => a.code.localeCompare(b.code, 'en', { numeric: true });
  return entries.sort((a, b) => {
    if (by === 'score') return b.score - a.score || b.unlocks.length - a.unlocks.length || byCode(a, b);
    if (by === 'level') return level(a.code) - level(b.code) || byCode(a, b);
    return byCode(a, b);
  });
}
