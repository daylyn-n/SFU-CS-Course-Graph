import { codesIn } from './graph';
import type { Courses, Offerings, OtherReq, Prereq, Taken, Term } from './types';

export interface PlanOptions {
  /** terms that have offering data, as in offerings.json */
  terms?: Term[];
  offerings?: Offerings;
  /** term id to start in (default: the current term, else the first known one) */
  start?: string;
  /** most courses to put in one term (default 4) */
  maxPerTerm?: number;
}

export interface PlannedCourse {
  code: string;
  title: string;
  /** null when the course isn't in the loaded data */
  units: number | null;
  missing: boolean;
  /** false when the term has no offering data, so we're only guessing it runs */
  confirmed: boolean;
  isTarget: boolean;
}

export interface PlanTerm {
  id: string; // "2027/summer"
  label: string; // "Summer 2027"
  short: string; // "Su27"
  /** the term has offering data */
  known: boolean;
  courses: PlannedCourse[];
}

export interface Plan {
  target: string;
  terms: PlanTerm[];
  courseCount: number;
  totalUnits: number;
  /** planned courses that aren't in the loaded data (their prerequisites are unknown) */
  missing: string[];
  /** courses whose prerequisites loop back on themselves; the loop was ignored */
  cycles: string[];
  /** the target is already taken, so there's nothing to plan */
  alreadyTaken: boolean;
}

const SEASONS = ['spring', 'summer', 'fall'] as const;
type Season = (typeof SEASONS)[number];

/** "2026/fall" -> "2027/spring" -> "2027/summer" -> "2027/fall" ... */
export function nextTermId(id: string): string {
  const [year, season] = id.split('/');
  const i = SEASONS.indexOf(season as Season);
  if (i < 0) throw new Error(`Unrecognised term id: ${id}`);
  return i === SEASONS.length - 1 ? `${+year + 1}/${SEASONS[0]}` : `${year}/${SEASONS[i + 1]}`;
}

export function termInfo(id: string): { id: string; label: string; short: string } {
  const [year, season] = id.split('/');
  const name = season[0].toUpperCase() + season.slice(1);
  return { id, label: `${name} ${year}`, short: name.slice(0, 2) + year.slice(-2) };
}

// What part of a prerequisite tree needs: each untaken course to add mapped
// to the courses it directly waits on, the courses this part names directly,
// and any prerequisite loops we had to cut to get there.
interface Need {
  edges: Map<string, Set<string>>;
  direct: Set<string>;
  loops: Set<string>;
}

const none = (): Need => ({ edges: new Map(), direct: new Set(), loops: new Set() });

/**
 * Pick a small set of untaken courses that satisfies `target`'s prerequisites.
 * For a "one of" group it takes the alternative that adds the fewest courses
 * on top of what the rest of the tree already needs, preferring ones without
 * loops, then ones with known offerings. Returns the chosen courses mapped to
 * the chosen courses each directly depends on.
 */
export function chooseCourses(
  target: string,
  courses: Courses,
  done: Taken,
  isOffered: (code: string) => boolean = () => true,
): { deps: Map<string, Set<string>>; cycles: Set<string> } {
  const memo = new Map<string, Need>();
  const reachMemo = new Map<string, string[]>();
  const stack: string[] = [];

  // Every course anywhere below `code`, so the memo key only includes the
  // parts of `have` that can change the answer.
  function reach(code: string): string[] {
    let out = reachMemo.get(code);
    if (!out) {
      const seen = new Set<string>();
      const queue = codesIn(courses[code]?.prereq);
      while (queue.length) {
        const c = queue.pop()!;
        if (seen.has(c)) continue;
        seen.add(c);
        queue.push(...codesIn(courses[c]?.prereq));
      }
      reachMemo.set(code, (out = [...seen].sort()));
    }
    return out;
  }

  // `have` is what the rest of the tree already pulls in, so a "one of" can
  // favour an alternative that overlaps with it.
  function course(code: string, have: ReadonlySet<string>): Need {
    if (done.has(code)) return none();
    // Someone else is already adding it (and its prerequisites).
    if (have.has(code)) return { ...none(), direct: new Set([code]) };
    if (stack.includes(code)) {
      // A prerequisite loop (bad parse or genuinely circular). Treat the
      // back edge as met so the rest can still be planned.
      return { ...none(), loops: new Set([code]) };
    }
    const key = code + '|' + reach(code).filter((c) => have.has(c)).join();
    const cached = memo.get(key);
    if (cached) return cached;
    stack.push(code);
    const inner = tree(courses[code]?.prereq ?? null, have);
    stack.pop();
    const need: Need = {
      edges: new Map([[code, inner.direct], ...inner.edges]),
      direct: new Set([code]),
      loops: inner.loops,
    };
    // A result that cut a loop depends on where we came from, so don't reuse it.
    if (!need.loops.size) memo.set(key, need);
    return need;
  }

  function tree(t: Prereq | null, have: ReadonlySet<string>): Need {
    const out = none();
    if (t == null) return out;
    if (typeof t === 'string') return course(t, have);
    // Non-course requirements (Pre-Calculus 12, a program) add no courses.
    if (isOther(t)) return out;
    if (t.op === 'and') {
      // Settle the fixed requirements first, then the choices.
      const ordered = [...t.args].sort((a, b) => +isOr(a) - +isOr(b));
      for (const arg of ordered) merge(out, tree(arg, new Set([...have, ...out.edges.keys()])));
      return out;
    }
    let best: { need: Need; score: number[] } | null = null;
    for (const arg of t.args) {
      const need = tree(arg, have);
      const added = [...need.edges.keys()];
      const unoffered = added.filter((c) => !courses[c] || !isOffered(c)).length;
      // Most students have Pre-Calculus 12 and the like, so those are free,
      // but "or permission" and program-only routes shouldn't beat courses.
      const hard = isOther(arg) && (!!arg.only || /permission|equivalent|admission/i.test(arg.other));
      const score = [+(need.loops.size > 0), +hard, added.length, unoffered];
      if (!best || lexLess(score, best.score)) best = { need, score };
      if (score[0] === 0 && score[1] === 0 && score[2] === 0) break; // nothing more to add
    }
    return best ? best.need : out;
  }

  const { edges, loops } = course(target, new Set());
  return { deps: edges, cycles: loops };
}

function isOr(t: Prereq): boolean {
  return typeof t !== 'string' && !isOther(t) && t.op === 'or';
}

const isOther = (t: Prereq): t is OtherReq => typeof t === 'object' && 'other' in t;

function merge(into: Need, from: Need) {
  // Keep the first entry for a course: later ones were told it was covered.
  for (const [c, ds] of from.edges) if (!into.edges.has(c)) into.edges.set(c, ds);
  from.direct.forEach((c) => into.direct.add(c));
  from.loops.forEach((c) => into.loops.add(c));
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Build a term-by-term plan to reach `target` from the taken set.
 *
 * Each course goes in a term strictly after all of its chosen prerequisites.
 * In terms with offering data a course only goes where it's offered; later
 * terms have no data, so anything can go there but is marked unconfirmed.
 * Longer prerequisite chains are scheduled first so they don't hold up the end.
 */
export function planCourses(target: string, courses: Courses, done: Taken, options: PlanOptions = {}): Plan {
  const { terms = [], offerings = {}, maxPerTerm = 4 } = options;
  const start = options.start ?? (terms.find((t) => t.current) ?? terms[0])?.id ?? '2026/fall';
  const perTerm = Math.max(1, Math.floor(maxPerTerm));
  const knownIds = new Set(terms.map((t) => t.id));
  const offeredSomewhere = (code: string) => terms.some((t) => offerings[code]?.[t.id]);

  const base = { target, terms: [], courseCount: 0, totalUnits: 0, missing: [], cycles: [] };
  if (done.has(target)) return { ...base, alreadyTaken: true };

  const { deps, cycles } = chooseCourses(target, courses, done, offeredSomewhere);

  // Height = longest chain of chosen courses that depends on this one.
  // Edges into a loop are ignored here too, so this always terminates.
  const dependents = new Map<string, string[]>();
  for (const [code, ds] of deps) for (const d of ds) (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(code);
  const height = new Map<string, number>();
  const heightOf = (code: string, path: Set<string> = new Set()): number => {
    if (height.has(code)) return height.get(code)!;
    path.add(code);
    let h = 0;
    for (const up of dependents.get(code) ?? []) if (!path.has(up)) h = Math.max(h, 1 + heightOf(up, path));
    path.delete(code);
    height.set(code, h);
    return h;
  };

  // Drop edges that close a loop so every course can eventually be placed.
  const edges = new Map<string, Set<string>>();
  const state = new Map<string, 'visiting' | 'done'>();
  const acyclic = (code: string) => {
    state.set(code, 'visiting');
    const kept = new Set<string>();
    for (const d of deps.get(code) ?? []) {
      if (state.get(d) === 'visiting') continue;
      if (!state.has(d)) acyclic(d);
      kept.add(d);
    }
    edges.set(code, kept);
    state.set(code, 'done');
  };
  for (const code of deps.keys()) if (!state.has(code)) acyclic(code);

  const termOf = new Map<string, number>();
  const plan: PlanTerm[] = [];
  let id = start;
  // Generous cap: a chain can't be longer than the number of courses, plus a
  // few terms of waiting for something to be offered.
  const limit = deps.size * 3 + 6;
  while (termOf.size < deps.size && plan.length < limit) {
    const known = knownIds.has(id);
    const index = plan.length;
    const ready = [...deps.keys()]
      .filter((c) => !termOf.has(c) && [...edges.get(c)!].every((d) => (termOf.get(d) ?? Infinity) < index))
      .filter((c) => !known || offerings[c]?.[id])
      .sort((a, b) => heightOf(b) - heightOf(a) || a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, perTerm);
    ready.forEach((c) => termOf.set(c, index));
    plan.push({
      ...termInfo(id),
      known,
      courses: ready.map((code) => {
        const c = courses[code];
        return {
          code,
          title: c?.title ?? 'Not in loaded data',
          units: c ? Number(c.units) || 0 : null,
          missing: !c,
          confirmed: known,
          isTarget: code === target,
        };
      }),
    });
    id = nextTermId(id);
  }

  const placed = plan.flatMap((t) => t.courses);
  return {
    ...base,
    terms: plan,
    courseCount: placed.length,
    totalUnits: placed.reduce((sum, c) => sum + (c.units ?? 0), 0),
    missing: placed.filter((c) => c.missing).map((c) => c.code),
    cycles: [...cycles].sort(),
    alreadyTaken: false,
  };
}
