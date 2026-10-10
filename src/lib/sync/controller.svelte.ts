// Connects sign-in to sync: starts a SyncEngine for the signed-in user, stops
// it (after pushing pending edits) on sign-out, pulls on focus and every
// minute, and exposes what the UI needs (status, the copy prompt, the program
// prompt). See docs/accounts-design.md, Layer 3.

import { SyncEngine } from './engine';
import { SupabaseRemote } from './supabaseRemote';
import { authState, getSupabase, isAuthConfigured, onAuthChange, signOut, type AuthUser } from '../account/client';
import { applyDoc, getDoc, onChange, setOwner, settings } from '../persist/store.svelte';
import { clearHistory, snapshot } from '../persist/history';
import { SCHEMA, emptyDoc } from '../persist/doc';
import { flash } from '../shareActions.svelte';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'outdated';

export const sync: {
  status: SyncStatus;
  lastSyncedAt: number | null;
  /** "Copy this device's progress into your account?" is showing */
  copyPrompt: boolean;
  /** the account has no program yet: ask for one */
  programPrompt: boolean;
} = $state({ status: 'idle', lastSyncedAt: null, copyPrompt: false, programPrompt: false });

let engine: SyncEngine | null = null;
let remote: SupabaseRemote | null = null;
let userId: string | null = null;
let answerCopyPrompt: ((yes: boolean) => void) | null = null;

/** The CopyPrompt's answer. */
export function answerCopy(yes: boolean): void {
  sync.copyPrompt = false;
  answerCopyPrompt?.(yes);
  answerCopyPrompt = null;
}

async function startFor(id: string) {
  const client = await getSupabase();
  if (!client || userId !== id) return;
  remote = new SupabaseRemote(client);
  const e = new SyncEngine({
    remote,
    getDoc,
    applyDoc,
    onChange,
    setOwner,
    snapshot,
    schema: SCHEMA,
    confirmCopy: () =>
      new Promise<boolean>((resolve) => {
        answerCopyPrompt = resolve;
        sync.copyPrompt = true;
      }),
  });
  engine = e;
  e.onStatus((s) => {
    sync.status = s.status as SyncStatus;
    sync.lastSyncedAt = s.lastSyncedAt;
  });
  e.onMerge((text) => text && flash(text));
  try {
    await e.start(id);
  } catch (err) {
    console.error(err);
    sync.status = 'error';
    return;
  }
  // Ask for the program once per account: when the synced data has none.
  if (engine === e && !settings.program) sync.programPrompt = true;
}

async function stopEngine() {
  const e = engine;
  engine = null;
  remote = null;
  sync.status = 'idle';
  sync.lastSyncedAt = null;
  if (sync.copyPrompt) answerCopy(false);
  await e?.stop();
}

async function follow(user: AuthUser | null) {
  const id = user?.id ?? null;
  if (id === userId) return;
  await stopEngine();
  userId = id;
  if (id) await startFor(id);
}

let started = false;
/** Call once at startup. Does nothing when accounts aren't configured. */
export function initSync(): void {
  if (started || !isAuthConfigured()) return;
  started = true;
  onAuthChange((user) => void follow(user));
  if (authState.user) void follow(authState.user);
  const pull = () => document.visibilityState === 'visible' && engine?.pullNow();
  addEventListener('focus', pull);
  document.addEventListener('visibilitychange', pull);
  setInterval(pull, 60_000);
}

/** Push anything pending now (the "Retry" in the account menu). */
export function retrySync(): void {
  engine?.flush();
  engine?.pullNow();
}

/** Sign out here. On a shared computer this also wipes the device's data. */
export async function signOutHere(): Promise<void> {
  await stopEngine(); // pushes pending edits first
  userId = null;
  const { error } = await signOut({
    clearLocal: () => {
      applyDoc(emptyDoc(null), 'load');
      setOwner(null);
    },
    clearHistory: () => clearHistory(),
  });
  flash(error ? `Signed out on this device (${error})` : 'Signed out. Your progress is still on this device.');
}

/**
 * Delete the account's saved data from the cloud. Sync stops first (or it
 * would upload this device's copy again), and you're signed out; this
 * device keeps its copy, no longer tied to the account.
 */
export async function deleteCloudData(): Promise<void> {
  const r = remote;
  await stopEngine();
  try {
    await r?.deleteMyState();
  } catch (err) {
    flash(`Couldn't delete your saved data: ${(err as Error).message}`, { error: true });
    if (userId) void startFor(userId);
    return;
  }
  setOwner(null);
  userId = null;
  await signOut({ sharedComputer: false });
  flash('Deleted your saved data from the cloud. This device still has its copy.');
}
