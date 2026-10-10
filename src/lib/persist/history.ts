// Version history: snapshots of the saved document that survive reloads, so
// any change can be undone later. See docs/accounts-design.md, Layer 2.
//
// PLACEHOLDER: this fixes the API so sync and UI code can be written against
// it; the implementation (IndexedDB with a byte budget, thinning, owner
// filter) replaces the bodies.

import type { AppDoc } from './doc';

export interface HistoryEntry {
  id: string;
  /** when the snapshot was taken (ms) */
  at: number;
  /** what was about to happen, e.g. "Before auto-arrange · Schedule 1" */
  label: string;
  /** e.g. "12 taken · 3 schedules · 9 courses" */
  summary: string;
  /** whose data it is (AppDoc.owner) */
  owner: string | null;
  doc: AppDoc;
}

/**
 * Save a snapshot of `doc` (default: the current document). Never throws and
 * never blocks saving: if history storage is full or unavailable it drops
 * the oldest entries, and if that fails it just reports false.
 */
export async function snapshot(label: string, doc?: AppDoc): Promise<boolean> {
  void label;
  void doc;
  return true;
}

/** Snapshots for one owner (null = data never tied to an account), newest first. */
export async function listHistory(owner: string | null): Promise<HistoryEntry[]> {
  void owner;
  return [];
}

/**
 * Restore a snapshot as the user's own change (it gets new stamps, so it
 * syncs to other devices). Snapshots the current state first.
 */
export async function restore(id: string): Promise<boolean> {
  void id;
  return false;
}

/** Forget snapshots for one owner, or all (shared-computer sign-out). */
export async function clearHistory(owner?: string | null): Promise<void> {
  void owner;
}
