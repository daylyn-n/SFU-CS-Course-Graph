// The undo/redo bookkeeping, without any UI or live store (undo.svelte.ts
// wires it up). Steps hold whole Values before and after, so undoing a step
// sets everything back to how it was.

import type { Values } from './doc';
import type { ChangeSource } from './store.svelte';

export interface Step {
  before: Values;
  after: Values;
  /** when the step last grew (ms), for coalescing */
  at: number;
}

export const COALESCE_MS = 800;
export const MAX_STEPS = 100;

export class UndoStack {
  past: Step[] = [];
  future: Step[] = [];
  /** next change starts a new step even if it comes quickly */
  private sealed = false;

  constructor(private now: () => number = Date.now) {}

  /** Record a change to the document. */
  record(source: ChangeSource, before: Values, after: Values): void {
    if (source === 'undo') return; // ours: undo()/redo() already moved the step
    // Housekeeping (filling in sections, setting a slot's term) isn't
    // something to undo; steps hold whole values, so nothing goes stale.
    if (source === 'auto') return;
    if (source === 'tab' || source === 'remote' || source === 'load') {
      // A barrier: undo never reverts a change that came from elsewhere.
      this.past = [];
      this.future = [];
      return;
    }
    const t = this.now();
    const last = this.past.at(-1);
    this.future = [];
    if (source === 'local' && last && !this.sealed && t - last.at < COALESCE_MS) {
      last.after = after;
      last.at = t;
      return;
    }
    this.past.push({ before, after, at: t });
    if (this.past.length > MAX_STEPS) this.past.shift();
    // A restore or import is a step of its own: don't let edits join it.
    this.sealed = source !== 'local';
  }

  /** Make the next change a new step (before a bulk action). */
  seal(): void {
    this.sealed = true;
  }

  /** Take the step to undo; the caller applies `step.before`. */
  undo(): Step | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push(step);
    this.sealed = true;
    return step;
  }

  /** Take the step to redo; the caller applies `step.after`. */
  redo(): Step | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push(step);
    this.sealed = true;
    return step;
  }
}
