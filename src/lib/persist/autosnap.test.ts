import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc } from './doc';

// The live store needs the Svelte compiler; autosnap only needs these.
const doc = emptyDoc();
vi.mock('./store.svelte', () => ({
  getDoc: () => doc,
  setValues: () => {},
  onChange: () => () => {},
  isOwnChange: (s: string) => ['local', 'undo', 'restore', 'import'].includes(s),
}));
vi.mock('./history', () => ({
  connectHistory: vi.fn(),
  snapshot: vi.fn(async () => true),
  lastSnapshotAt: vi.fn(async () => 0),
}));

const { createAutosnap, beforeBulk, onBeforeBulk, SETTLE_MS, MIN_GAP_MS } = await import('./autosnap');
const history = await import('./history');
import type { ChangeEvent } from './store.svelte';

function setup(last: number) {
  let listener: ((e: ChangeEvent) => void) | null = null;
  let lastAt = last;
  const snapshot = vi.fn(async () => {
    lastAt = Date.now();
    return true;
  });
  const stop = createAutosnap({
    onChange: (fn) => {
      listener = fn;
      return () => (listener = null);
    },
    snapshot,
    lastSnapshotAt: async () => lastAt,
  });
  const change = (source: ChangeEvent['source']) => listener?.({ source, before: doc, after: doc });
  return { snapshot, change, stop };
}

describe('autosnap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10 * MIN_GAP_MS);
  });
  afterEach(() => vi.useRealTimers());

  it('snapshots once edits settle', async () => {
    const { snapshot, change } = setup(0);
    change('local');
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 500);
    change('local'); // still editing: wait again
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 500);
    expect(snapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith('Autosave');
  });

  it('waits at least two minutes between autosaves', async () => {
    const { snapshot, change } = setup(0);
    change('local');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(snapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    change('local');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(snapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    change('undo');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("ignores changes that weren't made here", async () => {
    const { snapshot, change, stop } = setup(0);
    change('remote');
    change('tab');
    change('load');
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(snapshot).not.toHaveBeenCalled();
    change('local');
    stop();
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('beforeBulk snapshots the current document with its label and tells listeners', async () => {
    const heard = vi.fn();
    const off = onBeforeBulk(heard);
    await beforeBulk('Before auto-arrange · Schedule 1');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(history.snapshot).toHaveBeenCalledWith('Before auto-arrange · Schedule 1', doc);
    off();
  });

  it('beforeBulk never rejects', async () => {
    vi.mocked(history.snapshot).mockRejectedValueOnce(new Error('nope'));
    await expect(beforeBulk('x')).resolves.toBeUndefined();
  });
});
