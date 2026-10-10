// Share/backup actions shared by the share menu and the command palette, plus
// the little bit of UI state they report back through (toast, import banner).

import {
  chartAvailable,
  compareTaken,
  copyText,
  downloadBackup,
  downloadChartPng,
  parseBackup,
  pickTextFile,
  shareUrl,
} from './share';
import type { Taken } from './types';

export interface PendingImport {
  taken: string[];
  target: string | null;
  source: 'link' | 'file';
  added: string[];
  removed: string[];
}

export interface Toast {
  message: string;
  error?: boolean;
  action?: { label: string; run: () => void };
}

export const shareUi = $state<{ pending: PendingImport | null; toast: Toast | null }>({
  pending: null,
  toast: null,
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function flash(message: string, opts: Omit<Toast, 'message'> = {}): void {
  clearTimeout(toastTimer);
  shareUi.toast = { message, ...opts };
  toastTimer = setTimeout(() => (shareUi.toast = null), opts.action ? 6000 : 3000);
}

/** Asks (via the banner) before applying someone else's taken set. Returns false if nothing would change. */
export function offerImport(local: Taken, taken: string[], target: string | null, source: PendingImport['source']): boolean {
  const { added, removed, same } = compareTaken(local, taken);
  if (same) return false;
  shareUi.pending = { taken, target, source, added, removed };
  return true;
}

/** Applies a pending import. `merge` keeps local courses; otherwise local is replaced. */
export function applyImport(done: Set<string>, merge: boolean): void {
  const p = shareUi.pending;
  if (!p) return;
  const before = [...done];
  if (!merge) done.clear();
  for (const c of p.taken) done.add(c);
  shareUi.pending = null;
  flash(merge ? `Added ${p.added.length} course${p.added.length === 1 ? '' : 's'}` : 'Replaced your taken courses', {
    action: { label: 'Undo', run: () => restore(done, before) },
  });
}

function restore(done: Set<string>, codes: string[]) {
  done.clear();
  for (const c of codes) done.add(c);
  shareUi.toast = null;
}

export function clearTaken(done: Set<string>): void {
  if (!done.size) return flash('No courses are marked as taken.');
  const before = [...done];
  done.clear();
  flash(`Cleared ${before.length} taken course${before.length === 1 ? '' : 's'}`, {
    action: { label: 'Undo', run: () => restore(done, before) },
  });
}

export async function copyShareLink(target: string, taken: Taken): Promise<void> {
  try {
    await copyText(shareUrl(target, taken));
    flash(taken.size ? `Link copied with ${taken.size} taken course${taken.size === 1 ? '' : 's'}` : 'Link copied');
  } catch {
    flash("Couldn't copy the link. Try again, or copy it from the address bar.", { error: true });
  }
}

export function exportProgress(target: string, taken: Taken): void {
  downloadBackup(target, taken);
  flash('Progress saved as a JSON file');
}

export async function importProgress(local: Taken): Promise<void> {
  const text = await pickTextFile();
  if (text === null) return;
  try {
    const { taken, target } = parseBackup(text);
    if (!offerImport(local, taken, target, 'file')) flash('That backup matches what you already have.');
  } catch (e) {
    flash((e as Error).message, { error: true });
  }
}

/** `showChart` switches to the chart view if needed; we wait for it to appear. */
export async function exportPng(target: string, showChart: () => void): Promise<void> {
  if (!chartAvailable()) {
    showChart();
    for (let i = 0; i < 20 && !chartAvailable(); i++) await new Promise((r) => setTimeout(r, 50));
    // Give Svelte Flow a moment to measure the nodes.
    await new Promise((r) => setTimeout(r, 150));
  }
  try {
    flash('Rendering image…');
    await downloadChartPng(target);
    flash('Chart saved as PNG');
  } catch (e) {
    flash((e as Error).message || "Couldn't render the chart.", { error: true });
  }
}
