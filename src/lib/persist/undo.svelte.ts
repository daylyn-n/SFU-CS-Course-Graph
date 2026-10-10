// Undo/redo over the whole saved document (see docs/accounts-design.md,
// Layer 2). Edits close together make one step; a change from another tab or
// the server is a barrier that undo never goes past.

import { getDoc, onChange, setValues } from './store.svelte';
import { toValues, type Values } from './doc';
import { UndoStack } from './undoStack';
import { describe } from './describe';
import { onBeforeBulk } from './autosnap';
import { scheduleState } from '../schedule/store.svelte';
import { flash } from '../shareActions.svelte';

const stack = new UndoStack();
const counts = $state({ past: 0, future: 0 });
const sync = () => {
  counts.past = stack.past.length;
  counts.future = stack.future.length;
};

onChange(({ source, before, after }) => {
  stack.record(source, toValues(before), toValues(after));
  sync();
});
onBeforeBulk(() => stack.seal());

/** Reactive: is there anything to undo? */
export const canUndo = (): boolean => counts.past > 0;
/** Reactive: is there anything to redo? */
export const canRedo = (): boolean => counts.future > 0;

function apply(values: Values, from: Values) {
  const { slot } = describe(from, values);
  setValues(values, 'undo');
  // Show the schedule the change was in.
  if (slot !== null && slot !== scheduleState.active) scheduleState.active = slot;
}

export function undo(): void {
  const step = stack.undo();
  sync();
  if (!step) return flash('Nothing to undo.');
  apply(step.before, toValues(getDoc()));
  flash(`Undid: ${describe(step.before, step.after).text}`, { action: { label: 'Redo', run: redo } });
}

export function redo(): void {
  const step = stack.redo();
  sync();
  if (!step) return flash('Nothing to redo.');
  apply(step.after, toValues(getDoc()));
  flash(`Redid: ${describe(step.before, step.after).text}`, { action: { label: 'Undo', run: undo } });
}

function editable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z and Ctrl+Y redo, except while typing in
 * a field or while `isBlocked()` (e.g. the command palette is open). Returns
 * a function that removes the shortcuts.
 */
export function installUndoShortcuts(isBlocked: () => boolean = () => false): () => void {
  const onkeydown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey;
    const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey);
    if (!isUndo && !isRedo) return;
    if (editable(e.target) || editable(document.activeElement) || isBlocked()) return;
    e.preventDefault();
    if (isUndo) undo();
    else redo();
  };
  addEventListener('keydown', onkeydown);
  return () => removeEventListener('keydown', onkeydown);
}
