import { describe, expect, it } from 'vitest';
import { coursesNeeded, explore, level, department, reverseIndex, sortEntries, unlockScore } from './explore';
import type { Course, Courses, Prereq } from './types';

const course = (prereq: Prereq | null = null): Course => ({ title: '', units: '3', prereqText: '', prereq });
const or = (...args: Prereq[]): Prereq => ({ op: 'or', args });
const and = (...args: Prereq[]): Prereq => ({ op: 'and', args });

// A small catalogue:
//   CMPT 120 -> CMPT 125 -> CMPT 225 (needs MACM 101 too) -> CMPT 300
//   CMPT 310 needs CMPT 225 and one of MATH 150/151
const courses: Courses = {
  'CMPT 120': course(),
  'MACM 101': course(),
  'MATH 150': course(),
  'MATH 151': course(),
  'CMPT 125': course('CMPT 120'),
  'CMPT 225': course(and('CMPT 125', 'MACM 101')),
  'CMPT 300': course('CMPT 225'),
  'CMPT 310': course(and('CMPT 225', or('MATH 150', 'MATH 151'))),
  'CMPT 405': course(and(or(and('CMPT 300', 'CMPT 310'), 'MACM 101'), 'CMPT 225')),
};

const codes = (entries: { code: string }[]) => entries.map((e) => e.code).sort();

describe('reverseIndex', () => {
  it('lists each course that mentions a prerequisite, once', () => {
    const index = reverseIndex(courses);
    expect(index.get('CMPT 225')?.slice().sort()).toEqual(['CMPT 300', 'CMPT 310', 'CMPT 405']);
    expect(index.get('MATH 150')).toEqual(['CMPT 310']);
    expect(index.get('CMPT 405')).toBeUndefined();
  });
});

describe('coursesNeeded', () => {
  it('sums AND groups and takes the cheapest OR option', () => {
    const done = new Set<string>();
    expect(coursesNeeded(null, done)).toBe(0);
    expect(coursesNeeded(courses['CMPT 310'].prereq, done)).toBe(2);
    expect(coursesNeeded(courses['CMPT 310'].prereq, new Set(['MATH 151']))).toBe(1);
  });
});

describe('explore', () => {
  it('with nothing taken, ready means no prerequisites', () => {
    const { ready, almost } = explore(courses, new Set());
    expect(codes(ready)).toEqual(['CMPT 120', 'MACM 101', 'MATH 150', 'MATH 151']);
    // CMPT 300 only needs CMPT 225, even though that's a long way off.
    expect(codes(almost)).toEqual(['CMPT 125', 'CMPT 300']);
    expect(almost.find((e) => e.code === 'CMPT 125')?.missing).toEqual(['CMPT 120']);
  });

  it('never lists taken courses', () => {
    const { ready, almost } = explore(courses, new Set(['CMPT 120', 'MACM 101']));
    expect(codes(ready)).toEqual(['CMPT 125', 'MATH 150', 'MATH 151']);
    expect(codes(almost)).toEqual(['CMPT 225', 'CMPT 300', 'CMPT 405']);
    expect(almost.every((e) => !e.missing.includes('MACM 101'))).toBe(true);
  });

  it('names every option of a single missing "one of" group', () => {
    const done = new Set(['CMPT 120', 'CMPT 125', 'MACM 101', 'CMPT 225']);
    const { ready, almost } = explore(courses, done);
    expect(codes(ready)).toContain('CMPT 300');
    expect(codes(ready)).toContain('CMPT 405'); // MACM 101 satisfies the OR
    const cmpt310 = almost.find((e) => e.code === 'CMPT 310');
    expect(cmpt310?.missing).toEqual(['MATH 150', 'MATH 151']);
  });

  it('leaves out courses missing more than one thing', () => {
    const { almost } = explore(courses, new Set(['CMPT 120']));
    // CMPT 225 needs CMPT 125 and MACM 101; CMPT 310 needs even more.
    expect(codes(almost)).not.toContain('CMPT 225');
    expect(codes(almost)).not.toContain('CMPT 310');
  });
});

describe('unlockScore', () => {
  it('counts courses that become ready and ones that move closer', () => {
    const done = new Set(['CMPT 120']);
    // CMPT 125 makes nothing ready yet, but CMPT 225 now only needs MACM 101.
    expect(unlockScore('CMPT 125', courses, done)).toEqual({ unlocks: [], closer: ['CMPT 225'], score: 1 });
    // With CMPT 125 done too, MACM 101 unlocks CMPT 225.
    const s = unlockScore('MACM 101', courses, new Set(['CMPT 120', 'CMPT 125']));
    expect(s.unlocks).toEqual(['CMPT 225']);
    // CMPT 405's "one of" is now met, leaving just CMPT 225.
    expect(s.closer).toEqual(['CMPT 405']);
    expect(s.score).toBe(2);
  });

  it('ignores courses that are already ready or taken', () => {
    const done = new Set(['CMPT 120', 'CMPT 125', 'MACM 101', 'CMPT 225', 'MATH 150']);
    // CMPT 310 is ready already, so MATH 151 adds nothing.
    expect(unlockScore('MATH 151', courses, done).score).toBe(0);
  });

  it('scores CMPT 225 for everything that builds on it', () => {
    const done = new Set(['CMPT 120', 'CMPT 125', 'MACM 101']);
    const s = unlockScore('CMPT 225', courses, done);
    expect(s.unlocks.sort()).toEqual(['CMPT 300', 'CMPT 405']);
    expect(s.closer).toEqual(['CMPT 310']);
    expect(s.score).toBe(3);
  });
});

describe('helpers', () => {
  it('reads department and level from a code', () => {
    expect(department('CMPT 225')).toBe('CMPT');
    expect(level('CMPT 225')).toBe(200);
    expect(level('MATH 100W')).toBe(100);
  });

  it('sorts by score, code or level', () => {
    const e = (code: string, score: number) => ({ code, unlocks: [], closer: [], score, missing: [] });
    const list = [e('CMPT 310', 1), e('CMPT 120', 1), e('MACM 101', 4)];
    expect(sortEntries([...list], 'score').map((x) => x.code)).toEqual(['MACM 101', 'CMPT 120', 'CMPT 310']);
    expect(sortEntries([...list], 'code').map((x) => x.code)).toEqual(['CMPT 120', 'CMPT 310', 'MACM 101']);
    expect(sortEntries([...list], 'level').map((x) => x.code)).toEqual(['CMPT 120', 'MACM 101', 'CMPT 310']);
  });
});
