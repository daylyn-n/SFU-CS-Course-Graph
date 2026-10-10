// The accounts database and the sync engine against a real local Supabase.
//
//   npx supabase start            (from the project root; applies supabase/migrations)
//   npx vitest run --config scripts/e2e/vitest.config.ts
//
// Users sign in with the email code, read from the local mail catcher
// (Mailpit). URLs and keys come from SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY / MAILPIT_URL, or from `npx supabase status`.

import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { emptyDoc, SCHEMA, toValues, type AppDoc, type Values } from '../../src/lib/persist/doc';
import { DECLINE_LABEL, SWITCH_LABEL, SyncEngine } from '../../src/lib/sync/engine';
import { SupabaseRemote } from '../../src/lib/sync/supabaseRemote';
import { FakeDevice } from '../../src/lib/sync/testing';

interface Env {
  url: string;
  anon: string;
  service: string;
  mail: string;
}

function readEnv(): Env {
  let status: Record<string, string> = {};
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    status = JSON.parse(out.slice(out.indexOf('{')));
  }
  return {
    url: process.env.SUPABASE_URL ?? status.API_URL,
    anon: process.env.SUPABASE_ANON_KEY ?? status.ANON_KEY,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY,
    mail: process.env.MAILPIT_URL ?? status.MAILPIT_URL ?? status.INBUCKET_URL,
  };
}

let env: Env;
let admin: SupabaseClient;
const run = `${Date.now().toString(36)}`;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

interface User {
  id: string;
  email: string;
  db: SupabaseClient;
}

async function waitForCode(email: string, after: number): Promise<{ code: string; subject: string }> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${env.mail}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const list = (await res.json()) as { messages: { ID: string; Created: string }[] };
    const fresh = list.messages.filter((m) => Date.parse(m.Created) >= after - 1000);
    if (fresh.length) {
      const msg = (await (await fetch(`${env.mail}/api/v1/message/${fresh[0].ID}`)).json()) as {
        Text: string;
        Subject: string;
      };
      const code = /\b(\d{6})\b/.exec(msg.Text)?.[1];
      if (code) return { code, subject: msg.Subject };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No sign-in code arrived for ${email}`);
}

/** Sign in with an emailed 6-digit code, as the app does. */
async function signIn(email: string): Promise<User & { subject: string }> {
  const db = createClient(env.url, env.anon, noSession);
  let sentAt = Date.now();
  for (let tries = 0; ; tries++) {
    const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (!error) break;
    // auth.email.max_frequency: one code per address per second locally
    if (tries > 5 || !/request this after/.test(error.message)) throw error;
    await new Promise((r) => setTimeout(r, 1100));
    sentAt = Date.now();
  }
  const { code, subject } = await waitForCode(email, sentAt);
  const { data, error: e2 } = await db.auth.verifyOtp({ email, token: code, type: 'email' });
  if (e2) throw e2;
  return { id: data.user!.id, email, db, subject };
}

const email = (name: string) => `${name}-${run}@example.com`;

function docOf(owner: string | null, change: (v: Values) => void): AppDoc {
  const d = new FakeDevice(emptyDoc(owner));
  d.edit(change);
  return d.doc;
}

const save = (u: User, doc: unknown, rev: number | null, bulk = false) =>
  u.db.rpc('save_state', { p_doc: doc, p_expected_rev: rev, p_bulk: bulk });

const historyCount = async (u: User) => {
  const { count, error } = await admin.from('user_state_history').select('*', { count: 'exact', head: true }).eq('user_id', u.id);
  if (error) throw error;
  return count ?? 0;
};

beforeAll(async () => {
  env = readEnv();
  admin = createClient(env.url, env.service, noSession);
  const health = await fetch(`${env.url}/auth/v1/health`, { headers: { apikey: env.anon } }).catch(() => null);
  if (!health?.ok) throw new Error(`Local Supabase isn't reachable at ${env.url}; run npx supabase start`);
});

describe('user_state and save_state', () => {
  let a: User;
  let b: User;

  beforeAll(async () => {
    const first = await signIn(email('a'));
    expect(first.subject).toBe('Your SFU Course Planner sign-in code'); // our OTP template is in use
    a = first;
    b = await signIn(email('b'));
  });

  it('first save inserts; each user only sees and writes their own row', async () => {
    const docA = docOf(a.id, (v) => v.taken.push('CMPT 120'));
    expect((await save(a, docA, null)).data).toEqual({ ok: true, rev: 1 });

    const mine = await a.db.from('user_state').select('doc, rev, schema').maybeSingle();
    expect(mine.error).toBeNull();
    expect(mine.data).toMatchObject({ rev: 1, schema: SCHEMA });
    expect(toValues(mine.data!.doc).taken).toEqual(['CMPT 120']);

    // B sees nothing of A's.
    expect((await b.db.from('user_state').select('*')).data).toEqual([]);
    expect((await b.db.from('user_state_history').select('*')).data).toEqual([]);
    // B can't write the table directly, by any route.
    const upd = await b.db.from('user_state').update({ rev: 99 }).eq('user_id', a.id);
    expect(upd.error?.code).toBe('42501');
    const ins = await b.db.from('user_state').insert({ user_id: a.id, doc: {}, schema: 2 });
    expect(ins.error?.code).toBe('42501');
    const del = await b.db.from('user_state').delete().eq('user_id', a.id);
    expect(del.error?.code).toBe('42501');
    // save_state as B only ever touches B's own row.
    expect((await save(b, docOf(b.id, (v) => v.taken.push('HACK 101')), 1)).data).toEqual({ ok: true, rev: 1 });
    const still = await a.db.from('user_state').select('doc, rev').single();
    expect(still.data!.rev).toBe(1);
    expect(toValues(still.data!.doc).taken).toEqual(['CMPT 120']);
    // A's own select sees exactly one row (RLS) and B's isn't it.
    expect((await a.db.from('user_state').select('user_id')).data).toEqual([{ user_id: a.id }]);
  });

  it('compare-and-set: a stale rev gets the current doc back', async () => {
    const v2 = docOf(a.id, (v) => v.taken.push('CMPT 125'));
    expect((await save(a, v2, 1)).data).toEqual({ ok: true, rev: 2 });
    const stale = await save(a, docOf(a.id, (v) => v.taken.push('STALE 1')), 1);
    expect(stale.data.ok).toBe(false);
    expect(stale.data.rev).toBe(2);
    expect(toValues(stale.data.doc).taken).toEqual(['CMPT 125']);
    // "I saw no row" when there is one is also a conflict.
    const blind = await save(a, v2, null);
    expect(blind.data).toMatchObject({ ok: false, rev: 2 });
  });

  it('rejects a lower schema and documents over 256 kB', async () => {
    const lower = await save(a, { ...emptyDoc(a.id), schema: 1 }, 2);
    expect(lower.data).toMatchObject({ ok: false, rev: 2 });
    expect(lower.data.doc.schema).toBe(SCHEMA);

    const big = { ...emptyDoc(a.id), unknown: { blob: 'x'.repeat(300 * 1024) } };
    const res = await save(a, big, 2);
    expect(res.error?.code).toBe('54000');
    for (const bad of [null, [], { no: 'schema' }, { schema: 'two' }]) {
      expect((await save(a, bad, 2)).error?.code).toBe('22023');
    }
    expect((await a.db.from('user_state').select('rev').single()).data!.rev).toBe(2);
  });

  it('keeps history every 10 minutes or on bulk saves, pruned to 100', async () => {
    // Saves so far: insert (no history), rev 1 -> 2 (history: none recent, so kept).
    expect(await historyCount(a)).toBe(1);
    const mine = await a.db.from('user_state_history').select('rev, doc').order('saved_at', { ascending: false });
    expect(mine.data!.map((h) => h.rev)).toEqual([1]);
    expect(toValues(mine.data![0].doc).taken).toEqual(['CMPT 120']);

    // Within 10 minutes of the last history row: not kept...
    expect((await save(a, docOf(a.id, (v) => v.taken.push('CMPT 225')), 2)).data.ok).toBe(true);
    expect(await historyCount(a)).toBe(1);
    // ...unless bulk.
    expect((await save(a, docOf(a.id, (v) => v.taken.push('CMPT 276')), 3, true)).data.ok).toBe(true);
    expect(await historyCount(a)).toBe(2);
    // Over 10 minutes later: kept again.
    await admin.from('user_state_history').update({ saved_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('user_id', a.id);
    expect((await save(a, docOf(a.id, (v) => v.taken.push('CMPT 295')), 4)).data.ok).toBe(true);
    expect(await historyCount(a)).toBe(3);

    // Pruned to the newest 100.
    const old = Array.from({ length: 120 }, (_, i) => ({
      user_id: a.id,
      doc: emptyDoc(a.id),
      rev: 0,
      schema: SCHEMA,
      saved_at: new Date(Date.now() - (i + 60) * 60_000).toISOString(),
    }));
    expect((await admin.from('user_state_history').insert(old)).error).toBeNull();
    expect(await historyCount(a)).toBe(123);
    expect((await save(a, docOf(a.id, (v) => v.taken.push('CMPT 300')), 5, true)).data).toEqual({ ok: true, rev: 6 });
    expect(await historyCount(a)).toBe(100);
    const newest = await a.db.from('user_state_history').select('rev').order('saved_at', { ascending: false }).order('id', { ascending: false }).limit(4);
    expect(newest.data!.map((h) => h.rev)).toEqual([5, 4, 3, 1]);
    // B's history is untouched by any of this.
    expect(await historyCount(b)).toBe(0);
  });

  it('delete_my_state removes only the caller\'s rows', async () => {
    expect((await a.db.rpc('delete_my_state')).error).toBeNull();
    expect((await a.db.from('user_state').select('*').maybeSingle()).data).toBeNull();
    expect(await historyCount(a)).toBe(0);
    expect((await b.db.from('user_state').select('rev').single()).data!.rev).toBe(1);
    // Saving again starts over at rev 1.
    expect((await save(a, docOf(a.id, (v) => v.taken.push('CMPT 120')), 6)).data).toEqual({ ok: true, rev: 1 });
  });

  it('anon can neither run the functions nor read the tables', async () => {
    const anon = createClient(env.url, env.anon, noSession);
    expect((await anon.rpc('save_state', { p_doc: emptyDoc(), p_expected_rev: null })).error?.code).toBe('42501');
    expect((await anon.rpc('delete_my_state')).error?.code).toBe('42501');
    expect((await anon.from('user_state').select('*')).error?.code).toBe('42501');
    expect((await anon.from('user_state_history').select('*')).error?.code).toBe('42501');
    // Ratings still work for anon (the first migration is unchanged).
    expect((await anon.from('ratings').select('id').limit(1)).error).toBeNull();
  });
});

describe('the sync engine against the real database', () => {
  const take = (...codes: string[]) => (v: Values) => v.taken.push(...codes);
  const slot = (i: number, code: string) => (v: Values) => v.slots[i].courses.push({ code, picks: {} });
  const codes = (d: FakeDevice, i: number) => d.values().slots[i].courses.map((c) => c.code);

  function engineFor(device: FakeDevice, u: User, confirmCopy?: () => Promise<boolean>) {
    const remote = new SupabaseRemote(u.db);
    const engine = new SyncEngine({
      remote,
      ...device.deps(),
      schema: SCHEMA,
      confirmCopy,
      online: () => true,
      onOnline: () => () => {},
    });
    return { engine, remote };
  }

  it('laptop edits Schedule 1, phone edits Schedule 2: both survive', async () => {
    const mail = email('c');
    const onLaptop = await signIn(mail);
    const onPhone = await signIn(mail); // a second session for the same account

    const laptop = new FakeDevice(docOf(null, take('CMPT 120')));
    const phone = new FakeDevice();
    const L = engineFor(laptop, onLaptop);
    const P = engineFor(phone, onPhone);
    await L.engine.start(onLaptop.id); // never signed in + empty account: upload
    await P.engine.start(onPhone.id); // empty device: take the account's
    expect(phone.values().taken).toEqual(['CMPT 120']);
    expect(phone.doc.owner).toBe(onPhone.id);

    laptop.edit(slot(0, 'CMPT 225'));
    phone.edit(slot(1, 'MATH 232'));
    await L.engine.flush();
    const merges: string[] = [];
    P.engine.onMerge((t) => merges.push(t));
    await P.engine.flush(); // conflict: merges the laptop's save, retries
    await L.engine.pullNow();

    for (const d of [laptop, phone]) {
      expect(codes(d, 0)).toEqual(['CMPT 225']);
      expect(codes(d, 1)).toEqual(['MATH 232']);
    }
    expect(merges).toEqual(['Kept Schedule 2 from this device; kept Schedule 1 from your account']);
    const row = await L.remote.load();
    expect(toValues(row!.doc)).toEqual(laptop.values());
    expect(row!.rev).toBe(3);
    expect(L.engine.state.status).toBe('synced');
    expect(P.engine.state.status).toBe('synced');

    // An edit right before sign-out is flushed by stop().
    phone.edit(take('CMPT 300'));
    await P.engine.stop();
    expect(toValues((await L.remote.load())!.doc).taken).toEqual(['CMPT 120', 'CMPT 300']);
    await L.engine.stop();
  });

  it("declining to copy ownerless data leaves the account untouched", async () => {
    const f = await signIn(email('f'));
    const seed = new FakeDevice(docOf(null, take('MATH 151')));
    const S = engineFor(seed, f, async () => true);
    await S.engine.start(f.id);
    await S.engine.stop();

    const stranger = new FakeDevice(docOf(null, take('CMPT 120')));
    let asked = 0;
    const X = engineFor(stranger, f, async () => (asked++, false));
    await X.engine.start(f.id);
    expect(asked).toBe(1);
    expect(stranger.snapshots.map((s) => s.label)).toEqual([DECLINE_LABEL]);
    expect(stranger.values().taken).toEqual(['MATH 151']);
    await X.engine.stop();
    const row = await X.remote.load();
    expect(row!.rev).toBe(1);
    expect(toValues(row!.doc).taken).toEqual(['MATH 151']);
  });

  it('switching accounts on one device replaces the data and leaves both accounts intact', async () => {
    const d1 = await signIn(email('d'));
    const e1 = await signIn(email('e'));
    // E already has data from another device.
    const other = new FakeDevice(docOf(null, take('MATH 151')));
    const O = engineFor(other, e1);
    await O.engine.start(e1.id);
    await O.engine.stop();

    // A library computer: D signs in, works, signs out; then E signs in.
    const shared = new FakeDevice(docOf(null, take('CMPT 120')));
    const asD = engineFor(shared, d1);
    await asD.engine.start(d1.id);
    shared.edit(slot(0, 'CMPT 225'));
    await asD.engine.stop();

    const asE = engineFor(shared, e1);
    await asE.engine.start(e1.id);
    expect(shared.snapshots.map((s) => s.label)).toEqual([SWITCH_LABEL]);
    expect(shared.snapshots[0].doc.owner).toBe(d1.id);
    expect(shared.doc.owner).toBe(e1.id);
    expect(shared.values().taken).toEqual(['MATH 151']);
    expect(codes(shared, 0)).toEqual([]);
    await asE.engine.stop();

    const dRow = await new SupabaseRemote(d1.db).load();
    expect(toValues(dRow!.doc).taken).toEqual(['CMPT 120']);
    expect(toValues(dRow!.doc).slots[0].courses.map((c) => c.code)).toEqual(['CMPT 225']);
    const eRow = await new SupabaseRemote(e1.db).load();
    expect(toValues(eRow!.doc).taken).toEqual(['MATH 151']);
    expect(eRow!.doc.owner).toBe(e1.id);

    // deleteMyState through the remote.
    await new SupabaseRemote(d1.db).deleteMyState();
    expect(await new SupabaseRemote(d1.db).load()).toBeNull();
  });
});
