// Degree requirements: the data model for a program, and a pure evaluator that
// checks a set of taken courses against it.
//
// Allocation rules:
// - Requirements are "exclusive" by default: a course counted for one
//   exclusive requirement can't count for another. They are filled most
//   specific first (single courses, then "one of", then lists, then ranges),
//   and when choosing between eligible courses the evaluator prefers the ones
//   fewer other requirements are still waiting on.
// - `shared` requirements (unit totals, breadth, depth) overlay the others and
//   count every matching course, except ones allocated to the requirements
//   named in `notCountingFrom` (e.g. the BSc credential courses that must be
//   "in addition to" the 30 upper-division CMPT units).
// - Within a program, courses in an `equivalents` group (cross-listed
//   courses) count once.

import type { Courses, Taken } from './types.ts';

/** A set of courses: explicit codes and/or numeric ranges, minus exclusions. */
export interface CourseSet {
  codes?: string[];
  /** e.g. { subjects: ['CMPT'], from: 300, to: 499 }; subjects ['*'] = any */
  ranges?: { subjects: string[]; from: number; to: number }[];
  exclude?: string[];
}

interface ReqBase {
  id: string;
  title: string;
  /** Calendar wording or caveats, shown under the requirement. */
  note?: string;
  /** Overlay requirement: counts courses already used by others. */
  shared?: boolean;
  /** For shared requirements: ignore courses allocated to these requirement ids. */
  notCountingFrom?: string[];
}

export type Requirement =
  /** One specific course. */
  | (ReqBase & { kind: 'course'; code: string })
  /** Any one option; each option is a set of courses that must all be taken. */
  | (ReqBase & { kind: 'oneOf'; options: string[][] })
  /** At least `courses` courses and/or `units` units from a set. */
  | (ReqBase & { kind: 'choose'; from: CourseSet; courses?: number; units?: number })
  /** One course in each of `count` distinct areas. */
  | (ReqBase & { kind: 'areas'; count: number; areas: { name: string; codes: string[] }[] })
  /**
   * Something that can't be checked automatically (calendar text we couldn't
   * read). Shown as "check with an advisor"; never counts toward progress.
   * `codes` are courses the text mentions, shown as taken/not taken.
   */
  | (ReqBase & { kind: 'note'; text: string; codes?: string[] });

export interface RequirementSection {
  title: string;
  /** Calendar prose for the section; lines separated by newlines. */
  note?: string;
  requirements: Requirement[];
  /**
   * Alternative sections (streams, concentrations): sections sharing a
   * `group` are options, of which the student completes one. Only the best
   * matching one counts; `optional` groups don't count at all.
   */
  choice?: { group: string; label?: string; optional?: boolean };
}

export interface Program {
  id: string;
  name: string;
  /** e.g. "BSc", "Minor" */
  credential: string;
  calendar: string; // "Fall 2026"
  source: string; // URL of the calendar page
  sections: RequirementSection[];
  /** Groups of cross-listed/equivalent courses; only one of each counts. */
  equivalents?: string[][];
  /** Things the calendar leaves open, or that this model simplifies. */
  caveats?: string[];
  /** Faculty offering the program. */
  faculty?: string;
  /** True when converted automatically from the calendar (not hand-written). */
  converted?: boolean;
  /** For hand-written programs: the calendar program id this replaces. */
  calendarId?: string;
}

/** 'manual': a note requirement, which the student checks with an advisor. */
export type ReqStatus = 'met' | 'partial' | 'unmet' | 'manual';

export interface RequirementResult {
  req: Requirement;
  status: ReqStatus;
  /** Courses counted toward this requirement. */
  counted: string[];
  /** Progress in the requirement's own measure (courses, units or areas). */
  have: number;
  need: number;
  measure: 'courses' | 'units' | 'areas';
  /** Short human summary of what's left, '' when met. */
  remaining: string;
  /** Untaken courses that would count toward it (catalog order). */
  candidates: string[];
}

export interface SectionResult {
  section: RequirementSection;
  results: RequirementResult[];
  /**
   * For alternative sections (streams): whether this is the one being
   * counted (the best match). Unchosen alternatives are evaluated on their
   * own for display but don't count toward the totals.
   */
  chosen?: boolean;
}

export interface ProgramResult {
  program: Program;
  sections: SectionResult[];
  met: number;
  /** Requirements counted toward progress (excludes manual items and unchosen alternatives). */
  total: number;
  /** Manual (advisor-check) items in the counted sections. */
  manual: number;
  /** Fraction 0..1, giving partial credit by each requirement's own measure. */
  fraction: number;
  /** Units of taken courses counted by at least one requirement. */
  unitsCounted: number;
  /** Taken courses ignored because an equivalent course already counts. */
  duplicates: string[];
}

const CODE_RE = /^([A-Z]{2,5}) (\d{3})[A-Z]?$/;

export function inSet(code: string, set: CourseSet): boolean {
  if (set.exclude?.includes(code)) return false;
  if (set.codes?.includes(code)) return true;
  const m = CODE_RE.exec(code);
  if (!m || !set.ranges) return false;
  const n = Number(m[2]);
  return set.ranges.some(
    (r) => (r.subjects.includes('*') || r.subjects.includes(m[1])) && n >= r.from && n <= r.to,
  );
}

/** Units for a course from the catalog, defaulting to 3. */
export function unitsOf(code: string, courses: Courses): number {
  const u = parseFloat(courses[code]?.units ?? '');
  return Number.isFinite(u) ? u : 3;
}

function matches(req: Requirement, code: string): boolean {
  switch (req.kind) {
    case 'course':
      return req.code === code;
    case 'oneOf':
      return req.options.some((o) => o.includes(code));
    case 'choose':
      return inSet(code, req.from);
    case 'areas':
      return req.areas.some((a) => a.codes.includes(code));
    case 'note':
      return false;
  }
}

/** Rough size of the set a requirement draws from; smaller = fill first. */
function specificity(req: Requirement, catalog: string[]): number {
  switch (req.kind) {
    case 'course':
      return 1;
    case 'oneOf':
      return 1 + req.options.length;
    case 'choose':
      return 10 + catalog.filter((c) => inSet(c, req.from)).length + (req.from.ranges ? 1000 : 0);
    case 'areas':
      return 10 + req.areas.reduce((n, a) => n + a.codes.length, 0);
    case 'note':
      return Infinity;
  }
}

/** Maximum matching of areas to courses (one course per area). */
function matchAreas(areas: { codes: string[] }[], pool: string[]): Map<number, string> {
  const owner = new Map<string, number>(); // course -> area index
  const assign = (ai: number, seen: Set<string>): boolean => {
    for (const c of areas[ai].codes) {
      if (!pool.includes(c) || seen.has(c)) continue;
      seen.add(c);
      const prev = owner.get(c);
      if (prev === undefined || assign(prev, seen)) {
        owner.set(c, ai);
        return true;
      }
    }
    return false;
  };
  areas.forEach((_, i) => assign(i, new Set()));
  const out = new Map<number, string>();
  for (const [c, ai] of owner) out.set(ai, c);
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Evaluate a list of sections together (one allocation of courses). */
function evaluateSections(
  program: Program,
  sectionList: RequirementSection[],
  taken: Taken,
  courses: Courses,
  catalog: string[],
): { results: Map<string, RequirementResult>; duplicates: string[] } {
  const units = (c: string) => unitsOf(c, courses);

  // Equivalent courses count once: keep the first taken one in each group.
  const duplicates: string[] = [];
  const effective = new Set(taken);
  for (const group of program.equivalents ?? []) {
    const had = group.filter((c) => effective.has(c));
    for (const c of had.slice(1)) {
      effective.delete(c);
      duplicates.push(c);
    }
  }
  const equivalentOf = (code: string): string[] =>
    program.equivalents?.find((g) => g.includes(code)) ?? [code];
  const takenAny = (code: string) => equivalentOf(code).some((c) => effective.has(c));

  const all = sectionList.flatMap((s) => s.requirements);
  const notes = all.filter((r) => r.kind === 'note');
  const exclusive = all.filter((r) => !r.shared && r.kind !== 'note');
  const shared = all.filter((r) => r.shared && r.kind !== 'note');
  const results = new Map<string, RequirementResult>();
  const used = new Map<string, string>(); // course -> exclusive requirement id
  const done = new Set<string>(); // exclusive requirement ids already filled

  const available = () => [...effective].filter((c) => !used.has(c)).sort();

  /** How many other requirements still want this course (lower = safer to use). */
  function demand(code: string, self: Requirement): number {
    let n = 0;
    for (const r of exclusive) if (r !== self && !done.has(r.id) && matches(r, code)) n++;
    for (const r of shared) if (r.notCountingFrom?.includes(self.id) && matches(r, code)) n++;
    return n;
  }
  const byDemand = (self: Requirement) => (a: string, b: string) =>
    demand(a, self) - demand(b, self) || a.localeCompare(b);

  const untakenCandidates = (req: Requirement): string[] => {
    let list: string[];
    if (req.kind === 'course') list = [req.code];
    else if (req.kind === 'oneOf') list = [...new Set(req.options.flat())];
    else if (req.kind === 'areas') list = [...new Set(req.areas.flatMap((a) => a.codes))];
    else if (req.kind === 'note') list = req.codes ?? [];
    else list = [...new Set([...(req.from.codes ?? []), ...catalog.filter((c) => inSet(c, req.from))])];
    return list.filter((c) => !takenAny(c));
  };

  function evalChoose(
    req: Extract<Requirement, { kind: 'choose' }>,
    pool: string[],
    pick: boolean,
  ): RequirementResult {
    const eligible = pool.filter((c) => inSet(c, req.from));
    if (pick) eligible.sort(byDemand(req));
    const counted: string[] = [];
    let u = 0;
    const enough = () =>
      (req.courses === undefined || counted.length >= req.courses) &&
      (req.units === undefined || u >= req.units);
    for (const c of eligible) {
      if (pick && enough()) break;
      counted.push(c);
      u += units(c);
    }
    const byUnits = req.units !== undefined;
    const have = byUnits ? u : counted.length;
    const need = byUnits ? req.units! : (req.courses ?? 1);
    const met = enough();
    const left: string[] = [];
    if (!met && req.units !== undefined && u < req.units) left.push(plural(req.units - u, 'more unit'));
    if (!met && req.courses !== undefined && counted.length < req.courses)
      left.push(plural(req.courses - counted.length, 'more course'));
    return {
      req,
      status: met ? 'met' : counted.length ? 'partial' : 'unmet',
      counted,
      have: Math.min(have, need),
      need,
      measure: byUnits ? 'units' : 'courses',
      remaining: left.join(', '),
      candidates: met ? [] : untakenCandidates(req),
    };
  }

  // 1. Exclusive requirements, most specific first.
  const order = [...exclusive].sort((a, b) => specificity(a, catalog) - specificity(b, catalog));
  for (const req of order) {
    let result: RequirementResult;
    if (req.kind === 'course') {
      const counted = available().filter((c) => equivalentOf(req.code).includes(c));
      const met = counted.length > 0;
      result = {
        req,
        status: met ? 'met' : 'unmet',
        counted: counted.slice(0, 1),
        have: met ? 1 : 0,
        need: 1,
        measure: 'courses',
        remaining: met ? '' : req.code,
        candidates: met ? [] : untakenCandidates(req),
      };
    } else if (req.kind === 'oneOf') {
      const pool = new Set(available());
      const scored = req.options.map((opt) => {
        const got = opt.filter((c) => pool.has(c));
        return { opt, got, missing: opt.length - got.length, cost: got.reduce((n, c) => n + demand(c, req), 0) };
      });
      const full = scored.filter((s) => s.missing === 0).sort((a, b) => a.cost - b.cost);
      // Partial: the option closest to done.
      const best = full[0] ?? [...scored].sort((a, b) => a.missing - b.missing || b.got.length - a.got.length)[0];
      const met = best.missing === 0;
      result = {
        req,
        status: met ? 'met' : best.got.length ? 'partial' : 'unmet',
        counted: best.got,
        have: met ? 1 : best.got.length / best.opt.length,
        need: 1,
        measure: 'courses',
        remaining: met
          ? ''
          : best.got.length
            ? `also ${best.opt.filter((c) => !pool.has(c)).join(' + ')}`
            : `one of ${req.options.map((o) => o.join(' + ')).join(', ')}`,
        candidates: met ? [] : untakenCandidates(req),
      };
    } else if (req.kind === 'choose') {
      result = evalChoose(req, available(), true);
    } else if (req.kind === 'areas') {
      const pool = available();
      const got = matchAreas(req.areas, pool);
      const counted = [...got.values()];
      const met = got.size >= req.count;
      result = {
        req,
        status: met ? 'met' : got.size ? 'partial' : 'unmet',
        counted,
        have: Math.min(got.size, req.count),
        need: req.count,
        measure: 'areas',
        remaining: met ? '' : plural(req.count - got.size, 'more area'),
        candidates: met ? [] : untakenCandidates(req).filter((c) =>
          req.areas.some((a, i) => !got.has(i) && a.codes.includes(c)),
        ),
      };
    } else continue; // notes never reach here
    for (const c of result.counted) used.set(c, req.id);
    if (result.status === 'met') done.add(req.id);
    results.set(req.id, result);
  }

  // 2. Shared (overlay) requirements count every applicable taken course.
  for (const req of shared) {
    const pool = [...effective]
      .filter((c) => !req.notCountingFrom?.includes(used.get(c) ?? ''))
      .sort();
    let result: RequirementResult;
    if (req.kind === 'choose') {
      result = evalChoose(req, pool, false);
    } else if (req.kind === 'areas') {
      const got = matchAreas(req.areas, pool);
      const met = got.size >= req.count;
      result = {
        req,
        status: met ? 'met' : got.size ? 'partial' : 'unmet',
        counted: [...got.values()],
        have: Math.min(got.size, req.count),
        need: req.count,
        measure: 'areas',
        remaining: met ? '' : plural(req.count - got.size, 'more area'),
        candidates: met
          ? []
          : untakenCandidates(req).filter((c) => req.areas.some((a, i) => !got.has(i) && a.codes.includes(c))),
      };
    } else if (req.kind === 'course' || req.kind === 'oneOf') {
      // A shared single course / one-of behaves like an exclusive one without claiming.
      const opts = req.kind === 'course' ? [[req.code]] : req.options;
      const best = opts.find((o) => o.every((c) => pool.includes(c)));
      result = {
        req,
        status: best ? 'met' : 'unmet',
        counted: best ?? [],
        have: best ? 1 : 0,
        need: 1,
        measure: 'courses',
        remaining: best ? '' : opts.map((o) => o.join(' + ')).join(' or '),
        candidates: best ? [] : untakenCandidates(req),
      };
    } else continue;
    results.set(req.id, result);
  }

  // 3. Manual items: never met automatically; show which listed courses are taken.
  for (const req of notes) {
    if (req.kind !== 'note') continue;
    results.set(req.id, {
      req,
      status: 'manual',
      counted: (req.codes ?? []).filter((c) => takenAny(c)),
      have: 0,
      need: 0,
      measure: 'courses',
      remaining: '',
      candidates: untakenCandidates(req),
    });
  }

  return { results, duplicates };
}

const sectionFraction = (rs: RequirementResult[]) => {
  const counted = rs.filter((r) => r.status !== 'manual');
  return counted.length ? counted.reduce((n, r) => n + (r.need ? r.have / r.need : 1), 0) / counted.length : 0;
};

/**
 * Check `taken` against `program`. `courses` is the loaded catalog, used for
 * units and to list candidate courses for range requirements.
 *
 * Alternative sections (`choice` groups, e.g. streams) are tried one at a
 * time alongside the rest of the program; the best match in each group is
 * counted, and the others are shown with their own (uncounted) progress.
 */
export function evaluateProgram(program: Program, taken: Taken, courses: Courses): ProgramResult {
  const catalog = Object.keys(courses).sort();
  const units = (c: string) => unitsOf(c, courses);
  const core = program.sections.filter((s) => !s.choice);
  const groups = new Map<string, RequirementSection[]>();
  for (const s of program.sections) if (s.choice) groups.set(s.choice.group, [...(groups.get(s.choice.group) ?? []), s]);

  // Pick the best alternative in each group, trying each with the core sections.
  const chosen = new Set<RequirementSection>();
  const trial = new Map<RequirementSection, Map<string, RequirementResult>>();
  for (const members of groups.values()) {
    let best: RequirementSection | undefined;
    let bestScore = -1;
    for (const m of members) {
      const { results } = evaluateSections(program, [...core, m], taken, courses, catalog);
      trial.set(m, results);
      const score = sectionFraction(m.requirements.map((r) => results.get(r.id)!));
      if (score > bestScore) [best, bestScore] = [m, score];
    }
    if (best) chosen.add(best);
  }

  const active = program.sections.filter((s) => !s.choice || chosen.has(s));
  const { results, duplicates } = evaluateSections(program, active, taken, courses, catalog);

  const sections: SectionResult[] = program.sections.map((section) => {
    const source = !section.choice || chosen.has(section) ? results : trial.get(section)!;
    return {
      section,
      results: section.requirements.map((r) => source.get(r.id)!),
      ...(section.choice ? { chosen: chosen.has(section) } : {}),
    };
  });
  const countedSections = sections.filter((s) => !s.section.choice || (s.chosen && !s.section.choice.optional));
  const all = countedSections.flatMap((s) => s.results);
  const flat = all.filter((r) => r.status !== 'manual');
  const countedCourses = new Set(
    sections.filter((s) => !s.section.choice || s.chosen).flatMap((s) => s.results.filter((r) => r.status !== 'manual').flatMap((r) => r.counted)),
  );
  return {
    program,
    sections,
    met: flat.filter((r) => r.status === 'met').length,
    total: flat.length,
    manual: all.length - flat.length,
    fraction: flat.length ? flat.reduce((n, r) => n + (r.need ? r.have / r.need : 1), 0) / flat.length : 0,
    unitsCounted: [...countedCourses].reduce((n, c) => n + units(c), 0),
    duplicates,
  };
}
