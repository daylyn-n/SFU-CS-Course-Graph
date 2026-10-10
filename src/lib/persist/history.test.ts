import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createHistory, toEvict, MAX_PER_OWNER } from './history';
import { docFromValues, emptyDoc, toValues, type AppDoc, type Values } from './doc';
import { validateState } from '../schedule/schedule';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const values = (taken: string[] = []): Values => ({
  taken,
  notTaken: [],
  slots: validateState(null).slots,
  settings: { assumePrereqs: true, program: '', planPerTerm: 4 },
});
const docWith = (taken: string[], owner: string | null = null): AppDoc => docFromValues(values(taken), owner);

function setup(opts: { budget?: number; idb?: IDBFactory | null; start?: number } = {}) {
  let t = opts.start ?? 10 * DAY;
  let current = docWith(['CMPT 120']);
  const setValues = vi.fn((v: Values) => {
    current = docFromValues(v, current.owner);
  });
  const h = createHistory({
    idb: opts.idb === undefined ? new IDBFactory() : opts.idb,
    now: () => t,
    budget: opts.budget,
    store: { getDoc: () => current, setValues },
  });
  return {
    h,
    setValues,
    advance: (ms: number) => (t += ms),
    setCurrent: (d: AppDoc) => (current = d),
  };
}

describe('history', () => {
  it('stores snapshots in IndexedDB, newest first, with a summary', async () => {
    const { h, advance } = setup();
    expect(await h.snapshot('First')).toBe(true);
    advance(1000);
    expect(await h.snapshot('Second', docWith(['CMPT 120', 'CMPT 125']))).toBe(true);
    const list = await h.listHistory(null);
    expect(list.map((e) => e.label)).toEqual(['Second', 'First']);
    expect(list[0].summary).toBe('2 taken');
    expect(list[1].doc.courses['CMPT 120'].state).toBe('taken');
    expect(h.mode()).toBe('idb');
    expect(await h.lastSnapshotAt()).toBe(10 * DAY + 1000);
  });

  it('survives a new instance on the same database (a reload)', async () => {
    const idb = new IDBFactory();
    await setup({ idb }).h.snapshot('Kept');
    const again = setup({ idb });
    expect((await again.h.listHistory(null)).map((e) => e.label)).toEqual(['Kept']);
    expect(await again.h.lastSnapshotAt()).toBeGreaterThan(0);
  });

  it('filters by owner', async () => {
    const { h } = setup();
    await h.snapshot('Mine', docWith(['A 100'], 'user-1'));
    await h.snapshot('Theirs', docWith(['B 100'], 'user-2'));
    await h.snapshot('Nobody', docWith([], null));
    expect((await h.listHistory('user-1')).map((e) => e.label)).toEqual(['Mine']);
    expect((await h.listHistory('user-2')).map((e) => e.label)).toEqual(['Theirs']);
    expect((await h.listHistory(null)).map((e) => e.label)).toEqual(['Nobody']);
    await h.clearHistory('user-2');
    expect(await h.listHistory('user-2')).toEqual([]);
    expect(await h.listHistory('user-1')).toHaveLength(1);
    await h.clearHistory();
    expect(await h.listHistory('user-1')).toEqual([]);
  });

  it('keeps to the byte budget, evicting the oldest first', async () => {
    const big = (n: number) => docWith(Array.from({ length: 200 }, (_, i) => `CMPT ${100 + i}${'ABCDEFGHIJ'[n]}`));
    const { h, advance } = setup({ budget: 40_000 });
    for (let i = 0; i < 6; i++) {
      await h.snapshot(`S${i}`, big(i));
      advance(1000);
    }
    const labels = (await h.listHistory(null)).map((e) => e.label);
    expect(labels[0]).toBe('S5');
    expect(labels.length).toBeLessThan(6);
    // What's left is the newest run, with no gaps.
    expect(labels).toEqual(['S5', 'S4', 'S3', 'S2', 'S1', 'S0'].slice(0, labels.length));
    const bytes = (await h.listHistory(null)).reduce((n, e) => n + JSON.stringify(e).length, 0);
    expect(bytes).toBeLessThanOrEqual(40_000);
  });

  it('keeps everything from the last day, then one per hour', async () => {
    const { h, advance } = setup({ start: 0 });
    // Four snapshots in each of three hours, two days ago...
    for (let hr = 0; hr < 3; hr++) {
      for (let i = 0; i < 4; i++) {
        await h.snapshot(`old ${hr}.${i}`);
        advance(10 * 60_000);
      }
      advance(HOUR - 40 * 60_000);
    }
    advance(2 * DAY);
    // ...and several recent ones in one hour.
    for (let i = 0; i < 4; i++) {
      await h.snapshot(`new ${i}`);
      advance(60_000);
    }
    const labels = (await h.listHistory(null)).map((e) => e.label);
    expect(labels).toEqual(['new 3', 'new 2', 'new 1', 'new 0', 'old 2.3', 'old 1.3', 'old 0.3']);
  });

  it(`keeps at most ${MAX_PER_OWNER} per owner`, async () => {
    const { h, advance } = setup();
    for (let i = 0; i < MAX_PER_OWNER + 5; i++) {
      await h.snapshot(`S${i}`);
      advance(1000);
    }
    await h.snapshot('other owner', docWith([], 'u'));
    const mine = await h.listHistory(null);
    expect(mine).toHaveLength(MAX_PER_OWNER);
    expect(mine.at(-1)!.label).toBe('S5');
    expect(await h.listHistory('u')).toHaveLength(1);
  });

  it('never evicts the snapshot just taken', () => {
    const e = (id: string, at: number, bytes: number) => ({ id, at, bytes, label: id, summary: '', owner: null, doc: emptyDoc() });
    expect(toEvict([e('a', 1, 50), e('b', 2, 500)], 3, 100, 'b')).toEqual(['a']);
  });

  it('falls back to memory when IndexedDB throws, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const { h } = setup({ idb: broken });
    expect(await h.snapshot('Still works')).toBe(true);
    expect(h.mode()).toBe('memory');
    expect((await h.listHistory(null)).map((e) => e.label)).toEqual(['Still works']);
    warn.mockRestore();
  });

  it('falls back to memory with no IndexedDB at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { h } = setup({ idb: null });
    expect(await h.snapshot('x')).toBe(true);
    expect(h.mode()).toBe('memory');
    warn.mockRestore();
  });

  it('restore snapshots the current state first, then sets the values as a restore', async () => {
    const { h, setValues, advance, setCurrent } = setup();
    await h.snapshot('Old', docWith(['MACM 101']));
    advance(5000);
    setCurrent(docWith(['CMPT 120', 'CMPT 225']));
    const [old] = await h.listHistory(null);
    expect(await h.restore(old.id)).toBe(true);
    expect(setValues).toHaveBeenCalledWith(toValues(docWith(['MACM 101'])), 'restore');
    const list = await h.listHistory(null);
    expect(list[0].label).toMatch(/^Before restoring /);
    expect(list[0].doc.courses['CMPT 225'].state).toBe('taken');
  });

  it("restore of an unknown id reports false and doesn't change anything", async () => {
    const { h, setValues } = setup();
    expect(await h.restore('nope')).toBe(false);
    expect(setValues).not.toHaveBeenCalled();
  });

  it('never throws into callers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = createHistory({
      idb: null,
      store: {
        getDoc: () => {
          throw new Error('boom');
        },
        setValues: () => {},
      },
    });
    await expect(h.snapshot('x')).resolves.toBe(false);
    await expect(h.restore('x')).resolves.toBe(false);
    warn.mockRestore();
  });
});
