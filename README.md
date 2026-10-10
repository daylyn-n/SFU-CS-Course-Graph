# SFU Prerequisite Map

Pick an SFU course and see everything you need to take first, laid out left to
right. Tick the courses you've taken and the chart shows what you can take next.

Built with Svelte 5, [Svelte Flow](https://svelteflow.dev) for the interactive
chart, and [dagre](https://github.com/dagrejs/dagre) for the layered layout.

## Run it

```sh
npm install
npm run dev
npm run check      # type-check the app (npm run typecheck also checks scripts/)
```

The data scripts are TypeScript run directly by Node (>= 22.18, or 22.6+ with
`--experimental-strip-types`), so there is no build step for them.

Link straight to a course with the URL hash, e.g. `http://localhost:5173/#CMPT-410`.

## Course data

`src/data/courses.json` is generated from SFU's public academic calendar API:

```sh
npm run fetch-data                          # courses + offerings
node scripts/fetch-courses.ts 2027/spring cmpt macm math stat ensc
npm run fetch-offerings                     # just refresh who's teaching what
```

Prerequisites from other departments that these courses mention (e.g. ENSC 251)
are fetched too. The calendar writes prerequisites as English sentences, so
`scripts/parse-prereqs.ts` turns them into and/or trees as best it can. The
original text is always shown in the side panel for checking.

### Offerings and instructors

`scripts/fetch-offerings.ts` writes `src/data/offerings.json` from SFU's course
outlines API: which courses run in the current term and the following terms SFU
has already published (usually one term ahead), with each lecture section's
campus, meeting times and instructors. Courses show `Fa26`/`Sp27`-style badges
(filled = this term), and the side panel lists sections with a Rate My
Professors link per instructor. The links are RMP searches for that name at SFU
(school ID 1482), not direct profile links, because RMP has no public API.
Re-run it every so often, since instructors get assigned closer to the term.

## How the chart is built

- `src/lib/graph.ts` walks backwards from the chosen course, turning each
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
