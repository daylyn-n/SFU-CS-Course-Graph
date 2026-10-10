// Keeps the saved document in step with the signed-in account. Framework
// free: everything it touches comes in through `SyncDeps`, so tests drive it
// with a fake RemoteStore, an in-memory document and fake timers. See
// docs/accounts-design.md, Layer 3.
//
// - start(userId) decides what to do with this device's data (the owner
//   matrix), then keeps syncing: own edits are pushed 1.5 s after they settle,
//   pullNow() fetches the account's copy and merges it in.
// - Every server round trip runs one at a time (a queue), and pushes always
//   send the document as it is when the push starts, so an edit made while a
//   push is in flight is simply pushed next.
// - Data from the server is applied with applyDoc(doc, 'remote'): not stamped,
//   and an undo barrier.

import { emptyDoc, highestStamp, isEmptyDoc, parseDoc, type AppDoc } from '../persist/doc';
import { describeMerge, mergeDocs, sameContent, sideSize, type MergeReport } from './merge';

export type SaveResult = { ok: true; rev: number } | { ok: false; doc: AppDoc; rev: number };

/** The account's copy of the document. */
export interface RemoteStore {
  /** The stored document and its revision, or null if the account has none. */
  load(): Promise<{ doc: AppDoc; rev: number } | null>;
  /**
   * Save if the stored revision is still `expectedRev` (null: "I saw no row").
   * On a conflict, resolves with the stored document instead. `bulk` keeps
   * the previous version in server history whatever its age.
   */
  save(doc: AppDoc, expectedRev: number | null, bulk?: boolean): Promise<SaveResult>;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'outdated';

export interface SyncState {
  status: SyncStatus;
  /** when the last successful round trip finished (ms), or null */
  lastSyncedAt: number | null;
  /** the error behind 'error', for logs */
  error?: unknown;
}

/** Same shape as the persist store's change events (only `source` is used). */
export interface DocChange {
  source: string;
}

export interface SyncDeps {
  remote: RemoteStore;
  getDoc(): AppDoc;
  applyDoc(doc: AppDoc, source: 'remote'): void;
  onChange(fn: (e: DocChange) => void): () => void;
  setOwner(owner: string | null): void;
  snapshot(label: string, doc?: AppDoc): Promise<boolean>;
  /** The schema this build writes (doc.ts SCHEMA). A newer one on the server stops pushing. */
  schema: number;
  /**
   * Asked on sign-in when this device has data that never belonged to an
   * account (it may be someone else's on a shared computer), before anything
   * is sent: true copies it into the account (upload, or snapshot + merge);
   * false keeps it only in history and shows the account's data. Not
   * provided: treated as true. Not asked when the device has no data.
   */
  confirmCopy?(): Promise<boolean>;
  /** Changes the user made here (default: local, undo, restore, import). */
  isOwnChange?(source: string): boolean;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
  online?(): boolean;
  /** Subscribe to "back online" (default: window 'online'). */
  onOnline?(fn: () => void): () => void;
}

export const PUSH_DELAY = 1500;
/** Conflict retries after the first save attempt. */
export const MAX_RETRIES = 3;
export const SYNC_LABEL = 'Before syncing with your account';
export const SWITCH_LABEL = 'Before switching accounts';
/** Snapshot label when the user declines copying this device's ownerless data into the account. */
export const DECLINE_LABEL = 'This device before signing in';

const OWN = new Set(['local', 'undo', 'restore', 'import']);
const BULK = new Set(['restore', 'import']);

/** Which merges get a toast: none, any change, or only real two-sided merges. */
type Notify = 'never' | 'any' | 'both';

export class SyncEngine {
  #deps: SyncDeps;
  #now: () => number;
  #userId: string | null = null;
  /** revision of the server row we last saw (null: none) */
  #rev: number | null = null;
  /** the content the server holds as far as we know; pushes happen when ours differs */
  #synced: AppDoc | null = null;
  #ready = false;
  #outdated = false;
  #bulk = false;
  #timer: unknown = null;
  #queue: Promise<void> = Promise.resolve();
  /** bumped by stop(), so work from an earlier session gives up */
  #session = 0;
  #unsubs: (() => void)[] = [];
  #state: SyncState = { status: 'idle', lastSyncedAt: null };
  #statusFns = new Set<(s: SyncState) => void>();
  #mergeFns = new Set<(text: string, report: MergeReport) => void>();

  constructor(deps: SyncDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  get state(): SyncState {
    return this.#state;
  }

  get userId(): string | null {
    return this.#userId;
  }

  /** Hear status changes; called right away with the current state. */
  onStatus(fn: (s: SyncState) => void): () => void {
    this.#statusFns.add(fn);
    fn(this.#state);
    return () => this.#statusFns.delete(fn);
  }

  /** Hear about merges worth telling the user ("Kept Schedule 2 from this device; ..."). */
  onMerge(fn: (text: string, report: MergeReport) => void): () => void {
    this.#mergeFns.add(fn);
    return () => this.#mergeFns.delete(fn);
  }

  /** Begin syncing this device with `userId`'s account. Resolves after the first sync attempt. */
  start(userId: string): Promise<void> {
    if (this.#userId === userId) return this.#queue;
    if (this.#userId) throw new Error('SyncEngine: stop() before starting another account');
    this.#userId = userId;
    this.#outdated = false;
    const d = this.#deps;
    this.#unsubs.push(
      d.onChange((e) => this.#changed(e)),
      (d.onOnline ?? defaultOnOnline)(() => void this.pullNow()),
    );
    return this.#run(() => this.#init());
  }

  /** Fetch the account's copy and merge it in (also pushes anything pending). */
  pullNow(): Promise<void> {
    if (!this.#userId) return Promise.resolve();
    return this.#run(() => (this.#ready ? this.#pull() : this.#init()));
  }

  /** Push pending edits now instead of waiting for the debounce. */
  flush(): Promise<void> {
    if (!this.#userId) return Promise.resolve();
    this.#clearTimer();
    return this.#run(() => (this.#ready ? this.#push() : this.#init()));
  }

  /** Push anything pending, then stop (call before signing out). */
  async stop(): Promise<void> {
    if (!this.#userId) return;
    this.#clearTimer();
    for (const u of this.#unsubs.splice(0)) u();
    await this.#run(() => (this.#ready ? this.#push() : Promise.resolve()));
    this.#clearTimer();
    this.#session++;
    this.#userId = null;
    this.#ready = false;
    this.#rev = null;
    this.#synced = null;
    this.#bulk = false;
    this.#setStatus('idle');
  }

  // ---- internals --------------------------------------------------------------

  #run(fn: () => Promise<void>): Promise<void> {
    const session = this.#session;
    const p = this.#queue.then(async () => {
      if (session !== this.#session || !this.#userId) return;
      try {
        await fn();
      } catch (err) {
        if (session !== this.#session) return;
        this.#setStatus(this.#isOnline() ? 'error' : 'offline', err);
      }
    });
    this.#queue = p;
    return p;
  }

  #changed(e: DocChange) {
    const own = this.#deps.isOwnChange ? this.#deps.isOwnChange(e.source) : OWN.has(e.source);
    if (!own || !this.#userId) return;
    if (BULK.has(e.source)) this.#bulk = true;
    this.#schedule();
  }

  /** Push after PUSH_DELAY, restarting the wait if one is already scheduled. */
  #schedule() {
    this.#clearTimer();
    const set = this.#deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.#timer = set(() => {
      this.#timer = null;
      void this.#run(() => (this.#ready ? this.#push() : Promise.resolve()));
    }, PUSH_DELAY);
  }

  #clearTimer() {
    if (this.#timer === null) return;
    const clear = this.#deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
    clear(this.#timer);
    this.#timer = null;
  }

  #isOnline(): boolean {
    return this.#deps.online ? this.#deps.online() : typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  #setStatus(status: SyncStatus, error?: unknown) {
    if (this.#outdated) status = 'outdated';
    const lastSyncedAt = status === 'synced' ? this.#now() : this.#state.lastSyncedAt;
    this.#state = { status, lastSyncedAt, ...(error !== undefined ? { error } : {}) };
    for (const fn of this.#statusFns) {
      try {
        fn(this.#state);
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** True (and status 'outdated') if the account's data is from a newer app version. */
  #checkSchema(remote: AppDoc): boolean {
    if (remote.schema <= this.#deps.schema) return false;
    this.#outdated = true;
    this.#setStatus('outdated');
    return true;
  }

  #pending(): boolean {
    const doc = this.#deps.getDoc();
    // No row yet: worth creating only once there's something in it.
    if (!this.#synced) return !isEmptyDoc(doc) || highestStamp(doc) > 0;
    return !sameContent(doc, this.#synced);
  }

  /**
   * After a round trip: 'synced' if nothing is waiting to go up; otherwise
   * (an edit landed while we were busy) make sure a push is on its way.
   */
  #settled() {
    if (!this.#pending()) return this.#setStatus('synced');
    if (this.#timer === null) this.#schedule();
    this.#setStatus('syncing');
  }

  /**
   * Merge the account's copy into the live document and apply the result.
   * Returns the merged document.
   */
  #mergeIn(remote: AppDoc, notify: Notify): AppDoc {
    const d = this.#deps;
    const local = d.getDoc();
    const { doc, report } = mergeDocs(local, remote);
    doc.owner = this.#userId;
    if (!sameContent(doc, local)) d.applyDoc(doc, 'remote');
    else if (local.owner !== this.#userId) d.setOwner(this.#userId);
    const tell =
      notify === 'any' || (notify === 'both' && sideSize(report.local) > 0 && sideSize(report.remote) > 0);
    const text = tell ? describeMerge(report) : '';
    if (text) for (const fn of this.#mergeFns) fn(text, report);
    return doc;
  }

  /** The owner matrix, run on sign-in (or the first time we get through after it). */
  async #init(): Promise<void> {
    if (this.#outdated) return;
    if (!this.#isOnline()) return this.#setStatus('offline');
    this.#setStatus('syncing');
    const d = this.#deps;
    const session = this.#session;
    const userId = this.#userId!;
    const row = await d.remote.load();
    if (session !== this.#session) return;
    const remote = row ? parseDoc(row.doc) : null;
    this.#rev = row?.rev ?? null;
    if (remote && this.#checkSchema(remote)) return;

    const local = d.getDoc();
    if (local.owner === userId) {
      // Same account as last time: an ordinary merge.
      if (remote) this.#mergeIn(remote, 'both');
      this.#synced = remote;
    } else if (local.owner === null) {
      // Data never tied to an account. On a shared computer it may be
      // someone else's, so it only goes to the account if the user says so.
      const copy = isEmptyDoc(local) || !d.confirmCopy || (await d.confirmCopy());
      if (session !== this.#session) return;
      if (!copy) {
        await this.#replace(d.getDoc(), remote, DECLINE_LABEL);
      } else if (!remote || isEmptyDoc(remote)) {
        // A new (or empty) account: upload what this device has.
        if (remote) this.#mergeIn(remote, 'never');
        else d.setOwner(userId);
        this.#synced = remote;
        this.#bulk = true;
      } else if (isEmptyDoc(d.getDoc())) {
        // Nothing here yet: take the account's data.
        d.applyDoc({ ...remote, owner: userId }, 'remote');
        this.#synced = remote;
      } else {
        // Both have data: keep a copy of this device's, then merge.
        await d.snapshot(SYNC_LABEL, d.getDoc());
        if (session !== this.#session) return;
        this.#mergeIn(remote, 'any');
        this.#synced = remote;
        this.#bulk = true;
      }
    } else {
      // Someone else's data (shared computer, switching accounts): never merge.
      await this.#replace(local, remote, SWITCH_LABEL);
    }
    if (session !== this.#session) return;
    this.#ready = true;
    await this.#push();
  }

  /** Keep a copy of `local` in history, then show the account's data instead (nothing is pushed). */
  async #replace(local: AppDoc, remote: AppDoc | null, label: string): Promise<void> {
    const d = this.#deps;
    const session = this.#session;
    await d.snapshot(label, local);
    if (session !== this.#session) return;
    const now = d.getDoc();
    // Edits made while the snapshot was saving: keep those too.
    if (!sameContent(now, local)) void d.snapshot(label, now);
    d.applyDoc(remote ? { ...remote, owner: this.#userId } : emptyDoc(this.#userId), 'remote');
    this.#synced = remote;
  }

  async #pull(): Promise<void> {
    if (this.#outdated) return;
    if (!this.#isOnline()) return this.#setStatus('offline');
    this.#setStatus('syncing');
    const session = this.#session;
    const row = await this.#deps.remote.load();
    if (session !== this.#session) return;
    if (!row) {
      // The row is gone (deleted from another device): ours is the only copy.
      this.#rev = null;
      this.#synced = null;
      return this.#push();
    }
    const remote = parseDoc(row.doc);
    if (this.#checkSchema(remote)) return;
    if (row.rev !== this.#rev || !this.#synced) {
      this.#rev = row.rev;
      this.#mergeIn(remote, 'both');
      this.#synced = remote;
    }
    return this.#push();
  }

  /** Push the live document if it differs from what the server has. */
  async #push(): Promise<void> {
    if (this.#outdated) return;
    if (!this.#pending()) return this.#settled();
    if (!this.#isOnline()) return this.#setStatus('offline');
    this.#setStatus('syncing');
    const d = this.#deps;
    const session = this.#session;
    const bulk = this.#bulk;
    this.#bulk = false;
    let doc: AppDoc = { ...d.getDoc(), owner: this.#userId };
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await d.remote.save(doc, this.#rev, bulk);
        if (session !== this.#session) return;
        if (res.ok) {
          this.#rev = res.rev;
          this.#synced = doc;
          return this.#settled();
        }
        // Someone saved first: merge theirs in and try again.
        const remote = parseDoc(res.doc);
        this.#rev = res.rev;
        if (this.#checkSchema(remote)) return;
        this.#synced = remote;
        doc = this.#mergeIn(remote, 'both');
        if (sameContent(doc, remote)) return this.#settled();
        if (attempt >= MAX_RETRIES) throw new Error('Sync kept conflicting; will retry');
      }
    } catch (err) {
      if (bulk) this.#bulk = true;
      throw err;
    }
  }
}

function defaultOnOnline(fn: () => void): () => void {
  if (typeof addEventListener !== 'function') return () => {};
  addEventListener('online', fn);
  return () => removeEventListener('online', fn);
}
