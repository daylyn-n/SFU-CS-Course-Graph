import { describe, expect, it } from 'vitest';
import { groupPrograms, matchScore, OTHER_FACULTY, type ProgramOption } from './programs';

const P: ProgramOption[] = [
  { id: 'cmpt-major', name: 'Computing Science Major', faculty: 'Applied Sciences' },
  { id: 'soseng', name: 'Software Systems Major', faculty: 'Applied Sciences' },
  { id: 'math-major', name: 'Mathematics Major', faculty: 'Science' },
  { id: 'macm', name: 'Mathematics and Computing Science Joint Major', faculty: 'Science' },
  { id: 'econ', name: 'Economics Major', faculty: 'Arts and Social Sciences' },
  { id: 'fren', name: 'French Cohort Program (Français)', faculty: 'Arts and Social Sciences' },
  { id: 'undeclared', name: 'Undeclared' },
];
const names = (q: string) => groupPrograms(P, q).flatMap((g) => g.programs.map((p) => p.id));

describe('program search', () => {
  it('no query: everything, grouped by faculty A–Z, Other last, names A–Z', () => {
    const g = groupPrograms(P);
    expect(g.map((x) => x.faculty)).toEqual(['Applied Sciences', 'Arts and Social Sciences', 'Science', OTHER_FACULTY]);
    expect(g[2].programs.map((p) => p.id)).toEqual(['macm', 'math-major']);
  });
  it('word prefixes, any order, case and accents ignored', () => {
    expect(names('comp sci')).toEqual(['cmpt-major', 'macm']);
    expect(names('SCIENCE comp')).toEqual(['cmpt-major', 'macm']);
    expect(names('francais')).toEqual(['fren']);
    expect(names('soft')).toEqual(['soseng']);
  });
  it('initials', () => {
    expect(names('cs')).toContain('cmpt-major');
    expect(matchScore(P[0], 'csm')).toBeGreaterThan(0);
  });
  it('faculty and id match too, but rank below name matches', () => {
    expect(names('applied').sort()).toEqual(['cmpt-major', 'soseng']);
    expect(matchScore(P[2], 'math')).toBeGreaterThan(matchScore(P[0], 'applied'));
  });
  it('best group first while searching', () => {
    expect(groupPrograms(P, 'math')[0].faculty).toBe('Science');
    expect(groupPrograms(P, 'mathematics')[0].programs[0].id).toBe('math-major');
  });
  it('no match', () => {
    expect(groupPrograms(P, 'zzz')).toEqual([]);
    expect(names('comp zzz')).toEqual([]);
  });
});
