// When to take version-history snapshots (see docs/accounts-design.md,
// Layer 2): after edits settle, at most every couple of minutes, and always
// right before something destructive or bulk (`beforeBulk`).

import { getDoc, isOwnChange, onChange, setValues, type ChangeEvent } from './store.svelte';
import { connectHistory, lastSnapshotAt, snapshot } from './history';
import type { AppDoc } from './doc';

export const SETTLE_MS = 3000;
export const MIN_GAP_MS = 2 * 60_000;

export interface AutosnapDeps {
  onChange(fn: (e: ChangeEvent) => void): () => void;
  snapshot(label: string, doc?: AppDoc): Promise<boolean>;
  lastSnapshotAt(): Promise<number>;
  now?: () => number;
}

/** Snapshot "Autosave" once own edits settle, if the last snapshot is old enough. Returns a stop function. */
export function createAutosnap(deps: AutosnapDeps): () => void {
  const now = deps.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = async () => {
    try {
      if (now() - (await deps.lastSnapshotAt()) >= MIN_GAP_MS) await deps.snapshot('Autosave');
    } catch (err) {
      console.warn('Autosave snapshot skipped:', err);
    }
  };
  const off = deps.onChange(({ source }) => {
    if (!isOwnChange(source)) return;
    clearTimeout(timer);
    timer = setTimeout(settled, SETTLE_MS);
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}

connectHistory({ getDoc, setValues });

let started = false;
/** Start autosaving snapshots. Call once when the app starts. */
export function startAutosnap(): void {
  if (started) return;
  started = true;
  createAutosnap({ onChange, snapshot, lastSnapshotAt });
}

const bulkListeners = new Set<() => void>();
/** Hear when a bulk action is about to happen (undo starts a new step). */
export function onBeforeBulk(fn: () => void): () => void {
  bulkListeners.add(fn);
  return () => bulkListeners.delete(fn);
}

/**
 * Snapshot the current document right before a destructive or bulk action,
 * e.g. beforeBulk("Before auto-arrange · Schedule 1"). The document is
 * captured immediately, so callers needn't wait; the promise never rejects.
 */
export async function beforeBulk(label: string): Promise<void> {
  for (const fn of bulkListeners) {
    try {
      fn();
    } catch {}
  }
  try {
    await snapshot(label, getDoc());
  } catch {}
}
