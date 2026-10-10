import { describe, expect, it } from 'vitest';
import {
  compareTaken,
  compactCode,
  decodeShareHash,
  encodeShareHash,
  makeBackup,
  parseBackup,
  parseCode,
  shareUrl,
} from './share';
import { docFromValues, toValues, updateDoc, Clock } from './persist/doc';
import { validateState } from './schedule/schedule';

describe('parseCode', () => {
  it('normalises common spellings', () => {
    for (const s of ['CMPT 120', 'cmpt120', 'CMPT-120', 'CMPT+120', ' Cmpt  120 ']) expect(parseCode(s)).toBe('CMPT 120');
    expect(parseCode('math100w')).toBe('MATH 100W');
    expect(compactCode('MATH 100W')).toBe('MATH100W');
  });

  it('rejects things that are not course codes', () => {
    for (const s of ['', 'CMPT', '120', 'CMPT 12', 'C 120', '<script>']) expect(parseCode(s)).toBeNull();
  });
});

describe('encodeShareHash / decodeShareHash', () => {
  it('writes a compact, sorted, de-duplicated hash', () => {
    expect(encodeShareHash('CMPT 410', ['MACM 101', 'CMPT 120', 'MACM 101'])).toBe('#CMPT-410?taken=CMPT120,MACM101');
  });

  it('leaves the taken part off when nothing is taken', () => {
    expect(encodeShareHash('CMPT 410', [])).toBe('#CMPT-410');
  });

  it('round-trips', () => {
    const taken = ['CMPT 120', 'CMPT 125', 'MACM 101', 'MATH 100W'];
    expect(decodeShareHash(encodeShareHash('CMPT 307', taken))).toEqual({ target: 'CMPT 307', taken });
  });

  it('reads old-style links with no taken set', () => {
    expect(decodeShareHash('#CMPT-410')).toEqual({ target: 'CMPT 410', taken: null });
    expect(decodeShareHash('')).toEqual({ target: null, taken: null });
  });

  it('tolerates encoding, spaces, hand edits and junk', () => {
    expect(decodeShareHash('#CMPT%20410?taken=CMPT%20120%2Cmacm101')).toEqual({
      target: 'CMPT 410',
      taken: ['CMPT 120', 'MACM 101'],
    });
    expect(decodeShareHash('#CMPT-410?taken=CMPT120 MACM101,,nope')).toEqual({
      target: 'CMPT 410',
      taken: ['CMPT 120', 'MACM 101'],
    });
    expect(decodeShareHash('#CMPT-410?taken=CMPT+120')).toEqual({ target: 'CMPT 410', taken: ['CMPT 120'] });
    expect(decodeShareHash('#CMPT-410?taken=')).toEqual({ target: 'CMPT 410', taken: [] });
    // A malformed escape shouldn't lose the rest of the link.
    expect(decodeShareHash('#%E0%A4%A?taken=CMPT120').taken).toEqual(['CMPT 120']);
  });

  it('builds a full URL, replacing any existing hash', () => {
    expect(shareUrl('CMPT 410', ['CMPT 120'], 'https://x.dev/app/?a=1#CMPT-225')).toBe(
      'https://x.dev/app/?a=1#CMPT-410?taken=CMPT120',
    );
  });
});

describe('compareTaken', () => {
  it('lists what would be added and removed', () => {
    expect(compareTaken(['CMPT 120', 'CMPT 125'], ['CMPT 125', 'MACM 101'])).toEqual({
      added: ['MACM 101'],
      removed: ['CMPT 120'],
      same: false,
    });
    expect(compareTaken(['CMPT 120'], ['CMPT 120']).same).toBe(true);
  });
});

describe('backups', () => {
  it('round-trips through JSON', () => {
    const b = makeBackup('CMPT 410', ['MACM 101', 'CMPT 120'], new Date('2026-01-02T03:04:05Z'));
    expect(b).toEqual({
      app: 'sfu-prereqs',
      version: 1,
      exported: '2026-01-02T03:04:05.000Z',
      target: 'CMPT 410',
      taken: ['CMPT 120', 'MACM 101'],
    });
    expect(parseBackup(JSON.stringify(b))).toEqual({ target: 'CMPT 410', taken: ['CMPT 120', 'MACM 101'] });
  });

  it('accepts a bare array like the localStorage value', () => {
    expect(parseBackup('["CMPT 120", 42, "bogus", "macm101"]')).toEqual({ target: null, taken: ['CMPT 120', 'MACM 101'] });
  });

  it('rejects bad files with a readable message', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"foo": 1}')).toThrow(/taken courses/);
    expect(() => parseBackup('{"app": "other", "taken": []}')).toThrow(/backup/);
  });
});

describe('full (v2) backups', () => {
  const slots = validateState(null).slots;
  slots[1] = { ...slots[1], name: 'Fall', courses: [{ code: 'CMPT 225', picks: { enrol: 'D100' } }] };
  const values = {
    taken: ['CMPT 120', 'MACM 101'],
    notTaken: ['MATH 100'],
    slots,
    settings: { assumePrereqs: false, program: 'cs-major', planPerTerm: 5 },
  };
  const doc = updateDoc(docFromValues(values, 'user-1'), { ...values, taken: [...values.taken, 'CMPT 125'] }, new Clock(0, () => 5));

  it('exports the whole document with the target', () => {
    const b = makeBackup('CMPT 410', doc, new Date('2026-01-02T03:04:05Z'));
    expect(b).toEqual({ app: 'sfu-prereqs', version: 2, exported: '2026-01-02T03:04:05.000Z', target: 'CMPT 410', doc });
  });

  it('round-trips everything: taken, schedules, settings, stamps', () => {
    const parsed = parseBackup(JSON.stringify(makeBackup('CMPT 410', doc)));
    expect(parsed.target).toBe('CMPT 410');
    expect(parsed.taken).toEqual(['CMPT 120', 'CMPT 125', 'MACM 101']);
    expect(parsed.doc).toEqual(doc);
    expect(toValues(parsed.doc!).slots[1].courses[0]).toEqual({ code: 'CMPT 225', picks: { enrol: 'D100' } });
    expect(toValues(parsed.doc!).settings).toEqual({ assumePrereqs: false, program: 'cs-major', planPerTerm: 5 });
  });

  it('still reads v1 files and bare arrays without a doc', () => {
    expect(parseBackup('{"app":"sfu-prereqs","version":1,"target":"cmpt-225","taken":["CMPT 120"]}')).toEqual({
      target: 'CMPT 225',
      taken: ['CMPT 120'],
    });
    expect(parseBackup('{"app":"sfu-prereqs","version":1,"target":"x","taken":[]}').doc).toBeUndefined();
    expect(parseBackup('[]')).toEqual({ target: null, taken: [] });
  });

  it('tolerates damaged parts of a v2 doc', () => {
    const parsed = parseBackup(
      JSON.stringify({ app: 'sfu-prereqs', version: 2, doc: { courses: { 'CMPT 120': { state: 'taken' }, bad: 7 }, slots: 'nope' } }),
    );
    expect(parsed.target).toBeNull();
    expect(parsed.taken).toEqual(['CMPT 120']);
    expect(toValues(parsed.doc!).slots).toHaveLength(3);
  });

  it('rejects malformed files with a readable message', () => {
    for (const text of ['', '{', 'null', '42', '"text"', '{"app":"sfu-prereqs","version":2}', '{"version":2,"doc":[1]}']) {
      expect(() => parseBackup(text), text).toThrow(/valid JSON|taken courses|incomplete|backup/);
    }
    expect(() => parseBackup('{"app":"other","version":2,"doc":{}}')).toThrow(/isn't an SFU Prerequisite Map backup/);
  });
});
