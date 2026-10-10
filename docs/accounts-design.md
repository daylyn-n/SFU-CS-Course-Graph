# Never lose progress: saving, history and optional accounts

Status: design (revised after review), on branch `feat/accounts-sync`.

## The problem

Everything a student builds lives in one browser's `localStorage`: taken
courses, the three schedules, the chosen program, the semester plan. That fails
them in several ways:

1. **Clearing site data, a new laptop, or a phone** means starting over.
2. **No way back.** Auto-arrange, "Clear", a mis-click on a section picker or
   an import that replaces everything can't be undone, so iterating on a
   schedule feels risky.
3. **Two tabs overwrite each other.** Each tab saves its whole copy of the
   schedules, so the last tab to save silently wins.
4. **Quota or blocked storage** fails silently (writes are in `try {} catch {}`).

## Goals

- Nothing a student did is ever silently lost, with or without an account.
- Iterating is safe: undo/redo, and restoring an earlier version.
- An optional account syncs everything across devices.
- The app keeps working fully with no account and with Supabase not configured.

Non-goals: signing in with SFU's own login (CAS needs SFU IT to register the
app), sharing schedules with friends.

Order of delivery: **Layers 1 and 2 first** (no backend, fixes problems 2–4
and covers 1 with backups), then **Layer 3** (accounts). The saved format
below is designed for sync from the start, so Layer 3 doesn't change it.

## Layer 1: the saved document

### Shape: merge units are small

```ts
interface AppDoc {
  schema: 2;
  /** Supabase user id this data belongs to, or null if never signed in */
  owner: string | null;
  /** per course; 'none' + a stamp is a tombstone (unticked) */
  courses: Record<string, { state: 'taken' | 'notTaken' | 'none'; at: number }>;
  /** each schedule slot merges on its own */
  slots: { value: Slot; at: number }[]; // length 3
  settings: {
    assumePrereqs: { value: boolean; at: number };
    program: { value: string; at: number };
    planPerTerm: { value: number; at: number };
  };
  /** sections a newer version wrote that this version doesn't know: kept as is */
  unknown?: Record<string, unknown>;
}
```

- **Per course, per slot, per setting.** Editing Schedule 1 on a laptop and
  Schedule 2 on a phone keeps both. A course can't be both taken and
  not-taken.
- **Device preferences aren't synced:** which slot is active, dock height,
  current view, the ratings author id.

### Stamps: only real edits count

- A stamp changes only when the user changes something, never when the app
  loads, saves, or applies a change from another tab or the server. The
  persist layer keeps a baseline of what's on disk and stamps only what
  differs after a local change; loading or applying resets the baseline
  without stamping.
- Stamps come from a monotonic clock, `max(Date.now(), highestSeen + 1)`,
  where `highestSeen` includes stamps from other devices. A device with a
  fast clock can't win every merge, and stamps never go backwards.
- Existing users' data has no stamps; it loads with `at: 0` ("older than any
  real edit"), never as a fake "newest".

### Storage
- Values stay in the **existing localStorage keys** (taken, not-taken,
  schedules, program, per-term, assume) so nothing is lost on upgrade. The
  stamps, owner and unknown sections go in `sfu-prereqs:doc-meta`.
- One reactive store module owns the live values. App, the schedule store,
  DegreeView and PlanView read and write through it, so undo, restore,
  another tab and sync can apply a document to the running app without a
  reload.
- **Write failures are visible:** a banner says "Couldn't save on this device
  · Download a backup".
- `navigator.storage.persist()` is requested after the first real change.
- **Cross-tab:** a `storage` event from another tab is applied here (as
  "applied", so not stamped).

## Layer 2: undo and history (no account)

- **Undo/redo** over the whole document. Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z,
  except in input, textarea, select and contenteditable fields or while the
  command palette is open, plus Undo/Redo buttons in the schedule toolbar.
  Edits within ~800 ms make one step; up to 100 steps per tab. Each step says
  what it did ("Undid: removed CMPT 225 from Schedule 2") and switches to that
  view if it's hidden. A change applied from another tab or the server is an
  **undo barrier**: undo never reverts someone else's change, and it clears
  redo.
- **Version history in IndexedDB** with a byte budget, separate from the live
  data so it can never break saving. If it's full or unavailable, the oldest
  history goes first; a failed snapshot only warns. Snapshots are taken:
  - when edits settle, at most every 2 minutes;
  - always right before something destructive or bulk: Clear or Duplicate
    over a slot, Auto-arrange, an import or share link, a restore, the first
    sync, an account switch.

  Each has a label ("Before auto-arrange · Schedule 1"), a summary ("12 taken
  · 3 schedules · 9 courses") and its owner. Older than a day: thinned to one
  per hour. The History panel restores one after snapshotting the current
  state; signed in, it warns "This updates your other devices too".
- **Backup v2:** export the whole document as JSON. Import accepts v2 and the
  intern's v1 (taken courses + target), snapshotting first.

## Layer 3: optional account and sync (Supabase)

Only appears when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set (the
same project as ratings).

### Sign-in
- **A 6-digit code by email (OTP)**, not a link. Students read email on a
  phone and use the app on a laptop, and Outlook link scanners can use up
  one-time links. No passwords. Works with @sfu.ca.
- Optional Google (`VITE_AUTH_GOOGLE=1`), using the PKCE flow with
  `redirectTo` = the app's own URL (subpath-safe). Auth must never touch the
  `#…` hash that share links use.
- supabase-js is lazy-loaded; if a session key exists at startup it's loaded
  right away so the session refreshes.
- A **"This is a shared computer"** checkbox: on sign-out, wipe this device's
  document, history and session.
- **Launch requirement:** Supabase's built-in email is rate-limited (about 2
  emails per hour on the free tier). Configure custom SMTP (e.g. Resend) and
  an email template containing `{{ .Token }}`. Documented in the README.

### Whose data is on this device
- The local document records its `owner`.
- **Never signed in (owner null), signing in:**
  - Nothing on this device: no question; take the account's data (or start
    the account from this device's settings if the account is empty).
  - Data on this device: on a shared computer it may be someone else's, so
    nothing goes to the account silently. First ask "Copy this device's data
    into your account?" (`confirmCopy`), even if the account is empty.
    - **Yes:** if the account is empty, upload; otherwise snapshot ("Before
      syncing with your account"), merge, push, and report the merge.
    - **No:** snapshot the local document ("This device before signing in"),
      then show the account's data (or an empty document owned by the user if
      the account is empty). The old local data is never pushed.
- **Same owner:** merge normally.
- **Different owner** (a library computer, or switching accounts): never
  merge and never offer a copy. Snapshot the local document and load the
  account's. History is filtered by owner.

### Database (Postgres, row-level security)
- `user_state(user_id uuid pk → auth.users on delete cascade, doc jsonb, rev
  bigint, schema int, updated_at)`. RLS **select only** for `auth.uid() =
  user_id`; all writes go through functions.
- `save_state(p_doc jsonb, p_expected_rev bigint)`: SECURITY DEFINER,
  `set search_path = ''`, schema-qualified names, `auth.uid()` only (no user
  id parameter). It works in one statement:
  - insert on conflict for the first save;
  - compare-and-set on `rev`;
  - rejects a lower `schema` than stored;
  - rejects docs over 256 kB;
  - returns `{ok, rev}` or `{ok:false, doc, rev}`.

  `revoke all … from public, anon; grant execute … to authenticated`.
- `user_state_history`: written by `save_state`, not a trigger, keeping the
  previous doc only when the newest history row is over 10 minutes old or the
  client marks the save `bulk`. Pruned to 100 rows per user, indexed by
  `(user_id, saved_at desc)`. RLS select own.
- `delete_my_state()`: removes the user's rows.

### Sync engine (`src/lib/sync/`, pure TypeScript, unit-tested)
```ts
interface RemoteStore {
  load(): Promise<{ doc: AppDoc; rev: number } | null>;
  save(doc: AppDoc, expectedRev: number | null, bulk?: boolean):
    Promise<{ ok: true; rev: number } | { ok: false; doc: AppDoc; rev: number }>;
}
```
- Merge per course, slot and setting, by higher stamp; on a tie, keep local.
  Unknown sections are kept from whichever side has them. If the remote
  schema is newer than this build: stop pushing and show "Reload to update".
- **Push:** debounced 1.5 s; on conflict, merge with the returned doc and retry
  (bounded). **Pull:** on sign-in, on tab focus/visible, every 60 s while
  visible. **Offline:** queue locally, flush on `online`.
- Applying pulled data is an undo barrier and isn't stamped.
- After a merge that changed anything, a toast describes it ("Kept Schedule 2
  from this device; added 3 taken courses from your account") with a link to
  History.

### UI
- No new pill in the busy header: an **account button** (avatar or initial)
  with a small status dot (synced, syncing, offline, error). Toasts only for
  failures, offline, and merges.
- The account menu has: email, "Synced just now", History, Download backup,
  Sign out, Delete my saved data.

## Testing
- **Vitest is the main coverage**, with a fake `RemoteStore` and an injected
  clock. It covers:
  - the stamp rules (load and apply don't stamp);
  - clock skew;
  - per-slot and per-course merges, tombstones and the active-slot case;
  - schema skew and unknown sections;
  - the owner and account-switch matrix;
  - conflict retry and offline;
  - history budget and thinning;
  - undo barriers;
  - backup v1/v2.
- **One Puppeteer happy path against local Supabase** (Supabase CLI + Docker,
  with the migrations in `supabase/migrations/`, and the code read from the
  local mail catcher): device A signs in and builds a schedule, device B (a
  second browser profile) signs in and sees it, then concurrent edits to
  different slots both survive.
- `npm run check`, `npm test` and `npm run build` stay clean.
