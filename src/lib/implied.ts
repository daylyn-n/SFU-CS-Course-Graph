// Courses you must have taken, given the ones you've ticked. Taking CMPT 310
// proves you took CMPT 225 and STAT 271 (both required), and so on down.
//
// "One of" groups are different: CMPT 225 accepts MACM 101 + CMPT 125 or
// ENSC 251 + ENSC 252, and we can't know which. The group itself is clearly
// met, so we guess the most likely route and mark those courses as assumed
// (certain: false). Saying you didn't take one of them (`notTaken`) makes the
// next route the guess.

import { codesIn, satisfied } from './graph';
import type { Courses, OtherReq, Prereq, Taken } from './types';

export interface Implied {
  /** the course whose prerequisites this came from */
  via: string;
  /** required on every route (true), or our guess for a "one of" (false) */
  certain: boolean;
}

const isOther = (t: Prereq): t is OtherReq => typeof t === 'object' && 'other' in t;
const dept = (code: string) => code.split(' ')[0];
const number = (code: string) => parseInt(code.split(' ')[1] ?? '', 10) || 0;

/** Courses needed on every way through `tree` (an OR needs none for sure). */
function requiredIn(tree: Prereq): string[] {
  if (typeof tree === 'string') return [tree];
  if (isOther(tree) || tree.op === 'or') return [];
  return tree.args.flatMap(requiredIn);
}
// Routes we'd never guess: you'd have to have been given permission, been in a
// specific program, or have an unlisted equivalent.
const unlikely = (o: OtherReq) => !!o.only || /permission|equivalent|admission/i.test(o.other);

/**
 * Courses implied by `taken`, never including anything in `notTaken`. Ticked
 * courses aren't in the result; it only holds what they imply.
 */
export function inferTaken(courses: Courses, taken: Taken, notTaken: Taken = new Set()): Map<string, Implied> {
  const result = new Map<string, Implied>();
  const known = new Set(taken); // ticked + implied so far
  // "One of" groups still to resolve, with the course that needs them.
  type OrGroup = { op: 'or'; args: Prereq[] };
  const pending: { tree: OrGroup; code: string }[] = [];

  // Untaken courses on the cheapest way to `tree`; only used to rule out
  // routes we'd never guess (permission, rejected courses).
  function cost(tree: Prereq | null | undefined, seen = new Set<string>()): number {
    if (tree == null) return 0;
    if (isOther(tree)) return unlikely(tree) ? 50 : 0;
    if (typeof tree === 'string') {
      if (known.has(tree)) return 0;
      if (notTaken.has(tree)) return Infinity;
      if (seen.has(tree)) return 1; // cycle in the data
      return 1 + cost(courses[tree]?.prereq, new Set(seen).add(tree));
    }
    const each = tree.args.map((a) => cost(a, seen));
    return tree.op === 'and' ? each.reduce((a, b) => a + b, 0) : Math.min(...each);
  }

  function add(c: string, via: string, certain: boolean) {
    if (c === via || notTaken.has(c) || known.has(c)) return;
    result.set(c, { via, certain });
    known.add(c);
    expand(courses[c]?.prereq, c, certain);
  }

  // Add everything `tree` requires for `code`; queue its "one of" groups.
  function expand(tree: Prereq | null | undefined, code: string, certain: boolean) {
    if (tree == null || isOther(tree)) return;
    if (typeof tree === 'string') add(tree, code, certain);
    else if (tree.op === 'and') for (const a of tree.args) expand(a, code, certain);
    else pending.push({ tree: tree as OrGroup, code });
  }

  // Pick the route through a "one of" that `code` was most likely taken by:
  // one you've already got a course from; else a free non-course option like
  // Pre-Calculus 12; else one that also settles other open "one of" groups
  // (CMPT 225 and CMPT 210 both accept CMPT 135, so that beats one course
  // each); else the one closest to the course's own department; else the
  // calendar's order (it lists the usual route first; "fewest prerequisites"
  // would favour niche courses like CMPT 129 over CMPT 125).
  function bestRoute(alts: Prereq[], code: string): Prereq | null {
    const open = pending.filter((p) => !satisfied(p.tree, known));
    const scored = alts
      .map((a, i) => {
        const codes = codesIn(a);
        const withRoute = new Set([...known, ...requiredIn(a)]);
        return {
          a,
          i,
          // A route needing a course you said you didn't take is out.
          blocked: requiredIn(a).some((c) => notTaken.has(c)) || cost(a) >= 50,
          have: codes.filter((c) => known.has(c)).length,
          free: isOther(a) && !unlikely(a),
          shared: open.filter((p) => satisfied(p.tree, withRoute)).length,
          near: codes.length ? codes.filter((c) => dept(c) === dept(code)).length / codes.length : 0,
        };
      })
      .filter((s) => !s.blocked);
    scored.sort(
      (x, y) =>
        y.have - x.have ||
        Number(y.free) - Number(x.free) ||
        y.shared - x.shared ||
        y.near - x.near ||
        x.i - y.i,
    );
    return scored[0]?.a ?? null;
  }

  // First everything that's certain, from higher course numbers down...
  const start = [...taken].sort((a, b) => number(b) - number(a) || a.localeCompare(b));
  for (const code of start) expand(courses[code]?.prereq, code, true);
  // ...then guess a route for each open "one of", which may open more.
  while (pending.length) {
    const { tree, code } = pending.shift()!;
    if (satisfied(tree, known)) continue;
    const route = bestRoute(tree.args, code);
    if (route) expand(route, code, false);
  }
  return result;
}
