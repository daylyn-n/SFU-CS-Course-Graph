import { describe, expect, it } from 'vitest';
import {
  authKeys,
  emailProblem,
  friendlyAuthError,
  initialOf,
  isFirstSignIn,
  isSharedComputer,
  isValidEmail,
  MESSAGES,
  parseCode,
  setSharedComputer,
  SHARED_KEY,
  statusText,
  storedUser,
  timeAgo,
} from './helpers';

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

describe('email validation', () => {
  it.each(['jdoe@sfu.ca', ' jdoe@sfu.ca ', 'first.last+tag@mail.example.com', 'a@b.io'])('accepts %s', (e) =>
    expect(isValidEmail(e)).toBe(true),
  );
  it.each(['', 'jdoe', 'jdoe@', '@sfu.ca', 'jdoe@sfu', 'jd oe@sfu.ca', 'jdoe@sfu.c', 'a@@b.ca', 'jdoe@.ca', 'jdoe@sfu..ca'])(
    'rejects %j',
    (e) => expect(isValidEmail(e)).toBe(false),
  );
  it('explains the problem', () => {
    expect(emailProblem('')).toMatch(/Enter your email/);
    expect(emailProblem('jdoe')).toBe('Enter a full email address, like jdoe@sfu.ca.');
    expect(emailProblem('j doe')).toBe('Enter a full email address, like jdoe@sfu.ca.');
    expect(emailProblem('jdoe@sfu')).toMatch(/typos/);
    expect(emailProblem('jdoe@sfu.ca')).toBeNull();
  });
});

describe('code parsing', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['123-456', '123456'],
    [' 123456\n', '123456'],
    ['Your code is 482913', '482913'],
    ['Code 482913, valid for 60 minutes', '482913'],
    ['12', '12'],
    ['12a3', '123'],
    ['1234567890', '123456'],
    ['abc', ''],
    ['', ''],
  ])('%j -> %j', (input, out) => expect(parseCode(input)).toBe(out));
  it('respects another length', () => expect(parseCode('code: 12345678', 8)).toBe('12345678'));
});

describe('shared-computer flag', () => {
  it('round-trips through session storage', () => {
    const s = memory();
    expect(isSharedComputer(s)).toBe(false);
    setSharedComputer(true, s);
    expect(s.map.get(SHARED_KEY)).toBe('1');
    expect(isSharedComputer(s)).toBe(true);
    setSharedComputer(false, s);
    expect(s.map.has(SHARED_KEY)).toBe(false);
    expect(isSharedComputer(s)).toBe(false);
  });
  it('survives missing or throwing storage', () => {
    expect(isSharedComputer(null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => setSharedComputer(true, broken)).not.toThrow();
    expect(isSharedComputer(broken)).toBe(false);
  });
});

describe('error mapping', () => {
  it('rate limits', () => {
    expect(friendlyAuthError({ name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit' }, 'send')).toBe(
      MESSAGES.rateSend,
    );
    expect(friendlyAuthError({ message: 'email rate limit exceeded' }, 'send')).toBe(MESSAGES.rateSend);
    expect(friendlyAuthError({ status: 429, code: 'over_request_rate_limit' }, 'verify')).toBe(MESSAGES.rateVerify);
  });
  it('bad or expired codes', () => {
    expect(friendlyAuthError({ name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' }, 'verify')).toBe(
      MESSAGES.badCode,
    );
    expect(friendlyAuthError({ status: 400, message: 'Invalid token' }, 'verify')).toBe(MESSAGES.badCode);
  });
  it('network', () => {
    expect(friendlyAuthError({ name: 'AuthRetryableFetchError', status: 0, message: '{}' }, 'send')).toBe(MESSAGES.network);
    expect(friendlyAuthError(new TypeError('Failed to fetch'), 'send')).toBe(MESSAGES.network);
    expect(friendlyAuthError(new TypeError('Failed to fetch dynamically imported module: /x.js'))).toBe(MESSAGES.network);
    expect(friendlyAuthError(new TypeError('Load failed'), 'verify')).toBe(MESSAGES.network);
  });
  it('other cases', () => {
    expect(friendlyAuthError({ code: 'email_address_invalid' }, 'send')).toBe(MESSAGES.badEmail);
    expect(friendlyAuthError({ code: 'signup_disabled' }, 'send')).toBe(MESSAGES.closed);
    expect(friendlyAuthError({ message: 'weird' }, 'send')).toBe(MESSAGES.generic);
    expect(friendlyAuthError('boom')).toBe(MESSAGES.generic);
    expect(friendlyAuthError(null)).toBe(MESSAGES.generic);
  });
});

describe('status line', () => {
  const now = 1_000_000_000;
  it('relative times', () => {
    expect(timeAgo(now - 5_000, now)).toBe('just now');
    expect(timeAgo(now + 5_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 86_400_000, now)).toBe('1 day ago');
  });
  it('every status', () => {
    expect(statusText('synced', now - 1000, now)).toBe('Synced · just now');
    expect(statusText('synced', null, now)).toBe('Synced · just now');
    expect(statusText('syncing', null, now)).toBe('Syncing…');
    expect(statusText('offline', null, now)).toMatch(/^Offline: changes will sync/);
    expect(statusText('error', null, now)).toBe('Sync failed');
    expect(statusText('outdated', null, now)).toBe('A newer version is available');
    expect(statusText('idle', null, now)).toBe('Not synced yet');
    expect(statusText('idle', now - 120_000, now)).toBe('Synced · 2 min ago');
  });
  it('initials', () => {
    expect(initialOf('jdoe@sfu.ca')).toBe('J');
    expect(initialOf('_x@y.ca')).toBe('X');
    expect(initialOf('élise@y.ca')).toBe('É');
    expect(initialOf('')).toBe('?');
  });
});

describe('stored session', () => {
  it('finds supabase auth keys and the saved user', () => {
    const s = memory({
      'sfu-prereqs:taken': '[]',
      'sb-abc-auth-token': JSON.stringify({ access_token: 'x', user: { id: 'u1', email: 'a@sfu.ca' } }),
      'sb-abc-auth-token-code-verifier': '"v"',
    });
    expect(authKeys(s)).toEqual(['sb-abc-auth-token', 'sb-abc-auth-token-code-verifier']);
    expect(storedUser(s)).toEqual({ id: 'u1', email: 'a@sfu.ca' });
  });
  it('ignores a lone PKCE verifier or junk', () => {
    expect(storedUser(memory({ 'sb-abc-auth-token-code-verifier': '"v"' }))).toBeNull();
    expect(storedUser(memory({ 'sb-abc-auth-token': '{bad' }))).toBeNull();
    expect(storedUser(null)).toBeNull();
    expect(authKeys(memory({ 'sb-abc-other': '1' }))).toEqual([]);
  });
});

describe('first sign-in', () => {
  // Real values from local Supabase: the account is created when the code is sent.
  it('signed in with the code that created the account', () => {
    expect(isFirstSignIn({ created_at: '2026-10-10T16:31:22.670871Z', last_sign_in_at: '2026-10-10T16:33:24.30087194Z' })).toBe(true);
  });
  it('signed in long after', () => {
    expect(isFirstSignIn({ created_at: '2026-09-01T10:00:00Z', last_sign_in_at: '2026-10-10T10:00:00Z' })).toBe(false);
  });
  it('missing data', () => {
    expect(isFirstSignIn(null)).toBe(false);
    expect(isFirstSignIn({ last_sign_in_at: null })).toBe(false);
  });
});
