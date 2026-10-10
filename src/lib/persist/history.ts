// Version history: snapshots of the saved document that survive reloads, so
// any change can be undone later. See docs/accounts-design.md, Layer 2.
//
// Snapshots live in IndexedDB (db "sfu-prereqs", store "history"), apart from
// the live data in localStorage, so history can never break saving. The store
// keeps to a byte budget (oldest entries go first), keeps everything from the
// last day and one per hour before that, at most 50 per owner. If IndexedDB is
// unavailable (private mode, blocked, broken) history falls back to memory for
// this tab, and `historyMode()` says so. Nothing here ever throws into callers.
//
// This module doesn't import the live store (so pure code such as the sync
// engine can import it in tests); autosnap.ts connects it with
// `connectHistory()` when the app loads.

import { summarize, toValues, type AppDoc, type Values } from './doc';

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

/** What history needs from the live store. */
export interface HistoryStore {
  getDoc(): AppDoc;
  setValues(values: Values, source: 'restore'): void;
}

export interface HistoryOptions {
  /** IndexedDB to use; null or a throwing factory means memory only */
  idb?: IDBFactory | null;
  now?: () => number;
  /** total size of all snapshots, in bytes of JSON (default ~2 MB) */
  budget?: number;
  store?: HistoryStore | null;
}

export const DB_NAME = 'sfu-prereqs';
export const STORE = 'history';
export const BUDGET = 2 * 1024 * 1024;
export const MAX_PER_OWNER = 50;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Stored records carry their size so the budget doesn't re-measure everything. */
type Stored = HistoryEntry & { bytes: number };

interface Backend {
  all(): Promise<Stored[]>;
  put(e: Stored): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

function memoryBackend(): Backend {
  const map = new Map<string, Stored>();
  return {
    all: async () => [...map.values()].map((e) => structuredClone(e)),
    put: async (e) => void map.set(e.id, structuredClone(e)),
    remove: async (ids) => ids.forEach((id) => map.delete(id)),
  };
}

const done = (req: IDBRequest | IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    if ('oncomplete' in req) {
      req.oncomplete = () => resolve();
      req.onabort = req.onerror = () => reject(req.error ?? new Error('IndexedDB transaction failed'));
    } else {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }
  });

function idbBackend(factory: IDBFactory): Backend {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Couldn't open IndexedDB"));
      req.onblocked = () => reject(new Error('IndexedDB is blocked'));
    }));
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode);
  return {
    async all() {
      const store = (await tx('readonly')).objectStore(STORE);
      const req = store.getAll();
      await done(req);
      return req.result as Stored[];
    },
    async put(e) {
      const t = await tx('readwrite');
      t.objectStore(STORE).put(e);
      await done(t);
    },
    async remove(ids) {
      if (!ids.length) return;
      const t = await tx('readwrite');
      const store = t.objectStore(STORE);
      for (const id of ids) store.delete(id);
      await done(t);
    },
  };
}

const sizeOf = (e: HistoryEntry) => new TextEncoder().encode(JSON.stringify(e)).length;

/**
 * Which stored entries to drop: thinning (one per hour beyond a day, newest
 * per hour kept), the per-owner cap, then the byte budget, oldest first.
 * `keep` is never dropped (the snapshot just taken).
 */
export function toEvict(entries: Stored[], now: number, budget: number, keep?: string): string[] {
  const out = new Set<string>();
  const newestFirst = [...entries].sort((a, b) => b.at - a.at);
  const byOwner = new Map<string | null, Stored[]>();
  for (const e of newestFirst) {
    const list = byOwner.get(e.owner) ?? [];
    list.push(e);
    byOwner.set(e.owner, list);
  }
  for (const list of byOwner.values()) {
    const hours = new Set<number>();
    let kept = 0;
    for (const e of list) {
      if (e.id === keep) {
        kept++;
        continue;
      }
      if (now - e.at > DAY) {
        const hour = Math.floor(e.at / HOUR);
        if (hours.has(hour)) {
          out.add(e.id);
          continue;
        }
        hours.add(hour);
      }
      if (kept >= MAX_PER_OWNER) out.add(e.id);
      else kept++;
    }
  }
  let total = 0;
  for (const e of entries) if (!out.has(e.id)) total += e.bytes;
  for (let i = newestFirst.length - 1; i >= 0 && total > budget; i--) {
    const e = newestFirst[i];
    if (out.has(e.id) || e.id === keep) continue;
    out.add(e.id);
    total -= e.bytes;
  }
  return [...out];
}

let idCounter = 0;
const newId = (at: number) => `${at.toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const timeFmt = (at: number) =>
  new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function createHistory(opts: HistoryOptions = {}) {
  const now = opts.now ?? Date.now;
  const budget = opts.budget ?? BUDGET;
  let store = opts.store ?? null;
  let backend: Backend | null = null;
  let mode: 'idb' | 'memory' = 'idb';
  let lastAt: number | null = null;
  // Writes go one at a time so eviction sees a consistent list.
  let queue: Promise<unknown> = Promise.resolve();

  function getBackend(): Backend {
    if (backend) return backend;
    try {
      const factory = opts.idb === undefined ? globalThis.indexedDB : opts.idb;
      if (!factory) throw new Error('IndexedDB unavailable');
      backend = idbBackend(factory);
    } catch (err) {
      fallBack(err);
    }
    return backend!;
  }

  function fallBack(err: unknown) {
    if (mode === 'memory') return;
    console.warn('Version history is kept in memory only:', err);
    mode = 'memory';
    backend = memoryBackend();
  }

  /** Run `fn` on the backend; if IndexedDB fails, switch to memory and retry once. */
  async function run<T>(fn: (b: Backend) => Promise<T>): Promise<T> {
    try {
      return await fn(getBackend());
    } catch (err) {
      if (mode === 'memory') throw err;
      fallBack(err);
      return fn(backend!);
    }
  }

  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  }

  async function snapshot(label: string, doc?: AppDoc): Promise<boolean> {
    let d: AppDoc;
    try {
      const got = doc ?? store?.getDoc();
      if (!got) return false;
      d = structuredClone(got);
    } catch (err) {
      console.warn('Snapshot skipped:', err);
      return false;
    }
    const at = now();
    lastAt = Math.max(lastAt ?? 0, at);
    return serial(async () => {
      try {
        const entry: HistoryEntry = { id: newId(at), at, label, summary: summarize(d), owner: d.owner, doc: d };
        const stored: Stored = { ...entry, bytes: sizeOf(entry) };
        await run(async (b) => {
          const evict = toEvict([...(await b.all()), stored], at, budget, stored.id);
          await b.remove(evict);
          try {
            await b.put(stored);
          } catch (err) {
            // Full: drop the oldest half and try once more.
            if ((err as Error)?.name !== 'QuotaExceededError') throw err;
            const rest = (await b.all()).sort((a, b) => a.at - b.at);
            await b.remove(rest.slice(0, Math.ceil(rest.length / 2)).map((e) => e.id));
            await b.put(stored);
          }
        });
        return true;
      } catch (err) {
        console.warn("Couldn't save a version history snapshot:", err);
        return false;
      }
    });
  }

  async function all(): Promise<Stored[]> {
    try {
      return await serial(() => run((b) => b.all()));
    } catch (err) {
      console.warn("Couldn't read version history:", err);
      return [];
    }
  }

  const strip = ({ bytes: _bytes, ...e }: Stored): HistoryEntry => e;

  async function listHistory(owner: string | null): Promise<HistoryEntry[]> {
    return (await all())
      .filter((e) => e.owner === owner)
      .sort((a, b) => b.at - a.at)
      .map(strip);
  }

  async function restore(id: string): Promise<boolean> {
    try {
      if (!store) return false;
      const entry = (await all()).find((e) => e.id === id);
      if (!entry) return false;
      await snapshot(`Before restoring ${timeFmt(entry.at)}`);
      store.setValues(toValues(entry.doc), 'restore');
      return true;
    } catch (err) {
      console.warn("Couldn't restore that version:", err);
      return false;
    }
  }

  async function clearHistory(owner?: string | null): Promise<void> {
    try {
      await serial(() =>
        run(async (b) => {
          const ids = (await b.all()).filter((e) => owner === undefined || e.owner === owner).map((e) => e.id);
          await b.remove(ids);
        }),
      );
      if (owner === undefined) lastAt = null;
    } catch (err) {
      console.warn("Couldn't clear version history:", err);
    }
  }

  /** When the newest snapshot (any owner) was taken, 0 if none. */
  async function lastSnapshotAt(): Promise<number> {
    if (lastAt === null) lastAt = Math.max(0, ...(await all()).map((e) => e.at));
    return lastAt;
  }

  return {
    snapshot,
    listHistory,
    restore,
    clearHistory,
    lastSnapshotAt,
    /** 'memory' when IndexedDB couldn't be used: history won't survive a reload. */
    mode: () => mode,
    connect: (s: HistoryStore) => void (store = s),
  };
}

export type History = ReturnType<typeof createHistory>;

const shared = createHistory();

/** Let history read and restore the live document (done once by autosnap.ts). */
export function connectHistory(store: HistoryStore): void {
  shared.connect(store);
}

/** 'memory' when IndexedDB couldn't be used, so history won't survive a reload. */
export function historyMode(): 'idb' | 'memory' {
  return shared.mode();
}

/** When the newest snapshot was taken (ms), 0 if there are none. */
export function lastSnapshotAt(): Promise<number> {
  return shared.lastSnapshotAt();
}

/**
 * Save a snapshot of `doc` (default: the current document). Never throws and
 * never blocks saving: if history storage is full or unavailable it drops
 * the oldest entries, and if that fails it just reports false.
 */
export async function snapshot(label: string, doc?: AppDoc): Promise<boolean> {
  return shared.snapshot(label, doc);
}

/** Snapshots for one owner (null = data never tied to an account), newest first. */
export async function listHistory(owner: string | null): Promise<HistoryEntry[]> {
  return shared.listHistory(owner);
}

/**
 * Restore a snapshot as the user's own change (it gets new stamps, so it
 * syncs to other devices). Snapshots the current state first.
 */
export async function restore(id: string): Promise<boolean> {
  return shared.restore(id);
}

/** Forget snapshots for one owner, or all (shared-computer sign-out). */
export async function clearHistory(owner?: string | null): Promise<void> {
  return shared.clearHistory(owner);
}
