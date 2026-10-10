import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMin,
  fmtMin,
  overlaps,
  meetings,
  parseSchedule,
  componentGroups,
  resolvePicks,
  findConflicts,
  examClashes,
  layoutDay,
  gridRange,
  arrange,
  termForAdd,
  validateState,
  parseState,
} from './schedule.js';

const block = (days, start, end) => ({ days, start, end });
const sec = (section, type, enrol, assoc, blocks = [], extra = {}) => ({ section, type, enrol, assoc, blocks, ...extra });
const m = (day, s, e) => ({ day, start: toMin(s), end: toMin(e) });

test('toMin and fmtMin', () => {
  assert.equal(toMin('8:30'), 510);
  assert.equal(toMin('08:30'), 510);
  assert.equal(toMin('13:20'), 800);
  for (const bad of ['', '8', '8:3', '25:00', '10:75', null, undefined, 830]) assert.equal(toMin(bad), null);
  assert.equal(fmtMin(510), '8:30');
  assert.equal(fmtMin(780), '13:00');
});

test('overlaps: touching end/start is not a conflict', () => {
  assert.equal(overlaps(m('Mo', '8:30', '9:20'), m('Mo', '9:20', '10:20')), false);
  assert.equal(overlaps(m('Mo', '9:20', '10:20'), m('Mo', '8:30', '9:20')), false);
  assert.equal(overlaps(m('Mo', '8:30', '9:21'), m('Mo', '9:20', '10:20')), true);
  assert.equal(overlaps(m('Mo', '8:30', '12:00'), m('Mo', '9:00', '10:00')), true); // containment
  assert.equal(overlaps(m('Mo', '9:00', '10:00'), m('Mo', '9:00', '10:00')), true); // identical
  assert.equal(overlaps(m('Mo', '9:00', '10:00'), m('Tu', '9:00', '10:00')), false); // other day
});

test('meetings expands days, skips bad blocks and falls back to the schedule text', () => {
  const s = sec('D100', 'LEC', true, '1', [
    { days: ['Mo', 'We'], start: '8:30', end: '9:20', campus: 'Burnaby' },
    { days: ['Xx'], start: '8:30', end: '9:20' },
    { days: ['Fr'], start: '10:00', end: '9:00' },
    { days: ['Fr'], start: 'TBA', end: '9:00' },
    null,
  ]);
  assert.deepEqual(meetings(s), [
    { day: 'Mo', start: 510, end: 560, campus: 'Burnaby' },
    { day: 'We', start: 510, end: 560, campus: 'Burnaby' },
  ]);
  assert.deepEqual(meetings({ blocks: [] }), []); // online / TBA
  assert.deepEqual(meetings({ schedule: 'Mo, We 8:30–10:20, Fr 9:30–10:20' }).map((x) => x.day), ['Mo', 'We', 'Fr']);
  assert.deepEqual(parseSchedule('Tu Th 14:30-15:20')[0], { days: ['Tu', 'Th'], start: '14:30', end: '15:20' });
  assert.deepEqual(meetings(undefined), []);
});

// CMPT 225-like: two lectures, each with its own labs, plus an orphan open lab.
const CMPT = [
  sec('D100', 'LEC', true, '1', [block(['Tu'], '11:30', '13:20'), block(['Th'], '11:30', '12:20')]),
  sec('D101', 'LAB', false, '1', [block(['Th'], '8:30', '9:20')]),
  sec('D102', 'LAB', false, '1', [block(['Th'], '14:30', '15:20')]),
  sec('D200', 'LEC', true, '2', [block(['Mo', 'We'], '8:30', '9:20')]),
  sec('D201', 'LAB', false, '2', [block(['Fr'], '10:30', '11:20')]),
  sec('D202', 'TUT', false, '2', [block(['Fr'], '12:30', '13:20')]),
  sec('OP01', 'OPL', false, '200'),
];

test('componentGroups: components by assoc, orphans optional', () => {
  const g1 = componentGroups(CMPT, CMPT[0]);
  assert.deepEqual(
    g1.map((g) => [g.key, g.required, g.options.map((o) => o.section)]),
    [
      ['LAB', true, ['D101', 'D102']],
      ['OPL', false, ['OP01']],
    ],
  );
  const g2 = componentGroups(CMPT, CMPT[3]);
  assert.deepEqual(
    g2.map((g) => [g.key, g.required, g.options.map((o) => o.section)]),
    [
      ['LAB', true, ['D201']],
      ['TUT', true, ['D202']],
      ['OPL', false, ['OP01']],
    ],
  );
  // No components at all: nothing extra to pick.
  assert.deepEqual(componentGroups([sec('D100', 'LEC', true, '1')], { section: 'D100', type: 'LEC', assoc: '1' }), []);
  // A component of the enrolment section's own type gets a distinct key.
  const same = [sec('D100', 'LEC', true, '1'), sec('D101', 'LEC', false, '1')];
  assert.equal(componentGroups(same, same[0])[0].key, 'LEC-2');
});

test('resolvePicks ignores stale picks and reports completeness', () => {
  let r = resolvePicks(CMPT, { LEC: 'D100', LAB: 'D102' });
  assert.equal(r.enrol.section, 'D100');
  assert.deepEqual(r.chosen.map((s) => s.section), ['D100', 'D102']);
  assert.equal(r.complete, true);
  r = resolvePicks(CMPT, { LEC: 'D100', LAB: 'D201' }); // D201 belongs to D200
  assert.equal(r.complete, false);
  r = resolvePicks(CMPT, { LEC: 'D999' });
  assert.equal(r.enrol, null);
  assert.equal(r.complete, false);
  // Old-format data: no type/enrol fields, every section is an enrolment section.
  r = resolvePicks([{ section: 'D100', schedule: 'Tu 14:30–17:20' }], { LEC: 'D100' });
  assert.equal(r.complete, true);
});

test('findConflicts reports the overlapping stretch', () => {
  const a = { code: 'CMPT 225', section: CMPT[0] };
  const b = { code: 'MATH 152', section: sec('D101', 'TUT', false, '1', [block(['Tu'], '12:30', '14:20')]) };
  const c = { code: 'MACM 101', section: sec('D100', 'LEC', true, '1', [block(['Tu'], '13:20', '14:00')]) };
  const out = findConflicts([a, b, c]);
  assert.equal(out.length, 2);
  assert.equal(out[0].a.code, 'CMPT 225');
  assert.equal(out[0].b.code, 'MATH 152');
  assert.deepEqual([out[0].day, fmtMin(out[0].start), fmtMin(out[0].end)], ['Tu', '12:30', '13:20']);
  // CMPT 225 ends 13:20 and MACM starts 13:20: touching, so only MATH/MACM clash.
  assert.deepEqual([out[1].a.code, out[1].b.code], ['MATH 152', 'MACM 101']);
});

test('examClashes: same date and overlapping time only', () => {
  const ex = (code, date, start, end) => ({ code, section: { exam: { date, start, end } } });
  const out = examClashes([
    ex('A 100', '2026-12-10', '12:00', '15:00'),
    ex('B 100', '2026-12-10', '14:00', '17:00'),
    ex('C 100', '2026-12-10', '15:00', '18:00'), // touches A
    ex('D 100', '2026-12-11', '12:00', '15:00'),
    { code: 'E 100', section: {} },
  ]);
  assert.deepEqual(out.map((x) => [x.a, x.b]), [
    ['A 100', 'B 100'],
    ['B 100', 'C 100'],
  ]);
});

test('layoutDay puts overlapping events side by side', () => {
  const ev = (id, s, e) => ({ id, start: toMin(s), end: toMin(e) });
  const out = layoutDay([ev('a', '9:00', '11:00'), ev('b', '10:00', '12:00'), ev('c', '11:00', '12:00'), ev('d', '13:00', '14:00')]);
  const by = Object.fromEntries(out.map((e) => [e.id, e]));
  assert.deepEqual([by.a.col, by.b.col, by.c.col, by.a.cols], [0, 1, 0, 2]);
  assert.deepEqual([by.a.conflict, by.b.conflict, by.c.conflict, by.d.conflict], [true, true, true, false]);
  assert.deepEqual([by.d.col, by.d.cols], [0, 1]);
});

test('gridRange: weekdays plus used weekend days, hours fit the content', () => {
  assert.deepEqual(gridRange([]), { days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], from: 480, to: 1080 });
  const r = gridRange([m('Sa', '7:30', '9:00'), m('Mo', '18:30', '20:20')]);
  assert.deepEqual(r, { days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], from: 420, to: 21 * 60 });
});

test('arrange finds a conflict-free combination, keeping current picks', () => {
  // MATH lecture clashes with CMPT D100 on Tu; its tutorial choice matters too.
  const MATH = [
    sec('D100', 'LEC', true, '1', [block(['Tu'], '12:30', '13:20')]),
    sec('D200', 'LEC', true, '2', [block(['Mo', 'We'], '10:30', '11:20')]),
    sec('D201', 'TUT', false, '2', [block(['Fr'], '10:30', '11:20')]), // clashes with CMPT D201
    sec('D202', 'TUT', false, '2', [block(['Th'], '15:30', '16:20')]), // no extra campus day
  ];
  const r = arrange([
    { code: 'CMPT 225', sections: CMPT, picks: { LEC: 'D100', LAB: 'D102' } },
    { code: 'MATH 152', sections: MATH, picks: { LEC: 'D100' } },
  ]);
  assert.equal(r.conflicts, 0);
  assert.equal(r.exhaustive, true);
  assert.deepEqual(r.picks[0], { LEC: 'D100', LAB: 'D102' }); // kept: changing CMPT isn't needed
  assert.deepEqual(r.picks[1], { LEC: 'D200', TUT: 'D202' });
  assert.deepEqual([r.changes, r.early, r.days], [1, 0, 4]);
});

test('arrange prefers fewer early/late blocks, then fewer days', () => {
  const S = [
    sec('D100', 'LEC', true, '1', [block(['Mo'], '8:30', '9:20')]), // early
    sec('D200', 'LEC', true, '2', [block(['Tu'], '10:30', '11:20')]), // fine, but a new day
    sec('D300', 'LEC', true, '3', [block(['We'], '17:30', '19:20')]), // late
    sec('D400', 'LEC', true, '4', [block(['Mo'], '12:30', '13:20')]), // fine, shares Monday
  ];
  const fixed = { code: 'X 100', sections: [sec('D100', 'LEC', true, '1', [block(['Mo'], '10:30', '11:20')])], picks: { LEC: 'D100' } };
  const r = arrange([fixed, { code: 'Y 100', sections: S, picks: {} }]);
  assert.deepEqual(r.picks[1], { LEC: 'D400' });
  assert.deepEqual([r.conflicts, r.early, r.days], [0, 0, 1]);
});

test('arrange minimises conflicts when none is conflict-free', () => {
  const A = [sec('D100', 'LEC', true, '1', [block(['Mo', 'We'], '10:30', '11:20')])];
  const B = [
    sec('D100', 'LEC', true, '1', [block(['Mo', 'We'], '10:30', '11:20')]), // 2 clashes
    sec('D200', 'LEC', true, '2', [block(['Mo', 'Fr'], '10:30', '11:20')]), // 1 clash
  ];
  const r = arrange([
    { code: 'A 100', sections: A, picks: {} },
    { code: 'B 100', sections: B, picks: { LEC: 'D100' } },
  ]);
  assert.equal(r.conflicts, 1);
  assert.deepEqual(r.picks[1], { LEC: 'D200' });
});

test('arrange: fixed courses keep picks, unknown courses pass through, budget is respected', () => {
  const B = [
    sec('D100', 'LEC', true, '1', [block(['Mo'], '10:30', '11:20')]),
    sec('D200', 'LEC', true, '2', [block(['Tu'], '10:30', '11:20')]),
  ];
  const r = arrange([
    { code: 'A 100', sections: B, picks: { LEC: 'D100' }, fixed: true },
    { code: 'B 100', sections: B, picks: {} },
    { code: 'GONE 1', sections: undefined, picks: { LEC: 'D100' } },
  ]);
  assert.deepEqual(r.picks, [{ LEC: 'D100' }, { LEC: 'D200' }, { LEC: 'D100' }]);

  // Many courses with many options: still returns quickly with a valid answer.
  const many = Array.from({ length: 8 }, (_, c) => ({
    code: `C ${c}`,
    sections: Array.from({ length: 12 }, (_, k) =>
      sec(`D${k}`, 'LEC', true, String(k), [block([['Mo', 'Tu', 'We', 'Th', 'Fr'][k % 5]], `${8 + (k % 6)}:30`, `${9 + (k % 6)}:20`)]),
    ),
    picks: {},
  }));
  const t = Date.now();
  const big = arrange(many, { maxNodes: 5000 });
  assert.ok(Date.now() - t < 2000);
  assert.equal(big.picks.length, 8);
  assert.ok(big.picks.every((p) => p.LEC));
});

test('termForAdd switches term only when everything else fits', () => {
  const terms = [
    { id: 'f', current: true },
    { id: 's', current: false },
  ];
  const off = { A: { f: [{}] }, B: { s: [{}] }, C: { f: [{}], s: [{}] }, Z: {} };
  const slot = (term, codes) => ({ term, courses: codes.map((code) => ({ code, picks: {} })) });
  assert.deepEqual(termForAdd('A', slot(null, []), terms, off), { term: 'f', offered: true });
  assert.deepEqual(termForAdd('B', slot('f', []), terms, off), { term: 's', switched: true, offered: true });
  assert.deepEqual(termForAdd('B', slot('f', ['C']), terms, off), { term: 's', switched: true, offered: true });
  assert.deepEqual(termForAdd('B', slot('f', ['A']), terms, off), { term: 'f', elsewhere: 's', offered: true });
  assert.deepEqual(termForAdd('Z', slot('f', []), terms, off), { term: 'f', offered: false });
});

test('validateState survives corrupt storage', () => {
  for (const bad of [null, 42, 'x', [], { slots: 'no' }, { active: 9, slots: [null, 5, { courses: 'x' }] }]) {
    const s = validateState(bad);
    assert.equal(s.slots.length, 3);
    assert.equal(s.active, 0);
    assert.deepEqual(s.slots[1], { name: 'Schedule 2', term: null, courses: [] });
  }
  for (const text of ['{oops', '', 'null', '"str"', '{"slots":[{"courses":[1,{"code":7}]}]}']) {
    assert.equal(parseState(text).slots[0].courses.length, 0);
  }
  const s = validateState({
    active: 2,
    slots: [
      {
        name: '  Plan A  ',
        term: '2026/fall',
        courses: [
          { code: 'CMPT 225', picks: { LEC: 'D100', LAB: 7, bad: null } },
          { code: 'CMPT 225', picks: {} },
          { code: 'MATH 151', picks: [] },
        ],
      },
      { name: '', term: 5 },
    ],
  });
  assert.equal(s.active, 2);
  assert.equal(s.slots[0].name, 'Plan A');
  assert.deepEqual(s.slots[0].courses, [
    { code: 'CMPT 225', picks: { LEC: 'D100' } },
    { code: 'MATH 151', picks: {} },
  ]);
  assert.deepEqual(s.slots[1], { name: 'Schedule 2', term: null, courses: [] });
});
