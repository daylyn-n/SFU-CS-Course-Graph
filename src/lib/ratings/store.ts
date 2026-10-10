// Where ratings live. The site is static, so by default they stay in this
// browser's localStorage; with Supabase configured they're shared by everyone.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanInput, parseRating, type Rating, type RatingInput, type RatingKind } from './aggregate';

export interface RatingsStore {
  /** true when ratings from other people are included */
  readonly shared: boolean;
  /** every rating for these subjects, with `mine` set on this browser's own */
  list(kind: RatingKind, subjects: readonly string[]): Promise<Rating[]>;
  /** add or replace this browser's rating for input.subject */
  save(input: RatingInput): Promise<Rating>;
  /** delete this browser's rating for a subject */
  remove(kind: RatingKind, subject: string): Promise<void>;
}

/** The parts of the Storage API we use, so tests can pass a plain object. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const RATINGS_KEY = 'sfu-prereqs:ratings';
const AUTHOR_KEY = 'sfu-prereqs:author';

const keyOf = (kind: RatingKind, subject: string) => `${kind}:${subject}`;

function defaultStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. blocked by privacy settings
  }
}

/** This browser's own ratings, kept in localStorage. Works offline. */
export class LocalRatingsStore implements RatingsStore {
  readonly shared = false;
  // Fallback when storage is unavailable, so ratings at least last the session.
  #memory: Record<string, Rating> = {};

  constructor(private storage: KeyValueStorage | null = defaultStorage()) {}

  #read(): Record<string, Rating> {
    try {
      const raw = JSON.parse(this.storage?.getItem(RATINGS_KEY) ?? 'null');
      if (!raw || typeof raw !== 'object') return this.#memory;
      const out: Record<string, Rating> = {};
      for (const value of Object.values(raw)) {
        const r = parseRating(value);
        if (r) out[keyOf(r.kind, r.subject)] = { ...r, mine: true };
      }
      return out;
    } catch {
      return this.#memory;
    }
  }

  #write(all: Record<string, Rating>) {
    this.#memory = all;
    try {
      this.storage?.setItem(RATINGS_KEY, JSON.stringify(all));
    } catch {}
  }

  async list(kind: RatingKind, subjects: readonly string[]): Promise<Rating[]> {
    const all = this.#read();
    return subjects.flatMap((s) => all[keyOf(kind, s)] ?? []);
  }

  async save(input: RatingInput): Promise<Rating> {
    const clean = cleanInput(input);
    const all = this.#read();
    const key = keyOf(clean.kind, clean.subject);
    const rating: Rating = { ...clean, id: all[key]?.id ?? randomId(), updatedAt: Date.now(), mine: true };
    this.#write({ ...all, [key]: rating });
    return rating;
  }

  async remove(kind: RatingKind, subject: string): Promise<void> {
    const all = this.#read();
    delete all[keyOf(kind, subject)];
    this.#write(all);
  }
}

/** Row shape of the public `ratings` table (see supabase/schema.sql). */
interface RatingRow {
  id: number;
  kind: RatingKind;
  subject: string;
  score_a: number;
  score_b: number;
  liked: boolean | null;
  review: string | null;
  term: string | null;
  context: string | null;
  updated_at: string;
}

const COLUMNS = 'id, kind, subject, score_a, score_b, liked, review, term, context, updated_at';

/**
 * Shared ratings in a Supabase table. There are no accounts: each browser gets
 * a random id kept in localStorage, which acts as a secret key for its own
 * ratings. It's only ever sent to the database functions that write, never
 * readable back, so one browser can't edit another's ratings.
 */
export class SupabaseRatingsStore implements RatingsStore {
  readonly shared = true;
  #client: Promise<SupabaseClient> | null = null;

  constructor(
    private url: string,
    private anonKey: string,
    private storage: KeyValueStorage | null = defaultStorage(),
  ) {}

  // Loaded on first use so the library stays out of the bundle path when
  // Supabase isn't configured.
  #db(): Promise<SupabaseClient> {
    this.#client ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(this.url, this.anonKey, { auth: { persistSession: false } }),
    );
    return this.#client;
  }

  #author(): string {
    try {
      let id = this.storage?.getItem(AUTHOR_KEY);
      if (!id) {
        id = randomId();
        this.storage?.setItem(AUTHOR_KEY, id);
      }
      return id;
    } catch {
      return (this.#sessionAuthor ??= randomId());
    }
  }
  #sessionAuthor: string | null = null;

  async list(kind: RatingKind, subjects: readonly string[]): Promise<Rating[]> {
    if (!subjects.length) return [];
    const db = await this.#db();
    const [rows, mine] = await Promise.all([
      db.from('ratings').select(COLUMNS).eq('kind', kind).in('subject', subjects),
      db.rpc('my_rating_ids', { p_author: this.#author(), p_kind: kind, p_subjects: subjects }),
    ]);
    if (rows.error) throw rows.error;
    if (mine.error) throw mine.error;
    const mineIds = new Set((mine.data as number[] | null) ?? []);
    return (rows.data as RatingRow[]).flatMap((row) => fromRow(row, mineIds.has(row.id)) ?? []);
  }

  async save(input: RatingInput): Promise<Rating> {
    const r = cleanInput(input);
    const db = await this.#db();
    const { data, error } = await db.rpc('upsert_rating', {
      p_author: this.#author(),
      p_kind: r.kind,
      p_subject: r.subject,
      p_score_a: r.scores[0],
      p_score_b: r.scores[1],
      p_liked: r.liked,
      p_review: r.review || null,
      p_term: r.term,
      p_context: r.context,
    });
    if (error) throw error;
    const rating = fromRow((Array.isArray(data) ? data[0] : data) as RatingRow, true);
    if (!rating) throw new Error('The database returned an unexpected rating');
    return rating;
  }

  async remove(kind: RatingKind, subject: string): Promise<void> {
    const db = await this.#db();
    const { error } = await db.rpc('delete_rating', { p_author: this.#author(), p_kind: kind, p_subject: subject });
    if (error) throw error;
  }
}

function fromRow(row: RatingRow, mine: boolean): Rating | null {
  return parseRating({
    id: String(row.id),
    kind: row.kind,
    subject: row.subject,
    scores: [row.score_a, row.score_b],
    liked: row.liked,
    review: row.review ?? '',
    term: row.term,
    context: row.context,
    updatedAt: Date.parse(row.updated_at),
    mine,
  });
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers: good enough for a local key, not for anything secret.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0;
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
