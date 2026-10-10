// Picks the ratings store: shared Supabase if the env vars are set at build
// time, otherwise this browser's localStorage.
import { LocalRatingsStore, SupabaseRatingsStore, type RatingsStore } from './store';

export * from './aggregate';
export type { RatingsStore } from './store';

export function createRatingsStore(env: Record<string, string | undefined> = import.meta.env): RatingsStore {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? new SupabaseRatingsStore(url, key) : new LocalRatingsStore();
}
