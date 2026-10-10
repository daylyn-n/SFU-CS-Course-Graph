// Weekly timetable helpers: turn section schedule strings into meetings,
// find clashes between chosen sections, and search for a clash-free set.
// Pure functions only; the UI lives in TimetableView.svelte.
import type { Section } from './types';

export const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
export type Day = (typeof DAYS)[number];
export const DAY_NAMES: Record<Day, string> = {
  Mo: 'Monday',
  Tu: 'Tuesday',
  We: 'Wednesday',
  Th: 'Thursday',
  Fr: 'Friday',
  Sa: 'Saturday',
  Su: 'Sunday',
};

/** One weekly meeting; times are minutes after midnight. */
export interface Meeting {
  day: Day;
  start: number;
  end: number;
}

export interface ParsedSchedule {
  meetings: Meeting[];
  /** No meeting times published yet (empty schedule string). */
  tba: boolean;
  /**
   * Blocks that span most of the day on every weekday (co-op practicums are
   * listed as "Mo, Tu, We, Th, Fr 8:00–20:00"). Not real class times, so they
   * stay off the grid and never count as conflicts.
   */
  flexible: boolean;
  /** Pieces of the string that couldn't be understood. */
  errors: string[];
}

// "Mo", "Mon", "Monday", "TUE", ... -> Day
const DAY_ALIASES: Record<string, Day> = {
  mo: 'Mo', mon: 'Mo', monday: 'Mo',
  tu: 'Tu', tue: 'Tu', tues: 'Tu', tuesday: 'Tu',
  we: 'We', wed: 'We', wednesday: 'We',
  th: 'Th', thu: 'Th', thur: 'Th', thurs: 'Th', thursday: 'Th',
  fr: 'Fr', fri: 'Fr', friday: 'Fr',
  sa: 'Sa', sat: 'Sa', saturday: 'Sa',
  su: 'Su', sun: 'Su', sunday: 'Su',
};

const FLEXIBLE_MINUTES = 10 * 60;

/** "9:30" / "14:30" / "2:30pm" -> minutes after midnight, or null. */
export function parseTime(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  } else if (m[2] === undefined) {
    return null; // a bare number isn't a time
  }
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** 870 -> "14:30" */
export function formatTime(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseDays(s: string): Day[] | null {
  const words = s.trim().split(/[\s/&]+/).filter(Boolean);
  if (!words.length) return [];
  const days: Day[] = [];
  for (const w of words) {
    const key = w.toLowerCase().replace(/\.$/, '');
    if (DAY_ALIASES[key]) {
      days.push(DAY_ALIASES[key]);
      continue;
    }
    // Run-together two-letter codes, e.g. "MoWeFr"
    const run = key.match(/^(?:mo|tu|we|th|fr|sa|su)+$/) && key.match(/../g);
    if (!run) return null;
    days.push(...run.map((d) => DAY_ALIASES[d]));
  }
  return days;
}

/**
 * Parse a section's schedule string. Formats seen in offerings.json:
 *   "Tu 14:30–17:20"
 *   "Mo, We, Fr 11:30–12:20"           (days share the next time range)
 *   "Tu 13:30–14:20, Th 12:30–14:20"
 *   "Mo 12:30–13:20, We, Fr 12:30–13:20"
 *   ""                                  (times not published)
 * Never throws; anything it can't read goes into `errors`.
 */
export function parseSchedule(schedule: string | null | undefined): ParsedSchedule {
  const result: ParsedSchedule = { meetings: [], tba: false, flexible: false, errors: [] };
  const text = (schedule ?? '').trim();
  if (!text) {
    result.tba = true;
    return result;
  }

  let pending: Day[] = [];
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(.*?)\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]m)?)\s*(?:–|—|-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]m)?)$/i);
    const days = parseDays(m ? m[1] : part);
    if (!days) {
      result.errors.push(part);
      pending = [];
      continue;
    }
    if (!m) {
      pending.push(...days); // e.g. "We" in "Mo 9:30–10:20, We, Fr 9:30–10:20"
      continue;
    }
    const start = parseTime(m[2]);
    const end = parseTime(m[3]);
    const all = [...pending, ...days];
    pending = [];
    if (start === null || end === null || end <= start || !all.length) {
      result.errors.push(part);
      continue;
    }
    for (const day of new Set(all)) {
      if (!result.meetings.some((x) => x.day === day && x.start === start && x.end === end)) {
        result.meetings.push({ day, start, end });
      }
    }
  }
  if (pending.length) result.errors.push(`${pending.join(', ')} (no time given)`);

  const weekdays = new Set(result.meetings.map((x) => x.day));
  result.flexible =
    result.meetings.length >= 5 &&
    weekdays.size >= 5 &&
    result.meetings.every((x) => x.end - x.start >= FLEXIBLE_MINUTES);
  result.meetings.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start);
  return result;
}

/** Meetings that should appear on the grid and count for conflicts. */
export function timedMeetings(schedule: string): Meeting[] {
  const p = parseSchedule(schedule);
  return p.flexible ? [] : p.meetings;
}

export function overlaps(a: Meeting, b: Meeting): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

export interface Pick {
  code: string;
  section: Section;
}

export interface Conflict {
  a: Pick;
  b: Pick;
  day: Day;
  /** overlapping window */
  start: number;
  end: number;
}

/** Every pair of overlapping meetings between different picks. */
export function findConflicts(picks: Pick[]): Conflict[] {
  const meetings = picks.map((p) => timedMeetings(p.section.schedule));
  const out: Conflict[] = [];
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      for (const x of meetings[i]) {
        for (const y of meetings[j]) {
          if (overlaps(x, y)) {
            out.push({
              a: picks[i],
              b: picks[j],
              day: x.day,
              start: Math.max(x.start, y.start),
              end: Math.min(x.end, y.end),
            });
          }
        }
      }
    }
  }
  return out;
}

export function describeConflict(c: Conflict): string {
  return (
    `${c.a.code} ${c.a.section.section} and ${c.b.code} ${c.b.section.section} overlap ` +
    `${DAY_NAMES[c.day]} ${formatTime(c.start)}–${formatTime(c.end)}`
  );
}

export interface AutoPickOptions {
  /** Prefer sections on this campus (others are still allowed). */
  campus?: string;
  /** Current choice per course; kept when it costs nothing else. */
  current?: Record<string, string>;
  /** Give up after visiting this many search nodes. */
  limit?: number;
}

export interface AutoPickResult {
  /** course code -> section name */
  picks: Record<string, string>;
  /** sections not on the preferred campus */
  offCampus: number;
  /** false if no conflict-free combination was found */
  ok: boolean;
}

/**
 * Backtracking search for a conflict-free section per course. Among
 * conflict-free combinations it minimises sections off the preferred campus,
 * then changes from the current picks. Courses with no sections are skipped.
 */
export function autoPick(
  codes: string[],
  sectionsFor: (code: string) => Section[],
  { campus, current = {}, limit = 200_000 }: AutoPickOptions = {},
): AutoPickResult {
  const cost = (code: string, s: Section) =>
    (campus && s.campus !== campus ? 1000 : 0) + (current[code] && current[code] !== s.section ? 1 : 0);

  const vars = codes
    .map((code) => ({
      code,
      options: [...sectionsFor(code)]
        .map((section) => ({ section, meetings: timedMeetings(section.schedule), cost: cost(code, section) }))
        .sort((a, b) => a.cost - b.cost),
    }))
    .filter((v) => v.options.length)
    // fewest choices first prunes the most
    .sort((a, b) => a.options.length - b.options.length);

  // Cheapest possible cost of the remaining courses, for pruning.
  const floor = vars.map((v) => v.options[0].cost);
  const rest = floor.map((_, i) => floor.slice(i).reduce((s, c) => s + c, 0));

  let best: { cost: number; choice: number[] } | null = null;
  const choice: number[] = [];
  const placed: Meeting[] = [];
  let visited = 0;

  function search(i: number, total: number): void {
    if (visited++ > limit) return;
    if (best && total + (rest[i] ?? 0) >= best.cost) return;
    if (i === vars.length) {
      best = { cost: total, choice: [...choice] };
      return;
    }
    vars[i].options.forEach((opt, k) => {
      if (opt.meetings.some((m) => placed.some((p) => overlaps(m, p)))) return;
      choice.push(k);
      placed.push(...opt.meetings);
      search(i + 1, total + opt.cost);
      placed.length -= opt.meetings.length;
      choice.pop();
    });
  }
  search(0, 0);

  const found = best as { cost: number; choice: number[] } | null;
  if (!found) return { picks: { ...current }, offCampus: 0, ok: false };
  const picks: Record<string, string> = {};
  let offCampus = 0;
  vars.forEach((v, i) => {
    const s = v.options[found.choice[i]].section;
    picks[v.code] = s.section;
    if (campus && s.campus !== campus) offCampus++;
  });
  return { picks, offCampus, ok: true };
}
