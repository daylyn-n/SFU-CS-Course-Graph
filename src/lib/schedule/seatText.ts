// Seat snapshot text for the schedule builder's chosen sections. Pure, so
// it's testable; the data comes from seats.ts.

import { seatInfo, describeSeats, formatAsOf, type SeatData, type SeatLevel } from '../seats';
import type { Section } from '../types';

export interface SeatItem {
  section: string;
  type: string;
  text: string;
  level: SeatLevel;
}

/**
 * Seat lines for a course's chosen sections in one term:
 * { items: [{ section, type, text, level }], asOf: 'Sep 29' }, or null when
 * the snapshot has none of them (no data is never shown as "0 seats").
 */
export function seatSummary(
  seats: SeatData | null | undefined,
  termId: string | null | undefined,
  code: string,
  sections: readonly Pick<Section, 'section' | 'type'>[] | null | undefined,
): { items: SeatItem[]; asOf: string | null } | null {
  const items: SeatItem[] = [];
  let asOf: string | null = null;
  for (const s of sections ?? []) {
    const info = seatInfo(seats, termId, code, s?.section);
    if (!info || !Number.isFinite(info.max) || !Number.isFinite(info.enrolled)) continue;
    asOf ??= info.asOf;
    items.push({ section: s.section, type: s.type ?? '', ...describeSeats(info) });
  }
  return items.length ? { items, asOf: asOf ? formatAsOf(asOf) : null } : null;
}

/** Short seat text for a section picker option ("12 of 200 seats left"), or ''. */
export function seatLabel(
  seats: SeatData | null | undefined,
  termId: string | null | undefined,
  code: string,
  section: string | undefined,
): string {
  const info = seatInfo(seats, termId, code, section);
  if (!info || !Number.isFinite(info.max) || !Number.isFinite(info.enrolled)) return '';
  return describeSeats(info).text;
}
