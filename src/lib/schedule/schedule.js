// Pure schedule logic: time parsing, section picking, conflict detection,
// auto-arrange and saved-state validation. No Svelte here, so it's testable.

export const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export const DAY_NAMES = {
  Mo: 'Monday',
  Tu: 'Tuesday',
  We: 'Wednesday',
  Th: 'Thursday',
  Fr: 'Friday',
  Sa: 'Saturday',
  Su: 'Sunday',
};
export const SLOT_COUNT = 3;
const EARLY = 9 * 60 + 30; // blocks starting before 9:30 count as early
const LATE = 17 * 60 + 30; // ...and ending after 17:30 as late

/** '8:30' or '08:30' to minutes after midnight; null if malformed. */
export function toMin(t) {
  const m = typeof t === 'string' && t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 24 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

/** Minutes to '8:30'. */
export const fmtMin = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

/** Two meetings clash if they share a day and overlap; touching end/start is fine. */
export const overlaps = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;

/** Fallback for data without `blocks`: parse "Mo, We 8:30–10:20, Fr 9:30–10:20". */
export function parseSchedule(text) {
  if (typeof text !== 'string') return [];
  const re = /((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)[,\s]*)+)(\d{1,2}:\d\d)\s*[–-]\s*(\d{1,2}:\d\d)/g;
  return [...text.matchAll(re)].map((m) => ({
    days: m[1].match(/Mo|Tu|We|Th|Fr|Sa|Su/g),
    start: m[2],
    end: m[3],
  }));
}

/** A section's weekly meetings as [{ day, start, end, campus }] (minutes). */
export function meetings(section) {
  const out = [];
  const blocks = Array.isArray(section?.blocks) ? section.blocks : parseSchedule(section?.schedule);
  for (const b of blocks) {
    const start = toMin(b?.start);
    const end = toMin(b?.end);
    if (start == null || end == null || end <= start) continue;
    const days = Array.isArray(b.days) ? b.days : typeof b.days === 'string' ? b.days.split(/[,\s]+/) : [];
    for (const day of days) {
      if (!DAYS.includes(day) || out.some((m) => m.day === day && m.start === start && m.end === end)) continue;
      out.push({ day, start, end, campus: b.campus || section.campus || '' });
    }
  }
  return out;
}

export const isEnrol = (s) => s?.enrol !== false;
export const typeOf = (s) => s?.type || (isEnrol(s) ? 'LEC' : 'SEC');
const assocOf = (s) => String(s?.assoc ?? '');
const validSections = (sections) =>
  Array.isArray(sections) ? sections.filter((s) => s && typeof s.section === 'string') : [];

/** Sections you enrol in directly (lectures, seminars, online classes). */
export const enrolOptions = (sections) => validSections(sections).filter(isEnrol);

/**
 * The extra pieces to pick once `enrolSec` is chosen: one group per type of
 * non-enrolment section with the same `assoc` (required). Non-enrolment
 * sections whose assoc matches no enrolment section are offered too, as
 * optional groups. Group keys are the type ('LAB'), suffixed if it would
 * collide with the enrolment section's own type.
 */
export function componentGroups(sections, enrolSec) {
  const list = validSections(sections);
  const enrolAssocs = new Set(list.filter(isEnrol).map(assocOf));
  const used = new Set(enrolSec ? [typeOf(enrolSec)] : []);
  const groups = [];
  const add = (s, required) => {
    const type = typeOf(s);
    let g = groups.find((g) => g.type === type && g.required === required);
    if (!g) {
      let key = type;
      for (let i = 2; used.has(key); i++) key = `${type}-${i}`;
      used.add(key);
      groups.push((g = { key, type, required, options: [] }));
    }
    g.options.push(s);
  };
  for (const s of list) {
    if (isEnrol(s)) continue;
    if (enrolSec && assocOf(s) === assocOf(enrolSec)) add(s, true);
    else if (!enrolAssocs.has(assocOf(s))) add(s, false);
  }
  // Required groups first, so pickers read "LEC, then LAB".
  return groups.sort((a, b) => b.required - a.required);
}

/**
 * Resolve saved picks ({ LEC: 'D100', LAB: 'D103' }) against a term's sections.
 * Picks naming sections that don't exist are ignored.
 */
export function resolvePicks(sections, picks = {}) {
  const enrol = enrolOptions(sections).find((s) => picks[typeOf(s)] === s.section) ?? null;
  const groups = componentGroups(sections, enrol).map((g) => ({
    ...g,
    pick: g.options.find((o) => o.section === picks[g.key]) ?? null,
  }));
  const chosen = [enrol, ...groups.map((g) => g.pick)].filter(Boolean);
  const complete = !!enrol && groups.every((g) => !g.required || g.pick);
  return { enrol, groups, chosen, complete };
}

/** Picks object for an enrolment section plus component sections. */
export function picksFor(enrolSec, groupPicks = {}) {
  const picks = enrolSec ? { [typeOf(enrolSec)]: enrolSec.section } : {};
  for (const [k, v] of Object.entries(groupPicks)) if (v) picks[k] = v;
  return picks;
}

/**
 * Every pair of overlapping meetings among the picked sections.
 * entries: [{ code, section }]. Returns [{ a, b, day, start, end }] where
 * start/end is the overlapping stretch.
 */
export function findConflicts(entries) {
  const all = [];
  entries.forEach((e, i) => meetings(e.section).forEach((m) => all.push({ ...m, i })));
  const out = [];
  for (let x = 0; x < all.length; x++) {
    for (let y = x + 1; y < all.length; y++) {
      const p = all[x];
      const q = all[y];
      if (p.i === q.i || !overlaps(p, q)) continue;
      out.push({
        a: entries[p.i],
        b: entries[q.i],
        day: p.day,
        start: Math.max(p.start, q.start),
        end: Math.min(p.end, q.end),
      });
    }
  }
  return out.sort((p, q) => DAYS.indexOf(p.day) - DAYS.indexOf(q.day) || p.start - q.start);
}

/** Final exams on the same date with overlapping times, one exam per course. */
export function examClashes(entries) {
  const exams = [];
  for (const e of entries) {
    const x = e.section?.exam;
    const start = toMin(x?.start);
    const end = toMin(x?.end);
    if (!x?.date || start == null || end == null || exams.some((o) => o.code === e.code)) continue;
    exams.push({ code: e.code, date: x.date, start, end });
  }
  const out = [];
  for (let i = 0; i < exams.length; i++) {
    for (let j = i + 1; j < exams.length; j++) {
      const p = exams[i];
      const q = exams[j];
      if (p.date === q.date && p.start < q.end && q.start < p.end) {
        out.push({ a: p.code, b: q.code, date: p.date, start: Math.max(p.start, q.start), end: Math.min(p.end, q.end) });
      }
    }
  }
  return out;
}

/**
 * Lay out one day's events in side-by-side columns. Each event gets `col`,
 * `cols` (columns in its overlapping cluster) and `conflict`.
 */
export function layoutDay(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let colEnds = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const ev of cluster) ev.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const ev of sorted) {
    if (ev.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= ev.start);
    if (col === -1) col = colEnds.push(0) - 1;
    colEnds[col] = ev.end;
    const placed = { ...ev, col, cols: 1, conflict: false };
    cluster.push(placed);
    out.push(placed);
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  flush();
  for (const a of out) a.conflict = out.some((b) => a !== b && a.start < b.end && b.start < a.end);
  return out;
}

/** Days and hours the grid should show: Mo–Fr (plus weekend if used), 8–18 or wider. */
export function gridRange(all) {
  let from = 8 * 60;
  let to = 18 * 60;
  for (const m of all) {
    from = Math.min(from, Math.floor(m.start / 60) * 60);
    to = Math.max(to, Math.ceil(m.end / 60) * 60);
  }
  const days = DAYS.filter((d, i) => i < 5 || all.some((m) => m.day === d));
  return { days, from, to };
}

const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/**
 * Search section combinations for the best schedule: fewest clashing
 * meetings, then fewest changes to current picks, then fewest early/late
 * meetings, then fewest days on campus. Branch and bound over each course's
 * enrolment section and then its component groups; every cost only grows as
 * sections are added, so a partial score at least as bad as the best complete
 * one prunes the branch.
 *
 * items: [{ code, sections, picks, fixed? }]. Fixed items keep their picks
 * when those are valid. Returns { picks: [...per item], conflicts, changes,
 * early, days, exhaustive } where `exhaustive` is false if `maxNodes` ran out.
 */
export function arrange(items, { maxNodes = 200000 } = {}) {
  const cache = new Map();
  const mt = (s) => {
    if (!s) return [];
    let m = cache.get(s);
    if (!m) cache.set(s, (m = meetings(s)));
    return m;
  };
  const placed = [];
  const dayCount = Object.fromEntries(DAYS.map((d) => [d, 0]));
  const cur = [0, 0, 0, 0]; // conflicts, changes, early/late, days
  const choice = items.map((it) => ({ ...(it.picks ?? {}) }));
  let best = null;
  let nodes = 0;
  let exhaustive = true;

  const cost = (s) => {
    let c = 0;
    let e = 0;
    const fresh = new Set();
    for (const m of mt(s)) {
      for (const p of placed) if (overlaps(m, p)) c++;
      if (m.start < EARLY || m.end > LATE) e++;
      if (!dayCount[m.day]) fresh.add(m.day);
    }
    return [c, e, fresh.size];
  };

  // Fixed courses first (no branching), then those with fewest choices.
  const isFixed = (x) => Number(!!x.it.fixed && x.current.complete);
  const order = items
    .map((it, i) => ({ it, i, enrol: enrolOptions(it.sections), current: resolvePicks(it.sections, it.picks ?? {}) }))
    .filter((x) => x.enrol.length)
    .sort((a, b) => isFixed(b) - isFixed(a) || a.enrol.length - b.enrol.length);

  // Try each option for one variable, cheapest first, recursing via `next`.
  function tryOptions(opts, current, fixed, apply, next) {
    if (fixed && current !== undefined && opts.includes(current)) opts = [current];
    const scored = opts.map((s) => ({ s, c: cost(s), same: s === current }));
    scored.sort((a, b) => a.c[0] - b.c[0] || b.same - a.same || a.c[1] - b.c[1] || a.c[2] - b.c[2]);
    for (const { s, c, same } of scored) {
      if (++nodes > maxNodes) {
        exhaustive = false;
        if (best) return;
      }
      const changed = current !== undefined && !same ? 1 : 0;
      cur[0] += c[0];
      cur[1] += changed;
      cur[2] += c[1];
      cur[3] += c[2];
      if (!best || cmp(cur, best.score) < 0) {
        const ms = mt(s);
        for (const m of ms) {
          placed.push(m);
          dayCount[m.day]++;
        }
        apply(s);
        next(s);
        for (const m of ms) {
          placed.pop();
          dayCount[m.day]--;
        }
      }
      cur[0] -= c[0];
      cur[1] -= changed;
      cur[2] -= c[1];
      cur[3] -= c[2];
      if (!exhaustive && best) return;
    }
  }

  function course(k) {
    if (k === order.length) {
      best = { score: [...cur], picks: choice.map((c) => ({ ...c })) };
      return;
    }
    const { it, i, enrol, current } = order[k];
    const fixed = isFixed(order[k]);
    tryOptions(
      enrol,
      current.enrol ?? undefined,
      fixed,
      (s) => (choice[i] = { [typeOf(s)]: s.section }),
      (s) => groups(k, componentGroups(it.sections, s), 0),
    );
  }

  function groups(k, gs, j) {
    if (j === gs.length) return course(k + 1);
    const { it, i } = order[k];
    const g = gs[j];
    const prev = g.options.find((o) => o.section === it.picks?.[g.key]);
    const opts = g.required ? g.options : [null, ...g.options];
    // An optional group with nothing picked counts "none" as the current pick.
    const current = prev ?? (g.required ? undefined : null);
    tryOptions(
      opts,
      current,
      it.fixed,
      (s) => {
        if (s) choice[i][g.key] = s.section;
        else delete choice[i][g.key];
      },
      () => groups(k, gs, j + 1),
    );
  }

  course(0);
  const [conflicts, changes, early, days] = best.score;
  return { picks: best.picks, conflicts, changes, early, days, exhaustive };
}

/**
 * Which term a newly added course should go in. Stays in the slot's term if
 * the course runs then; otherwise switches if some term runs this course and
 * every course already in the slot. Returns { term, switched?, elsewhere?, offered }.
 */
export function termForAdd(code, slot, terms, offerings) {
  const has = (c, t) => !!offerings?.[c]?.[t]?.length;
  const current = slot.term ?? terms.find((t) => t.current)?.id ?? terms[0]?.id ?? null;
  if (has(code, current)) return { term: current, offered: true };
  const options = terms.filter((t) => has(code, t.id));
  if (!options.length) return { term: current, offered: false };
  const fits = (t) => slot.courses.filter((c) => c.code !== code && has(c.code, t.id)).length;
  const best = options.reduce((a, b) => (fits(b) > fits(a) ? b : a));
  const others = slot.courses.filter((c) => c.code !== code).length;
  if (fits(best) === others) return { term: best.id, switched: true, offered: true };
  return { term: current, elsewhere: best.id, offered: true };
}

export const emptySlot = (i) => ({ name: `Schedule ${i + 1}`, term: null, courses: [] });

/** Coerce whatever was in localStorage into a valid state; never throws. */
export function validateState(raw) {
  const out = { active: 0, slots: Array.from({ length: SLOT_COUNT }, (_, i) => emptySlot(i)) };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (Number.isInteger(raw.active) && raw.active >= 0 && raw.active < SLOT_COUNT) out.active = raw.active;
  if (!Array.isArray(raw.slots)) return out;
  raw.slots.slice(0, SLOT_COUNT).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const slot = out.slots[i];
    if (typeof s.name === 'string' && s.name.trim()) slot.name = s.name.trim().slice(0, 40);
    if (typeof s.term === 'string') slot.term = s.term;
    if (!Array.isArray(s.courses)) return;
    for (const c of s.courses) {
      if (!c || typeof c.code !== 'string' || slot.courses.some((x) => x.code === c.code)) continue;
      const picks = {};
      if (c.picks && typeof c.picks === 'object' && !Array.isArray(c.picks)) {
        for (const [k, v] of Object.entries(c.picks)) if (typeof v === 'string') picks[k] = v;
      }
      slot.courses.push({ code: c.code, picks });
      if (slot.courses.length >= 30) break;
    }
  });
  return out;
}

/** Parse the saved JSON string; a corrupt value gives the empty state. */
export function parseState(text) {
  try {
    return validateState(JSON.parse(text));
  } catch {
    return validateState(null);
  }
}
