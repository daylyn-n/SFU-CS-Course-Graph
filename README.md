# SFU Prerequisite Map

Pick an SFU course and see everything you need to take first, laid out left to
right. Tick the courses you've taken and the chart shows what you can take next.

Built with Svelte 5, [Svelte Flow](https://svelteflow.dev) for the interactive
chart, and [dagre](https://github.com/dagrejs/dagre) for the layered layout.

## Run it

```sh
npm install
npm run dev
```

Link straight to a course with the URL hash, e.g. `http://localhost:5173/#CMPT-410`.

## Course data

`src/data/courses.json` is generated from SFU's public academic calendar API:

```sh
npm run fetch-data                          # courses + offerings
node scripts/fetch-courses.mjs 2027/spring cmpt macm math stat ensc
npm run fetch-offerings                     # just refresh who's teaching what
```

Prerequisites from other departments that these courses mention (e.g. ENSC 251)
are fetched too. The calendar writes prerequisites as English sentences, so
`scripts/parse-prereqs.mjs` turns them into and/or trees as best it can. The
original text is always shown in the side panel for checking.

### Offerings and instructors

`scripts/fetch-offerings.mjs` writes `src/data/offerings.json` from SFU's course
outlines API: which courses run in the current term and the following terms SFU
has already published (usually one term ahead), with each lecture section's
campus, meeting times and instructors. Courses show `Fa26`/`Sp27`-style badges
(filled = this term), and the side panel lists sections with a Rate My
Professors link per instructor. The links are RMP searches for that name at SFU
(school ID 1482), not direct profile links, because RMP has no public API.
Re-run it every so often, since instructors get assigned closer to the term.

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

## How the chart is built

- `src/lib/graph.js` walks backwards from the chosen course, turning each
  prerequisite tree into nodes and edges, then runs dagre to position them.
- Lines that go straight into a course are all required. A "one of" node means
  any one of its inputs is enough, and "all of" groups appear inside a "one of".
- To keep it readable: only a few levels show by default (`+` expands a single
  course), identical "one of" groups are merged into one node, and once you've
  taken a course, everything behind it (and the alternatives it replaces) is
  hidden.

## Deploy

`npm run build` produces a static site in `dist/` that works on GitHub Pages,
Netlify, Vercel, etc.
