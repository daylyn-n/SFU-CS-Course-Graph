// Turns SFU's English prerequisite sentences into a tree:
//   "CMPT 225 and (MACM 101 or MATH 151), both with a minimum grade of C-."
//   → { op: 'and', args: ['CMPT 225', { op: 'or', args: ['MACM 101', 'MATH 151'] }] }
//
// A tree is either a course code string, { op: 'and' | 'or', args: [...] },
// { other: 'Pre-Calculus 12' } for a non-course alternative inside an OR, or
// null when no course prerequisites were found. The wording is not fully
// regular, so this is best-effort: the UI always shows the original text too.
//
// Pipeline: preprocess (drop notes, normalise phrasing) → tokenize →
// allof groups → comma resolution → precedence parse → simplify.
// Precedence, loosest first: sentence/";" (all required), "; or"
// (alternative paths), "and", "or".

const COURSE = /^([A-Z][A-Za-z]{1,4})\s?(\d{3}[A-Z]?)\b/;
const BARE_NUMBER = /^(\d{3}[A-Z]?)\b(?!\s*(units|credits|-level|level))/i;
// Number words used in unit counts ("six units in MATH").
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, nine: 9, twelve: 12, fifteen: 15, eighteen: 18 };
// Clauses that describe exceptions or advice rather than requirements.
const NOTE = /recommend|advised|concurrently|is a required course|must be taken|substitut|only available|open only|in place of|instead of|may not|waived/i;

// "students in an Applied Physics program" → "⟦Applied Physics program students⟧"
function restriction(who) {
  const m = who.trim().match(/^students (?:in|enrolled in|admitted to) (?:the |an? )?(.+)$/i);
  return `⟦${m ? `${m[1]} students` : who.trim()}⟧`;
}

function preprocess(text) {
  let s = text.replace(/^\s*prerequisites?:?(\s*or\s+corequisites?:?)?/i, '');
  s = s.split(/\bcorequisites?\b|\brecommended:/i)[0];
  s = s
    .replace(/\.?\s*an alternative to the above prerequisites? is\b/gi, '; or')
    // "BUS (or BUEC) 232" → "BUS 232 or BUEC 232"
    .replace(/\b([A-Z]{2,5}) \(or ([A-Z]{2,5})\) (\d{3}[A-Z]?)\b/g, '$1 $3 or $2 $3')
    .replace(/\([^()]*recommend[^()]*\)/gi, '')
    // "for students in the life sciences," / "For non-SDA minor students,"
    // "60 units, including CMPT 225 or 276" needs both.
    .replace(/,?\s+(which must )?includ(e|ing)\b/gi, ' and')
    // Paths limited to a program become a ⟦…⟧ marker, parsed as an { other,
    // only: true } leaf ANDed into that path:
    // "…, or for biomedical engineering students, BPK 201 and 208" (a new path),
    // "(MATH 151 and CMPT 102 for students in an Applied Physics program)",
    // "Also, for students in the life sciences, MATH 154 and MATH 155".
    .replace(/,?\s*\bor\s+for\s+([^,.;()]*?\bstudents\b[^,.;()]*),/gi, (_, who) => `; or ${restriction(who)} and `)
    .replace(/\s+for\s+([^,.;()]*?\bstudents\b[^,.;()]*)\)/gi, (_, who) => ` and ${restriction(who)})`)
    .replace(/\bfor\s+([^,.;()]*?\bstudents\b[^,.;()]*),/gi, (_, who) => `${restriction(who)} and `)
    // "..., all with a minimum grade of C- or permission of the instructor."
    // offers permission instead of everything before it in the clause.
    .replace(/(?<=(\bgrade of [A-D][+-]?|\bhigher|\bbetter|\bunits)\)?),?\s+or\s+(?=(by |with )?(the )?(instructor'?s? )?permission\b[^.;(),]*(\.|;|$))/gi, '; or ');

  let out = '';
  for (let sentence of s.split(/(?<=\.)\s+/)) {
    sentence = sentence.trim().replace(/\.$/, '');
    if (!sentence || /^students\b/i.test(sentence)) continue;
    // "Also, ..." and ". Or ..." start an alternative path.
    const alt = /^(also\b,?|or\b)/i.test(sentence);
    if (alt) sentence = sentence.replace(/^(also\b,?|or\b)\s*/i, '');
    const body = sentence
      .split(';')
      .filter((clause) => !NOTE.test(clause))
      .join(';');
    if (!body.trim()) continue;
    out += out ? (alt ? `; or ${body}` : `. ${body}`) : body;
  }
  return out;
}

function tokenize(s, { self, depts }) {
  const tokens = [];
  let lastDept = null;
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const before = s.slice(0, i);
    const wordStart = !/[A-Za-z0-9]$/.test(before);
    let m;
    if (wordStart && (m = rest.match(COURSE)) && isDept(m[1], depts)) {
      lastDept = m[1].toUpperCase();
      const code = `${lastDept} ${m[2]}`;
      if (code !== self) tokens.push({ t: 'course', v: code });
      i += m[0].length;
    } else if ((m = rest.match(/^⟦([^⟧]+)⟧/))) {
      tokens.push({ t: 'other', v: m[1], only: true });
      i += m[0].length;
    } else if (wordStart && (m = matchOther(rest))) {
      tokens.push({ t: 'other', v: m.label });
      i += m.length;
    } else if (
      lastDept &&
      wordStart &&
      // "MATH 150 or 151" → MATH 151, but not "Physics 126".
      (!/[A-Za-z]\s*$/.test(before) || /\b(and|or|of|both|either)\s*$/i.test(before)) &&
      (m = rest.match(BARE_NUMBER))
    ) {
      const code = `${lastDept} ${m[1].toUpperCase()}`;
      if (code !== self) tokens.push({ t: 'course', v: code });
      i += m[0].length;
    } else if (wordStart && (m = rest.match(/^(at least )?(one|any|two) of\b/i))) {
      tokens.push({ t: 'oneof' });
      i += m[0].length;
    } else if (wordStart && (m = rest.match(/^(both|all)( of)?:?(?=\s*(\(|[A-Za-z]{2,5}\s?\d{3}))/i))) {
      tokens.push({ t: 'allof' });
      i += m[0].length;
    } else if (wordStart && (m = rest.match(/^(and|or)\b/i))) {
      tokens.push({ t: m[1].toLowerCase() });
      i += m[0].length;
    } else if ((m = rest.match(/^;\s*or\b/i))) {
      tokens.push({ t: 'semior' });
      i += m[0].length;
    } else if (rest[0] === ';' || /^\.(\s|$)/.test(rest)) {
      tokens.push({ t: 'semi' });
      i += 1;
    } else if ('(),'.includes(rest[0])) {
      tokens.push({ t: rest[0] });
      i += 1;
    } else {
      i += 1;
    }
  }
  return tokens;
}

// Non-course requirements that can stand in for courses inside an OR.
// Returns { label, length } for a match at the start of `rest`.
function matchOther(rest) {
  let m;
  // High school courses: "Grade 12 French", "BC Pre-Calculus 12",
  // "Foundations of Mathematics 11".
  if ((m = rest.match(/^[Gg]rade (1[12]) ([A-Z][a-z]+)\b/))) return { label: `${m[2]} ${m[1]}`, length: m[0].length };
  if ((m = rest.match(/^(?:B\.?C\.? )?(?:high school )?((?:[A-Z][A-Za-z-]+ (?:of )?){1,3})(1[12])\b/))) {
    let name = m[1].trim().replace(/\bMathematics\b/, 'Math').replace(/^Precalculus\b/i, 'Pre-Calculus');
    if (/\b(Fall|Spring|Summer|Grade|Level|Year|Term|One|Any)\b/i.test(name)) return null;
    if (name === 'Math') name = 'BC Math';
    return { label: `${name} ${m[2]}`, length: m[0].length };
  }
  if ((m = rest.match(/^(AP|IB) (Calculus|Math(?:ematics)?)(?: (HL|SL))?\b/))) {
    const subject = m[2].startsWith('Math') ? 'Math' : m[2];
    return { label: [m[1], subject, m[3]].filter(Boolean).join(' '), length: m[0].length };
  }
  if ((m = rest.match(/^(?:SFU |Simon Fraser University )?FAN (X\d\d)\b/))) {
    return { label: `FAN ${m[1]}`, length: m[0].length };
  }
  if ((m = rest.match(/^(?:by |with )?(?:the )?(?:(instructor|department)(?:al|'s)? )?(?:permission|consent)\b/i))) {
    // Peek at whose permission, but leave those words to the tokenizer.
    const of = rest.slice(m[0].length).match(/^ (?:of|from) (?:the )?((?:(?!and\b|or\b)[^.;,()\s]+ ?){1,4})/i);
    const who = `${m[1] ?? ''} ${of?.[1] ?? ''}`;
    const label = /co-?op/i.test(who)
      ? 'permission of co-op coordinator'
      : /instructor|supervisor|director/i.test(who)
        ? 'permission of instructor'
        : /department|school|program|chair|advisor/i.test(who)
          ? 'permission of department'
          : 'permission';
    return { label, length: m[0].length };
  }
  if ((m = rest.match(/^equivalent\b/i))) return { label: 'equivalent', length: m[0].length };
  if ((m = rest.match(/^(\d{1,3}|[a-z]+) (?:(?:upper|lower)[- ]division )?units\b(?: (?:in|of) (?:upper[- ]division )?([A-Z]{2,5})\b(?!\s?\d))?/i))) {
    const n = /^\d+$/.test(m[1]) ? m[1] : NUMBERS[m[1].toLowerCase()];
    if (!n) return null;
    const dept = m[2] === m[2]?.toUpperCase() ? m[2] : null; // "in MATH", not "in film"
    return { label: dept ? `${n} units in ${dept}` : `${n} units`, length: m[0].length };
  }
  if ((m = rest.match(/^Job Practicum(?: [IVX]+\b)?/i))) return { label: 'Job Practicum', length: m[0].length };
  if ((m = rest.match(/^(?:two-term )?co-?op (?:work(?: terms?)?|terms?)\b/i))) {
    return { label: 'co-op work term', length: m[0].length };
  }
  if ((m = rest.match(/^(?:enrol?l?ment|admission|acceptance) (?:in|into|to)\b/i))) {
    return { label: 'program admission', length: m[0].length };
  }
  return null;
}

// "A (or B)" means "(A or B)": move the paren before the atom it follows.
function attachOrParens(tokens) {
  const out = [...tokens];
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].t === '(' && out[i + 1].t === 'or' && ['course', 'other'].includes(out[i - 1].t)) {
      [out[i - 1], out[i]] = [out[i], out[i - 1]];
    }
  }
  return out;
}

// All-caps codes are always departments; "Math 125" only if MATH is known.
function isDept(word, depts) {
  if (word === word.toUpperCase()) return true;
  return /^[A-Z][a-z]+$/.test(word) && !!depts?.has(word.toUpperCase());
}

// Turn "both"/"all of" into a virtual paren group. It closes after the first
// complete atom following an "and" at its depth ("both A and B"), or before an
// "or", ";", ")" or the end ("both of A, B with ...").
function groupAllOf(tokens) {
  const out = [];
  const open = []; // depths of open virtual groups
  let depth = 0;
  let sawAnd = false;
  const close = () => {
    out.push({ t: ')' });
    open.pop();
    depth--;
    sawAnd = false;
  };
  for (const tok of tokens) {
    while (open.length && depth === open.at(-1) && ['or', 'semi', 'semior', ')'].includes(tok.t)) close();
    if (tok.t === 'allof') {
      out.push({ t: '(', allof: true });
      open.push(++depth);
      sawAnd = false;
      continue;
    }
    out.push(tok);
    if (tok.t === '(') depth++;
    else if (tok.t === ')') depth--;
    const inGroup = open.length && depth === open.at(-1);
    if (inGroup && tok.t === 'and') sawAnd = true;
    else if (inGroup && sawAnd && ['course', 'other', ')'].includes(tok.t)) close();
  }
  while (open.length) close();
  return out;
}

const CLAUSE_END = ['semi', 'semior'];

// Decide what each comma means.
//  - After "one of" in the same clause, commas mean OR.
//  - Inside a "both"/"all of" group, commas mean AND.
//  - Otherwise a list takes its meaning from an Oxford comma ("A, B, C or D,
//    and E" is all AND at the top), else from the next connector.
function resolveCommas(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t !== ',') {
      out.push(tok);
      continue;
    }
    const next = tokens[i + 1]?.t;
    if (!next || ['and', 'or', ')', ...CLAUSE_END].includes(next)) continue;

    let op = null;
    let depth = 0;
    let scanning = true;
    for (let j = out.length - 1; j >= 0; j--) {
      const p = out[j];
      if (p.t === ')') depth++;
      else if (p.t === '(') {
        if (depth === 0) {
          if (p.allof) op = 'and';
          break;
        }
        depth--;
      } else if (depth === 0 && scanning) {
        if (p.t === 'oneof') {
          op = 'or';
          break;
        }
        // Past the clause start, only an enclosing allof group matters.
        if (p.t === 'and' || CLAUSE_END.includes(p.t)) scanning = false;
      }
    }
    if (!op) {
      let first = null;
      depth = 0;
      for (let j = i + 1; j < tokens.length; j++) {
        const p = tokens[j];
        if (p.t === '(') depth++;
        else if (p.t === ')') {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0) {
          if (CLAUSE_END.includes(p.t)) break;
          if (p.t === ',' && (tokens[j + 1]?.t === 'and' || tokens[j + 1]?.t === 'or')) {
            op = tokens[j + 1].t;
            break;
          }
          if (!first && (p.t === 'and' || p.t === 'or')) first = p.t;
        }
      }
      op ??= first ?? 'and';
    }
    out.push({ t: op });
  }
  return out;
}

// Each level splits on its separator; atoms are courses or parenthesised groups.
const LEVELS = [
  ['semi', 'and'],
  ['semior', 'or'],
  ['and', 'and'],
  ['or', 'or'],
];

function parse(tokens) {
  let pos = 0;

  function parseLevel(n) {
    if (n === LEVELS.length) return parseAtom();
    const [sep, op] = LEVELS[n];
    const args = [parseLevel(n + 1)];
    while (tokens[pos]?.t === sep) {
      pos++;
      args.push(parseLevel(n + 1));
    }
    return { op, args };
  }
  function parseAtom() {
    const items = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.t === 'course') {
        items.push(tok.v);
        pos++;
      } else if (tok.t === 'other') {
        items.push(tok.only ? { other: tok.v, only: true } : { other: tok.v });
        pos++;
      } else if (tok.t === '(') {
        pos++;
        items.push(parseLevel(0));
        if (tokens[pos]?.t === ')') pos++;
      } else if (tok.t === 'oneof') {
        pos++;
      } else break;
    }
    return items.length === 1 ? items[0] : { op: 'and', args: items };
  }

  const tree = parseLevel(0);
  // Keep going past anything unparseable (a stray ")"), joining with AND.
  const rest = [];
  while (pos < tokens.length) {
    pos++;
    rest.push(parseLevel(0));
  }
  return rest.length ? { op: 'and', args: [tree, ...rest] } : tree;
}

// Drop empty branches, merge nested same-op groups, dedupe, unwrap single children.
function simplify(node) {
  if (node == null || typeof node === 'string' || node.other) return node;
  const args = [];
  for (const a of node.args.map(simplify)) {
    if (a == null) continue;
    if (typeof a === 'object' && a.op === node.op) args.push(...a.args);
    else args.push(a);
  }
  const seen = new Set();
  const unique = args.filter((a) => {
    const key = JSON.stringify(a);
    return seen.has(key) ? false : seen.add(key);
  });
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  return { op: node.op, args: unique };
}

const hasCourse = (node) => typeof node === 'string' || !!node?.args?.some(hasCourse);
const othersIn = (node) => (node.other ? [node] : node.args.flatMap(othersIn));

// Non-course requirements only count as alternatives: drop them from ANDs,
// collapse a course-less OR branch to its first requirement, and list them
// after the courses. Run on a simplified tree; returns null with no courses.
function keepOthersInOr(node) {
  if (node?.only) return node;
  if (!hasCourse(node)) return null;
  if (typeof node === 'string') return node;
  // Program restrictions ({ only: true }) stay on their path; other
  // non-course requirements in an AND are dropped.
  if (node.op === 'and') return { op: 'and', args: node.args.filter((a) => hasCourse(a) || a.only).map(keepOthersInOr) };
  const courses = node.args.filter(hasCourse).map(keepOthersInOr);
  let others = node.args.filter((a) => !hasCourse(a)).flatMap((a) => (a.op === 'and' ? othersIn(a).slice(0, 1) : othersIn(a)));
  // "Pre-Calculus 12 (or equivalent)": the specific label says enough.
  if (others.some((o) => o.other !== 'equivalent')) others = others.filter((o) => o.other !== 'equivalent');
  return { op: 'or', args: [...courses, ...others] };
}

/**
 * @param {string} text calendar prerequisite text
 * @param {{ self?: string, depts?: Set<string> }} opts the course's own code
 *   (dropped from the tree) and known uppercase department codes (so "Math 125"
 *   counts as MATH 125)
 */
export function parsePrereqs(text, { self, depts } = {}) {
  if (!text) return null;
  const tokens = tokenize(preprocess(text), { self, depts });
  const tree = simplify(parse(resolveCommas(groupAllOf(attachOrParens(tokens)))));
  return simplify(keepOthersInOr(tree));
}
