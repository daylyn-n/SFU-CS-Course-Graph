// Pure helpers for sign-in: no Svelte, no supabase-js, so they're easy to test.

/** Digits in the emailed sign-in code (Supabase's default OTP length). */
export const CODE_LENGTH = 6;
/** Seconds before "Resend code" works again. Supabase refuses faster resends anyway. */
export const RESEND_COOLDOWN_S = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

/** A plausible email address (the server has the final say). */
export function isValidEmail(raw: string): boolean {
  const s = raw.trim();
  return s.length <= 254 && EMAIL_RE.test(s);
}

/** Why an address won't do, in words, or null if it's fine. */
export function emailProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Enter your email address.';
  if (!s.includes('@')) return `Enter a full email address, like ${/^[a-z0-9._-]+$/i.test(s) ? s : 'jdoe'}@sfu.ca.`;
  return isValidEmail(s) ? null : 'That doesn’t look like an email address. Check for typos.';
}

/**
 * Digits of a sign-in code from typed or pasted text: "123 456",
 * "123-456" and "Your code is 123456" all give "123456". If the text holds a
 * run of exactly `length` digits, that run wins over stray other numbers.
 */
export function parseCode(text: string, length = CODE_LENGTH): string {
  const runs = text.match(/\d+/g) ?? [];
  const exact = runs.find((r) => r.length === length);
  if (exact) return exact;
  return runs.join('').slice(0, length);
}

// ---- Shared-computer flag ---------------------------------------------------

/** sessionStorage key: lasts until this tab closes, so sign-out can read it. */
export const SHARED_KEY = 'sfu-prereqs:shared-computer';

type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function session(): SessionLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function setSharedComputer(on: boolean, store: SessionLike | null = session()): void {
  try {
    if (on) store?.setItem(SHARED_KEY, '1');
    else store?.removeItem(SHARED_KEY);
  } catch {}
}

export function isSharedComputer(store: SessionLike | null = session()): boolean {
  try {
    return store?.getItem(SHARED_KEY) === '1';
  } catch {
    return false;
  }
}

// ---- Errors -----------------------------------------------------------------

export const MESSAGES = {
  rateSend: 'Too many codes sent. Try again in a few minutes.',
  rateVerify: 'Too many tries. Wait a few minutes, then send a new code.',
  badCode: 'That code is wrong or has expired. Check the newest email, or send a new code.',
  network: 'Couldn’t reach the sign-in server. Check your connection and try again.',
  badEmail: 'That email address can’t be used. Try another one.',
  closed: 'New accounts can’t be created right now.',
  notConfigured: 'Accounts aren’t set up on this site.',
  generic: 'Something went wrong. Try again.',
} as const;

interface ErrorLike {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
}

/** Turn a supabase-js (or fetch) error into a sentence for the user. */
export function friendlyAuthError(err: unknown, during: 'send' | 'verify' | 'other' = 'other'): string {
  const e: ErrorLike = typeof err === 'object' && err !== null ? (err as ErrorLike) : { message: String(err) };
  const code = e.code ?? '';
  const msg = e.message ?? '';

  if (e.status === 429 || /rate_limit/.test(code) || /rate limit|too many/i.test(msg))
    return during === 'verify' ? MESSAGES.rateVerify : MESSAGES.rateSend;
  if (
    e.name === 'AuthRetryableFetchError' ||
    (e.status === 0 && e.name?.startsWith('Auth')) ||
    /failed to fetch|networkerror|network request failed|load failed|fetch.*dynamically imported module/i.test(msg)
  )
    return MESSAGES.network;
  if (
    code === 'otp_expired' ||
    code === 'invalid_credentials' ||
    (during === 'verify' && /expired|invalid|not found/i.test(msg)) ||
    /token has expired|otp.*(expired|invalid)/i.test(msg)
  )
    return MESSAGES.badCode;
  if (code === 'email_address_invalid' || code === 'email_address_not_authorized' || /email address.*invalid/i.test(msg))
    return MESSAGES.badEmail;
  if (code === 'signup_disabled' || code === 'otp_disabled' || /signups not allowed/i.test(msg)) return MESSAGES.closed;
  return MESSAGES.generic;
}

// ---- Status line -----------------------------------------------------------

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'outdated';

/** "just now", "5 min ago", "2 h ago", "3 days ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The menu's status sentence (action buttons such as Retry are separate). */
export function statusText(status: SyncStatus, lastSyncedAt: number | null, now = Date.now()): string {
  switch (status) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return 'Offline: changes will sync when you’re back online';
    case 'error':
      return 'Sync failed';
    case 'outdated':
      return 'A newer version is available';
    case 'synced':
      return `Synced · ${lastSyncedAt ? timeAgo(lastSyncedAt, now) : 'just now'}`;
    case 'idle':
      return lastSyncedAt ? `Synced · ${timeAgo(lastSyncedAt, now)}` : 'Not synced yet';
  }
}

/** First letter for the avatar. */
export function initialOf(email: string): string {
  const ch = email.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return ch ? ch.toUpperCase() : '?';
}

// ---- Stored session --------------------------------------------------------

/** Is this a supabase-js auth key (a session or a pending PKCE verifier)? */
export const isAuthKey = (key: string) => /^sb-.+-auth-token/.test(key);

type LocalLike = Pick<Storage, 'getItem' | 'key' | 'length'>;

/** Keys supabase-js keeps auth in, without loading supabase-js. */
export function authKeys(store: LocalLike | null): string[] {
  const out: string[] = [];
  try {
    if (!store) return out;
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && isAuthKey(k)) out.push(k);
    }
  } catch {}
  return out;
}

/** The user saved with a stored session, read without supabase-js (so the avatar shows at once). */
export function storedUser(store: LocalLike | null): { id: string; email: string } | null {
  for (const k of authKeys(store)) {
    if (!/-auth-token$/.test(k)) continue;
    try {
      const raw = JSON.parse(store!.getItem(k) ?? 'null');
      const u = raw?.user ?? raw?.currentSession?.user;
      if (u && typeof u.id === 'string') return { id: u.id, email: typeof u.email === 'string' ? u.email : '' };
    } catch {}
  }
  return null;
}

// ---- First sign-in ---------------------------------------------------------

/** How long an emailed code lasts (Supabase's default OTP expiry). */
const CODE_LIFETIME_MS = 60 * 60_000;

/**
 * Probably a new account's first sign-in: the account was created by asking
 * for this code, so it signs in within the code's lifetime. (Supabase marks
 * the email confirmed when the code is sent, so that time doesn't help.) A
 * second sign-in within that hour also counts; for an exact answer the app
 * can check whether the account has saved data (SignInDialog's askProgram).
 * Both times are the server's, so the device clock doesn't matter.
 */
export function isFirstSignIn(user: { created_at?: string; last_sign_in_at?: string | null } | null | undefined): boolean {
  if (!user) return false;
  const created = Date.parse(user.created_at ?? '');
  const signedIn = Date.parse(user.last_sign_in_at ?? '');
  if (Number.isNaN(created) || Number.isNaN(signedIn)) return false;
  return signedIn - created < CODE_LIFETIME_MS;
}
