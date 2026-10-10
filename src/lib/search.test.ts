import { describe, expect, it } from 'vitest';
import { matchCourse, searchCourses } from './search';
import type { Courses } from './types';

const course = (title: string) => ({ title, units: '3', prereqText: '', prereq: null });
const courses: Courses = {
  'CMPT 120': course('Introduction to Computing Science and Programming I'),
  'CMPT 125': course('Introduction to Computing Science and Programming II'),
  'CMPT 225': course('Data Structures and Programming'),
  'CMPT 410': course('Machine Learning'),
  'PHIL 100W': course('Knowledge and Reality'),
};
const codes = (q: string) => searchCourses(q, courses).map((h) => h.code);

describe('search', () => {
  it('codes in any spacing or case', () => {
    expect(matchCourse('cmpt225', courses)).toBe('CMPT 225');
    expect(matchCourse('CMPT 225 — Data Structures and Programming', courses)).toBe('CMPT 225');
    expect(matchCourse('phil 100w', courses)).toBe('PHIL 100W');
  });

  it('names, including words out of order and partial words', () => {
    expect(matchCourse('machine learning', courses)).toBe('CMPT 410');
    expect(codes('intro prog')).toEqual(['CMPT 120', 'CMPT 125']);
    expect(codes('programming data')).toEqual(['CMPT 225']);
    expect(matchCourse('intro prog', courses)).toBeNull(); // ambiguous
  });

  it('code prefixes rank before name matches', () => {
    expect(codes('cmpt 12')).toEqual(['CMPT 120', 'CMPT 125']);
  });

  it('no match', () => {
    expect(codes('zzz')).toEqual([]);
    expect(matchCourse('', courses)).toBeNull();
  });
});
