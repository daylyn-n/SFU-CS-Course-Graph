import { describe, expect, it } from 'vitest';
import { chooseCourses, nextTermId, planCourses, termInfo } from './planner';
import type { Course, Courses, Offerings, Prereq, Term } from './types';

const course = (prereq: Prereq | null = null, units = '3'): Course => ({
  title: 'Test course',
  units,
  prereqText: '',
  prereq,
});
const or = (...args: Prereq[]): Prereq => ({ op: 'or', args });
const and = (...args: Prereq[]): Prereq => ({ op: 'and', args });

const TERMS: Term[] = [
  { id: '2026/fall', label: 'Fall 2026', short: 'Fa26', current: true },
  { id: '2027/spring', label: 'Spring 2027', short: 'Sp27', current: false },
];

// Every course offered in both known terms unless the test says otherwise.
const everywhere = (courses: Courses): Offerings =>
  Object.fromEntries(Object.keys(courses).map((c) => [c, { '2026/fall': [], '2027/spring': [] }]));

const termsByCode = (plan: ReturnType<typeof planCourses>) =>
  Object.fromEntries(plan.terms.flatMap((t, i) => t.courses.map((c) => [c.code, i])));

describe('term ids', () => {
  it('cycles fall -> spring -> summer -> fall', () => {
    expect(nextTermId('2026/fall')).toBe('2027/spring');
    expect(nextTermId('2027/spring')).toBe('2027/summer');
    expect(nextTermId('2027/summer')).toBe('2027/fall');
  });

  it('labels terms like offerings.json does', () => {
    expect(termInfo('2027/summer')).toEqual({ id: '2027/summer', label: 'Summer 2027', short: 'Su27' });
  });
});

describe('chooseCourses', () => {
  it('takes every course in an AND and skips taken ones', () => {
    const courses = { A: course(), B: course(), C: course(and('A', 'B')) };
    const { deps } = chooseCourses('C', courses, new Set(['A']));
    expect([...deps.keys()].sort()).toEqual(['B', 'C']);
    expect([...deps.get('C')!]).toEqual(['B']);
  });

  it('picks the OR alternative that needs the fewest extra courses', () => {
    const courses = {
      X: course(),
      Y: course('X'),
      Z: course(),
      T: course(or('Y', 'Z')),
    };
    expect([...chooseCourses('T', courses, new Set()).deps.keys()].sort()).toEqual(['T', 'Z']);
  });

  it('prefers an OR alternative that is already taken', () => {
    const courses = { A: course(), B: course(), T: course(or('A', 'B')) };
    expect([...chooseCourses('T', courses, new Set(['B'])).deps.keys()]).toEqual(['T']);
  });

  it('prefers an OR alternative that overlaps with other requirements', () => {
    const courses = { A: course(), B: course(), T: course(and(or('A', 'B'), 'B')) };
    expect([...chooseCourses('T', courses, new Set()).deps.keys()].sort()).toEqual(['B', 'T']);
  });

  it('breaks ties toward courses that are offered', () => {
    const courses = { A: course(), B: course(), T: course(or('A', 'B')) };
    const { deps } = chooseCourses('T', courses, new Set(), (c) => c === 'B');
    expect([...deps.keys()].sort()).toEqual(['B', 'T']);
  });

  it('takes Pre-Calculus 12 as given but not "or permission"', () => {
    const courses = {
      A: course(),
      T: course(or({ other: 'BC Pre-Calculus 12' }, 'A')),
      U: course(or({ other: 'permission of the instructor' }, 'A')),
    };
    expect([...chooseCourses('T', courses, new Set()).deps.keys()]).toEqual(['T']);
    expect([...chooseCourses('U', courses, new Set()).deps.keys()].sort()).toEqual(['A', 'U']);
  });

  it('survives prerequisite loops and reports them', () => {
    const courses = { A: course('B'), B: course('A'), T: course('A') };
    const { deps, cycles } = chooseCourses('T', courses, new Set());
    expect([...deps.keys()].sort()).toEqual(['A', 'B', 'T']);
    expect([...cycles]).toEqual(['A']);
  });

  it('avoids an OR alternative that loops when another works', () => {
    const courses = { A: course('T'), B: course(), T: course(or('A', 'B')) };
    const { deps, cycles } = chooseCourses('T', courses, new Set());
    expect([...deps.keys()].sort()).toEqual(['B', 'T']);
    expect(cycles.size).toBe(0);
  });
});

describe('planCourses', () => {
  it('puts each course strictly after its prerequisites', () => {
    const courses = { A: course(), B: course('A'), C: course(), D: course(and('B', 'C')) };
    const plan = planCourses('D', courses, new Set(), { terms: TERMS, offerings: everywhere(courses) });
    const at = termsByCode(plan);
    expect(at.A).toBeLessThan(at.B);
    expect(at.B).toBeLessThan(at.D);
    expect(at.C).toBeLessThan(at.D);
    expect(plan.terms.map((t) => t.id)).toEqual(['2026/fall', '2027/spring', '2027/summer']);
    expect(plan.courseCount).toBe(4);
    expect(plan.totalUnits).toBe(12);
  });

  it('respects the per-term limit, scheduling long chains first', () => {
    const courses = {
      A: course(),
      B: course('A'),
      C: course(),
      D: course(),
      T: course(and('B', 'C', 'D')),
    };
    const plan = planCourses('T', courses, new Set(), {
      terms: TERMS,
      offerings: everywhere(courses),
      maxPerTerm: 2,
    });
    expect(plan.terms.every((t) => t.courses.length <= 2)).toBe(true);
    // A starts the longest chain, so it has to go in the first term.
    expect(termsByCode(plan).A).toBe(0);
    expect(plan.terms.length).toBe(3);
  });

  it('waits for a term the course is offered in', () => {
    const courses = { A: course(), T: course('A') };
    const offerings: Offerings = { A: { '2027/spring': [] }, T: { '2026/fall': [] } };
    const plan = planCourses('T', courses, new Set(), { terms: TERMS, offerings });
    expect(plan.terms[0].courses).toEqual([]);
    expect(plan.terms[1].courses.map((c) => c.code)).toEqual(['A']);
    // T isn't offered in a known term after A, so it lands in an unknown one.
    expect(plan.terms[2]).toMatchObject({ id: '2027/summer', known: false });
    expect(plan.terms[2].courses[0]).toMatchObject({ code: 'T', confirmed: false, isTarget: true });
  });

  it('marks known-term courses as confirmed', () => {
    const courses = { T: course() };
    const plan = planCourses('T', courses, new Set(), { terms: TERMS, offerings: everywhere(courses) });
    expect(plan.terms[0].courses[0].confirmed).toBe(true);
  });

  it('handles courses missing from the data', () => {
    const courses = { T: course(and('A', 'GONE 101')), A: course() };
    const plan = planCourses('T', courses, new Set(), { terms: TERMS, offerings: everywhere(courses) });
    expect(plan.missing).toEqual(['GONE 101']);
    const gone = plan.terms.flatMap((t) => t.courses).find((c) => c.code === 'GONE 101')!;
    expect(gone).toMatchObject({ missing: true, units: null, confirmed: false });
    expect(plan.totalUnits).toBe(6);
  });

  it('still produces a plan when prerequisites loop', () => {
    const courses = { A: course('B'), B: course('A'), T: course('A') };
    const plan = planCourses('T', courses, new Set(), { terms: TERMS, offerings: everywhere(courses) });
    expect(plan.courseCount).toBe(3);
    expect(plan.cycles).toEqual(['A']);
    const at = termsByCode(plan);
    expect(at.A).toBeLessThan(at.T);
  });

  it('returns an empty plan when the target is already taken', () => {
    const plan = planCourses('T', { T: course() }, new Set(['T']), { terms: TERMS });
    expect(plan).toMatchObject({ alreadyTaken: true, terms: [], courseCount: 0 });
  });

  it('starts from the given term and assumes unknown terms are possible', () => {
    const courses = { A: course(), T: course('A') };
    const plan = planCourses('T', courses, new Set(), { start: '2030/summer' });
    expect(plan.terms.map((t) => [t.short, t.known])).toEqual([
      ['Su30', false],
      ['Fa30', false],
    ]);
  });
});
