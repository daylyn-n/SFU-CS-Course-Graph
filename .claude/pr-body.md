## Summary

Everything since PR #2: smarter "taken" courses, a fully reworked Degree tab for all SFU programs, a no-account safety net (undo, history, backups), optional accounts with cross-device sync, and a welcome page.

### Taken courses
- **Prerequisites fill in.** Ticking a course marks its prerequisites as taken: required ones for certain, and a best-guess route for "one of" groups, shown dashed as *assumed*. Unticking an assumed course ("I didn't take this") switches to the next route.
- **Unticking cascades.** Unticking a course also unticks what only had its prerequisites through it (120 → 125 → 225), with a toast and Undo. A course still covered another way stays ticked.

### Degree tab
- **All 368 SFU undergraduate programs.** Requirements are converted from the SFU calendar API; 74.5% are checked automatically and the rest are shown as "confirm with an advisor". The curated CS programs still take precedence.
- **Lazy loading.** Only the chosen program's file is downloaded; only its id is saved.
- **One-click ticking.** Every course row and option chip has the same tick box, and the course code opens its details.
- **Concentrations** (CS major and honours): all six Table I areas with progress (4 courses, 2 at the 400 level).
- **Grade requirements** quoted from the calendar for 259 programs. CS major: 2.40 CGPA to stay in good standing, 2.00 upper-division GPA to graduate; honours: 3.00.
- A clear "Change program" control, and a searchable program picker grouped by faculty.

### Never lose progress (no account needed)
- **One saved document.** Each edit is stamped by course, schedule slot and setting, and existing localStorage keys are reused, so no migration is needed. Open tabs stay in sync, and save failures show a banner offering a backup.
- **Undo/redo** with Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, plus toolbar and palette entries.
- **Version history** in IndexedDB, with automatic snapshots before Clear, Duplicate, Auto-arrange, imports and restores.
- **Backup v2** exports everything; v1 files still import.

### Optional accounts and sync (Supabase)
- **Sign-in** with a 6-digit email code (no passwords); Google is optional.
- **Merging** is per course, per schedule slot and per setting, so simultaneous edits on two devices both survive. Pull happens on focus and every minute, and edits are queued while offline.
- **Shared computers.** Sign-in asks before copying a device's ownerless progress into an account, and a "shared computer" sign-out wipes the device.
- **New accounts** are asked for their program once.
- **Database:** `user_state` with select-own RLS, a `save_state` RPC (compare-and-set, schema and size checks, server-side history) and `delete_my_state`. The migrations are in `supabase/migrations/`, and `supabase/schema.sql` combines them.
- **When not configured,** the app works exactly as before, with no Sign in button.

### UI and fixes
- A welcome page on the first visit (skipped for existing users and share links), with "About this site" to reopen it.
- The view tabs stay in one place on every view; the Chart/List options moved into a bar above the chart.
- Edges leave nodes at their vertical centre. A global `.source` style was hitting Svelte Flow's handles.
- The chart layout is fixed: dragging is removed.

## Before going live with accounts
1. Run `supabase/schema.sql` (or `npx supabase db push`).
2. Set up custom SMTP (e.g. Resend). Supabase's built-in sender only allows a few emails an hour.
3. Set the Magic Link and Confirm signup email templates to show the code (`{{ .Token }}`), as in `supabase/templates/otp.html`.
4. Add the site URL to Site URL and Redirect URLs.

The README has the details, and `docs/accounts-design.md` explains the saving and sync design.

## Testing
- `npm run typecheck`: 0 errors, 0 warnings. `npm test`: 338 passed (24 files). `npm run build`: OK.
- Sync against a real local Supabase (`npx vitest run --config scripts/e2e/vitest.config.ts`): 9 passed.
- Browser checks with Puppeteer:
  - two devices against local Supabase with real emailed codes: 17
  - safety net: 10
  - persistence and tabs: 10
  - untick cascade: 7
  - filled-in prerequisites: 16
  - Degree page: 12
  - welcome: 11
  - full-app walkthrough: 29

  No console errors.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
