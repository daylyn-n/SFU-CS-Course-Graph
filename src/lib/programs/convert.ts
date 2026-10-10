// Converts a program from SFU's academic calendar API into the degree model
// (`Program` in ../degree.ts). Pure, so it's unit tested against saved API
// responses, and used by scripts/fetch-programs.ts.
//
// The calendar gives each section as a flat list of items: prose
// ({description: '<html>'}) and courses ({value: 'cmpt/120'}). Most lists are
// introduced by a phrase ("Students complete all of", "and one of", "and at
// least 12 units from", ...), and the courses after it belong to that phrase
// until the next description. Anything we can't read confidently becomes a
// `note` requirement (shown as "check with an advisor") with its text kept:
// requirement text is never dropped.
//
// Only type imports here (with .ts extensions), so Node can run this file
// directly from the fetch script.

import type { CourseSet, Program, Requirement, RequirementSection } from '../degree.ts';

/** One item in the calendar API's `requirements` tree. */
export interface RawItem {
  title?: string;
  description?: string;
  courseTitle?: string;
  value?: string;
  requirements?: RawItem[] | null;
}

/** The calendar API's program object (only the fields we use). */
export interface RawProgram {
  title?: string;
  fullTitle?: string;
  awardType?: string;
  credential?: string;
  degreeLevel?: string;
  faculties?: { title?: string }[];
  departments?: { title?: string }[];
  requirements?: RawItem[] | null;
}

export interface ConvertOptions {
  /** Program id (filename-safe), e.g. 'biological-sciences~major~bachelor-of-science'. */
  id: string;
  /** Calendar URL of the program page. */
  source: string;
  /** e.g. 'Fall 2026' */
  calendar: string;
  /** Subject code -> name ('HIST' -> 'History'), to read "history courses". */
  depts?: Record<string, string>;
}

/** How much of the calendar text was understood, for the fetch report. */
export interface ConvertStats {
  /** Requirement-bearing descriptions and courses that became checkable requirements. */
  understood: number;
  /** ...and those left as manual (advisor) items. */
  manual: number;
}

export const CONVERTED_CAVEAT = 'Converted automatically from the calendar; confirm with an advisor.';

// ---------------------------------------------------------------- text helpers

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', dagger: '†' };

/** HTML to plain text: tags removed, entities decoded, whitespace collapsed. */
export function cleanHtml(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/tr|\/h\d)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'cmpt/105w' -> 'CMPT 105W'; null when it isn't a plain course value. */
export function courseCode(value: string | undefined): string | null {
  const m = /^([a-z]{2,5})\/(\d{3}[a-z]?)$/i.exec((value ?? '').trim());
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, 'twenty-one': 21, 'twenty-four': 24, thirty: 30,
};
const NUM = String.raw`(\d{1,3}|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})`;
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s.toLowerCase()]);

/** Lowercase, footnote marks removed, whitespace tidied. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*†‡+]+/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sentences(text: string): string[] {
  // Split after ". " when the next word starts a new sentence; keeps "e.g." etc. together.
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(*])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------- subjects and divisions

interface SubjectMatcher {
  codes: Set<string>;
  names: { re: RegExp; code: string }[];
}

const SUBJECT_ALIASES: Record<string, string> = {
  business: 'BUS',
  'business administration': 'BUS',
  sociology: 'SA',
  anthropology: 'SA',
  'sociology and anthropology': 'SA',
  'political science': 'POL',
  'global humanities': 'HUM',
  'computing science': 'CMPT',
  'environmental science': 'EVSC',
  'health sciences': 'HSCI',
  'health science': 'HSCI',
  'international studies': 'IS',
  'world literature': 'WL',
  'gender, sexuality, and women\'s studies': 'GSWS',
  'labour studies': 'LBST',
  criminology: 'CRIM',
  kinesiology: 'BPK',
};

function subjectMatcher(depts: Record<string, string> = {}): SubjectMatcher {
  const pairs: [string, string][] = [
    ...Object.entries(depts).map(([code, name]) => [name.toLowerCase(), code] as [string, string]),
    ...Object.entries(SUBJECT_ALIASES),
  ];
  // Longest names first so "computing science" wins over "science".
  pairs.sort((a, b) => b[0].length - a[0].length);
  const generic = new Set(['science', 'language', 'graduate', 'education', 'environment']);
  return {
    codes: new Set(Object.keys(depts)),
    names: pairs
      .filter(([name]) => name.length > 2 && !generic.has(name))
      .map(([name, code]) => ({ re: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), code })),
  };
}

/** Pull subject names/codes and division phrases out of a phrase. */
function extractScope(
  text: string,
  subjects: SubjectMatcher,
): { rest: string; subjects: string[]; from?: number; to?: number } {
  // Works on original-case text: subject codes only count in capitals ("SA", not "sa").
  let t = ` ${text} `;
  const found: string[] = [];
  let from: number | undefined;
  let to: number | undefined;
  const div = (re: RegExp, f: (m: RegExpExecArray) => [number, number]) => {
    if (from !== undefined) return;
    const m = re.exec(t);
    if (!m) return;
    [from, to] = f(m);
    t = t.replace(m[0], ' xdivx ');
  };
  div(/\b([1-4])00[- ]?(?:and|or|&|to)[- ]?([1-4])00[- ]?(?:division|level)\b/i, (m) => [Number(m[1]) * 100, Number(m[2]) * 100 + 99]);
  div(/\b(?:upper[- ]division|upper[- ]level)\b/i, () => [300, 499]);
  div(/\b(?:lower[- ]division|lower[- ]level)\b/i, () => [100, 299]);
  div(/\b([1-4])00[- ]?(?:division|level)\b(?: \(or above\))?/i, (m) => [Number(m[1]) * 100, Number(m[1]) * 100 + 99]);
  for (const { re, code } of subjects.names) {
    const before = t;
    t = t.replace(re, ' xsubjx ');
    if (t !== before && !found.includes(code)) found.push(code);
  }
  t = t.replace(/\b([A-Z]{2,5})(?:-Writing)?\b/g, (m, code: string) => {
    if (!subjects.codes.has(code)) return m;
    if (!found.includes(code)) found.push(code);
    return ' xsubjx ';
  });
  return { rest: t.replace(/\s+/g, ' ').trim(), subjects: found, from, to };
}

// --------------------------------------------------------------- phrase reading

/** What an intro phrase asks of the courses listed after it. */
export type Quant =
  | { mode: 'all' }
  | { mode: 'one' }
  | { mode: 'courses'; n: number }
  | { mode: 'units'; n: number }
  | { mode: 'unknown' };

/** Words that are allowed around a quantifier without changing its meaning. */
const FILLER = new Set(
  `students student all honours approved minor who choose chooses this stream concentration option discipline program will must
   may also complete completes completing take takes taking choose select selected chosen pick a an the minimum of at least
   additional further more other from following list lists courses course units unit credits credit in and or plus to
   any which be below above as follows listed shown core required requirements requirement these qualify for by
   group groups electives elective techniques organismal applied stream of: exactly remaining SUBJ DIV level division
   total either both one is are need needs needed set table tables both: following: list: courses: below: complete: xsubjx xdivx and/or`.split(/\s+/),
);

/** Phrases that mean the list isn't a plain requirement (examples, limits, recommendations...). */
const NOT_A_REQUIREMENT =
  /\b(no more than|maximum|may be used|may also|may be counted|recommended|suggested|such as|for example|e\.g\.|omit|permitted|appropriate|if not counted|counted in one of|instead of|equivalent number|exempt|cannot be substituted|may include)\b/;

/** Extra conditions we don't check but must show (e.g. "(one must be at the 400-level)"). */
const EXTRA_CONDITION =
  /\b(of which|must be (at|from|in)|at least (one|two|three|four|\d+) (course|courses|units?) (must|from|in|at)|with at least|excluding|outside|with a (minimum )?(c|b)|grade|gpa|cgpa|taken in|in a single term|consecutive terms|different subjects|must have)\b/;

/**
 * Read an intro phrase ("and at least two of", "Students complete 12 units
 * from", "Marketing Analytics (choose at least one)") into a quantifier.
 * `extra` is true when it also states a condition we can't check.
 */
export function readQuantifier(text: string, subjects?: SubjectMatcher): { quant: Quant; extra: boolean } {
  let t = norm(subjects ? extractScope(text, subjects).rest : text)
    .replace(/\([^)]*\)/g, (m) => (/\bchoose\b/.test(m) ? m.slice(1, -1) : ` ${m} `))
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parenthetical = /\([^)]*\)/.exec(t)?.[0] ?? '';
  t = t.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  // "The following core courses are required for ...".
  if (/^the following [\w\s]{0,30}\b(courses|course) (are|is) required\b/.test(t)) return { quant: { mode: 'all' }, extra: false };
  if (NOT_A_REQUIREMENT.test(t)) return { quant: { mode: 'unknown' }, extra: false };
  const extra = EXTRA_CONDITION.test(t) || EXTRA_CONDITION.test(parenthetical) || /\d00/.test(parenthetical);
  const core = t.replace(EXTRA_CONDITION_TAIL, '').trim();

  const words = core.replace(/[.:]$/, '').split(' ').filter(Boolean);
  const nums = [...core.matchAll(new RegExp(`\\b${NUM}\\b`, 'g'))]
    .map((m) => ({ n: toNum(m[1]), at: m.index }))
    .filter((x) => x.n !== undefined);
  // Every other word must be filler, or we don't trust our reading.
  const unknownWords = words.filter((w) => !FILLER.has(w) && toNum(w) === undefined && !/^\d+$/.test(w));
  if (unknownWords.length > 1) return { quant: { mode: 'unknown' }, extra };

  if (nums.length > 1) return { quant: { mode: 'unknown' }, extra };
  // "all of the following, with a minimum of 22 units": two rules at once.
  if (nums.length === 1 && /\b(all|both) of\b|\ball the\b/.test(core)) return { quant: { mode: 'unknown' }, extra };
  if (nums.length === 1) {
    const { n, at } = nums[0];
    const after = core.slice(at);
    if (/^\S+ (?:(?:additional|further|more|other|xsubjx|xdivx|or|of|these|the)\s+){0,4}(units?|credits?)\b/.test(after)) {
      return { quant: { mode: 'units', n }, extra };
    }
    // "one of" and "one course from" are the same thing.
    return { quant: n === 1 ? { mode: 'one' } : { mode: 'courses', n }, extra };
  }
  if (/\beither\b/.test(core) && !/\bboth\b|\ball\b/.test(core)) return { quant: { mode: 'one' }, extra };
  return { quant: { mode: 'all' }, extra };
}
// Trailing qualifiers dropped before the filler check (they're reported via `extra`).
const EXTRA_CONDITION_TAIL = /\b(of which|with at least|excluding|outside|with a (minimum )?(c|b)).*$/;

/**
 * A standalone sentence that is itself a requirement: "Students complete 18
 * units of 100 and 200 division history courses", "and an additional 26 upper
 * division PSYC units", "Students complete 120 units".
 */
export function readUnitsSentence(
  text: string,
  subjects: SubjectMatcher,
): { units?: number; courses?: number; set: CourseSet; additional: boolean } | null {
  const scope = extractScope(text.replace(/\([^)]*\)/g, ' '), subjects);
  const t = norm(scope.rest).replace(/[,;]/g, ' ').replace(/\s+/g, ' ').replace(/[.:]$/, '').trim();
  if (NOT_A_REQUIREMENT.test(t) || EXTRA_CONDITION.test(t)) return null;
  const nums = [...t.matchAll(new RegExp(`\\b${NUM}\\b`, 'g'))].filter((m) => toNum(m[1]) !== undefined);
  if (nums.length !== 1) return null;
  const n = toNum(nums[0][1]);
  const after = t.slice(nums[0].index! + nums[0][0].length);
  const isUnits = /^ (?:(?:additional|further|more|other|xsubjx|xdivx|or|of|these|the)\s+){0,4}(units?|credits?)\b/.test(after);
  const isCourses = /^ (?:(?:additional|further|more|other|xsubjx|xdivx|or)\s+){0,4}courses?\b/.test(after);
  if (!isUnits && !isCourses) return null;
  const words = t.split(' ').filter(Boolean);
  if (words.some((w) => !FILLER.has(w) && toNum(w) === undefined && !['specified', 'program', 'as', 'below'].includes(w))) return null;
  // Without a subject it must be a degree-sized unit total ("45 upper division
  // units"); "nine lower division units" in a history minor means history.
  if (!scope.subjects.length && !(isUnits && n >= (scope.from === undefined ? 60 : 30))) return null;
  const subjectsList = scope.subjects.length ? scope.subjects : ['*'];
  const set: CourseSet = { ranges: [{ subjects: subjectsList, from: scope.from ?? 100, to: scope.to ?? 499 }] };
  return {
    ...(isUnits ? { units: n } : { courses: n }),
    set,
    additional: /\b(additional|further|more|other|remaining)\b/.test(t),
  };
}

/** Intro clauses like "..., including" / "which must include": split off the prefix. */
const INCLUDING = /^(.*?)(?:,?\s*(?:which|these units|these courses)?\s*(?:must )?(?:include|includes|including))\b(.*)$/i;

const ADMIN_TITLE =
  /continu|graduation|grade|gpa|admission|declar|residency|transfer credit|letters? of permission|co-?op|work experience|work term|writing, quantitative|wqb|university (honours )?degree requirements|faculty of .* (degree|honours|co-operative)|prerequisite|enrol+ment|course access|course information|course offerings|academic continuance|accelerated master|exchange credit|prior approval|non-completion|intending to specialize/i;
/** University/faculty-wide rules, never program requirements. */
const DEGREE_LEVEL_TITLE =
  /residency|transfer credit|writing, quantitative|wqb|university (honours )?degree requirements|faculty of .* (degree|honours|co-operative)|co-?op|work experience|work term/i;
const STATES_REQUIREMENT = new RegExp(
  `\\bstudents (must )?(also )?complete (a minimum of |at least |a total of )?${NUM} (additional )?(upper|lower|units|courses|[1-4]00)`,
  'i',
);
/** Sections that are only about admission/declaration: their courses don't count toward the program. */
const ENTRY_TITLE = /admission|declar|prerequisite|enrol+ment|course access|prior approval/i;

/** Informational prose: shown as a section note, not as something to confirm. */
const INFO =
  /^(note|please|for more information|see |to view|\(see)|\b(strongly )?(advised|encouraged|recommended|recommend|suggested|optional|may wish|are reminded|for further information|for information|click here|interdisciplinary|should|urged|eligible|enrol+|enrol+ment|application|apply|waived|vary|varies|contact|repeated|transcript|prior application|approval|permission|substitut\w*|consult)\b/i;
/** Limits and conditions that do affect completion, even if phrased like advice. */
const CONSTRAINT = /\b(no more than|maximum|may not|cannot be used|not be used|must be completed at|must|required to graduate|will not be able to graduate)\b/i;
const REQUIREMENT_LIKE =
  /\b(must|complete|completes|completing|required|requires|minimum|at least|no more than|maximum|may not|have to|need to|qualify|maintain)\b/i;
const COUNTED = new RegExp(`^(and|plus|or)\\b|\\b${NUM} (additional |further |more |other )?([\\w-]+ ){0,4}(units|courses)\\b`, 'i');
const isInfo = (s: string) =>
  /^\W*note\b|accelerated master/i.test(s) ||
  /^(all )?(students )?(must |will )?(also )?(complete|take)[:.]?$/i.test(s) ||
  (/\b(listed below|as follows|the following)[.:]?$/i.test(s) && !COUNTED.test(s)) ||
  !REQUIREMENT_LIKE.test(s) ||
  (INFO.test(s) && !COUNTED.test(s) && !CONSTRAINT.test(s.replace(/students (should|must) (see|consult|contact)/i, '')));

const isHeading = (text: string) =>
  text.length <= 90 &&
  !/[.:]$/.test(text) &&
  text.split(' ').length <= 10 &&
  !/\b(students?|complete|must|will|choose|following)\b/i.test(text);

// ------------------------------------------------------------------ conversion

/** One "entry" in a list: alternatives (OR) of bundles (AND). Plain course: [[code]]. */
type Entry = string[][];

interface Block {
  /** Description that introduced the list, or the sub-heading above it ('' if none). */
  intro: string;
  quant: Quant;
  /** The intro states a condition we can't check, shown as a manual item. */
  extra: boolean;
  /** Intro starts with "or": an alternative to the previous list. */
  or: boolean;
  /** "Students complete 30 units, including ...": the part before "including". */
  prefix?: string;
  labels: string[];
  entries: Entry[];
  emitted: Requirement[];
}

/** Read consecutive course items into entries, joining "X (or) Y" and "X (and) Y". */
function readEntries(items: RawItem[], i: number, entries: Entry[], bad: (t: string) => void): number {
  let join: 'or' | 'and' | null = null;
  for (; i < items.length && items[i].description === undefined; i++) {
    const it = items[i];
    const code = courseCode(it.value);
    if (!code) {
      bad(cleanHtml(it.courseTitle || it.value || ''));
      join = null;
      continue;
    }
    const last = entries[entries.length - 1];
    if (join === 'or' && last) last.push([code]);
    else if (join === 'and' && last) for (const opt of last) opt.push(code);
    else entries.push([[code]]);
    const link = (it.title ?? '').trim().toLowerCase();
    join = link === 'or' ? 'or' : link === 'and' ? 'and' : null;
  }
  return i;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const listTitle = (codes: string[], max = 4) =>
  codes.length <= max ? codes.join(', ') : `${codes.slice(0, max - 1).join(', ')} and ${codes.length - max + 1} more`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const tidy = (s: string) => capitalize(s.trim().replace(/^(and|plus|or)\s+/i, '').replace(/[*†‡^]+/g, '').replace(/[\s,:.;]+$/, ''));

// Streams and concentrations: alternative sections, of which the student completes one.
const OWN_CHOICE =
  /\b(who choose|choosing|students in) (this|the [\w\s-]{1,40}?) (stream|concentration|option|discipline)\b|\bfor this (concentration|stream|option)\b|\bqualify for this concentration\b/i;
const ANNOUNCES_CHOICE =
  /\b(one|one or two|two|one or more) of the following (areas of concentration|concentrations|streams|options)\b|\bchoose (one|a) (stream|concentration|option)\b|\b(declare|select|choose) (one|a) (stream|concentration|option)\b/i;
const OPTIONAL_CHOICE =
  /\b(concentrations?|streams?) (is|are) optional\b|\boptional (concentration|stream)s?\b|\boption of taking (a )?concentrations?\b|\bcompleting a concentration is optional\b|\bmay (choose to )?complete (one or more|a) [\w\s]{0,20}concentrations?\b/i;

const hasQuantWord = (s: string) => new RegExp(`\\b(choose|all|both|either|${NUM})\\b`, 'i').test(s);

/** Convert one calendar program. Returns the program and coverage counts. */
export function convertProgram(raw: RawProgram, opts: ConvertOptions): { program: Program; stats: ConvertStats } {
  const subjects = subjectMatcher(opts.depts);
  const sections: RequirementSection[] = [];
  let seq = 0;
  let group: NonNullable<RequirementSection['choice']> | undefined;
  let announced: string | undefined; // label of an announced choice ("concentration")
  let optional = false;
  // GPA rules ("at least a 2.40 CGPA"), quoted from wherever they appear.
  const grades: { label: string; text: string }[] = [];

  for (const [si, rs] of (raw.requirements ?? []).entries()) {
    if (!rs) continue;
    const title = cleanHtml(rs.title ?? '');
    const items = flatten([...(rs.description ? [{ description: rs.description }] : []), ...(rs.requirements ?? [])]);
    if (!items.length) continue;
    const hasCourses = items.some((it) => it.description === undefined);
    const text = items.map((it) => (it.description ? cleanHtml(it.description) : '')).join(' ');
    for (const sentence of text.split(/(?<=\.)\s+/)) {
      if (/\b(c?gpa|grade point average)\b/i.test(sentence) && grades.length < 6 && !grades.some((g) => g.text === sentence)) {
        grades.push({ label: title || 'Grades', text: sentence.trim() });
      }
    }
    // Admin sections (GPA, residency, admission...) are skipped, unless they
    // also state what to complete ("Upper Division Course Access and Requirements").
    if (!hasCourses && ADMIN_TITLE.test(title) && (DEGREE_LEVEL_TITLE.test(title) || !STATES_REQUIREMENT.test(text))) continue;

    if (OPTIONAL_CHOICE.test(text)) optional = true;
    const kindOf = (t: string) => (/concentration/i.test(t) ? 'concentration' : /\boption\b/i.test(t) ? 'option' : 'stream');
    if (!hasCourses) {
      // Prose-only sections end a run of alternatives (or announce a new one).
      group = undefined;
      announced = ANNOUNCES_CHOICE.test(text) ? kindOf(ANNOUNCES_CHOICE.exec(text)![0]) : undefined;
    } else {
      const member =
        OWN_CHOICE.test(text) ||
        /\b(stream|concentration|option)$/i.test(title) ||
        (!!announced && !!title && !/requirement/i.test(title) && !ADMIN_TITLE.test(title));
      if (member) {
        group ??= { group: `g${si}`, label: announced ?? kindOf(title + ' ' + text), ...(optional ? { optional: true } : {}) };
      } else {
        group = undefined;
        announced = undefined;
      }
    }

    const section = convertSection(title, items, ENTRY_TITLE.test(title), subjects, () => `r${++seq}`);
    if (group && hasCourses) section.choice = { ...group };
    if (section.requirements.length || section.note) sections.push(section);
  }

  // A "choice" with fewer than two real alternatives isn't one.
  const groups = new Map<string, RequirementSection[]>();
  for (const s of sections) if (s.choice) groups.set(s.choice.group, [...(groups.get(s.choice.group) ?? []), s]);
  for (const members of groups.values()) {
    if (members.filter((s) => s.requirements.some((r) => r.kind !== 'note')).length < 2) {
      for (const s of members) delete s.choice;
    }
  }

  const all = sections.flatMap((s) => s.requirements);
  const manual = all.filter((r) => r.kind === 'note').length;
  const program: Program = {
    id: opts.id,
    name: cleanHtml(raw.fullTitle || raw.title || opts.id),
    credential: shortCredential(raw),
    calendar: opts.calendar,
    source: opts.source,
    faculty: cleanHtml(raw.faculties?.[0]?.title ?? '') || undefined,
    converted: true,
    sections,
    ...(grades.length ? { grades } : {}),
    caveats: [CONVERTED_CAVEAT],
  };
  return { program, stats: { understood: all.length - manual, manual } };
}

function convertSection(
  title: string,
  items: RawItem[],
  entryOnly: boolean,
  subjects: SubjectMatcher,
  nextId: () => string,
): RequirementSection {
  const section: RequirementSection = { title: title || 'Other requirements', requirements: [] };
  const notes: string[] = [];
  const reqs = section.requirements;

  const add = (r: Requirement): Requirement => {
    // Admission/declaration courses are usually also program courses: don't let them claim.
    if (entryOnly && r.kind !== 'note') r.shared = true;
    reqs.push(r);
    return r;
  };
  const manual = (text: string, codes?: string[]) =>
    add({ id: nextId(), title: 'Check with an advisor', kind: 'note', text: tidy(text) + '.', ...(codes?.length ? { codes } : {}) });
  const bad = (t: string) => manual(`Course not recognized: ${t}`);

  const unitsReq = (text: string, u: NonNullable<ReturnType<typeof readUnitsSentence>>, extra: Partial<Requirement> = {}) =>
    add({
      id: nextId(),
      title: tidy(text),
      kind: 'choose',
      from: u.set,
      ...(u.units !== undefined ? { units: u.units } : { courses: u.courses }),
      // Totals overlay the other requirements; "additional" ones don't.
      ...(u.additional ? {} : { shared: true }),
      ...extra,
    } as Requirement);

  /** Standalone prose: a requirement if we can read it, else a note or a manual item. */
  const prose = (text: string) => {
    for (const s of sentences(text)) {
      const u = readUnitsSentence(s, subjects);
      // "120 units, including 44 units at the upper division level": two totals.
      const inc = u ? null : INCLUDING.exec(s);
      const u1 = inc && readUnitsSentence(inc[1], subjects);
      const u2 = u1 && readUnitsSentence(inc[2], subjects);
      if (u) unitsReq(s, u);
      else if (u1 && u2) {
        unitsReq(inc[1], { ...u1, additional: false });
        unitsReq(inc[2], { ...u2, additional: false });
      }
      else if (isInfo(s)) notes.push(s);
      else manual(s);
    }
  };

  let pending: Block | undefined;
  let last: Block | undefined; // last emitted list, for "or ..." alternatives
  let headings: string[] = [];

  const newBlock = (intro: string): Block => ({ intro, quant: { mode: 'unknown' }, extra: false, or: false, labels: [], entries: [], emitted: [] });

  const emit = (b: Block) => {
    const { entries } = b;
    if (!entries.length) {
      if (b.prefix) prose(`${b.prefix}.`);
      if (b.intro) prose(b.intro);
      return;
    }
    const codes = uniq(entries.flat(2));
    const intro = tidy(b.intro);
    const listNote = b.labels.length ? `Lists: ${b.labels.join(', ')}.` : undefined;

    if (b.prefix) {
      const u = readUnitsSentence(b.prefix, subjects);
      if (u) unitsReq(b.prefix, { ...u, additional: false });
      else manual(b.prefix);
    }

    const q = b.quant;
    // "or both of" / "or one of": merge with the previous list into one choice.
    if (b.or) {
      const prev = last;
      const optionsOf = (x: Block): string[][] | null =>
        x.quant.mode === 'one'
          ? x.entries.flat()
          : x.quant.mode === 'all' || (x.quant.mode === 'courses' && x.quant.n >= x.entries.length)
            ? [x.entries.map((e) => e[0]).flat()]
            : null;
      const a = prev && !prev.prefix && !prev.extra ? optionsOf(prev) : null;
      const c = optionsOf(b);
      if (prev && a && c && !b.extra) {
        for (const r of prev.emitted) reqs.splice(reqs.indexOf(r), 1);
        const options = [...a, ...c];
        prev.emitted = [add({ id: nextId(), title: `One of: ${options.map((o) => o.join(' + ')).join('; ')}`, kind: 'oneOf', options })];
        prev.quant = { mode: 'one' };
        prev.entries = options.map((o) => [o]);
        return;
      }
      b.emitted = [manual(intro || 'Or these courses', codes)];
      last = b;
      return;
    }
    if (q.mode === 'unknown') {
      b.emitted = [manual([intro || 'Courses listed without a rule we could read', listNote].filter(Boolean).join('. '), codes)];
      last = b;
      return;
    }
    if (b.extra) manual(intro);
    // Keep the calendar's wording when it says more than "and two of".
    const wordy = !b.extra && intro.replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).length > 5;
    const note = [wordy ? `${intro}.` : '', listNote].filter(Boolean).join(' ') || undefined;
    if (q.mode === 'all' || (q.mode === 'courses' && q.n >= entries.length)) {
      if (note) notes.push(note);
      for (const e of entries) {
        if (e.length === 1 && e[0].length === 1) b.emitted.push(add({ id: nextId(), title: e[0][0], kind: 'course', code: e[0][0] }));
        else b.emitted.push(add({ id: nextId(), title: `One of: ${e.map((o) => o.join(' + ')).join('; ')}`, kind: 'oneOf', options: e }));
      }
    } else if (q.mode === 'one') {
      const options = entries.flat();
      b.emitted.push(add({ id: nextId(), title: `One of ${listTitle(options.map((o) => o.join(' + ')))}`, kind: 'oneOf', options, note }));
    } else if (q.mode === 'courses') {
      b.emitted.push(add({ id: nextId(), title: `${q.n} of ${listTitle(codes)}`, kind: 'choose', from: { codes }, courses: q.n, note }));
    } else {
      b.emitted.push(add({ id: nextId(), title: `${q.n} units from ${listTitle(codes)}`, kind: 'choose', from: { codes }, units: q.n, note }));
    }
    last = b;
  };
  const finish = () => {
    if (pending) emit(pending);
    pending = undefined;
  };
  const flushHeadings = () => {
    notes.push(...headings);
    headings = [];
  };

  for (let i = 0; i < items.length; ) {
    const it = items[i];
    if (it.description === undefined) {
      const entries: Entry[] = [];
      i = readEntries(items, i, entries, bad);
      if (pending && (!pending.entries.length || (headings.length && pending.quant.mode !== 'unknown'))) {
        // Courses for the intro above, possibly under sub-headings ("Artificial Intelligence").
        pending.labels.push(...headings);
        pending.entries.push(...entries);
        headings = [];
        continue;
      }
      finish();
      // A list with no intro phrase: its heading may carry one ("Methods (choose one)").
      const b = newBlock(headings.join(' · '));
      if (headings.length === 1 && hasQuantWord(headings[0])) {
        // "Marketing Analytics (choose at least one)": read the parenthetical.
        const paren = /\(([^)]*\bchoose\b[^)]*)\)/i.exec(headings[0]);
        const q = readQuantifier(paren ? paren[1] : headings[0], subjects);
        if (q.quant.mode !== 'unknown') Object.assign(b, q);
      } else if (!headings.length && !reqs.length && !notes.length && /\b(required|core)\b/i.test(title)) {
        b.quant = { mode: 'all' };
      }
      headings = [];
      b.entries = entries;
      pending = b;
      continue;
    }

    const text = cleanHtml(it.description);
    i++;
    if (!text) continue;
    const nextIsCourse = i < items.length && items[i].description === undefined;
    const nextIsHeading = i < items.length && items[i].description !== undefined && isHeading(cleanHtml(items[i].description!));
    // A list follows, possibly after sub-headings.
    let k = i;
    while (k < items.length && items[k].description !== undefined && isHeading(cleanHtml(items[k].description!))) k++;
    const listFollows = k < items.length && items[k].description === undefined;
    if (isHeading(text.replace(/\([^)]*\)/g, '')) && !/^(and|or|plus|one|all|both|any|either)\b/i.test(text)) {
      if (nextIsCourse || nextIsHeading) headings.push(text);
      else notes.push(text);
      continue;
    }
    finish();
    flushHeadings();
    if (!listFollows) {
      prose(text);
      continue;
    }

    // An intro for the list below. Earlier sentences stand alone; trailing
    // advice ("Students should consult an advisor") isn't the intro.
    const ss = sentences(text);
    const trailing: string[] = [];
    while (ss.length > 1 && isInfo(ss[ss.length - 1]) && !/\bmay include\b/i.test(ss[ss.length - 1])) trailing.unshift(ss.pop()!);
    notes.push(...trailing);
    const intro = ss.pop()!;
    // "Students complete any two 100-division English courses. Such courses may include:"
    if (/\bmay include\b/i.test(intro) && ss.length) {
      const main = ss.pop()!;
      if (ss.length) prose(ss.join(' '));
      const entries: Entry[] = [];
      i = readEntries(items, i, entries, bad);
      const u = readUnitsSentence(main.replace(/\bany\b/i, ''), subjects);
      const codes = uniq(entries.flat(2));
      if (u) unitsReq(main, { ...u, additional: true }, { note: `${intro} ${listTitle(codes, 8)}` });
      else manual(`${main} ${intro}`, codes);
      continue;
    }
    if (ss.length) prose(ss.join(' '));

    const b = newBlock(intro);
    b.or = /^or\b/i.test(intro.trim());
    let quantText = intro;
    const inc = INCLUDING.exec(intro);
    if (inc && /\d|\bunits?\b|\bcourses?\b/i.test(inc[1]) && readQuantifier(inc[1], subjects).quant.mode !== 'all') {
      b.prefix = inc[1].trim();
      quantText = inc[2].trim();
    }
    Object.assign(b, readQuantifier(quantText.replace(/^(and|or|plus)\s+/i, ''), subjects));
    pending = b;
  }
  finish();
  flushHeadings();

  if (notes.length) section.note = uniq(notes).join('\n');
  return section;
}

/** Flatten nested item lists (some sections nest a titled sub-list). */
function flatten(items: RawItem[]): RawItem[] {
  const out: RawItem[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it.requirements?.length) {
      if (it.title) out.push({ description: it.title });
      if (it.description) out.push({ description: it.description });
      out.push(...flatten(it.requirements));
    } else if (it.value !== undefined || it.description !== undefined) {
      out.push(it.value !== undefined ? it : { description: it.description });
    } else if (it.title && !it.requirements) {
      out.push({ description: it.title });
    }
  }
  return out;
}

const DEGREE_ABBR: [RegExp, string][] = [
  [/bachelor of business administration/i, 'BBA'],
  [/bachelor of applied science/i, 'BASc'],
  [/bachelor of science/i, 'BSc'],
  [/bachelor of arts/i, 'BA'],
  [/bachelor of fine arts/i, 'BFA'],
  [/bachelor of environment/i, 'BEnv'],
  [/bachelor of general studies/i, 'BGS'],
  [/bachelor of education/i, 'BEd'],
  [/bachelor of/i, 'Bachelor'],
];

/** "BSc", "BA or BBA", "Minor", "Certificate", "Post Baccalaureate Diploma". */
export function shortCredential(raw: Pick<RawProgram, 'awardType' | 'credential'>): string {
  const award = (raw.awardType ?? '').trim();
  const cred = (raw.credential ?? '').trim();
  if (/minor/i.test(award)) return award;
  if (/bachelor/i.test(cred)) {
    const parts = cred.split(/\s+(or|and)\s+/i).filter((p) => !/^(or|and)$/i.test(p));
    const joiner = /\s+and\s+/i.test(cred) ? ' and ' : ' or ';
    return parts.map((p) => DEGREE_ABBR.find(([re]) => re.test(p))?.[1] ?? p).join(joiner);
  }
  return cred || award || 'Program';
}
