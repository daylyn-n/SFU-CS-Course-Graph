import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CONVERTED_CAVEAT,
  cleanHtml,
  convertProgram,
  courseCode,
  readQuantifier,
  shortCredential,
  type RawProgram,
} from './convert';
import { evaluateProgram, type Program, type Requirement } from '../degree';
import type { Courses } from '../types';

// Real API responses (Fall 2026), saved from
// https://www.sfu.ca/bin/wcm/academic-calendar?2026/fall/programs/<value>
const fixture = (name: string): RawProgram =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));
const depts: Record<string, string> = JSON.parse(
  readFileSync(new URL('./__fixtures__/depts.json', import.meta.url), 'utf8'),
);

const FIXTURES = {
  biology: 'biological-sciences~major~bachelor-of-science',
  bba: 'business~major~bachelor-of-business-administration',
  engineering: 'engineering-science-computer-engineering-option~major~bachelor-of-applied-science',
  joint: 'english-and-history~joint-major~bachelor-of-arts',
  certificate: 'computing-studies~certificate',
  historyMinor: 'history~minor',
  psychology: 'psychology~major~bachelor-of-arts',
} as const;

function convert(key: keyof typeof FIXTURES): Program {
  const id = FIXTURES[key];
  return convertProgram(fixture(id), {
    id,
    source: `https://www.sfu.ca/students/calendar/2026/fall/programs/${id.replace(/~/g, '/')}.html`,
    calendar: 'Fall 2026',
    depts,
  }).program;
}

const reqs = (p: Program, section?: string): Requirement[] =>
  p.sections.filter((s) => !section || s.title === section).flatMap((s) => s.requirements);
const courseReqs = (p: Program, section?: string) =>
  reqs(p, section).flatMap((r) => (r.kind === 'course' ? [r.code] : []));
const find = <K extends Requirement['kind']>(p: Program, kind: K, pred: (r: Extract<Requirement, { kind: K }>) => boolean) =>
  reqs(p).find((r): r is Extract<Requirement, { kind: K }> => r.kind === kind && pred(r as Extract<Requirement, { kind: K }>));

describe('helpers', () => {
  it('cleans HTML', () => {
    expect(cleanHtml('Students complete all&nbsp;of <a href="x">these</a>\n <b>courses</b> &amp; more')).toBe(
      'Students complete all of these courses & more',
    );
  });

  it('reads course values', () => {
    expect(courseCode('cmpt/105w')).toBe('CMPT 105W');
    expect(courseCode('mbb/222')).toBe('MBB 222');
    expect(courseCode('not a course')).toBeNull();
  });

  it('reads intro phrases', () => {
    const q = (t: string) => readQuantifier(t).quant;
    expect(q('Students complete all of')).toEqual({ mode: 'all' });
    expect(q('and all of')).toEqual({ mode: 'all' });
    expect(q('Students complete both of')).toEqual({ mode: 'all' });
    expect(q('and one of*')).toEqual({ mode: 'one' });
    expect(q('and either')).toEqual({ mode: 'one' });
    expect(q('and two of')).toEqual({ mode: 'courses', n: 2 });
    expect(q('and at least five additional stream electives from')).toEqual({ mode: 'courses', n: 5 });
    expect(q('and at least 12 units from')).toEqual({ mode: 'units', n: 12 });
    expect(q('Students who choose this stream will complete two of the following techniques courses')).toEqual({
      mode: 'courses',
      n: 2,
    });
    // Limits and recommendations aren't requirements we can check.
    expect(q('No more than one of')).toEqual({ mode: 'unknown' });
    expect(q('The following courses are recommended.')).toEqual({ mode: 'unknown' });
    // A condition we can't check is flagged.
    expect(readQuantifier('Choose two of (one must be at the 400-level)')).toEqual({
      quant: { mode: 'courses', n: 2 },
      extra: true,
    });
  });

  it('abbreviates credentials', () => {
    expect(shortCredential({ awardType: 'Major', credential: 'Bachelor of Science' })).toBe('BSc');
    expect(shortCredential({ awardType: 'Joint Major', credential: 'Bachelor of Arts or Bachelor of Business Administration' })).toBe('BA or BBA');
    expect(shortCredential({ awardType: 'Minor', credential: '' })).toBe('Minor');
    expect(shortCredential({ awardType: '', credential: 'Certificate' })).toBe('Certificate');
  });
});

describe('convertProgram on real calendar programs', () => {
  it('every program: metadata, caveat, unique ids, admin sections skipped', () => {
    for (const key of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
      const p = convert(key);
      expect(p.converted).toBe(true);
      expect(p.caveats).toContain(CONVERTED_CAVEAT);
      expect(p.source).toMatch(/^https:\/\/www\.sfu\.ca\/students\/calendar\/2026\/fall\/programs\/.+\.html$/);
      const ids = reqs(p).map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      const titles = p.sections.map((s) => s.title);
      for (const admin of ['Writing, Quantitative, and Breadth Requirements', 'Residency Requirements and Transfer Credit', 'University Degree Requirements']) {
        expect(titles).not.toContain(admin);
      }
      for (const r of reqs(p)) if (r.kind === 'note') expect(r.text.length).toBeGreaterThan(3);
    }
  });

  it('never drops requirement text from the sections it keeps', () => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const missing: string[] = [];
    for (const key of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
      const raw = fixture(FIXTURES[key]);
      const out = norm(JSON.stringify(convert(key)));
      const kept = new Set(convert(key).sections.map((s) => s.title));
      for (const s of raw.requirements ?? []) {
        if (!kept.has(cleanHtml(s.title ?? '')) && s.title) continue;
        const items = [...(s.description ? [{ description: s.description }] : []), ...(s.requirements ?? [])];
        items.forEach((it, i) => {
          if (!it.description) return;
          const sentences = cleanHtml(it.description).split(/(?<=[.!?])\s+(?=[A-Z(*])/);
          const beforeList = items[i + 1]?.value !== undefined;
          sentences.forEach((sentence, j) => {
            // A list intro we understood lives on as the requirement's structure.
            if (beforeList && j === sentences.length - 1 && readQuantifier(sentence).quant.mode !== 'unknown') return;
            const n = norm(sentence);
            const chunk = n.length > 40 ? n.slice(8, 38) : n.replace(/^(and|or|plus)/, '');
            if (chunk && !out.includes(chunk)) missing.push(`${key}: "${sentence}"`);
          });
        });
      }
    }
    expect(missing).toEqual([]);
  });

  it('Biology BSc: lists, one-ofs, and streams as alternatives', () => {
    const p = convert('biology');
    expect(courseReqs(p, 'Lower Division Requirements')).toEqual([
      'BISC 101', 'BISC 102', 'BISC 202', 'BISC 204', 'BISC 205', 'CHEM 121', 'CHEM 281', 'MBB 222', 'MBB 231', 'STAT 201',
    ]);
    expect(find(p, 'oneOf', (r) => r.options.some((o) => o[0] === 'CHEM 180'))?.options).toEqual([['CHEM 122'], ['CHEM 180']]);
    // "All students complete three core courses, as follows." + "and at least one of"
    expect(courseReqs(p, 'Upper Division Requirements')).toEqual(['BISC 300', 'BISC 333']);
    const streams = p.sections.filter((s) => s.choice);
    expect(streams.map((s) => s.title)).toEqual([
      'Cells, Molecules, and Physiology (CMP) Stream',
      'Ecology, Evolution, and Conservation (EEC) Stream',
      'Open Stream',
    ]);
    expect(new Set(streams.map((s) => s.choice!.group)).size).toBe(1);
    expect(find(p, 'choose', (r) => r.courses === 5 && !!r.from.codes?.includes('BISC 357'))).toBeTruthy();
    // "120 units, including 44 units at the upper division level" -> two totals.
    expect(find(p, 'choose', (r) => r.units === 120 && !!r.shared)).toBeTruthy();
    expect(find(p, 'choose', (r) => r.units === 44 && r.from.ranges?.[0].from === 300)).toBeTruthy();
  });

  it('BBA: concentrations announced by a prose section; titled lists', () => {
    const p = convert('bba');
    const conc = p.sections.filter((s) => s.choice);
    expect(conc.length).toBeGreaterThanOrEqual(9);
    expect(conc[0]).toMatchObject({ title: 'Accounting', choice: { label: 'concentration' } });
    expect(p.sections.find((s) => s.title === 'Group A')?.choice).toBeUndefined();
    expect(courseReqs(p, 'Lower Division Requirements')).toContain('BUS 217W');
    expect(find(p, 'choose', (r) => r.units === 6 && !!r.from.codes?.includes('GA 101'))).toBeTruthy();
    // "Marketing Analytics (choose at least one)" heading carries its own rule.
    expect(find(p, 'oneOf', (r) => r.options.some((o) => o[0] === 'BUS 345'))).toBeTruthy();
  });

  it('Computer Engineering: required core, "or" pairs, "any two of"', () => {
    const p = convert('engineering');
    const core = courseReqs(p, 'Core Course Requirements');
    expect(core).toContain('ENSC 100');
    expect(core).toContain('MATH 152');
    expect(find(p, 'oneOf', (r) => r.options.some((o) => o[0] === 'ENSC 410'))?.options).toEqual([['ENSC 410'], ['ENSC 411']]);
    expect(find(p, 'choose', (r) => r.courses === 2)?.from.codes).toEqual(['ENSC 450', 'ENSC 452', 'ENSC 453']);
    // Elective lists published elsewhere stay as advisor items.
    expect(find(p, 'note', (r) => /12 units from the engineering science and design elective/.test(r.text))).toBeTruthy();
  });

  it('English and History joint major: subject/division ranges from prose', () => {
    const p = convert('joint');
    expect(find(p, 'choose', (r) => r.units === 18)?.from).toEqual({ ranges: [{ subjects: ['HIST'], from: 100, to: 299 }] });
    expect(find(p, 'choose', (r) => r.courses === 2)?.from.ranges).toEqual([{ subjects: ['ENGL'], from: 100, to: 199 }]);
    expect(find(p, 'choose', (r) => r.units === 20)?.from.ranges).toEqual([{ subjects: ['ENGL'], from: 300, to: 499 }]);
    // "of which 12 must be in 400 level" can't be checked: advisor item, text kept.
    expect(find(p, 'note', (r) => /24 units of 300 and 400 level history/.test(r.text))).toBeTruthy();
  });

  it('Computing Studies certificate: "N units ... including" and sub-headed lists', () => {
    const p = convert('certificate');
    expect(find(p, 'choose', (r) => r.units === 18)).toMatchObject({
      shared: true,
      from: { ranges: [{ subjects: ['CMPT', 'MACM'], from: 100, to: 499 }] },
    });
    expect(courseReqs(p)).toEqual(['CMPT 225']);
    const list = find(p, 'choose', (r) => r.units === 3)!;
    expect(list.from.codes).toContain('CMPT 310');
    expect(list.from.codes).toContain('MACM 476');
    expect(list.note).toMatch(/^3 units of upper division CMPT courses .* Lists: Artificial Intelligence, Visual and Interactive Computing/);
  });

  it('History minor (all prose): kept as advisor items, nothing invented', () => {
    const p = convert('historyMinor');
    const all = reqs(p);
    expect(all.every((r) => r.kind === 'note')).toBe(true);
    expect(all.some((r) => r.kind === 'note' && /15 or 16 units in 300 and 400 division history/.test(r.text))).toBe(true);
  });

  it('Psychology: declaration courses overlay; "additional" units are exclusive', () => {
    const p = convert('psychology');
    const decl = reqs(p, 'Declaration Requirements').filter((r) => r.kind !== 'note');
    expect(decl.length).toBeGreaterThan(0);
    expect(decl.every((r) => r.shared)).toBe(true);
    expect(find(p, 'oneOf', (r) => !r.shared && r.options.some((o) => o[0] === 'PSYC 210'))?.options).toEqual([['PSYC 210'], ['STAT 270']]);
    const extra = find(p, 'choose', (r) => r.units === 26)!;
    expect(extra.shared).toBeUndefined();
    expect(extra.from.ranges).toEqual([{ subjects: ['PSYC'], from: 300, to: 499 }]);
  });
});

describe('evaluating converted programs', () => {
  const cat = (codes: string[]): Courses =>
    Object.fromEntries(codes.map((c) => [c, { title: c, units: '3', prereqText: '', prereq: null }]));

  it('counts only the best-matching stream, and never counts advisor items', () => {
    const p = convert('biology');
    const taken = ['STAT 302', 'BISC 360W', 'BISC 306', 'BISC 308', 'BISC 407', 'BISC 410', 'BISC 412'];
    const courses = cat([...new Set([...taken, ...reqs(p).flatMap((r) => (r.kind === 'choose' ? (r.from.codes ?? []) : []))])]);
    const r = evaluateProgram(p, new Set(taken), courses);
    const streams = r.sections.filter((s) => s.section.choice);
    expect(streams.filter((s) => s.chosen).map((s) => s.section.title)).toEqual([
      'Ecology, Evolution, and Conservation (EEC) Stream',
    ]);
    const manual = reqs(p).filter((x) => x.kind === 'note');
    expect(r.manual).toBeGreaterThan(0);
    expect(r.manual).toBeLessThanOrEqual(manual.length);
    const counted = r.sections.filter((s) => !s.section.choice || s.chosen).flatMap((s) => s.results);
    expect(r.total).toBe(counted.filter((x) => x.status !== 'manual').length);
    expect(counted.filter((x) => x.req.kind === 'note').every((x) => x.status === 'manual')).toBe(true);
  });
});
