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
