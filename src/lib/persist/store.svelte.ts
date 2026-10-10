// The one place that owns what a student has entered (taken courses,
// schedules, settings) and keeps it saved. Components read and change the
// live values exported here; this module writes them to localStorage, stamps
// only what the user actually changed (see doc.ts), applies changes from
// other tabs, and tells listeners (history, undo, sync) about every change.

import { SvelteSet } from 'svelte/reactivity';
import { scheduleState } from '../schedule/store.svelte';
import { validateState } from '../schedule/schedule';
import {
  Clock,
  DEFAULT_SETTINGS,
  highestStamp,
  parseDoc,
  toValues,
  updateDoc,
  type AppDoc,
  type Settings,
  type Values,
} from './doc';

// The values keep their existing keys, so nothing is lost on upgrade and an
// older tab of the app still reads them. Stamps and the owner live in META.
export const KEYS = {
  taken: 'sfu-prereqs:taken',
  notTaken: 'sfu-prereqs:not-taken',
  assumePrereqs: 'sfu-prereqs:assume-prereqs',
  schedules: 'sfu-prereqs:schedules',
  program: 'sfu-prereqs:program',
  planPerTerm: 'sfu-prereqs:per-term',
  meta: 'sfu-prereqs:doc-meta',
} as const;
const OUR_KEYS = new Set<string>(Object.values(KEYS));

/** What changed and why. 'local' covers ordinary edits. */
export type ChangeSource = 'local' | 'undo' | 'restore' | 'import' | 'tab' | 'remote' | 'load';
/** Changes the user made here (stamped, synced); the rest came from elsewhere. */
export const isOwnChange = (s: ChangeSource) => s === 'local' || s === 'undo' || s === 'restore' || s === 'import';

export interface ChangeEvent {
  source: ChangeSource;
  before: AppDoc;
  after: AppDoc;
}

// ---- Reading storage --------------------------------------------------------

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readCodes(key: string): string[] {
  try {
    const v = JSON.parse(read(key) ?? '[]');
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function readValues(): Values {
  const assume = read(KEYS.assumePrereqs);
  const perTerm = Number(read(KEYS.planPerTerm));
  let schedules;
  try {
    schedules = validateState(JSON.parse(read(KEYS.schedules) ?? 'null'));
  } catch {
    schedules = validateState(null);
  }
  return {
    taken: readCodes(KEYS.taken),
    notTaken: readCodes(KEYS.notTaken),
    slots: schedules.slots,
    settings: {
      assumePrereqs: assume === null ? DEFAULT_SETTINGS.assumePrereqs : assume === 'true',
      program: read(KEYS.program) ?? DEFAULT_SETTINGS.program,
      planPerTerm: Number.isInteger(perTerm) && perTerm > 0 ? perTerm : DEFAULT_SETTINGS.planPerTerm,
    },
  };
}

function readDoc(): AppDoc {
  let meta: unknown = null;
  try {
    meta = JSON.parse(read(KEYS.meta) ?? 'null');
  } catch {}
  // The value keys are the truth (an older tab may have written them); the
  // meta only supplies stamps. Nothing gets a new stamp just from loading.
  return updateDoc(parseDoc(meta), readValues(), null);
}

// ---- Live state -------------------------------------------------------------

let doc: AppDoc = readDoc();
const clock = new Clock(highestStamp(doc));
const initial = toValues(doc);

/** Courses ticked as taken. */
export const done = new SvelteSet<string>(initial.taken);
/** Courses the user said they didn't take (rejecting a filled-in guess). */
export const notTaken = new SvelteSet<string>(initial.notTaken);
/** Synced settings. */
export const settings: Settings = $state({ ...initial.settings });
// Schedules live in the schedule store (scheduleState); the loaded slots go
// there too, so both modules agree from the start.
scheduleState.slots = initial.slots;

/** Shown to the user when saving on this device fails. */
export const persistStatus: { error: string | null } = $state({ error: null });

// Same order as toValues(), so values from any source compare equal.
const byCode = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function currentValues(): Values {
  return {
    taken: [...done].sort(byCode),
    notTaken: [...notTaken].sort(byCode),
    slots: $state.snapshot(scheduleState.slots),
    settings: { ...$state.snapshot(settings) },
  };
}

const serialize = (v: Values) => JSON.stringify(v);
let saved = serialize(currentValues());
let savedActive = scheduleState.active;
/** Values being applied from somewhere else, and why: not stamped. */
let incoming: { json: string; source: ChangeSource } | null = null;
/** Values being set by an own action other than an ordinary edit (undo...). */
let ownSource: ChangeSource | null = null;

const listeners = new Set<(e: ChangeEvent) => void>();

/** Hear about every change to the saved document. Returns an unsubscribe. */
export function onChange(fn: (e: ChangeEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e: ChangeEvent) {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      console.error(err);
    }
  }
}

// ---- Writing storage --------------------------------------------------------

function write(key: string, value: string) {
  localStorage.setItem(key, value);
}

function writeAll(v: Values, d: AppDoc) {
  try {
    write(KEYS.taken, JSON.stringify(v.taken));
    write(KEYS.notTaken, JSON.stringify(v.notTaken));
    write(KEYS.assumePrereqs, String(v.settings.assumePrereqs));
    write(KEYS.schedules, JSON.stringify({ active: scheduleState.active, slots: v.slots }));
    write(KEYS.program, v.settings.program);
    write(KEYS.planPerTerm, String(v.settings.planPerTerm));
    write(KEYS.meta, JSON.stringify(d));
    persistStatus.error = null;
  } catch (err) {
    persistStatus.error =
      (err as Error)?.name === 'QuotaExceededError'
        ? "This browser's storage is full, so your latest changes aren't saved on this device."
        : "This browser is blocking storage, so your changes aren't saved on this device.";
  }
}

let askedToPersist = false;
/** Ask the browser not to evict our data under storage pressure. */
function requestDurableStorage() {
  if (askedToPersist) return;
  askedToPersist = true;
  navigator.storage?.persist?.().catch(() => {});
}

// Every change to the live values lands here (after Svelte batches it).
$effect.root(() => {
  $effect(() => {
    const values = currentValues();
    const active = scheduleState.active;
    const json = serialize(values);
    if (json === saved) {
      // Only the active slot (a device preference) changed: save, don't stamp.
      if (active !== savedActive) {
        savedActive = active;
        writeAll(values, doc);
      }
      return;
    }

    const before = doc;
    let source: ChangeSource;
    if (incoming && incoming.json === json) {
      source = incoming.source; // doc already set by applyDoc
    } else {
      source = ownSource ?? 'local';
      doc = updateDoc(doc, values, clock);
      requestDurableStorage();
    }
    incoming = null;
    ownSource = null;
    saved = json;
    savedActive = active;
    // Another tab's change is already in storage; writing it back could
    // bounce storage events between tabs.
    if (source !== 'tab') writeAll(values, doc);
    emit({ source, before, after: doc });
  });
});

// ---- Changing everything at once ---------------------------------------------

function assign(v: Values) {
  done.clear();
  for (const c of v.taken) done.add(c);
  notTaken.clear();
  for (const c of v.notTaken) notTaken.add(c);
  Object.assign(settings, v.settings);
  scheduleState.slots = structuredClone(v.slots);
}

/** The saved document as it stands. */
export function getDoc(): AppDoc {
  return doc;
}

/**
 * Apply a document that came from somewhere else (another tab, the server).
 * Its stamps are kept as they are: nothing here counts as a new edit.
 */
export function applyDoc(next: AppDoc, source: 'tab' | 'remote' | 'load'): void {
  const before = doc;
  doc = next;
  clock.see(highestStamp(next));
  const values = toValues(next);
  const json = serialize(values);
  if (json === saved) {
    // Same values (stamps or owner may differ): just save the document.
    if (source !== 'tab') writeAll(values, doc);
    emit({ source, before, after: doc });
    return;
  }
  incoming = { json, source };
  assign(values);
}

/**
 * Set everything to `values` as the user's own action (undo, restoring a
 * version, importing a backup). What differs gets new stamps, so it wins over
 * older copies on other devices.
 */
export function setValues(values: Values, source: 'undo' | 'restore' | 'import'): void {
  if (serialize(values) === saved) return;
  ownSource = source;
  assign(values);
}

/** Mark whose data this is (on sign-in) or clear it (shared-computer sign-out). */
export function setOwner(owner: string | null): void {
  if (doc.owner === owner) return;
  doc = { ...doc, owner };
  writeAll(currentValues(), doc);
}

// Another tab saved: take its values and stamps (shared storage is the truth).
addEventListener('storage', (e) => {
  if (e.key === null || OUR_KEYS.has(e.key)) applyDoc(readDoc(), 'tab');
});
