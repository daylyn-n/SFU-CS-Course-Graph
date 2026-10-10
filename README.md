# SFU Prerequisite Map

Plan your way through SFU. Pick any course and see everything you need to take
first, laid out left to right; tick the courses you've taken and it shows what
you can take next. Then build a timetable for next term in the schedule builder.

Built with Svelte 5, [Svelte Flow](https://svelteflow.dev) for the interactive
chart, and [dagre](https://github.com/dagrejs/dagre) for the layered layout.

## Run it

```sh
npm install
npm run dev
npm test        # parser and schedule-logic tests
```

Link straight to a course with the URL hash, e.g. `http://localhost:5173/#CMPT-410`.

## What's in it

- **Prerequisite chart** (Chart / List tabs). Lines into a course are all
  required; a "one of" node means any one input is enough. Only a few levels
  show by default (`+` expands a course), and once you've taken a course,
  everything behind it and the alternatives it replaces are hidden. Hover a
  course to highlight its path.
- **Side panel**: the calendar's own prerequisite text, "Next steps" (the
  cheapest path to the target given what you've taken), when it runs, sections
  and instructors with Rate My Professors links, and what it leads to.
- **Schedule builder** (Schedule tab): three saved schedules, section pickers
  for lectures plus their labs/tutorials, a weekly grid with time-conflict and
  exam-clash detection, and an auto-arrange button that searches section
  combinations for a conflict-free timetable. Prerequisite warnings use the
  courses you've ticked as taken.

Taken courses and schedules are saved in your browser's localStorage.

## Course data

Everything comes from SFU's public APIs and is saved as static JSON in
`public/data/`, which the app loads at startup (about 200 KB gzipped):

```sh
npm run fetch-data        # both files below, ~10 minutes
npm run fetch-offerings   # just refresh sections and instructors, ~7 minutes
```

- `courses.json` (`scripts/fetch-courses.mjs`): every course in the academic
  calendar, with its prerequisite text and a parsed and/or tree. The calendar
  writes prerequisites as English sentences, so `scripts/parse-prereqs.mjs`
  turns them into trees as best it can (see `parse-prereqs.test.mjs` for the
  patterns it handles). The original text is always shown in the side panel.
- `offerings.json` (`scripts/fetch-offerings.mjs`): every section of every
  course in the current term and the following terms SFU has published
  (usually one term ahead), with meeting times, campus and instructors. Re-run
  it every so often, since instructors get assigned closer to the term.

Rate My Professors links are searches for the instructor's name at SFU (school
ID 1482), not direct profile links, because RMP has no public API.

Seat counts aren't included: SFU doesn't publish live enrolment publicly (goSFU
needs a login). Its Institutional Research office does post a daily snapshot
spreadsheet during registration, which could be added later.

## Code map

- `src/App.svelte`: page layout, chart, side panel
- `src/lib/graph.js`: prerequisite logic (status, next steps) and chart layout
- `src/lib/Header.svelte`: hero header, search, view switcher
- `src/lib/schedule/`: schedule builder (`schedule.js` is the pure logic)
- `scripts/`: data fetching and the prerequisite parser

## Deploy

`npm run build` produces a static site in `dist/` that works on GitHub Pages,
Netlify, Vercel, etc.
