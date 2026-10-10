import { describe, expect, it } from 'vitest';
import { evaluateProgram, inSet, type Program, type RequirementResult } from './degree';
import { PROGRAMS } from '../data/programs';
import type { Courses } from './types';
import data from '../data/courses.json';

const catalog = data.courses as Courses;

/** Tiny catalog: every code gets 3 units unless listed. */
function cat(codes: string[], units: Record<string, string> = {}): Courses {
  return Object.fromEntries(
    codes.map((c) => [c, { title: c, units: units[c] ?? '3', prereqText: '', prereq: null }]),
  );
}

function byId(result: ReturnType<typeof evaluateProgram>, id: string): RequirementResult {
  const r = result.sections.flatMap((s) => s.results).find((x) => x.req.id === id);
  if (!r) throw new Error(`no requirement ${id}`);
  return r;
}

const program = (sections: Program['sections'], extra: Partial<Program> = {}): Program => ({
  id: 't',
  name: 'Test',
  credential: 'BSc',
  calendar: 'Fall 2026',
  source: 'https://example.invalid',
  sections,
  ...extra,
});

describe('inSet', () => {
  it('matches codes, ranges, wildcards, suffixes and exclusions', () => {
    const set = { codes: ['MATH 308'], ranges: [{ subjects: ['CMPT'], from: 300, to: 499 }], exclude: ['CMPT 415'] };
    expect(inSet('MATH 308', set)).toBe(true);
    expect(inSet('CMPT 376W', set)).toBe(true);
    expect(inSet('CMPT 415', set)).toBe(false);
    expect(inSet('CMPT 225', set)).toBe(false);
    expect(inSet('HIST 301', { ranges: [{ subjects: ['*'], from: 300, to: 499 }] })).toBe(true);
  });
});

describe('evaluateProgram', () => {
  it('reports met / partial / unmet for each kind', () => {
    const p = program([
      {
        title: 'S',
        requirements: [
          { id: 'a', title: 'a', kind: 'course', code: 'CMPT 120' },
          { id: 'b', title: 'b', kind: 'oneOf', options: [['MATH 151'], ['MATH 150']] },
          { id: 'c', title: 'c', kind: 'choose', from: { codes: ['CMPT 310', 'CMPT 361', 'CMPT 354'] }, units: 9 },
          { id: 'd', title: 'd', kind: 'oneOf', options: [['CMPT 494', 'CMPT 495']] },
        ],
      },
    ]);
    const courses = cat(['CMPT 120', 'MATH 150', 'MATH 151', 'CMPT 310', 'CMPT 361', 'CMPT 354', 'CMPT 494', 'CMPT 495']);
    const r = evaluateProgram(p, new Set(['CMPT 120', 'CMPT 310', 'CMPT 494']), courses);
    expect(byId(r, 'a').status).toBe('met');
    expect(byId(r, 'b')).toMatchObject({ status: 'unmet', candidates: ['MATH 151', 'MATH 150'] });
    expect(byId(r, 'c')).toMatchObject({ status: 'partial', have: 3, need: 9, remaining: '6 more units' });
    expect(byId(r, 'c').candidates).toEqual(['CMPT 361', 'CMPT 354']);
    expect(byId(r, 'd')).toMatchObject({ status: 'partial', counted: ['CMPT 494'], remaining: 'also CMPT 495' });
    expect(r.met).toBe(1);
    expect(r.total).toBe(4);
  });

  it("doesn't double-count across exclusive requirements, and allocates sensibly", () => {
    // 'wide' could take CMPT 431, but 'narrow' needs it; greedy-by-demand
    // should give 'wide' the course nobody else wants.
    const p = program([
      {
        title: 'S',
        requirements: [
          { id: 'wide', title: 'wide', kind: 'choose', from: { codes: ['CMPT 431', 'CMPT 303', 'CMPT 371'] }, courses: 1 },
          { id: 'narrow', title: 'narrow', kind: 'choose', from: { codes: ['CMPT 431', 'CMPT 433'] }, courses: 1 },
        ],
      },
    ]);
    const r = evaluateProgram(p, new Set(['CMPT 431', 'CMPT 303']), cat(['CMPT 431', 'CMPT 303', 'CMPT 371', 'CMPT 433']));
    expect(byId(r, 'narrow')).toMatchObject({ status: 'met', counted: ['CMPT 431'] });
    expect(byId(r, 'wide')).toMatchObject({ status: 'met', counted: ['CMPT 303'] });

    // With only CMPT 431 taken, it can count once.
    const r2 = evaluateProgram(p, new Set(['CMPT 431']), cat(['CMPT 431', 'CMPT 303', 'CMPT 371', 'CMPT 433']));
    expect(r2.met).toBe(1);
  });

  it('lets shared totals overlay everything except notCountingFrom', () => {
    const p = program([
      {
        title: 'S',
        requirements: [
          { id: 'extra', title: 'extra', kind: 'choose', from: { codes: ['CMPT 310', 'MATH 308'] }, courses: 1 },
          {
            id: 'total',
            title: 'total',
            kind: 'choose',
            from: { ranges: [{ subjects: ['CMPT'], from: 300, to: 499 }] },
            units: 6,
            shared: true,
            notCountingFrom: ['extra'],
          },
        ],
      },
    ]);
    const courses = cat(['CMPT 310', 'CMPT 354', 'MATH 308']);
    // Prefers MATH 308 for 'extra' so CMPT 310 still counts toward the CMPT total.
    const r = evaluateProgram(p, new Set(['CMPT 310', 'CMPT 354', 'MATH 308']), courses);
    expect(byId(r, 'extra').counted).toEqual(['MATH 308']);
    expect(byId(r, 'total')).toMatchObject({ status: 'met', have: 6 });

    // Without MATH 308, CMPT 310 goes to 'extra' and the total drops.
    const r2 = evaluateProgram(p, new Set(['CMPT 310', 'CMPT 354']), courses);
    expect(byId(r2, 'extra').counted).toEqual(['CMPT 310']);
    expect(byId(r2, 'total')).toMatchObject({ status: 'partial', have: 3, counted: ['CMPT 354'] });
  });

  it('matches one course per area', () => {
    const p = program([
      {
        title: 'S',
        requirements: [
          {
            id: 'br',
            title: 'br',
            kind: 'areas',
            count: 2,
            areas: [
              { name: 'A', codes: ['X 300', 'X 301'] },
              { name: 'B', codes: ['X 301', 'X 400'] },
            ],
          },
        ],
      },
    ]);
    const courses = cat(['X 300', 'X 301', 'X 400']);
    // X 301 alone covers only one area, even though it's in both.
    expect(byId(evaluateProgram(p, new Set(['X 301']), courses), 'br')).toMatchObject({ status: 'partial', have: 1 });
    // X 301 + X 300: matching must put X 300 in A and X 301 in B.
    expect(byId(evaluateProgram(p, new Set(['X 301', 'X 300']), courses), 'br').status).toBe('met');
  });

  it('counts equivalent (cross-listed) courses once', () => {
    const p = program(
      [
        {
          title: 'S',
          requirements: [
            { id: 'u', title: 'u', kind: 'choose', from: { codes: ['CMPT 476', 'MACM 476'] }, units: 6 },
          ],
        },
      ],
      { equivalents: [['CMPT 476', 'MACM 476']] },
    );
    const r = evaluateProgram(p, new Set(['CMPT 476', 'MACM 476']), cat(['CMPT 476', 'MACM 476']));
    expect(r.duplicates).toEqual(['MACM 476']);
    expect(byId(r, 'u')).toMatchObject({ status: 'partial', have: 3 });
  });

  it('uses catalog units', () => {
    const p = program([
      { title: 'S', requirements: [{ id: 'u', title: 'u', kind: 'choose', from: { codes: ['CMPT 201', 'CMPT 295'] }, units: 8 }] },
    ]);
    const r = evaluateProgram(p, new Set(['CMPT 201', 'CMPT 295']), cat(['CMPT 201', 'CMPT 295'], { 'CMPT 201': '4', 'CMPT 295': '4' }));
    expect(byId(r, 'u').status).toBe('met');
    expect(r.unitsCounted).toBe(8);
  });
});

describe('real programs', () => {
  const major = PROGRAMS.find((p) => p.id === 'cmpt-major-bsc')!;
  const sosy = PROGRAMS.find((p) => p.id === 'sosy-major-bsc')!;
  const minor = PROGRAMS.find((p) => p.id === 'cmpt-minor')!;

  it('has unique requirement ids and a calendar source per program', () => {
    for (const p of PROGRAMS) {
      const ids = p.sections.flatMap((s) => s.requirements.map((r) => r.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(p.source).toMatch(/^https:\/\/www\.sfu\.ca\/students\/calendar\/2026\/fall\//);
    }
  });

  it('nothing taken: nothing met', () => {
    for (const p of PROGRAMS) {
      const r = evaluateProgram(p, new Set(), catalog);
      expect(r.met).toBe(0);
      expect(r.fraction).toBe(0);
    }
  });

  it('a complete CS major transcript meets every requirement', () => {
    const taken = new Set([
      'CMPT 105W', 'CMPT 120', 'CMPT 125', 'CMPT 201', 'CMPT 210', 'CMPT 225', 'CMPT 276', 'CMPT 295',
      'MACM 101', 'STAT 271', 'MATH 151', 'MATH 152', 'MATH 232',
      'CMPT 307', 'CMPT 376W', 'MACM 316', 'MATH 308', 'MATH 343',
      'CMPT 310', 'CMPT 361', 'CMPT 354', 'CMPT 410', 'CMPT 412', 'CMPT 454', 'CMPT 431', 'CMPT 300',
      'PHIL 300', 'HIST 300', 'MATH 340',
    ]);
    const r = evaluateProgram(major, taken, catalog);
    const unmet = r.sections.flatMap((s) => s.results).filter((x) => x.status !== 'met');
    expect(unmet.map((x) => `${x.req.id}: ${x.remaining}`)).toEqual([]);
    // The two Table III MATH courses are used for the BSc credential, leaving
    // the CMPT courses for the 30-unit CMPT total.
    expect(byId(r, 'bsc-tables').counted.every((c) => c.startsWith('MATH'))).toBe(true);
  });

  it('BSc credential courses do not also count toward the 30 CMPT units', () => {
    // 10 upper-division CMPT courses = 30 units, but two must go to the credential.
    const ud = ['CMPT 307', 'CMPT 310', 'CMPT 354', 'CMPT 361', 'CMPT 371', 'CMPT 373', 'CMPT 383', 'CMPT 410', 'CMPT 412', 'CMPT 431'];
    const r = evaluateProgram(major, new Set(['CMPT 376W', ...ud]), catalog);
    expect(byId(r, 'bsc-tables').status).toBe('met');
    expect(byId(r, 'ud-cmpt')).toMatchObject({ status: 'partial', have: 27 });
  });

  it('SoSy: capstone via two of 379/431/433 without stealing from the other lists', () => {
    const taken = new Set(['CMPT 303', 'CMPT 354', 'CMPT 371', 'CMPT 372', 'CMPT 431', 'CMPT 433', 'CMPT 383', 'CMPT 477']);
    const r = evaluateProgram(sosy, taken, catalog);
    expect(byId(r, 'capstone')).toMatchObject({ status: 'met' });
    expect(byId(r, 'systems').status).toBe('met');
    expect(byId(r, 'se-electives').status).toBe('met');
    const counted = ['capstone', 'systems', 'se-electives'].flatMap((id) => byId(r, id).counted);
    expect(new Set(counted).size).toBe(counted.length);
  });

  it('minor: MATH list courses count toward the 12 but not the CMPT/MACM 15', () => {
    const r = evaluateProgram(minor, new Set(['CMPT 225', 'CMPT 310', 'CMPT 354', 'CMPT 410', 'MATH 343', 'CMPT 300']), catalog);
    expect(byId(r, 'minor-list').status).toBe('met');
    expect(byId(r, 'minor-ud')).toMatchObject({ status: 'partial', have: 12 });
  });
});
