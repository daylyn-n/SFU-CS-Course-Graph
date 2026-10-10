import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankCourses } from './fuzzy';
import type { Courses } from './types';

const course = (title: string) => ({ title, units: '3', prereqText: '', prereq: null });
const courses: Courses = {
  'CMPT 120': course('Introduction to Computing Science and Programming I'),
  'CMPT 225': course('Data Structures and Programming'),
  'CMPT 300': course('Operating Systems I'),
  'CMPT 307': course('Data Structures and Algorithms'),
  'CMPT 410': course('Machine Learning'),
  'MACM 101': course('Discrete Mathematics I'),
  'MATH 100W': course('Calculus Writing'),
};

describe('fuzzyScore', () => {
  it('matches letters in order and rejects anything else', () => {
    expect(fuzzyScore('opsys', 'Operating Systems')).not.toBeNull();
    expect(fuzzyScore('syso', 'Operating Systems')).toBeNull();
    expect(fuzzyScore('xyz', 'Operating Systems')).toBeNull();
  });

  it('is case-insensitive and returns hit positions', () => {
    expect(fuzzyScore('LEARN', 'Machine Learning')!.hits).toEqual([8, 9, 10, 11, 12]);
  });

  it('ranks contiguous and word-start matches above scattered ones', () => {
    const contiguous = fuzzyScore('sys', 'Operating Systems')!.score;
    const scattered = fuzzyScore('sys', 'is my set')!.score;
    expect(contiguous).toBeGreaterThan(scattered);
    expect(fuzzyScore('data', 'Data Structures')!.score).toBeGreaterThan(fuzzyScore('data', 'Big metadata')!.score);
  });

  it('falls back when preferring word starts would strand later letters', () => {
    // Jumping to the "a" in "ab" would leave nothing for "c".
    expect(fuzzyScore('abc', 'xaxbc ab')).not.toBeNull();
  });

  it('treats an empty query as a match', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, hits: [] });
  });
});

describe('rankCourses', () => {
  const codes = (q: string) => rankCourses(q, courses).map((m) => m.code);

  it('finds codes with or without the space', () => {
    expect(codes('cmpt410')[0]).toBe('CMPT 410');
    expect(codes('CMPT 410')[0]).toBe('CMPT 410');
    expect(codes('math100w')[0]).toBe('MATH 100W');
  });

  it('puts the exact code first even when other codes share a prefix', () => {
    expect(codes('cmpt 30')).toEqual(expect.arrayContaining(['CMPT 300', 'CMPT 307']));
    expect(codes('cmpt 300')[0]).toBe('CMPT 300');
  });

  it('searches titles, with words in any order', () => {
    expect(codes('machine learning')[0]).toBe('CMPT 410');
    expect(codes('systems operating')[0]).toBe('CMPT 300');
    expect(codes('algorithms')).toEqual(['CMPT 307']);
  });

  it('maps code hits back onto the spaced code', () => {
    const m = rankCourses('cmpt410', courses)[0];
    expect(m.codeHits).toEqual([0, 1, 2, 3, 5, 6, 7]);
    expect(m.titleHits).toEqual([]);
  });

  it('returns nothing for a blank query and respects the limit', () => {
    expect(rankCourses('  ', courses)).toEqual([]);
    expect(rankCourses('c', courses, 2)).toHaveLength(2);
  });
});
