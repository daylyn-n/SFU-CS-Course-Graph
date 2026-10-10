// Test helpers for the sync engine (not used by the app): an in-memory
// "device" standing in for the persist store, a RemoteStore that behaves like
// save_state, and manual timers.

import { Clock, emptyDoc, highestStamp, toValues, updateDoc, type AppDoc, type Values } from '../persist/doc';
import type { DocChange, RemoteStore, SaveResult, SyncDeps } from './engine';

/** A device's saved document, with the same rules as the persist store. */
export class FakeDevice {
  doc: AppDoc;
  clock: Clock;
  snapshots: { label: string; doc: AppDoc }[] = [];
  applied: AppDoc[] = [];
  #listeners = new Set<(e: DocChange) => void>();

  constructor(
    doc: AppDoc = emptyDoc(),
    public now: () => number = Date.now,
  ) {
    this.doc = structuredClone(doc);
    this.clock = new Clock(highestStamp(doc), () => this.now());
  }

  getDoc = (): AppDoc => this.doc;

  applyDoc = (next: AppDoc, source: 'remote' | 'tab' | 'load' = 'remote'): void => {
    this.doc = structuredClone(next);
    this.clock.see(highestStamp(next));
    this.applied.push(this.doc);
    this.#emit(source);
  };

  onChange = (fn: (e: DocChange) => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  setOwner = (owner: string | null): void => {
    this.doc = { ...this.doc, owner };
  };

  snapshot = async (label: string, doc?: AppDoc): Promise<boolean> => {
    this.snapshots.push({ label, doc: structuredClone(doc ?? this.doc) });
    return true;
  };

  /** A user edit: change the values, stamp what differs, tell listeners. */
  edit(change: (v: Values) => void, source: 'local' | 'undo' | 'restore' | 'import' = 'local'): void {
    const v = toValues(this.doc);
    change(v);
    this.doc = updateDoc(this.doc, v, this.clock);
    this.#emit(source);
  }

  values(): Values {
    return toValues(this.doc);
  }

  /** The SyncDeps this device provides. */
  deps(): Pick<SyncDeps, 'getDoc' | 'applyDoc' | 'onChange' | 'setOwner' | 'snapshot'> {
    return { getDoc: this.getDoc, applyDoc: this.applyDoc, onChange: this.onChange, setOwner: this.setOwner, snapshot: this.snapshot };
  }

  #emit(source: string) {
    for (const fn of this.#listeners) fn({ source });
  }
}

/** A RemoteStore with save_state's rules, kept in memory. */
export class FakeRemote implements RemoteStore {
  row: { doc: AppDoc; rev: number } | null = null;
  saves: { doc: AppDoc; expectedRev: number | null; bulk: boolean; ok: boolean }[] = [];
  loads = 0;
  /** when set, load/save throw (a network failure) */
  failing: Error | null = null;
  /** when set, save waits for it before doing anything (an in-flight request) */
  gate: Promise<void> | null = null;
  /** runs just before each save is decided (to simulate another device saving first) */
  beforeSave: (() => void) | null = null;

  async load() {
    this.loads++;
    await Promise.resolve();
    if (this.failing) throw this.failing;
    return this.row ? structuredClone(this.row) : null;
  }

  async save(doc: AppDoc, expectedRev: number | null, bulk = false): Promise<SaveResult> {
    const sent = structuredClone(doc);
    if (this.gate) await this.gate;
    await Promise.resolve();
    if (this.failing) throw this.failing;
    this.beforeSave?.();
    const row = this.row;
    let res: SaveResult;
    if (!row) {
      this.row = { doc: sent, rev: 1 };
      res = { ok: true, rev: 1 };
    } else if (expectedRev !== row.rev || sent.schema < row.doc.schema) {
      res = { ok: false, doc: structuredClone(row.doc), rev: row.rev };
    } else {
      this.row = { doc: sent, rev: row.rev + 1 };
      res = { ok: true, rev: row.rev + 1 };
    }
    this.saves.push({ doc: sent, expectedRev, bulk, ok: res.ok });
    return res;
  }

  /** Another device saved this document. */
  put(doc: AppDoc): void {
    this.row = { doc: structuredClone(doc), rev: (this.row?.rev ?? 0) + 1 };
  }
}

/** setTimeout/clearTimeout driven by hand. */
export class ManualTimers {
  time = 0;
  #tasks = new Map<number, { at: number; fn: () => void }>();
  #id = 0;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.#id;
    this.#tasks.set(id, { at: this.time + ms, fn });
    return id;
  };

  clearTimeout = (h: unknown): void => {
    this.#tasks.delete(h as number);
  };

  get pending(): number {
    return this.#tasks.size;
  }

  /** Move time forward, running whatever comes due. */
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = [...this.#tasks.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#tasks.delete(due[0]);
      this.time = due[1].at;
      due[1].fn();
    }
    this.time = until;
  }
}

/** Let pending promise chains run. */
export const settle = async (rounds = 30): Promise<void> => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
};
