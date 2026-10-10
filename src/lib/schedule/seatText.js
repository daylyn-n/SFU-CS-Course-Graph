// Seat snapshot text for the schedule builder's chosen sections. Pure, so
// it's testable; the data comes from seats.js.

import { seatInfo, describeSeats, formatAsOf } from '../seats.js';

/**
 * Seat lines for a course's chosen sections in one term:
 * { items: [{ section, type, text, level }], asOf: 'Sep 29' }, or null when
 * the snapshot has none of them (no data is never shown as "0 seats").
 */
export function seatSummary(seats, termId, code, sections) {
  const items = [];
  let asOf = null;
  for (const s of sections ?? []) {
    const info = seatInfo(seats, termId, code, s?.section);
    if (!info || !Number.isFinite(info.max) || !Number.isFinite(info.enrolled)) continue;
    asOf ??= info.asOf;
    items.push({ section: s.section, type: s.type ?? '', ...describeSeats(info) });
  }
  return items.length ? { items, asOf: asOf ? formatAsOf(asOf) : null } : null;
}

/** Short seat text for a section picker option ("12 of 200 seats left"), or ''. */
export function seatLabel(seats, termId, code, section) {
  const info = seatInfo(seats, termId, code, section);
  if (!info || !Number.isFinite(info.max) || !Number.isFinite(info.enrolled)) return '';
  return describeSeats(info).text;
}
