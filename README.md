# SFU Prerequisite Map

Plan your way through SFU. Pick any course and see everything you need to take
first, laid out left to right; tick the courses you've taken and it shows what
you can take next. Then build a timetable for next term in the schedule builder.

Built with Svelte 5 and TypeScript, [Svelte Flow](https://svelteflow.dev) for
the interactive chart, and [dagre](https://github.com/dagrejs/dagre) for the
layered layout.

## Run it

```sh
npm install
npm run dev
npm test           # unit tests (vitest)
npm run check      # type-check the app (npm run typecheck also checks scripts/)
```

The data scripts are TypeScript run directly by Node (>= 22.18, or 22.6+ with
`--experimental-strip-types`), so there is no build step for them.

Link straight to a course with the URL hash, e.g. `http://localhost:5173/#CMPT-410`.
Share links can carry taken courses too (`#CMPT-410?taken=CMPT120,MACM101`); the
app asks before importing them. Press Cmd/Ctrl+K for the command palette.

## What's in it

- **Prerequisite chart** (Chart / List tabs). Lines into a course are all
  required; a "one of" node means any one input is enough, and dashed pills are
  non-course options like Pre-Calculus 12. Only a few levels show by default
  (`+` expands a course), and once you've taken a course, everything behind it
  and the alternatives it replaces are hidden. Hover a course to highlight its
  path.
- **Side panel**: the course's description and WQB/breadth designation, the
  calendar's own prerequisite text, "Next steps" (the cheapest path to the
  target given what you've taken), sections with seat snapshots and Rate My
  Professors links, and what the course leads to.
- **Explore**: everything you can take next, by department and term.
- **Plan**: a term-by-term plan toward the target course.
- **Degree**: progress against your program's requirements, for all 368 SFU
  undergraduate programs (majors, honours, joint majors, minors, certificates).
  Requirements that can't be checked automatically are listed to confirm with
  an advisor. Only the chosen program's data is downloaded.
- **Schedule**: three saved schedules, section pickers for lectures plus their
  labs/tutorials, a weekly grid with time-conflict and exam-clash detection,
  and an auto-arrange button that searches section combinations for a
  conflict-free timetable. Click a course for its description, breadth
  designation and seats. "Dock under map" shows it beneath the chart or list
  so you can build a schedule while looking at prerequisites.
- **Sharing**: share links, progress backup/restore and a PNG of the chart
  (side panel or command palette).

- **Ticking courses** fills in their prerequisites: required ones for certain,
  a best-guess route for "one of" groups (shown dashed as assumed; untick one
  to try another route). Unticking a course also unticks what only had its
  prerequisites through it, with Undo.
- **Never lose progress**: undo/redo (Ctrl/Cmd+Z), version history with
  automatic snapshots before anything destructive, full backups, open tabs
  kept in sync, and a warning if saving fails.

Everything is saved in this browser (localStorage, plus version history in
IndexedDB); there are no accounts. Download a backup to move to another
device. See `docs/accounts-design.md` for how saving and history work.

## Course data

Everything comes from SFU's public sources and is saved as static JSON in
`public/data/`, which the app loads at startup (about 200 KB gzipped; the
descriptions file loads afterwards):

```sh
npm run fetch-data        # all the files below, ~12 minutes
npm run fetch-offerings   # just refresh sections and instructors, ~7 minutes
npm run fetch-seats       # just refresh seat counts (skips if SFU hasn't posted a new file)
```

A GitHub Action (`.github/workflows/refresh-data.yml`) does this automatically,
opening and merging its own pull request into `main`: seats every day, sections and instructors on Mondays,
and everything on the 1st of the month. Before committing it runs
`scripts/check-data.ts`, which stops the update if a file is broken or lost a
big share of its courses or programs (SFU's APIs sometimes fail under load), and
skips files where only the timestamp changed. You can also start it by hand
from the Actions tab.

- `courses.json` (`scripts/fetch-courses.ts`): every course in the academic
  calendar, with its prerequisite text and a parsed and/or tree. The calendar
  writes prerequisites as English sentences, so `scripts/parse-prereqs.ts`
  turns them into trees as best it can (see `parse-prereqs.test.ts` for the
  patterns it handles). The original text is always shown in the side panel.
- `details.json` (`scripts/fetch-details.ts`): calendar descriptions and
  WQB/breadth designations.
- `offerings.json` (`scripts/fetch-offerings.ts`): every section of every
  course in the current term and the following terms SFU has published
  (usually one term ahead), with meeting times, campus and instructors. Re-run
  it every so often, since instructors get assigned closer to the term.
- `programs/` (`scripts/fetch-programs.ts`): every undergraduate program's
  requirements, one small file each, plus an index for the picker.
- `seats.json` (`scripts/fetch-seats.ts`): seat counts from SFU's Course
  Section Availability Report, a daily snapshot that Institutional Research
  posts during registration. It's not live, and has no waitlists; live seats
  are only in goSFU, which needs a login, so the app links there.

Rate My Professors links are searches for the instructor's name at SFU (school
ID 1482), not direct profile links, because RMP has no public API.

## Code map

- `src/App.svelte`: page layout, chart, side panel
- `src/lib/graph.ts`: prerequisite logic (status, next steps) and chart layout
- `src/lib/Header.svelte`: hero header, search, view switcher
- `src/lib/fuzzy.ts` / `search.ts`: course search used everywhere
- `src/lib/schedule/`: schedule builder (`schedule.ts` is the pure logic)
- `src/lib/explore.ts`, `planner.ts`, `degree.ts`: Explore, Plan and Degree views
- `src/lib/programs/`: converting and lazy-loading SFU program requirements,
  and the program picker
- `src/lib/implied.ts`: filling in and unticking prerequisites
- `src/lib/persist/`: the saved document, history, undo, autosnapshots
- `src/lib/share.ts`: share links
- `scripts/`: data fetching and the prerequisite parser

## Deploy

`npm run build` produces a static site in `dist/` that works on any static
host. It's deployed on Cloudflare (Workers static assets, `wrangler.jsonc`) with
build command `npm run build` and deploy command `npx wrangler deploy`; every
merge to `main`, including the automatic data refreshes, redeploys it.

## Archived features

In-site ratings (courses and profs) and accounts with email sign-in and
cross-device sync (via Supabase) were removed to keep the site fully static;
Rate My Professors links cover ratings. The last version with them is kept at
the tag `archive-accounts-ratings` (also the branch
`archive/accounts-and-ratings`), including the Supabase schema, the sync
engine and their tests. To bring them back:

```sh
git checkout archive-accounts-ratings -- src/lib/account src/lib/sync src/lib/ratings supabase scripts/e2e .env.example
npm install @supabase/supabase-js
```

then re-wire them in `src/main.ts`, `src/App.svelte`, `Header.svelte` and
`Welcome.svelte` (compare with `git diff archive-accounts-ratings -- src`).
The saved data still has an `owner` field, so nothing needs migrating.
