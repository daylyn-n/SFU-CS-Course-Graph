import { describe, expect, it } from 'vitest';
import { emptyDoc, isEmptyDoc, SCHEMA, toValues, type AppDoc, type Values } from '../persist/doc';
import { DECLINE_LABEL, PUSH_DELAY, SWITCH_LABEL, SYNC_LABEL, SyncEngine, type SyncDeps, type SyncState } from './engine';
import { FakeDevice, FakeRemote, ManualTimers, settle } from './testing';

const ME = 'user-me';
const OTHER = 'user-other';

function setup(opts: { doc?: AppDoc; remote?: FakeRemote; extra?: Partial<SyncDeps> } = {}) {
  const timers = new ManualTimers();
  let clockNow = 1_000_000;
  const now = () => (clockNow += 7);
  const device = new FakeDevice(opts.doc ?? emptyDoc(), now);
  const remote = opts.remote ?? new FakeRemote();
  let online = true;
  let onlineFn: (() => void) | null = null;
  const merges: string[] = [];
  const statuses: SyncState['status'][] = [];
  const engine = new SyncEngine({
    remote,
    ...device.deps(),
    schema: SCHEMA,
    now,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    online: () => online,
    onOnline: (fn) => {
      onlineFn = fn;
      return () => (onlineFn = null);
    },
    ...opts.extra,
  });
  engine.onMerge((t) => merges.push(t));
  engine.onStatus((s) => statuses.push(s.status));
  return {
    engine,
    device,
    remote,
    timers,
    merges,
    statuses,
    setOnline(v: boolean) {
      online = v;
      if (v) onlineFn?.();
    },
    /** run the debounce and let the push finish */
    async tick(ms = PUSH_DELAY) {
      timers.advance(ms);
      await settle();
    },
  };
}

/** A document with some data, owned by `owner`, edited by its own device. */
function docWith(owner: string | null, change: (v: Values) => void, start = 500_000): AppDoc {
  let t = start;
  const d = new FakeDevice(emptyDoc(owner), () => (t += 3));
  d.edit(change);
  return d.doc;
}

const take = (...codes: string[]) => (v: Values) => v.taken.push(...codes);
const slot = (i: number, code: string) => (v: Values) => v.slots[i].courses.push({ code, picks: {} });
const remoteValues = (r: FakeRemote) => toValues(r.row!.doc);

describe('owner matrix on start()', () => {
  it('never signed in, empty account: uploads (bulk) and takes ownership', async () => {
    const s = setup({ doc: docWith(null, take('CMPT 120')) });
    await s.engine.start(ME);
    expect(s.remote.saves).toHaveLength(1);
    expect(s.remote.saves[0]).toMatchObject({ expectedRev: null, bulk: true, ok: true });
    expect(s.remote.row!.doc.owner).toBe(ME);
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120']);
    expect(s.device.doc.owner).toBe(ME);
    expect(s.device.snapshots).toEqual([]);
    expect(s.engine.state.status).toBe('synced');
    expect(s.engine.state.lastSyncedAt).not.toBeNull();
  });

  it('never signed in, account has a row with nothing in it: still uploads', async () => {
    const remote = new FakeRemote();
    remote.put(emptyDoc(ME));
    const s = setup({ doc: docWith(null, take('CMPT 120')), remote });
    await s.engine.start(ME);
    expect(remoteValues(remote).taken).toEqual(['CMPT 120']);
    expect(remote.saves[0]).toMatchObject({ expectedRev: 1, bulk: true });
    expect(s.merges).toEqual([]);
  });

  it('nothing on this device: takes the account data, no push, no snapshot', async () => {
    const remote = new FakeRemote();
    remote.put(docWith(ME, take('CMPT 225')));
    const s = setup({ remote });
    await s.engine.start(ME);
    expect(s.device.values().taken).toEqual(['CMPT 225']);
    expect(s.device.doc.owner).toBe(ME);
    expect(remote.saves).toEqual([]);
    expect(s.device.snapshots).toEqual([]);
    expect(s.engine.state.status).toBe('synced');
  });

  it('never signed in, both have data: snapshot, merge, push, tell the user', async () => {
    const remote = new FakeRemote();
    remote.put(docWith(ME, take('CMPT 120', 'CMPT 125', 'CMPT 225'), 100_000));
    const local = docWith(null, slot(1, 'CMPT 300'), 200_000);
    const s = setup({ doc: local, remote });
    await s.engine.start(ME);
    expect(s.device.snapshots.map((x) => x.label)).toEqual([SYNC_LABEL]);
    expect(s.device.snapshots[0].doc).toEqual(local);
    const v = s.device.values();
    expect(v.taken).toEqual(['CMPT 120', 'CMPT 125', 'CMPT 225']);
    expect(v.slots[1].courses.map((c) => c.code)).toEqual(['CMPT 300']);
    expect(remoteValues(remote)).toEqual(v);
    expect(remote.saves.at(-1)).toMatchObject({ bulk: true, ok: true });
    expect(s.merges).toEqual(['Kept Schedule 2 from this device; added 3 taken courses from your account']);
  });

  it('same owner: merges without a snapshot', async () => {
    const remote = new FakeRemote();
    remote.put(docWith(ME, take('MATH 151'), 100_000));
    const s = setup({ doc: docWith(ME, take('CMPT 120'), 200_000), remote });
    await s.engine.start(ME);
    expect(s.device.values().taken).toEqual(['CMPT 120', 'MATH 151']);
    expect(remoteValues(remote).taken).toEqual(['CMPT 120', 'MATH 151']);
    expect(s.device.snapshots).toEqual([]);
    expect(remote.saves.at(-1)!.bulk).toBe(false);
  });

  it("same owner, account only has older copies: nothing to say, and one-sided merges don't toast", async () => {
    const remote = new FakeRemote();
    remote.put(docWith(ME, take('MATH 151'), 100_000));
    const s = setup({ doc: emptyDoc(ME), remote });
    await s.engine.start(ME);
    expect(s.device.values().taken).toEqual(['MATH 151']);
    expect(s.merges).toEqual([]);
    expect(remote.saves).toEqual([]);
  });

  it("someone else's data: snapshot, replace with the account's, never merge or offer a copy", async () => {
    const remote = new FakeRemote();
    remote.put(docWith(ME, take('MATH 151')));
    const local = docWith(OTHER, take('CMPT 120'));
    let asked = 0;
    const s = setup({ doc: local, remote, extra: { confirmCopy: async () => (asked++, true) } });
    await s.engine.start(ME);
    expect(s.device.snapshots.map((x) => x.label)).toEqual([SWITCH_LABEL]);
    expect(s.device.snapshots[0].doc.owner).toBe(OTHER);
    expect(s.device.values().taken).toEqual(['MATH 151']);
    expect(s.device.doc.owner).toBe(ME);
    expect(remoteValues(remote).taken).toEqual(['MATH 151']);
    expect(remote.saves).toEqual([]);
    expect(asked).toBe(0);
  });

  it("someone else's data, empty account: this device starts empty", async () => {
    const s = setup({ doc: docWith(OTHER, take('CMPT 120')) });
    await s.engine.start(ME);
    expect(isEmptyDoc(s.device.doc)).toBe(true);
    expect(s.device.doc.owner).toBe(ME);
    expect(s.device.snapshots).toHaveLength(1);
    expect(s.remote.row).toBeNull(); // nothing to upload
  });

  it('start() for a second account requires stop() first', async () => {
    const s = setup();
    await s.engine.start(ME);
    expect(() => s.engine.start(OTHER)).toThrow(/stop/);
  });
});

describe('confirmCopy: ownerless data on this device', () => {
  /** confirmCopy that answers `answer` and records what the account held when asked. */
  function asker(answer: boolean, remote: FakeRemote) {
    const calls: number[] = [];
    return { calls, confirmCopy: async () => (calls.push(remote.saves.length), answer) };
  }
  const accountWithData = () => {
    const r = new FakeRemote();
    r.put(docWith(ME, take('MATH 151'), 100_000));
    return r;
  };

  it('yes, empty account: asks before sending anything, then uploads', async () => {
    const remote = new FakeRemote();
    const ask = asker(true, remote);
    const s = setup({ doc: docWith(null, take('CMPT 120')), remote, extra: { confirmCopy: ask.confirmCopy } });
    await s.engine.start(ME);
    expect(ask.calls).toEqual([0]);
    expect(remoteValues(remote).taken).toEqual(['CMPT 120']);
    expect(remote.saves[0].bulk).toBe(true);
    expect(s.device.snapshots).toEqual([]);
  });

  it('yes, account has data: snapshot, merge, push, toast', async () => {
    const remote = accountWithData();
    const ask = asker(true, remote);
    const s = setup({ doc: docWith(null, take('CMPT 120'), 200_000), remote, extra: { confirmCopy: ask.confirmCopy } });
    await s.engine.start(ME);
    expect(ask.calls).toEqual([0]);
    expect(s.device.snapshots.map((x) => x.label)).toEqual([SYNC_LABEL]);
    expect(remoteValues(remote).taken).toEqual(['CMPT 120', 'MATH 151']);
    expect(s.merges).toEqual(['Kept 1 taken course from this device; added 1 taken course from your account']);
  });

  it('no, empty account: keeps it in history only; device starts empty, nothing pushed', async () => {
    const remote = new FakeRemote();
    const ask = asker(false, remote);
    const local = docWith(null, take('CMPT 120'));
    const s = setup({ doc: local, remote, extra: { confirmCopy: ask.confirmCopy } });
    await s.engine.start(ME);
    expect(ask.calls).toEqual([0]);
    expect(s.device.snapshots).toEqual([{ label: DECLINE_LABEL, doc: local }]);
    expect(isEmptyDoc(s.device.doc)).toBe(true);
    expect(s.device.doc.owner).toBe(ME);
    expect(remote.saves).toEqual([]);
    expect(remote.row).toBeNull();
    // Later edits sync as usual, without the old data.
    s.device.edit(take('CMPT 125'));
    await s.tick();
    expect(remoteValues(remote).taken).toEqual(['CMPT 125']);
  });

  it("no, account has data: shows the account's data, never pushes the old local data", async () => {
    const remote = accountWithData();
    const ask = asker(false, remote);
    const s = setup({ doc: docWith(null, take('CMPT 120'), 200_000), remote, extra: { confirmCopy: ask.confirmCopy } });
    await s.engine.start(ME);
    expect(s.device.snapshots.map((x) => x.label)).toEqual([DECLINE_LABEL]);
    expect(s.device.values().taken).toEqual(['MATH 151']);
    expect(s.device.doc.owner).toBe(ME);
    expect(remote.saves).toEqual([]);
    expect(remote.row!.rev).toBe(1);
    expect(s.merges).toEqual([]);
  });

  it("doesn't ask when this device has nothing", async () => {
    for (const remote of [new FakeRemote(), accountWithData()]) {
      const ask = asker(false, remote);
      const s = setup({ remote, extra: { confirmCopy: ask.confirmCopy } });
      await s.engine.start(ME);
      expect(ask.calls).toEqual([]);
      expect(s.device.doc.owner).toBe(ME);
      expect(s.device.snapshots).toEqual([]);
    }
  });
});

describe('pushing', () => {
  it('debounces own edits by 1.5 s and sends one save', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    s.device.edit(take('CMPT 120'));
    s.timers.advance(1000);
    s.device.edit(take('CMPT 125'));
    await s.tick(1400);
    expect(s.remote.saves).toHaveLength(0);
    await s.tick(100);
    expect(s.remote.saves).toHaveLength(1);
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120', 'CMPT 125']);
    expect(s.engine.state.status).toBe('synced');
  });

  it("doesn't push changes that came from elsewhere", async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    s.device.applyDoc(docWith(ME, take('X 100')), 'tab');
    await s.tick();
    expect(s.timers.pending).toBe(0);
    expect(s.remote.saves).toHaveLength(0);
  });

  it('marks restores and imports as bulk saves', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    s.device.edit(take('CMPT 120'), 'restore');
    await s.tick();
    expect(s.remote.saves.at(-1)!.bulk).toBe(true);
    s.device.edit(take('CMPT 125'));
    await s.tick();
    expect(s.remote.saves.at(-1)!.bulk).toBe(false);
  });

  it('on a conflict merges the account copy and retries', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    s.device.edit(slot(0, 'CMPT 225'));
    // Another device saved Schedule 2 meanwhile.
    s.remote.put(docWith(ME, slot(1, 'MATH 232')));
    await s.tick();
    expect(s.remote.saves.map((x) => x.ok)).toEqual([false, true]);
    const v = remoteValues(s.remote);
    expect(v.slots[0].courses[0].code).toBe('CMPT 225');
    expect(v.slots[1].courses[0].code).toBe('MATH 232');
    expect(s.device.values()).toEqual(v);
    expect(s.merges).toEqual(['Kept Schedule 1 from this device; kept Schedule 2 from your account']);
  });

  it('gives up after 3 retries with status error, and the edit stays pending', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    let n = 0;
    s.remote.beforeSave = () => s.remote.put(docWith(ME, take(`OTHER ${++n}`)));
    s.device.edit(take('CMPT 120'));
    await s.tick();
    expect(s.remote.saves).toHaveLength(4);
    expect(s.remote.saves.every((x) => !x.ok)).toBe(true);
    expect(s.engine.state.status).toBe('error');
    s.remote.beforeSave = null;
    await s.engine.pullNow();
    expect(remoteValues(s.remote).taken).toContain('CMPT 120');
    expect(s.engine.state.status).toBe('synced');
  });

  it('never loses an edit made while a push is in flight', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    let release!: () => void;
    s.remote.gate = new Promise((r) => (release = r));
    s.device.edit(take('CMPT 120'));
    s.timers.advance(PUSH_DELAY); // push starts and waits
    await settle();
    s.device.edit(take('CMPT 125')); // edit during the push
    s.remote.gate = null;
    release();
    await settle();
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120']);
    expect(s.engine.state.status).toBe('syncing');
    await s.tick();
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120', 'CMPT 125']);
    expect(s.device.values().taken).toEqual(['CMPT 120', 'CMPT 125']);
    expect(s.engine.state.status).toBe('synced');
  });

  it('keeps an edit made during a conflicting push', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    let release!: () => void;
    s.remote.gate = new Promise((r) => (release = r));
    s.device.edit(take('CMPT 120'));
    s.timers.advance(PUSH_DELAY);
    await settle();
    s.device.edit(take('CMPT 125'));
    s.remote.put(docWith(ME, take('MATH 151')));
    s.remote.gate = null;
    release();
    await s.tick();
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120', 'CMPT 125', 'MATH 151']);
    expect(s.device.values().taken).toEqual(['CMPT 120', 'CMPT 125', 'MATH 151']);
  });
});

describe('pulling', () => {
  it("pullNow() brings in another device's edits without a toast", async () => {
    const s = setup({ doc: docWith(ME, take('CMPT 120')) });
    await s.engine.start(ME);
    const other = new FakeDevice(structuredClone(s.remote.row!.doc), () => 9_000_000);
    other.edit(take('MATH 151'));
    s.remote.put(other.doc);
    const saves = s.remote.saves.length;
    await s.engine.pullNow();
    expect(s.device.values().taken).toEqual(['CMPT 120', 'MATH 151']);
    expect(s.remote.saves.length).toBe(saves); // nothing new to send back
    expect(s.merges).toEqual([]);
  });

  it('pullNow() with an unchanged rev does nothing', async () => {
    const s = setup({ doc: docWith(ME, take('CMPT 120')) });
    await s.engine.start(ME);
    const applied = s.device.applied.length;
    await s.engine.pullNow();
    expect(s.device.applied.length).toBe(applied);
  });

  it('re-uploads if the row was deleted from another device', async () => {
    const s = setup({ doc: docWith(ME, take('CMPT 120')) });
    await s.engine.start(ME);
    s.remote.row = null;
    await s.engine.pullNow();
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120']);
    expect(s.remote.saves.at(-1)!.expectedRev).toBeNull();
  });
});

describe('offline and errors', () => {
  it('queues while offline and flushes when back online', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    s.setOnline(false);
    s.device.edit(take('CMPT 120'));
    await s.tick();
    expect(s.engine.state.status).toBe('offline');
    expect(s.remote.saves).toHaveLength(0);
    s.setOnline(true);
    await settle();
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120']);
    expect(s.engine.state.status).toBe('synced');
  });

  it('starting offline runs the owner matrix once back online', async () => {
    const remote = new FakeRemote();
    remote.put(docWith(ME, take('MATH 151')));
    const s = setup({ remote });
    s.setOnline(false);
    await s.engine.start(ME);
    expect(s.engine.state.status).toBe('offline');
    expect(remote.loads).toBe(0);
    s.setOnline(true);
    await settle();
    expect(s.device.values().taken).toEqual(['MATH 151']);
  });

  it('a failed request is an error; the next pull recovers', async () => {
    const remote = new FakeRemote();
    remote.failing = new Error('500');
    const s = setup({ doc: docWith(null, take('CMPT 120')), remote });
    await s.engine.start(ME);
    expect(s.engine.state.status).toBe('error');
    remote.failing = null;
    await s.engine.pullNow();
    expect(remoteValues(remote).taken).toEqual(['CMPT 120']);
    expect(remote.saves[0].bulk).toBe(true);
  });
});

describe('a newer app version', () => {
  it('stops at start if the account has a newer schema, and never pushes', async () => {
    const remote = new FakeRemote();
    remote.put({ ...docWith(ME, take('MATH 151')), schema: SCHEMA + 1 });
    const s = setup({ doc: docWith(ME, take('CMPT 120')), remote });
    await s.engine.start(ME);
    expect(s.engine.state.status).toBe('outdated');
    s.device.edit(take('CMPT 125'));
    await s.tick();
    await s.engine.pullNow();
    await s.engine.stop();
    expect(remote.saves).toHaveLength(0);
    expect(s.device.values().taken).toEqual(['CMPT 120', 'CMPT 125']); // local untouched
  });

  it('goes outdated when a save conflict reveals a newer schema', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    s.remote.put({ ...docWith(ME, take('MATH 151')), schema: SCHEMA + 1 });
    s.device.edit(take('CMPT 120'));
    await s.tick();
    expect(s.engine.state.status).toBe('outdated');
    expect(s.remote.saves.map((x) => x.ok)).toEqual([false]);
    expect(s.remote.row!.doc.schema).toBe(SCHEMA + 1);
  });
});

describe('stop()', () => {
  it('flushes a pending push first, then stops listening', async () => {
    const s = setup({ doc: emptyDoc(ME) });
    await s.engine.start(ME);
    s.device.edit(take('CMPT 120'));
    await s.engine.stop();
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120']);
    expect(s.engine.state.status).toBe('idle');
    expect(s.engine.userId).toBeNull();
    s.device.edit(take('CMPT 125'));
    await s.tick();
    expect(remoteValues(s.remote).taken).toEqual(['CMPT 120']);
    expect(s.timers.pending).toBe(0);
  });

  it('can start again with another account afterwards', async () => {
    const s = setup({ doc: docWith(ME, take('CMPT 120')) });
    await s.engine.start(ME);
    await s.engine.stop();
    s.remote.row = null; // a different account (empty)
    await s.engine.start(OTHER);
    expect(s.device.snapshots.map((x) => x.label)).toEqual([SWITCH_LABEL]);
    expect(isEmptyDoc(s.device.doc)).toBe(true);
    expect(s.device.doc.owner).toBe(OTHER);
  });
});

describe('two devices on one account', () => {
  it('laptop edits Schedule 1, phone edits Schedule 2: both survive everywhere', async () => {
    const remote = new FakeRemote();
    const laptop = setup({ doc: docWith(null, take('CMPT 120')), remote });
    await laptop.engine.start(ME);
    const phone = setup({ remote });
    await phone.engine.start(ME);
    expect(phone.device.values().taken).toEqual(['CMPT 120']);

    laptop.device.edit(slot(0, 'CMPT 225'));
    phone.device.edit(slot(1, 'MATH 232'));
    await laptop.tick();
    await phone.tick(); // conflicts, merges, retries
    await laptop.engine.pullNow();
    for (const d of [laptop.device, phone.device]) {
      const v = d.values();
      expect(v.slots[0].courses.map((c) => c.code)).toEqual(['CMPT 225']);
      expect(v.slots[1].courses.map((c) => c.code)).toEqual(['MATH 232']);
    }
    expect(remoteValues(remote)).toEqual(laptop.device.values());
  });
});
