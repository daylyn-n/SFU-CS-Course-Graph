import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real module uses $state; a plain object is enough here.
vi.mock('./auth.svelte', () => ({ authState: { ready: false, user: null } }));

const { authState } = await import('./auth.svelte');
const client = await import('./client');
const { MESSAGES, SHARED_KEY } = await import('./helpers');

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    map: m,
  };
}

type Listener = (event: string, session: { user: { id: string; email: string } } | null) => void;

function fakeClient(overrides: Record<string, unknown> = {}) {
  let listener: Listener | null = null;
  const auth = {
    onAuthStateChange: (fn: Listener) => {
      listener = fn;
      return { data: { subscription: { unsubscribe: () => (listener = null) } } };
    },
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'a@sfu.ca' }, session: {} }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
  return { auth, emit: (e: string, s: Parameters<Listener>[1]) => listener?.(e, s) };
}

let local: ReturnType<typeof memory>;
let session: ReturnType<typeof memory>;

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  local = memory();
  session = memory();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  authState.ready = false;
  authState.user = null;
});
afterEach(() => {
  client.__setClientForTests(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('configuration', () => {
  it('needs both env vars; Google needs its flag too', () => {
    expect(client.isAuthConfigured({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'k' })).toBe(true);
    expect(client.isAuthConfigured({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: ' ' })).toBe(false);
    expect(client.googleEnabled({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'k' })).toBe(false);
    expect(client.googleEnabled({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'k', VITE_AUTH_GOOGLE: '1' })).toBe(true);
  });
  it('getSupabase is null when not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    expect(await client.getSupabase()).toBeNull();
    expect((await client.sendCode('a@sfu.ca')).error).toBe(MESSAGES.notConfigured);
  });
});

describe('restoreSessionIfPresent', () => {
  it('without a session key, is ready at once and loads nothing', async () => {
    authState.user = { id: 'stale', email: '' };
    await client.restoreSessionIfPresent();
    expect(authState).toEqual({ ready: true, user: null });
  });
  it('with a session key, loads the client and follows auth events', async () => {
    local.setItem('sb-127-auth-token', '{}');
    const fake = fakeClient();
    client.__setClientForTests(fake);
    await client.restoreSessionIfPresent();
    const seen: unknown[] = [];
    const off = client.onAuthChange((u, e) => seen.push([u?.id ?? null, e]));
    fake.emit('INITIAL_SESSION', { user: { id: 'u1', email: 'a@sfu.ca' } });
    expect(authState).toEqual({ ready: true, user: { id: 'u1', email: 'a@sfu.ca' } });
    fake.emit('SIGNED_OUT', null);
    expect(authState.user).toBeNull();
    off();
    expect(seen).toEqual([
      ['u1', 'INITIAL_SESSION'],
      [null, 'SIGNED_OUT'],
    ]);
  });
});

describe('codes', () => {
  it('sends with shouldCreateUser and verifies as type email', async () => {
    const fake = fakeClient();
    client.__setClientForTests(fake);
    expect(await client.sendCode(' a@sfu.ca ')).toEqual({ error: null });
    expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'a@sfu.ca', options: { shouldCreateUser: true } });
    const res = await client.verifyCode('a@sfu.ca', '123456');
    expect(fake.auth.verifyOtp).toHaveBeenCalledWith({ email: 'a@sfu.ca', token: '123456', type: 'email' });
    expect(res).toEqual({ user: { id: 'u1', email: 'a@sfu.ca' }, error: null, firstSignIn: false });
    expect(authState.user).toEqual({ id: 'u1', email: 'a@sfu.ca' });
  });
  it('maps errors', async () => {
    client.__setClientForTests(
      fakeClient({
        signInWithOtp: async () => ({ error: { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit' } }),
        verifyOtp: async () => ({ data: { user: null, session: null }, error: { status: 403, code: 'otp_expired' } }),
      }),
    );
    expect((await client.sendCode('a@sfu.ca')).error).toBe(MESSAGES.rateSend);
    expect(await client.verifyCode('a@sfu.ca', '000000')).toEqual({ user: null, error: MESSAGES.badCode, firstSignIn: false });
  });
  it('maps a thrown network error', async () => {
    client.__setClientForTests(
      fakeClient({
        signInWithOtp: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    );
    expect((await client.sendCode('a@sfu.ca')).error).toBe(MESSAGES.network);
  });
});

describe('signOut', () => {
  it('normal: local scope, keeps data, removes auth keys', async () => {
    const fake = fakeClient();
    client.__setClientForTests(fake);
    local.setItem('sb-127-auth-token', '{}');
    local.setItem('sfu-prereqs:taken', '["CMPT 120"]');
    const clearLocal = vi.fn();
    const clearHistory = vi.fn();
    authState.user = { id: 'u1', email: 'a@sfu.ca' };
    expect(await client.signOut({ clearLocal, clearHistory })).toEqual({ error: null });
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(clearLocal).not.toHaveBeenCalled();
    expect(clearHistory).not.toHaveBeenCalled();
    expect(local.map.has('sb-127-auth-token')).toBe(false);
    expect(local.map.has('sfu-prereqs:taken')).toBe(true);
    expect(authState.user).toBeNull();
  });
  it('shared computer (from the sign-in flag): wipes data even when the server fails', async () => {
    client.__setClientForTests(fakeClient({ signOut: async () => ({ error: new TypeError('Failed to fetch') }) }));
    session.setItem(SHARED_KEY, '1');
    local.setItem('sb-127-auth-token', '{}');
    const order: string[] = [];
    const res = await client.signOut({
      clearLocal: () => void order.push('local'),
      clearHistory: async () => void order.push('history'),
    });
    expect(res.error).toBeNull();
    expect(order).toEqual(['history', 'local']);
    expect(local.map.size).toBe(0);
    expect(session.map.has(SHARED_KEY)).toBe(false);
  });
  it('an explicit sharedComputer overrides the flag, and a failing callback does not stop the rest', async () => {
    client.__setClientForTests(fakeClient());
    const clearLocal = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await client.signOut({
      sharedComputer: true,
      clearHistory: () => {
        throw new Error('idb');
      },
      clearLocal,
    });
    expect(clearLocal).toHaveBeenCalled();
  });
});
