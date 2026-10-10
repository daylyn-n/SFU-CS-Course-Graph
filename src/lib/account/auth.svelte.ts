// Who is signed in, as reactive state. client.ts keeps it up to date.
import { storedUser } from './helpers';

export interface AuthUser {
  id: string;
  email: string;
}

function local(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Start from the session supabase-js saved last time, so the avatar shows
// before supabase-js has even downloaded. `ready` turns true once the client
// has confirmed (or there was nothing to confirm).
const initial = storedUser(local());

export const authState: { ready: boolean; user: AuthUser | null } = $state({
  ready: initial === null,
  user: initial,
});
