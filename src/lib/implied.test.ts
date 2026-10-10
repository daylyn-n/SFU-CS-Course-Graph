import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inferTaken, untick } from './implied';
import type { Courses, CourseData, Prereq } from './types';

const or = (...args: Prereq[]): Prereq => ({ op: 'or', args });
const and = (...args: Prereq[]): Prereq => ({ op: 'and', args });

// A small catalog shaped like the real one.
const C = (prereq: Prereq | null = null) => ({ title: '', units: '3', prereqText: '', prereq });
const courses: Courses = {
  'CMPT 120': C(),
  'CMPT 130': C(),
  'CMPT 125': C(or('CMPT 120', 'CMPT 130')),
  'CMPT 129': C(),
  'CMPT 135': C('CMPT 130'),
  'MACM 101': C(or('MATH 150', 'MATH 151', { other: 'BC Math 12' })),
  'MATH 150': C(or('MATH 100', { other: 'Pre-Calculus 12' })),
  'MATH 151': C(or('MATH 100', { other: 'Pre-Calculus 12' })),
  'MATH 100': C(),
  'ENSC 251': C(),
  'ENSC 252': C(),
  'CMPT 225': C(or(and('MACM 101', or('CMPT 125', 'CMPT 129', 'CMPT 135')), and('ENSC 251', 'ENSC 252'))),
  'STAT 271': C(),
  'CMPT 310': C(and('CMPT 225', 'STAT 271')),
  'CMPT 401': C(or('CMPT 310', { other: 'permission of instructor' })),
  'BUS 999': C(or('CMPT 225', 'BUS 100')),
  'BUS 100': C(),
  'CMPT 210': C(and('MACM 101', or('CMPT 125', 'CMPT 135'))),
};

const view = (m: Map<string, { certain: boolean }>) =>
  Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.certain ? 'certain' : 'assumed']));

describe('inferTaken', () => {
  it('marks required prerequisites as certain, all the way down', () => {
    const m = inferTaken(courses, new Set(['CMPT 310']));
    expect(m.get('CMPT 225')).toEqual({ via: 'CMPT 310', certain: true });
    expect(m.get('STAT 271')?.certain).toBe(true);
  });

  it('guesses the route in the same department for a "one of", as assumed', () => {
    expect(view(inferTaken(courses, new Set(['CMPT 225'])))).toEqual({
      'CMPT 120': 'assumed',
      'CMPT 125': 'assumed',
      'MACM 101': 'assumed',
    });
  });

  it('prefers a route you already have a course from', () => {
    const m = inferTaken(courses, new Set(['CMPT 225', 'ENSC 251']));
    expect(m.get('ENSC 252')?.certain).toBe(false);
    expect(m.has('MACM 101')).toBe(false);
  });

  it('takes the next route when you say you did not take part of the guess', () => {
    const m = inferTaken(courses, new Set(['CMPT 225']), new Set(['MACM 101']));
    expect(view(m)).toEqual({ 'ENSC 251': 'assumed', 'ENSC 252': 'assumed' });
  });

  it('only switches the inner choice when the rejected course is optional there', () => {
    const m = inferTaken(courses, new Set(['CMPT 225']), new Set(['CMPT 125']));
    expect(m.has('MACM 101')).toBe(true);
    expect(m.get('CMPT 129')?.certain).toBe(false);
    expect(m.has('CMPT 125')).toBe(false);
  });

  it('prefers one course that settles several "one of" groups', () => {
    // CMPT 225 takes 125/129/135 and CMPT 210 takes 125/135. Without 125,
    // CMPT 135 covers both, rather than guessing 129 for one and 135 for the other.
    const m = inferTaken(courses, new Set(['CMPT 225', 'CMPT 210']), new Set(['CMPT 125']));
    expect(m.get('CMPT 135')?.certain).toBe(false);
    expect(m.has('CMPT 129')).toBe(false);
  });

  it('assumes a free high-school option rather than inventing a course', () => {
    const m = inferTaken(courses, new Set(['MATH 151']));
    expect(m.size).toBe(0);
  });

  it('never guesses permission routes', () => {
    const m = inferTaken(courses, new Set(['CMPT 401']));
    expect(m.get('CMPT 310')?.certain).toBe(false);
    expect(m.has('CMPT 225')).toBe(true);
  });

  it('upgrades a guess to certain when another course requires it', () => {
    // BUS 999 alone would only guess CMPT 225; CMPT 310 requires it.
    const m = inferTaken(courses, new Set(['BUS 999', 'CMPT 310']));
    expect(m.get('CMPT 225')?.certain).toBe(true);
  });

  it('does not list ticked courses and respects explicit choices', () => {
    const m = inferTaken(courses, new Set(['CMPT 225', 'CMPT 135']));
    expect(m.has('CMPT 135')).toBe(false); // ticked, so not "implied"
    expect(m.has('CMPT 125')).toBe(false); // "one of" already met by CMPT 135
    expect(m.get('CMPT 130')?.certain).toBe(true); // required by CMPT 135
  });

  it('copes with cycles and missing courses', () => {
    const loop: Courses = { A: C('B'), B: C('A'), X: C('NOPE 999') };
    expect(view(inferTaken(loop, new Set(['A', 'X'])))).toEqual({ B: 'certain', 'NOPE 999': 'certain' });
  });

  it('works on the real catalog', () => {
    const { courses: real } = JSON.parse(
      readFileSync(new URL('../../public/data/courses.json', import.meta.url), 'utf8'),
    ) as CourseData;
    const m = inferTaken(real, new Set(['CMPT 410']));
    // CMPT 410 needs CMPT 310 and MACM 316 (both required), CMPT 310 needs CMPT 225.
    for (const c of ['CMPT 310', 'MACM 316', 'CMPT 225', 'STAT 271']) expect(m.get(c)?.certain, c).toBe(true);
    // MACM 101 is certain too: STAT 271 requires CMPT 210, which requires it.
    expect(m.get('MACM 101')?.certain).toBe(true);
    // CMPT 225's "one of" is guessed as the CMPT route (CMPT 125), not ENSC.
    expect(m.get('CMPT 125')?.certain).toBe(false);
    expect(m.has('ENSC 251')).toBe(false);
    // High-school options are assumed for first-year math, so no MATH 100.
    expect(m.has('MATH 100')).toBe(false);
  });
});

describe('untick', () => {
  const sorted = (a: string[]) => [...a].sort();

  it('unticks the courses a beginner course opened up (the 120 → 125 → 225 case)', () => {
    const r = untick(courses, new Set(['CMPT 120', 'CMPT 125', 'CMPT 225']), new Set(), 'CMPT 120');
    expect(r.cascaded).toEqual(['CMPT 125', 'CMPT 225']);
    expect(r.taken).toEqual([]);
    // Nothing left needs CMPT 120, so no "not taken" mark lingers.
    expect(r.notTaken).toEqual([]);
  });

  it('keeps a course that is still covered another way', () => {
    const r = untick(courses, new Set(['CMPT 120', 'CMPT 130', 'CMPT 125']), new Set(), 'CMPT 120');
    expect(r.cascaded).toEqual([]);
    expect(sorted(r.taken)).toEqual(['CMPT 125', 'CMPT 130']);
  });

  it('cascades through several levels', () => {
    const r = untick(courses, new Set(['CMPT 225', 'STAT 271', 'CMPT 310']), new Set(), 'CMPT 225');
    expect(r.cascaded).toEqual(['CMPT 310']);
    expect(r.taken).toEqual(['STAT 271']);
  });

  it('a wrong guess switches route instead of cascading', () => {
    // CMPT 125 is only our guess for CMPT 225's prerequisite.
    const r = untick(courses, new Set(['CMPT 225']), new Set(), 'CMPT 125');
    expect(r.cascaded).toEqual([]);
    expect(r.taken).toEqual(['CMPT 225']);
    expect(r.notTaken).toEqual(['CMPT 125']);
    expect(inferTaken(courses, new Set(r.taken), new Set(r.notTaken)).has('CMPT 125')).toBe(false);
  });

  it('a filled-in course with no other route unticks what needed it', () => {
    // CMPT 225 is required (certain) for CMPT 310; saying you didn't take it
    // means CMPT 310 can't have been taken either.
    const r = untick(courses, new Set(['CMPT 310']), new Set(), 'CMPT 225');
    expect(r.cascaded).toEqual(['CMPT 310']);
    expect(r.taken).toEqual([]);
    expect(r.notTaken).toEqual([]);
  });

  it('unticked courses do not come back as assumed', () => {
    const r = untick(courses, new Set(['CMPT 120', 'CMPT 125', 'CMPT 225']), new Set(), 'CMPT 120');
    const implied = inferTaken(courses, new Set(r.taken), new Set(r.notTaken));
    expect(implied.has('CMPT 120')).toBe(false);
  });

  it('leaves unrelated ticks and marks alone', () => {
    const r = untick(courses, new Set(['CMPT 120', 'CMPT 125', 'BUS 100']), new Set(['ENSC 251']), 'CMPT 120');
    expect(r.taken).toEqual(['BUS 100']);
    expect(r.notTaken).toEqual(['ENSC 251']);
  });
});
