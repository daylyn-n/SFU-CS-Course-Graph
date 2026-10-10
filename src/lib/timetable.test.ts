import { describe, expect, it } from 'vitest';
import offeringData from '../data/offerings.json';
import type { Offerings, Section } from './types';
import {
  autoPick,
  describeConflict,
  findConflicts,
  formatTime,
  parseSchedule,
  parseTime,
} from './timetable';

const sec = (section: string, schedule: string, campus = 'Burnaby'): Section => ({
  section,
  schedule,
  campus,
  instructors: [],
  delivery: 'In Person',
});

describe('parseTime', () => {
  it('reads 24-hour and am/pm times', () => {
    expect(parseTime('8:30')).toBe(510);
    expect(parseTime('14:30')).toBe(870);
    expect(parseTime('2:30pm')).toBe(870);
    expect(parseTime('12:00 am')).toBe(0);
    expect(parseTime('12pm')).toBe(720);
  });
  it('rejects nonsense', () => {
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('9:75')).toBeNull();
    expect(parseTime('9')).toBeNull();
    expect(parseTime('noon')).toBeNull();
  });
  it('formats back', () => {
    expect(formatTime(510)).toBe('8:30');
    expect(formatTime(1220)).toBe('20:20');
  });
});

describe('parseSchedule', () => {
  it('single meeting', () => {
    expect(parseSchedule('Tu 14:30–17:20')).toEqual({
      meetings: [{ day: 'Tu', start: 870, end: 1040 }],
      tba: false,
      flexible: false,
      errors: [],
    });
  });

  it('several days sharing one time', () => {
    const p = parseSchedule('Mo, We, Fr 9:30–10:20');
    expect(p.meetings.map((m) => m.day)).toEqual(['Mo', 'We', 'Fr']);
    expect(p.meetings.every((m) => m.start === 570 && m.end === 620)).toBe(true);
  });

  it('separate times per day', () => {
    const p = parseSchedule('Tu 13:30–14:20, Th 12:30–14:20');
    expect(p.meetings).toEqual([
      { day: 'Tu', start: 810, end: 860 },
      { day: 'Th', start: 750, end: 860 },
    ]);
  });

  it('mixed groups', () => {
    const p = parseSchedule('Mo 12:30–13:20, We, Fr 12:30–13:20');
    expect(p.meetings.map((m) => m.day)).toEqual(['Mo', 'We', 'Fr']);
    expect(p.errors).toEqual([]);
  });

  it('empty is TBA', () => {
    expect(parseSchedule('').tba).toBe(true);
    expect(parseSchedule(undefined).meetings).toEqual([]);
  });

  it('flags all-day weekday placeholders as flexible', () => {
    const p = parseSchedule('Mo, Tu, We, Th, Fr 8:00–20:00');
    expect(p.flexible).toBe(true);
    expect(p.meetings).toHaveLength(5);
  });

  it('accepts other dash styles and day spellings', () => {
    expect(parseSchedule('Mon/Wed 9:30-10:20').meetings).toHaveLength(2);
    expect(parseSchedule('MoWeFr 9:30 — 10:20').meetings).toHaveLength(3);
    expect(parseSchedule('Thursday 1:30pm to 3:20pm').meetings).toEqual([{ day: 'Th', start: 810, end: 920 }]);
  });

  it('reports what it cannot read instead of throwing', () => {
    expect(parseSchedule('Xy 9:30–10:20').errors).toEqual(['Xy 9:30–10:20']);
    expect(parseSchedule('Mo 11:00–10:00').errors).toHaveLength(1);
    expect(parseSchedule('9:30–10:20').errors).toHaveLength(1);
    expect(parseSchedule('Mo, We').errors).toEqual(['Mo, We (no time given)']);
    const p = parseSchedule('Tu 9:30–10:20, gibberish');
    expect(p.meetings).toHaveLength(1);
    expect(p.errors).toEqual(['gibberish']);
  });

  it('parses every schedule in offerings.json', () => {
    const { offerings } = offeringData as { offerings: Offerings };
    let count = 0;
    for (const terms of Object.values(offerings)) {
      for (const sections of Object.values(terms)) {
        for (const s of sections) {
          const p = parseSchedule(s.schedule);
          expect(p.errors, s.schedule).toEqual([]);
          if (s.schedule) expect(p.meetings.length, s.schedule).toBeGreaterThan(0);
          count++;
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe('findConflicts', () => {
  it('finds overlapping meetings with the overlap window', () => {
    const c = findConflicts([
      { code: 'CMPT 225', section: sec('D100', 'Mo, We, Fr 10:30–11:20') },
      { code: 'CMPT 295', section: sec('D100', 'We 11:00–12:20') },
      { code: 'MACM 101', section: sec('D100', 'Tu, Th 10:30–12:20') },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ day: 'We', start: 660, end: 680 });
    expect(describeConflict(c[0])).toBe('CMPT 225 D100 and CMPT 295 D100 overlap Wednesday 11:00–11:20');
  });

  it('back-to-back classes do not conflict', () => {
    expect(
      findConflicts([
        { code: 'A', section: sec('D100', 'Mo 9:30–10:20') },
        { code: 'B', section: sec('D100', 'Mo 10:20–11:20') },
      ]),
    ).toEqual([]);
  });

  it('ignores TBA and flexible sections', () => {
    expect(
      findConflicts([
        { code: 'A', section: sec('D100', 'Mo 9:30–10:20') },
        { code: 'B', section: sec('D100', 'Mo, Tu, We, Th, Fr 8:00–20:00') },
        { code: 'C', section: sec('D100', '') },
      ]),
    ).toEqual([]);
  });
});

describe('autoPick', () => {
  const data: Record<string, Section[]> = {
    A: [sec('D100', 'Mo 9:30–10:20'), sec('D200', 'Tu 9:30–10:20', 'Surrey')],
    B: [sec('D100', 'Mo 9:30–10:20'), sec('D200', 'We 9:30–10:20', 'Surrey')],
    C: [sec('D100', 'Mo 9:00–11:00', 'Surrey'), sec('D200', 'Th 9:30–10:20')],
  };
  const sectionsFor = (code: string) => data[code] ?? [];

  it('finds a conflict-free combination', () => {
    const r = autoPick(['A', 'B', 'C'], sectionsFor);
    expect(r.ok).toBe(true);
    const picks = Object.entries(r.picks).map(([code, s]) => ({
      code,
      section: data[code].find((x) => x.section === s)!,
    }));
    expect(findConflicts(picks)).toEqual([]);
  });

  it('prefers the chosen campus', () => {
    const r = autoPick(['A', 'B', 'C'], sectionsFor, { campus: 'Burnaby' });
    expect(r.ok).toBe(true);
    expect(r.offCampus).toBe(1); // A and B can't both be Burnaby (both Mo 9:30)
    expect(r.picks.C).toBe('D200');

    const s = autoPick(['A', 'C'], sectionsFor, { campus: 'Surrey' });
    expect(s.picks).toEqual({ A: 'D200', C: 'D100' });
    expect(s.offCampus).toBe(0);
  });

  it('keeps current picks when nothing is gained by changing', () => {
    const r = autoPick(['A', 'B'], sectionsFor, { current: { A: 'D200', B: 'D100' } });
    expect(r.picks).toEqual({ A: 'D200', B: 'D100' });
  });

  it('reports failure when every combination clashes', () => {
    const clash = { X: [sec('D100', 'Mo 9:30–10:20')], Y: [sec('D100', 'Mo 10:00–11:00')] };
    const r = autoPick(['X', 'Y'], (c) => clash[c as 'X' | 'Y'], { current: { X: 'D100' } });
    expect(r.ok).toBe(false);
    expect(r.picks).toEqual({ X: 'D100' });
  });

  it('skips courses with no sections', () => {
    expect(autoPick(['A', 'Nope'], sectionsFor).picks).toEqual({ A: 'D100' });
  });
});
