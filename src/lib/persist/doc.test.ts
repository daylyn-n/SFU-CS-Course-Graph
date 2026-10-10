import { describe, expect, it } from 'vitest';
import { Clock, docFromValues, emptyDoc, highestStamp, isEmptyDoc, parseDoc, summarize, toValues, updateDoc, type Values } from './doc';
import { validateState } from '../schedule/schedule';

const base = (): Values => ({
  taken: [],
  notTaken: [],
  slots: validateState(null).slots,
  settings: { assumePrereqs: true, program: '', planPerTerm: 4 },
});

const fixedClock = (start: number) => {
  let t = start;
  return new Clock(0, () => t++);
};

describe('stamps', () => {
  it('loading never stamps: existing data comes in at 0', () => {
    const v = { ...base(), taken: ['CMPT 120'] };
    const doc = docFromValues(v);
    expect(doc.courses['CMPT 120']).toEqual({ state: 'taken', at: 0 });
    expect(highestStamp(doc)).toBe(0);
  });

  it('only what changed gets a new stamp', () => {
    const clock = fixedClock(1000);
    let doc = docFromValues(base());
    doc = updateDoc(doc, { ...base(), taken: ['CMPT 120'] }, clock);
    const slotStamps = doc.slots.map((s) => s.at);
    const v = base();
    v.taken = ['CMPT 120'];
    v.slots[1] = { ...v.slots[1], courses: [{ code: 'CMPT 225', picks: {} }] };
    doc = updateDoc(doc, v, clock);
    expect(doc.courses['CMPT 120'].at).toBe(1000); // unchanged
    expect(doc.slots[0].at).toBe(slotStamps[0]);
    expect(doc.slots[2].at).toBe(slotStamps[2]);
    expect(doc.slots[1].at).toBeGreaterThan(1000);
  });

  it('unticking leaves a stamped tombstone', () => {
    const clock = fixedClock(5);
    let doc = updateDoc(docFromValues(base()), { ...base(), taken: ['MACM 101'] }, clock);
    doc = updateDoc(doc, base(), clock);
    expect(doc.courses['MACM 101'].state).toBe('none');
    expect(doc.courses['MACM 101'].at).toBeGreaterThan(5);
    expect(toValues(doc).taken).toEqual([]);
  });

  it('a course is never both taken and not taken', () => {
    const doc = updateDoc(docFromValues(base()), { ...base(), taken: ['X 100'], notTaken: ['X 100'] }, fixedClock(1));
    expect(toValues(doc)).toMatchObject({ taken: ['X 100'], notTaken: [] });
  });

  it('applying without a clock keeps existing stamps', () => {
    const clock = fixedClock(100);
    const doc = updateDoc(docFromValues(base()), { ...base(), taken: ['A 100'] }, clock);
    const again = updateDoc(doc, { ...base(), taken: ['A 100', 'B 200'] }, null);
    expect(again.courses['A 100'].at).toBe(100);
    expect(again.courses['B 200'].at).toBe(0);
  });
});

describe('Clock', () => {
  it('never goes backwards and stays ahead of stamps seen from elsewhere', () => {
    let now = 1000;
    const clock = new Clock(0, () => now);
    expect(clock.next()).toBe(1000);
    expect(clock.next()).toBe(1001); // same ms: still increases
    clock.see(5_000_000); // a device with a fast clock
    now = 2000;
    expect(clock.next()).toBe(5_000_001);
  });
});

describe('parseDoc', () => {
  it('never throws on junk and falls back to an empty document', () => {
    for (const junk of [null, 42, 'x', [], { courses: 'no', slots: {}, settings: [] }]) {
      expect(isEmptyDoc(parseDoc(junk))).toBe(true);
    }
  });

  it('round-trips a document', () => {
    const doc = updateDoc(emptyDoc('user-1'), { ...base(), taken: ['CMPT 225'] }, fixedClock(9));
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('keeps sections from a newer version instead of dropping them', () => {
    const fromFuture = { ...JSON.parse(JSON.stringify(emptyDoc())), schema: 3, minors: { value: ['MATH'], at: 7 } };
    const doc = parseDoc(fromFuture);
    expect(doc.schema).toBe(3);
    expect(doc.unknown).toEqual({ minors: { value: ['MATH'], at: 7 } });
    // ...and an edit by this version still carries them along.
    const edited = updateDoc(doc, { ...base(), taken: ['A 100'] }, fixedClock(1));
    expect(edited.unknown).toEqual(doc.unknown);
    expect(edited.schema).toBe(3);
  });

  it('drops invalid courses and keeps valid stamps', () => {
    const doc = parseDoc({ courses: { 'A 100': { state: 'taken', at: 4 }, 'B 200': { state: 'weird', at: 1 } } });
    expect(doc.courses).toEqual({ 'A 100': { state: 'taken', at: 4 } });
  });
});

describe('summarize', () => {
  it('describes what is saved', () => {
    const v = { ...base(), taken: ['A 100', 'B 200'] };
    v.slots[0] = { ...v.slots[0], courses: [{ code: 'C 300', picks: {} }, { code: 'D 400', picks: {} }] };
    expect(summarize(docFromValues(v))).toBe('2 taken · 1 schedule · 2 courses');
  });
});
