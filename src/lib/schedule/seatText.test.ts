import { test } from 'vitest';
import assert from 'node:assert/strict';
import { seatSummary, seatLabel } from './seatText';
import type { SeatData } from '../seats';

const seats = {
  terms: {
    '2026/fall': {
      asOf: '2026-09-29',
      sections: {
        'CMPT 225': { D100: { max: 200, enrolled: 188 }, D101: { max: 24, enrolled: 24 }, D102: { max: 24 } },
      },
    },
  },
} as unknown as SeatData; // D102 is deliberately malformed
const lec = { section: 'D100', type: 'LEC' };
const lab = { section: 'D101', type: 'LAB' };

test('seatSummary lists chosen sections with data, plus the snapshot date', () => {
  const s = seatSummary(seats, '2026/fall', 'CMPT 225', [lec, lab, { section: 'D199', type: 'LAB' }]);
  assert.equal(s?.asOf, 'Sep 29');
  assert.deepEqual(s?.items, [
    { section: 'D100', type: 'LEC', text: '12 of 200 seats left', level: 'tight' },
    { section: 'D101', type: 'LAB', text: 'Full (24/24)', level: 'full' },
  ]);
});

test('missing data gives null or empty text, never zero seats', () => {
  assert.equal(seatSummary(seats, '2027/spring', 'CMPT 225', [lec]), null);
  assert.equal(seatSummary(seats, '2026/fall', 'CMPT 120', [lec]), null);
  assert.equal(seatSummary({ terms: {} }, '2026/fall', 'CMPT 225', [lec]), null);
  assert.equal(seatSummary(null, '2026/fall', 'CMPT 225', [lec]), null);
  assert.equal(seatSummary(seats, '2026/fall', 'CMPT 225', []), null);
  // A malformed entry (no enrolled count) is skipped rather than shown as full.
  assert.equal(seatSummary(seats, '2026/fall', 'CMPT 225', [{ section: 'D102' }]), null);
  assert.equal(seatLabel(seats, '2026/fall', 'CMPT 225', 'D102'), '');
  assert.equal(seatLabel(null, '2026/fall', 'CMPT 225', 'D100'), '');
});

test('seatLabel gives the picker text', () => {
  assert.equal(seatLabel(seats, '2026/fall', 'CMPT 225', 'D100'), '12 of 200 seats left');
  assert.equal(seatLabel(seats, '2026/fall', 'CMPT 225', 'D101'), 'Full (24/24)');
});
