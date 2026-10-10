import { describe, expect, it } from 'vitest';
import { Clock, emptyDoc, parseDoc, toValues, updateDoc, type AppDoc, type Values } from '../persist/doc';
import { canonical, describeMerge, mergeDocs, sameContent } from './merge';

/** A device: a document plus a clock with its own idea of "now". */
function device(now: () => number, doc: AppDoc = emptyDoc()) {
  const clock = new Clock(0, now);
  const d = {
    doc,
    clock,
    edit(change: (v: Values) => void) {
      const v = toValues(d.doc);
      change(v);
      d.doc = updateDoc(d.doc, v, clock);
    },
  };
  return d;
}

const ticking = (start: number) => {
  let t = start;
  return () => (t += 10);
};

const addTo = (slot: number, code: string) => (v: Values) => {
  v.slots[slot].courses.push({ code, picks: {} });
};

describe('mergeDocs: schedule slots', () => {
  it('laptop edits Schedule 1, phone edits Schedule 2: both kept', () => {
    const start = emptyDoc('u1');
    const laptop = device(ticking(1000), structuredClone(start));
    const phone = device(ticking(2000), structuredClone(start));
    laptop.edit(addTo(0, 'CMPT 225'));
    phone.edit(addTo(1, 'MATH 232'));

    const { doc, report } = mergeDocs(laptop.doc, phone.doc);
    const v = toValues(doc);
    expect(v.slots[0].courses.map((c) => c.code)).toEqual(['CMPT 225']);
    expect(v.slots[1].courses.map((c) => c.code)).toEqual(['MATH 232']);
    expect(report.local.slots.map((s) => s.index)).toEqual([0]);
    expect(report.remote.slots.map((s) => s.index)).toEqual([1]);
    expect(describeMerge(report)).toBe('Kept Schedule 1 from this device; kept Schedule 2 from your account');

    // The other way round gives the same content.
    expect(sameContent(mergeDocs(phone.doc, laptop.doc).doc, doc)).toBe(true);
  });

  it('the same slot edited on both: the later edit wins, whole slot', () => {
    const laptop = device(ticking(1000));
    const phone = device(ticking(5000));
    laptop.edit(addTo(0, 'CMPT 225'));
    phone.edit(addTo(0, 'MATH 232'));
    const { doc } = mergeDocs(laptop.doc, phone.doc);
    expect(toValues(doc).slots[0].courses.map((c) => c.code)).toEqual(['MATH 232']);
  });

  it('a tie keeps this device', () => {
    const a = device(() => 1000);
    const b = device(() => 1000);
    a.edit(addTo(2, 'CMPT 225'));
    b.edit(addTo(2, 'MATH 232'));
    expect(a.doc.slots[2].at).toBe(b.doc.slots[2].at);
    expect(toValues(mergeDocs(a.doc, b.doc).doc).slots[2].courses[0].code).toBe('CMPT 225');
    expect(toValues(mergeDocs(b.doc, a.doc).doc).slots[2].courses[0].code).toBe('MATH 232');
  });
});

describe('mergeDocs: courses', () => {
  it('merges per course and keeps tombstones', () => {
    const a = device(ticking(1000));
    const b = device(ticking(1000));
    a.edit((v) => v.taken.push('CMPT 120', 'CMPT 125'));
    b.edit((v) => v.taken.push('CMPT 120', 'MATH 151'));
    b.edit((v) => (v.taken = v.taken.filter((c) => c !== 'CMPT 120'))); // b unticks it later
    a.edit((v) => v.notTaken.push('MACM 101'));

    const { doc, report } = mergeDocs(a.doc, b.doc);
    expect(doc.courses['CMPT 120'].state).toBe('none'); // b's later untick wins
    const v = toValues(doc);
    expect(v.taken).toEqual(['CMPT 125', 'MATH 151']);
    expect(v.notTaken).toEqual(['MACM 101']);
    expect(report.remote.courses.map((c) => c.code).sort()).toEqual(['CMPT 120', 'MATH 151']);
    expect(report.local.courses.map((c) => c.code).sort()).toEqual(['CMPT 125', 'MACM 101']);
    expect(describeMerge(report)).toBe(
      'Kept 1 taken course from this device; kept 1 course marked not taken from this device; added 1 taken course from your account; unticked 1 course from your account',
    );
  });

  it('a later tick beats an earlier tombstone', () => {
    const a = device(ticking(1000));
    const b = device(ticking(9000));
    a.edit((v) => v.taken.push('CMPT 120'));
    a.edit((v) => (v.taken = []));
    b.edit((v) => v.taken.push('CMPT 120'));
    expect(mergeDocs(a.doc, b.doc).doc.courses['CMPT 120'].state).toBe('taken');
  });

  it('a tombstone beats a course the other side never stamped (at 0)', () => {
    const a = device(ticking(1000), updateDoc(emptyDoc(), { ...toValues(emptyDoc()), taken: ['CMPT 120'] }, null));
    expect(a.doc.courses['CMPT 120'].at).toBe(0);
    const b = device(ticking(1000), structuredClone(a.doc));
    b.edit((v) => (v.taken = []));
    expect(mergeDocs(a.doc, b.doc).doc.courses['CMPT 120'].state).toBe('none');
  });

  it('counts "added 3 taken courses from your account"', () => {
    const a = device(ticking(1000));
    const b = device(ticking(1000));
    b.edit((v) => v.taken.push('CMPT 120', 'CMPT 125', 'CMPT 225'));
    a.edit(addTo(1, 'CMPT 300'));
    expect(describeMerge(mergeDocs(a.doc, b.doc).report)).toBe(
      'Kept Schedule 2 from this device; added 3 taken courses from your account',
    );
  });
});

describe('mergeDocs: clock skew', () => {
  it("a device with a fast clock can't win every later merge", () => {
    const HOUR = 3600_000;
    const fast = device(ticking(10_000 + HOUR)); // an hour ahead
    const slow = device(ticking(10_000));
    fast.edit((v) => (v.settings.program = 'CS major'));
    // The slow device receives it (its clock sees the stamps), then edits.
    const merged = mergeDocs(slow.doc, fast.doc).doc;
    slow.doc = merged;
    for (const s of Object.values(merged.settings)) slow.clock.see(s.at);
    slow.edit((v) => (v.settings.program = 'SoSy major'));
    expect(slow.doc.settings.program.at).toBeGreaterThan(fast.doc.settings.program.at);
    const back = mergeDocs(fast.doc, slow.doc);
    expect(back.doc.settings.program.value).toBe('SoSy major');
    expect(describeMerge(back.report)).toBe('Kept your program from your account');
  });
});

describe('mergeDocs: settings, schema and unknown sections', () => {
  it('merges each setting on its own', () => {
    const a = device(ticking(1000));
    const b = device(ticking(1000));
    a.edit((v) => (v.settings.planPerTerm = 3));
    b.edit((v) => (v.settings.program = 'CS major'));
    const { doc, report } = mergeDocs(a.doc, b.doc);
    expect(toValues(doc).settings).toEqual({ assumePrereqs: true, program: 'CS major', planPerTerm: 3 });
    expect(report.local.settings).toEqual(['planPerTerm']);
    expect(report.remote.settings).toEqual(['program']);
  });

  it('keeps unknown sections from both sides, preferring the newer schema', () => {
    const local = parseDoc({ ...emptyDoc(), schema: 2, unknown: { notes: 'local', mine: 1 } });
    const remote = parseDoc({ ...emptyDoc(), schema: 3, friends: ['x'], notes: 'remote' });
    expect(remote.unknown).toEqual({ friends: ['x'], notes: 'remote' });
    const { doc, report } = mergeDocs(local, remote);
    expect(doc.schema).toBe(3);
    expect(doc.unknown).toEqual({ notes: 'remote', mine: 1, friends: ['x'] });
    expect(report.remote.unknown.sort()).toEqual(['friends', 'notes']);
    expect(report.local.unknown).toEqual(['mine']);

    // Same schema: this device's copy of a shared section wins.
    const same = mergeDocs(local, { ...remote, schema: 2 });
    expect(same.doc.unknown?.notes).toBe('local');
    expect(same.doc.schema).toBe(2);
  });

  it('no unknown sections: none in the result', () => {
    expect('unknown' in mergeDocs(emptyDoc(), emptyDoc()).doc).toBe(false);
  });
});

describe('describeMerge and sameContent', () => {
  it("is '' when nothing differs", () => {
    const a = device(ticking(1000));
    a.edit((v) => v.taken.push('CMPT 120'));
    const { doc, report } = mergeDocs(a.doc, structuredClone(a.doc));
    expect(describeMerge(report)).toBe('');
    expect(sameContent(doc, a.doc)).toBe(true);
  });

  it('ignores key order (jsonb reorders keys) and owner', () => {
    const a = device(ticking(1000));
    a.edit((v) => v.taken.push('CMPT 120', 'CMPT 125'));
    const reordered = JSON.parse(canonical(a.doc)) as AppDoc;
    reordered.courses = Object.fromEntries(Object.entries(reordered.courses).reverse());
    expect(sameContent({ ...reordered, owner: 'x' }, a.doc)).toBe(true);
    expect(mergeDocs(a.doc, reordered).report).toEqual(mergeDocs(a.doc, a.doc).report);
  });

  it('never mutates its inputs', () => {
    const a = device(ticking(1000));
    const b = device(ticking(2000));
    a.edit(addTo(0, 'CMPT 225'));
    b.edit(addTo(1, 'MATH 232'));
    const ja = JSON.stringify(a.doc);
    const jb = JSON.stringify(b.doc);
    const { doc } = mergeDocs(a.doc, b.doc);
    doc.slots[0].value.courses.push({ code: 'X', picks: {} });
    expect(JSON.stringify(a.doc)).toBe(ja);
    expect(JSON.stringify(b.doc)).toBe(jb);
  });
});
