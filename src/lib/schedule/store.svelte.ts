// Saved schedules (3 slots), shared between the schedule builder and the rest
// of the app. Persisted to localStorage on every change.

import { arrange, emptySlot, parseState, termForAdd, validateState, type Picks, type ScheduleState, type Slot } from './schedule';
import type { Offerings, Term } from '../types';

const KEY = 'sfu-prereqs:schedules';

function load(): ScheduleState {
  try {
    return parseState(localStorage.getItem(KEY));
  } catch {
    return validateState(null); // storage blocked
  }
}

export const scheduleState: ScheduleState = $state(load());
/** Transient feedback, e.g. "Added CMPT 225 to Schedule 1". */
export const scheduleNotice: { text: string; kind: 'info' | 'warn'; id: number } = $state({ text: '', kind: 'info', id: 0 });

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(scheduleState);
    try {
      localStorage.setItem(KEY, json);
    } catch {}
  });
});

// Terms and offerings, once someone hands them over (see setScheduleData).
let data: { terms: Term[]; offerings: Offerings } | null = null;

/** Give the store the term/offering data so adds can pick terms and sections. */
export function setScheduleData({ terms, offerings }: { terms: Term[]; offerings: Offerings }): void {
  data = { terms, offerings };
}

export const activeSlot = (): Slot => scheduleState.slots[scheduleState.active];

export function notify(text: string, kind: 'info' | 'warn' = 'info'): void {
  scheduleNotice.text = text;
  scheduleNotice.kind = kind;
  scheduleNotice.id++;
}

const termLabel = (id: string | null) => data?.terms.find((t) => t.id === id)?.label ?? id;

/** Default picks for `code` in the slot, avoiding clashes with what's there. */
function defaultPicks(slot: Slot, code: string): Picks {
  const { offerings } = data!;
  const items = slot.courses.map((c) => ({
    code: c.code,
    sections: slot.term == null ? undefined : offerings[c.code]?.[slot.term],
    picks: c.picks,
    fixed: c.code !== code,
  }));
  const i = slot.courses.findIndex((c) => c.code === code);
  return arrange(items, { maxNodes: 20000 }).picks[i];
}

/** Add a course to the active schedule. */
export function addToSchedule(code: string): void {
  const slot = activeSlot();
  if (slot.courses.some((c) => c.code === code)) return;
  if (!data) {
    // No data yet: the builder fills in sections when it opens.
    slot.courses.push({ code, picks: {} });
    notify(`Added ${code} to ${slot.name}`);
    return;
  }
  const where = termForAdd(code, slot, data.terms, data.offerings);
  const switched = where.switched && slot.term !== where.term && slot.courses.length > 0;
  slot.term = where.term;
  slot.courses.push({ code, picks: {} });
  if (switched) {
    // Section names differ between terms, so re-pick everything together.
    const term = slot.term;
    const items = slot.courses.map((c) => ({ code: c.code, sections: term == null ? undefined : data!.offerings[c.code]?.[term], picks: {} }));
    const result = arrange(items, { maxNodes: 50000 });
    slot.courses.forEach((c, i) => (c.picks = result.picks[i]));
  } else {
    slot.courses.at(-1)!.picks = defaultPicks(slot, code);
  }
  if (!where.offered) notify(`Added ${code}, but it isn't offered in any upcoming term`, 'warn');
  else if (where.elsewhere)
    notify(`Added ${code}, but it isn't offered in ${termLabel(slot.term)}. It runs in ${termLabel(where.elsewhere)}.`, 'warn');
  else if (switched) notify(`Added ${code} and switched ${slot.name} to ${termLabel(slot.term)}, when it runs`);
  else notify(`Added ${code} to ${slot.name} (${termLabel(slot.term)})`);
}

/** Is the course in the active schedule? */
export function isInSchedule(code: string): boolean {
  return activeSlot().courses.some((c) => c.code === code);
}

export function removeCourse(code: string): void {
  const slot = activeSlot();
  slot.courses = slot.courses.filter((c) => c.code !== code);
}

export function setPicks(code: string, picks: Picks): void {
  const c = activeSlot().courses.find((c) => c.code === code);
  if (c) c.picks = picks;
}

/** Change the active slot's term, re-picking sections for it. */
export function setTerm(term: string): void {
  const slot = activeSlot();
  if (slot.term === term) return;
  slot.term = term;
  if (!data) return;
  const result = arrange(
    slot.courses.map((c) => ({ code: c.code, sections: data!.offerings[c.code]?.[term], picks: c.picks })),
    { maxNodes: 50000 },
  );
  slot.courses.forEach((c, i) => (c.picks = result.picks[i]));
}

export function renameSlot(i: number, name: string): void {
  const slot = scheduleState.slots[i];
  slot.name = name.trim().slice(0, 40) || emptySlot(i).name;
}

export function clearSlot(i: number): void {
  scheduleState.slots[i].courses = [];
}

/** Copy slot `from` over slot `to` (named "<name> copy") and switch to it. */
export function duplicateSlot(from: number, to: number): void {
  const src = $state.snapshot(scheduleState.slots[from]);
  scheduleState.slots[to] = { ...src, name: `${src.name} copy`.slice(0, 40) };
  scheduleState.active = to;
}
