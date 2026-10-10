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
  Professors links, ratings, and what the course leads to.
- **Explore**: everything you can take next, by department and term.
- **Plan**: a term-by-term plan toward the target course.
- **Degree**: progress against SFU CS program requirements.
- **Schedule**: three saved schedules, section pickers for lectures plus their
  labs/tutorials, a weekly grid with time-conflict and exam-clash detection,
  and an auto-arrange button that searches section combinations for a
  conflict-free timetable. Click a course for its description, breadth
  designation and seats. "Dock under map" shows it beneath the chart or list
  so you can build a schedule while looking at prerequisites.
- **Sharing**: share links, progress backup/restore and a PNG of the chart
  (side panel or command palette).

Taken courses, schedules and ratings (unless Supabase is set up, below) are
saved in your browser's localStorage.

## Course data

Everything comes from SFU's public sources and is saved as static JSON in
`public/data/`, which the app loads at startup (about 200 KB gzipped; the
descriptions file loads afterwards):

```sh
npm run fetch-data        # all four files below, ~12 minutes
npm run fetch-offerings   # just refresh sections and instructors, ~7 minutes
npm run fetch-seats       # just refresh seat counts (skips if SFU hasn't posted a new file)
```

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
- `seats.json` (`scripts/fetch-seats.ts`): seat counts from SFU's Course
  Section Availability Report, a daily snapshot that Institutional Research
  posts during registration. It's not live, and has no waitlists; live seats
  are only in goSFU, which needs a login, so the app links there.

Rate My Professors links are searches for the instructor's name at SFU (school
ID 1482), not direct profile links, because RMP has no public API.

## Ratings

Courses can be rated on **Easy** and **Useful**, and instructors on **Clear** and
**Engaging**, each on a 1–5 scale and shown as a percentage (1 = 0%, 3 = 50%,
5 = 100%), with an optional thumbs up/down, short written review, term and
prof/course. A prof's ratings are pooled across every course they teach. The
code lives in `src/lib/ratings/`; `aggregate.ts` does the maths and is unit
tested (`npm test`).

By default ratings are saved in the visitor's own browser (localStorage), so
each person only sees their own. To share them between everyone, connect a
free [Supabase](https://supabase.com) project:

1. Create a project, open **SQL Editor**, paste in `supabase/schema.sql` and run it.
   This makes the `ratings` table, its row-level security and three functions
   (`upsert_rating`, `delete_rating`, `my_rating_ids`).
2. In **Project Settings → API**, copy the project URL and the `anon` public key.
3. `cp .env.example .env.local` and fill in `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (set the same two variables in your host's build
   settings when deploying).
4. Restart `npm run dev` / rebuild. The side panel stops saying ratings are
   saved in this browser only.

There are no accounts. Each browser gets a random id stored in localStorage
that only the write functions ever see, so it's one rating per course or prof
per browser and nobody can edit anyone else's. Clearing site data loses the
ability to edit old ratings (they stay up). The Supabase library is only
downloaded when those variables are set.

## Code map

- `src/App.svelte`: page layout, chart, side panel
- `src/lib/graph.ts`: prerequisite logic (status, next steps) and chart layout
- `src/lib/Header.svelte`: hero header, search, view switcher
- `src/lib/fuzzy.ts` / `search.ts`: course search used everywhere
- `src/lib/schedule/`: schedule builder (`schedule.ts` is the pure logic)
- `src/lib/explore.ts`, `planner.ts`, `degree.ts`: Explore, Plan and Degree views
- `src/lib/ratings/`, `share.ts`: ratings and sharing
- `scripts/`: data fetching and the prerequisite parser

## Deploy

`npm run build` produces a static site in `dist/` that works on GitHub Pages,
Netlify, Vercel, etc.
