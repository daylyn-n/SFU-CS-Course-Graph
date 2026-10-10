// The optional account: one lazily loaded supabase-js client for sign-in.
//
// supabase-js is only downloaded when someone signs in, or at startup when a
// saved session (or a pending Google sign-in) is found in localStorage.
//
// The URL hash belongs to the app (share links like #CMPT-410?taken=…), so
// auth never reads or clears it: email codes need no redirect at all, and
// Google uses the PKCE flow, which comes back with ?code=… in the query.
// supabase-js only clears the hash for the implicit flow, which we switch off.

import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { authState, type AuthUser } from './auth.svelte';
import { authKeys, friendlyAuthError, isFirstSignIn, isSharedComputer, MESSAGES, setSharedComputer } from './helpers';

export type { AuthUser } from './auth.svelte';
export { authState } from './auth.svelte';
export { isSharedComputer } from './helpers';

type Env = Record<string, string | boolean | undefined>;

function config(env: Env = import.meta.env): { url: string; key: string } | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim();
  const key = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  return url && key ? { url, key } : null;
}

/** Are accounts available on this build? (Supabase env vars set.) */
export function isAuthConfigured(env: Env = import.meta.env): boolean {
  return config(env) !== null;
}

/** Is "Continue with Google" offered? (VITE_AUTH_GOOGLE=1) */
export function googleEnabled(env: Env = import.meta.env): boolean {
  return isAuthConfigured(env) && env.VITE_AUTH_GOOGLE === '1';
}

function local(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// ---- The client ------------------------------------------------------------

let clientPromise: Promise<SupabaseClient | null> | null = null;
let unsubscribe: (() => void) | null = null;
const listeners = new Set<(user: AuthUser | null, event: AuthChangeEvent) => void>();

const toUser = (u: User | null | undefined): AuthUser | null => (u ? { id: u.id, email: u.email ?? '' } : null);

function watch(client: SupabaseClient) {
  unsubscribe?.();
  const { data } = client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
    // Don't await supabase calls in here: supabase-js holds a lock meanwhile.
    const user = toUser(session?.user);
    if (authState.user?.id !== user?.id || authState.user?.email !== user?.email) authState.user = user;
    authState.ready = true;
    for (const fn of listeners) {
      try {
        fn(user, event);
      } catch (err) {
        console.error(err);
      }
    }
  });
  unsubscribe = () => data.subscription.unsubscribe();
}

/**
 * The shared supabase-js client (with auth), or null when accounts aren't
 * configured. The first call downloads supabase-js. Rejects if that download
 * fails (offline); a later call tries again.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise;
  const cfg = config();
  if (!cfg) return Promise.resolve(null);
  clientPromise = import('@supabase/supabase-js').then(
    ({ createClient }) => {
      const client = createClient(cfg.url, cfg.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          flowType: 'pkce',
          // A function instead of `true`: it answers "is this an implicit-flow
          // redirect?" with no, so supabase-js never parses or clears our hash.
          // PKCE redirects (?code=… plus a stored verifier) are still handled.
          detectSessionInUrl: () => false,
        },
      });
      watch(client);
      return client;
    },
    (err) => {
      clientPromise = null;
      throw err;
    },
  );
  return clientPromise;
}

/** Hear about sign-in and sign-out (and token refreshes). Returns an unsubscribe. */
export function onAuthChange(fn: (user: AuthUser | null, event: AuthChangeEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const RETURN_HASH_KEY = 'sfu-prereqs:auth-return-hash';

/**
 * Call once at startup, before the app reads the hash. If a session (or a
 * Google sign-in in progress) is saved, load supabase-js so the session is
 * refreshed and authState confirmed; otherwise download nothing.
 */
export function restoreSessionIfPresent(): Promise<void> {
  restoreReturnHash();
  if (!config() || authKeys(local()).length === 0) {
    authState.ready = true;
    if (authState.user) authState.user = null;
    return Promise.resolve();
  }
  return getSupabase().then(
    () => {},
    () => {
      // Offline: keep the saved user; sync will retry when it can.
      authState.ready = true;
    },
  );
}

/** Back from Google: put back the course the user was looking at (not any ?taken= part). */
function restoreReturnHash() {
  try {
    const hash = sessionStorage.getItem(RETURN_HASH_KEY);
    if (hash === null) return;
    sessionStorage.removeItem(RETURN_HASH_KEY);
    if (!location.hash && new URLSearchParams(location.search).has('code'))
      history.replaceState(history.state, '', location.pathname + location.search + hash);
  } catch {}
}

// ---- Signing in ------------------------------------------------------------

export type Result = { error: string | null };

/** Email a sign-in code. Creates the account on first use. */
export async function sendCode(email: string): Promise<Result> {
  try {
    const client = await getSupabase();
    if (!client) return { error: MESSAGES.notConfigured };
    const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    return { error: error ? friendlyAuthError(error, 'send') : null };
  } catch (err) {
    return { error: friendlyAuthError(err, 'send') };
  }
}

export interface VerifyResult {
  user: AuthUser | null;
  error: string | null;
  /** the account's very first sign-in (a new account) */
  firstSignIn: boolean;
}

/** Check the emailed code. On success the user is signed in (authState updates too). */
export async function verifyCode(email: string, token: string): Promise<VerifyResult> {
  const fail = (error: string): VerifyResult => ({ user: null, error, firstSignIn: false });
  try {
    const client = await getSupabase();
    if (!client) return fail(MESSAGES.notConfigured);
    const { data, error } = await client.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (error) return fail(friendlyAuthError(error, 'verify'));
    const raw = data.user ?? data.session?.user;
    const user = toUser(raw);
    if (!user) return fail(MESSAGES.generic);
    authState.user = user;
    authState.ready = true;
    return { user, error: null, firstSignIn: isFirstSignIn(raw) };
  } catch (err) {
    return fail(friendlyAuthError(err, 'verify'));
  }
}

/**
 * Leave for Google's sign-in page (only offered with VITE_AUTH_GOOGLE=1).
 * Comes back to this page's URL with ?code=…, which restoreSessionIfPresent
 * handles. The hash is kept aside in sessionStorage and put back afterwards.
 */
export async function signInWithGoogle(opts: { sharedComputer?: boolean } = {}): Promise<Result> {
  if (!googleEnabled()) return { error: MESSAGES.notConfigured };
  try {
    const client = await getSupabase();
    if (!client) return { error: MESSAGES.notConfigured };
    setSharedComputer(!!opts.sharedComputer);
    try {
      const bare = location.hash.split('?')[0];
      if (bare && bare !== '#') sessionStorage.setItem(RETURN_HASH_KEY, bare);
    } catch {}
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    return { error: error ? friendlyAuthError(error) : null };
  } catch (err) {
    return { error: friendlyAuthError(err) };
  }
}

// ---- Signing out -----------------------------------------------------------

export interface SignOutOptions {
  /** Wipe this device's data too. Defaults to what was ticked at sign-in. */
  sharedComputer?: boolean;
  /** Clears the saved document and its owner (provided by the app). */
  clearLocal?: () => void | Promise<void>;
  /** Clears version history (provided by the app). */
  clearHistory?: () => void | Promise<void>;
}

/**
 * Sign out on this device only (other devices stay signed in). On a shared
 * computer, also wipe the local document, the history and every auth key,
 * even if the server can't be reached.
 */
export async function signOut(opts: SignOutOptions = {}): Promise<Result> {
  const shared = opts.sharedComputer ?? isSharedComputer();
  let error: string | null = null;
  try {
    const client = clientPromise ? await clientPromise : await getSupabase();
    const res = await client?.auth.signOut({ scope: 'local' });
    if (res?.error) error = friendlyAuthError(res.error);
  } catch (err) {
    error = friendlyAuthError(err);
  }
  if (shared) {
    for (const step of [opts.clearHistory, opts.clearLocal]) {
      try {
        await step?.();
      } catch (err) {
        console.error(err);
      }
    }
  }
  // Signing out must stick even if the server call failed.
  const store = local();
  for (const k of authKeys(store)) {
    try {
      store?.removeItem(k);
    } catch {}
  }
  setSharedComputer(false);
  authState.user = null;
  authState.ready = true;
  return { error: shared ? null : error };
}

// ---- Tests -----------------------------------------------------------------

/** Use a fake client (tests and the visual harness). Pass null to reset. */
export function __setClientForTests(fake: unknown): void {
  unsubscribe?.();
  unsubscribe = null;
  if (fake === null) {
    clientPromise = null;
    return;
  }
  const client = fake as SupabaseClient;
  clientPromise = Promise.resolve(client);
  watch(client);
}
