// Seat counts from SFU's public Course Section Availability Report, which
// Institutional Research posts as a daily snapshot during registration (not
// live). public/data/seats.json:
//   { fetched, terms: { "2026/fall": { asOf: "2026-09-29",
//       sections: { "CMPT 225": { "D100": { max: 200, enrolled: 28 } } } } } }
// Live seats and waitlists are only in goSFU, which needs a login.

export const GOSFU_URL = 'https://go.sfu.ca/';

export interface SeatCount {
  max: number;
  enrolled: number;
}
export interface SeatData {
  fetched?: string;
  terms: Record<string, { asOf: string; sections: Record<string, Record<string, SeatCount>> }>;
}
export type SeatLevel = 'full' | 'tight' | 'open';

let pending: Promise<SeatData> | null = null;

/** Load (once) and return the seats data, or an empty one if unavailable. */
export function loadSeats(): Promise<SeatData> {
  pending ??= fetch(`${import.meta.env.BASE_URL}data/seats.json`)
    .then((r) => (r.ok ? r.json() : { terms: {} }))
    .catch(() => {
      pending = null;
      return { terms: {} };
    });
  return pending;
}

/** { max, enrolled, asOf } for one section, or null if the report lacks it. */
export function seatInfo(
  seats: SeatData | null | undefined,
  termId: string | null | undefined,
  code: string,
  section: string | undefined,
): (SeatCount & { asOf: string }) | null {
  const term = termId == null ? undefined : seats?.terms?.[termId];
  const s = section == null ? undefined : term?.sections?.[code]?.[section];
  return s && term ? { ...s, asOf: term.asOf } : null;
}

/** "28/200 filled" style text plus a fullness level for colouring. */
export function describeSeats({ max, enrolled }: SeatCount): { text: string; level: SeatLevel } {
  const left = Math.max(0, max - enrolled);
  const ratio = max ? enrolled / max : 1;
  return {
    text: left === 0 ? `Full (${enrolled}/${max})` : `${left} of ${max} seats left`,
    level: left === 0 ? 'full' : ratio >= 0.85 ? 'tight' : 'open',
  };
}

/** "Sep 29" from "2026-09-29". */
export function formatAsOf(asOf: string): string {
  const d = new Date(`${asOf}T12:00:00`);
  return isNaN(d.getTime()) ? asOf : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
