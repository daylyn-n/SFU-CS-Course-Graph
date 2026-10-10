// The account's copy of the document, in Supabase (supabase/migrations/
// *_user_state.sql). Reads go straight to the user_state table (row-level
// security returns only the caller's row); writes go through save_state.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppDoc } from '../persist/doc';
import type { RemoteStore, SaveResult } from './engine';

/** Raised for failed requests; `code` is the Postgres/PostgREST error code if any. */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

interface PgError {
  message: string;
  code?: string;
}

const fail = (what: string, e: PgError) => new RemoteError(`${what}: ${e.message}`, e.code);

export class SupabaseRemote implements RemoteStore {
  constructor(private client: SupabaseClient) {}

  async load(): Promise<{ doc: AppDoc; rev: number } | null> {
    const { data, error } = await this.client.from('user_state').select('doc, rev, schema').maybeSingle();
    if (error) throw fail("Couldn't load your saved data", error);
    if (!data) return null;
    return { doc: data.doc as AppDoc, rev: Number(data.rev) };
  }

  async save(doc: AppDoc, expectedRev: number | null, bulk = false): Promise<SaveResult> {
    const { data, error } = await this.client.rpc('save_state', {
      p_doc: doc,
      p_expected_rev: expectedRev,
      p_bulk: bulk,
    });
    if (error) throw fail("Couldn't save your data", error);
    const res = data as { ok: boolean; rev: number | string; doc?: AppDoc };
    if (!res || typeof res.ok !== 'boolean') throw new RemoteError('Unexpected reply from save_state');
    return res.ok ? { ok: true, rev: Number(res.rev) } : { ok: false, doc: res.doc as AppDoc, rev: Number(res.rev) };
  }

  /** "Delete my saved data": the account's document and its server history. */
  async deleteMyState(): Promise<void> {
    const { error } = await this.client.rpc('delete_my_state');
    if (error) throw fail("Couldn't delete your saved data", error);
  }
}
