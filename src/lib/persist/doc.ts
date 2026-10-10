// The saved document: everything a student would be upset to lose, in units
// small enough to merge (per course, per schedule slot, per setting). See
// docs/accounts-design.md. Pure functions only; the reactive store that uses
// them is store.svelte.ts.

import { validateState, SLOT_COUNT, type Slot } from '../schedule/schedule';

export const SCHEMA = 2;

export type CourseState = 'taken' | 'notTaken' | 'none';

export interface Stamped<T> {
  value: T;
  /** when the user last changed it (monotonic ms, see Clock); 0 = never stamped */
  at: number;
}

export interface Settings {
  assumePrereqs: boolean;
  program: string;
  planPerTerm: number;
}

export interface AppDoc {
  schema: number;
  /** Supabase user id this data belongs to, or null if never signed in */
  owner: string | null;
  /** per course; 'none' with a stamp is a tombstone (unticked) */
  courses: Record<string, { state: CourseState; at: number }>;
  slots: Stamped<Slot>[];
  settings: { [K in keyof Settings]: Stamped<Settings[K]> };
  /** sections a newer version wrote that this version doesn't know: kept as is */
  unknown?: Record<string, unknown>;
}

/** The plain values the app works with, without stamps. */
export interface Values {
  taken: string[];
  notTaken: string[];
  slots: Slot[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = { assumePrereqs: true, program: '', planPerTerm: 4 };

/**
 * Stamps that never go backwards and can't be dominated by a device whose
 * clock runs fast: each one is later than anything seen so far, including
 * stamps from other devices.
 */
export class Clock {
  constructor(
    private highest = 0,
    private now: () => number = Date.now,
  ) {}
  /** Note a stamp from elsewhere so our next one is later. */
  see(at: number): void {
    if (at > this.highest) this.highest = at;
  }
  next(): number {
    this.highest = Math.max(this.now(), this.highest + 1);
    return this.highest;
  }
}

/** The highest stamp anywhere in a document. */
export function highestStamp(doc: AppDoc): number {
  let max = 0;
  for (const c of Object.values(doc.courses)) max = Math.max(max, c.at);
  for (const s of doc.slots) max = Math.max(max, s.at);
  for (const s of Object.values(doc.settings)) max = Math.max(max, s.at);
  return max;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The values described by a document. */
export function toValues(doc: AppDoc): Values {
  const taken: string[] = [];
  const notTaken: string[] = [];
  for (const [code, c] of Object.entries(doc.courses)) {
    if (c.state === 'taken') taken.push(code);
    else if (c.state === 'notTaken') notTaken.push(code);
  }
  const byCode = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
  return {
    taken: taken.sort(byCode),
    notTaken: notTaken.sort(byCode),
    slots: doc.slots.map((s) => structuredClone(s.value)),
    settings: {
      assumePrereqs: doc.settings.assumePrereqs.value,
      program: doc.settings.program.value,
      planPerTerm: doc.settings.planPerTerm.value,
    },
  };
}

function courseStates(v: Values): Map<string, CourseState> {
  const m = new Map<string, CourseState>();
  for (const c of v.notTaken) m.set(c, 'notTaken');
  for (const c of v.taken) m.set(c, 'taken'); // taken wins if listed in both
  return m;
}

/**
 * A document for `next`, given the document for the previous values. Only
 * what actually changed gets a new stamp; everything else keeps its stamp.
 * With `clock` null nothing is stamped (used when loading or applying a
 * change that came from somewhere else: stamps then come from `prev`, and
 * new entries get 0).
 */
export function updateDoc(prev: AppDoc, next: Values, clock: Clock | null): AppDoc {
  // A changed entry gets a new stamp; without a clock it keeps the stamp it
  // had (or 0 if it's new), so loading never makes anything look "newer".
  const stamp = (had: number | undefined) => (clock ? clock.next() : (had ?? 0));
  const doc: AppDoc = {
    schema: Math.max(prev.schema, SCHEMA),
    owner: prev.owner,
    courses: { ...prev.courses },
    slots: [],
    settings: { ...prev.settings },
    ...(prev.unknown ? { unknown: prev.unknown } : {}),
  };

  const nowStates = courseStates(next);
  for (const [code, state] of nowStates) {
    const had = doc.courses[code];
    if (had?.state !== state) doc.courses[code] = { state, at: stamp(had?.at) };
  }
  // Courses no longer ticked or rejected become tombstones so the "unticked"
  // survives a merge with a device that still has them ticked.
  for (const [code, c] of Object.entries(doc.courses)) {
    if (!nowStates.has(code) && c.state !== 'none') doc.courses[code] = { state: 'none', at: stamp(c.at) };
  }

  for (let i = 0; i < SLOT_COUNT; i++) {
    const was = prev.slots[i];
    const value = next.slots[i];
    doc.slots[i] = was && sameJson(was.value, value) ? was : { value: structuredClone(value), at: stamp(was?.at) };
  }

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const was = prev.settings[key];
    const value = next.settings[key];
    if (!was || was.value !== value) {
      (doc.settings as Record<string, Stamped<unknown>>)[key] = { value, at: stamp(was?.at) };
    }
  }
  return doc;
}

/** A document for values that have never been stamped (all `at: 0`). */
export function docFromValues(values: Values, owner: string | null = null): AppDoc {
  return updateDoc(emptyDoc(owner), values, null);
}

export function emptyDoc(owner: string | null = null): AppDoc {
  const slotsState = validateState(null);
  return {
    schema: SCHEMA,
    owner,
    courses: {},
    slots: slotsState.slots.map((value) => ({ value, at: 0 })),
    settings: {
      assumePrereqs: { value: DEFAULT_SETTINGS.assumePrereqs, at: 0 },
      program: { value: DEFAULT_SETTINGS.program, at: 0 },
      planPerTerm: { value: DEFAULT_SETTINGS.planPerTerm, at: 0 },
    },
  };
}

/** True when the document holds nothing a student entered. */
export function isEmptyDoc(doc: AppDoc): boolean {
  const v = toValues(doc);
  return !v.taken.length && !v.notTaken.length && v.slots.every((s) => !s.courses.length);
}

const KNOWN = new Set(['schema', 'owner', 'courses', 'slots', 'settings', 'unknown']);

/**
 * Read a document from anywhere (storage, a backup, the server). Never
 * throws: bad parts fall back to defaults. Keys a newer version added are
 * kept in `unknown` so this version doesn't destroy them when it saves.
 */
export function parseDoc(input: unknown): AppDoc {
  const raw = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, any>;
  const doc = emptyDoc(typeof raw.owner === 'string' ? raw.owner : null);
  doc.schema = Number.isInteger(raw.schema) && raw.schema > SCHEMA ? raw.schema : SCHEMA;

  if (raw.courses && typeof raw.courses === 'object') {
    for (const [code, c] of Object.entries(raw.courses as Record<string, any>)) {
      if (!c || !['taken', 'notTaken', 'none'].includes(c.state)) continue;
      doc.courses[code] = { state: c.state, at: Number.isFinite(c.at) ? c.at : 0 };
    }
  }
  if (Array.isArray(raw.slots)) {
    const checked = validateState({ active: 0, slots: raw.slots.map((s: any) => s?.value) });
    doc.slots = checked.slots.map((value, i) => ({ value, at: Number.isFinite(raw.slots[i]?.at) ? raw.slots[i].at : 0 }));
  }
  if (raw.settings && typeof raw.settings === 'object') {
    const s = raw.settings;
    if (typeof s.assumePrereqs?.value === 'boolean') doc.settings.assumePrereqs = stamped(s.assumePrereqs);
    if (typeof s.program?.value === 'string') doc.settings.program = stamped(s.program);
    if (Number.isInteger(s.planPerTerm?.value)) doc.settings.planPerTerm = stamped(s.planPerTerm);
  }

  const unknown: Record<string, unknown> = { ...(raw.unknown && typeof raw.unknown === 'object' ? raw.unknown : {}) };
  for (const [k, v] of Object.entries(raw)) if (!KNOWN.has(k)) unknown[k] = v;
  if (Object.keys(unknown).length) doc.unknown = unknown;
  return doc;
}

function stamped<T>(s: { value: T; at?: unknown }): Stamped<T> {
  return { value: s.value, at: Number.isFinite(s.at) ? (s.at as number) : 0 };
}

/** A short description for history entries: "12 taken · 3 schedules · 9 courses". */
export function summarize(doc: AppDoc): string {
  const v = toValues(doc);
  const used = v.slots.filter((s) => s.courses.length);
  const inSchedules = used.reduce((n, s) => n + s.courses.length, 0);
  const parts = [`${v.taken.length} taken`];
  if (used.length) parts.push(`${used.length} schedule${used.length === 1 ? '' : 's'} · ${inSchedules} course${inSchedules === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
