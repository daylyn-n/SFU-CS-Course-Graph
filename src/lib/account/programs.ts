// Searching and grouping the program list for ProgramPicker. Pure, so it's tested.

export interface ProgramOption {
  id: string;
  name: string;
  faculty?: string;
}

export interface ProgramGroup {
  faculty: string;
  programs: ProgramOption[];
}

export const OTHER_FACULTY = 'Other programs';

/** Lowercase, no accents, words split on anything that isn't a letter or digit. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Little words left out of initials: "Bachelor of Science" -> "bs".
const SMALL = new Set(['of', 'and', 'in', 'the', 'with', 'for', 'a', '&']);

/**
 * How well a program matches the query: 0 = no match, higher is better.
 * Every query word must match the start of a word in the name (or faculty,
 * or id), or the name's initials ("cs" finds Computing Science).
 */
export function matchScore(p: ProgramOption, query: string): number {
  const q = words(query);
  if (!q.length) return 1;
  const name = words(p.name);
  const nameFold = fold(p.name);
  const extra = [...words(p.faculty ?? ''), ...words(p.id)];
  const initials = name.filter((w) => !SMALL.has(w)).map((w) => w[0]).join('');
  let score = 0;
  for (const w of q) {
    if (name.some((n) => n === w)) score += 4;
    else if (name.some((n) => n.startsWith(w))) score += 3;
    else if (w.length >= 2 && initials.includes(w)) score += 2;
    else if (extra.some((n) => n.startsWith(w))) score += 1;
    else if (w.length >= 3 && nameFold.includes(w)) score += 1;
    else return 0;
  }
  if (nameFold.startsWith(fold(query.trim()))) score += 3;
  return score;
}

/**
 * Programs matching `query`, grouped by faculty (groups and programs sorted
 * by name; while searching, best matches first within each group and groups
 * ordered by their best match).
 */
export function groupPrograms(programs: readonly ProgramOption[], query = ''): ProgramGroup[] {
  const searching = words(query).length > 0;
  const scored = programs
    .map((p) => ({ p, s: matchScore(p, query) }))
    .filter((x) => x.s > 0);
  const byName = (a: ProgramOption, b: ProgramOption) => a.name.localeCompare(b.name, 'en');
  const groups = new Map<string, { best: number; items: { p: ProgramOption; s: number }[] }>();
  for (const x of scored) {
    const f = x.p.faculty?.trim() || OTHER_FACULTY;
    const g = groups.get(f) ?? { best: 0, items: [] };
    g.best = Math.max(g.best, x.s);
    g.items.push(x);
    groups.set(f, g);
  }
  return [...groups.entries()]
    .sort(([fa, a], [fb, b]) => {
      if (searching && a.best !== b.best) return b.best - a.best;
      if (fa === OTHER_FACULTY) return 1;
      if (fb === OTHER_FACULTY) return -1;
      return fa.localeCompare(fb, 'en');
    })
    .map(([faculty, g]) => ({
      faculty,
      programs: g.items
        .sort((a, b) =>
          !searching ? byName(a.p, b.p) : b.s - a.s || a.p.name.length - b.p.name.length || byName(a.p, b.p),
        )
        .map((x) => x.p),
    }));
}
