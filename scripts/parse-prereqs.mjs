// Turns SFU's English prerequisite sentences into a tree:
//   "CMPT 225 and (MACM 101 or MATH 151), both with a minimum grade of C-."
//   → { op: 'and', args: ['CMPT 225', { op: 'or', args: ['MACM 101', 'MATH 151'] }] }
//
// A tree is either a course code string, { op: 'and' | 'or', args: [...] },
// or null when no course prerequisites were found. The wording is not fully
// regular, so this is best-effort: the UI always shows the original text too.

const COURSE = /^([A-Z]{2,5})\s?(\d{3}[A-Z]?)\b/;
const BARE_NUMBER = /^(\d{3}[A-Z]?)\b(?!\s*(units|credits|-level|level))/i;

function tokenize(text) {
  // Stop before trailing notes that aren't requirements.
  let s = text.replace(/^\s*prerequisites?:?(\s*or\s+corequisites?:?)?/i, '');
  s = s.split(/\b(recommended|corequisites?|students)\b/i)[0];
  // Sentences about substitutions ("X may be substituted for Y") describe
  // exceptions, not requirements, and would otherwise get merged in.
  s = s
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/substitut|in place of|instead of/i.test(sentence))
    .join(' ');

  const tokens = [];
  let lastDept = null;
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = rest.match(COURSE))) {
      lastDept = m[1];
      tokens.push({ t: 'course', v: `${m[1]} ${m[2].toUpperCase()}` });
      i += m[0].length;
    } else if (lastDept && /^\d/.test(rest) && /\W$|^$/.test(s.slice(Math.max(0, i - 1), i)) && (m = rest.match(BARE_NUMBER))) {
      // "MATH 150 or 151" → the 151 is MATH 151.
      tokens.push({ t: 'course', v: `${lastDept} ${m[1].toUpperCase()}` });
      i += m[0].length;
    } else if ((m = rest.match(/^(one|any|two) of\b/i))) {
      tokens.push({ t: 'oneof' });
      i += m[0].length;
    } else if ((m = rest.match(/^(and|or)\b/i)) && /\W$|^$/.test(s.slice(Math.max(0, i - 1), i))) {
      tokens.push({ t: m[1].toLowerCase() });
      i += m[0].length;
    } else if ('(),;'.includes(rest[0])) {
      tokens.push({ t: rest[0] });
      i += 1;
    } else {
      i += 1;
    }
  }
  return tokens;
}

// Decide what each comma means. "A, B or C" is a list of ORs and
// "A, B and C" a list of ANDs, so a comma takes the meaning of the next
// connector at the same nesting level. After "one of", commas mean OR.
function resolveCommas(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === ';') {
      // "A; or B" keeps the OR; a bare semicolon separates required parts.
      const next = tokens[i + 1]?.t;
      if (next !== 'and' && next !== 'or') out.push({ t: 'and' });
      continue;
    }
    if (tok.t !== ',') {
      out.push(tok);
      continue;
    }
    const next = tokens[i + 1];
    if (!next || next.t === 'and' || next.t === 'or' || next.t === ')') continue;

    let op = 'and';
    let depth = 0;
    for (let j = out.length - 1; j >= 0; j--) {
      const p = out[j];
      if (p.t === ')') depth++;
      else if (p.t === '(') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && p.t === 'and') break;
      else if (depth === 0 && p.t === 'oneof') {
        op = 'or';
        break;
      }
    }
    if (op === 'and') {
      depth = 0;
      for (let j = i + 1; j < tokens.length; j++) {
        const p = tokens[j];
        if (p.t === '(') depth++;
        else if (p.t === ')') {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && (p.t === 'and' || p.t === 'or')) {
          op = p.t;
          break;
        }
      }
    }
    out.push({ t: op });
  }
  return out;
}

// Precedence: AND binds loosest, then OR. "A or B and C" reads as
// "(A or B) and C", which matches how SFU usually phrases things.
function parse(tokens) {
  let pos = 0;

  function parseAnd() {
    const args = [parseOr()];
    while (tokens[pos]?.t === 'and') {
      pos++;
      args.push(parseOr());
    }
    return { op: 'and', args };
  }
  function parseOr() {
    const args = [parseAtom()];
    while (tokens[pos]?.t === 'or') {
      pos++;
      args.push(parseAtom());
    }
    return { op: 'or', args };
  }
  function parseAtom() {
    const items = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.t === 'course') {
        items.push(tok.v);
        pos++;
      } else if (tok.t === '(') {
        pos++;
        items.push(parseAnd());
        if (tokens[pos]?.t === ')') pos++;
      } else if (tok.t === 'oneof') {
        pos++;
      } else break;
    }
    return items.length === 1 ? items[0] : { op: 'and', args: items };
  }

  const tree = parseAnd();
  // Keep going past anything unparseable, joining later pieces with AND.
  const rest = [];
  while (pos < tokens.length) {
    pos++;
    rest.push(parseAnd());
  }
  return rest.length ? { op: 'and', args: [tree, ...rest] } : tree;
}

// Drop empty branches, merge nested same-op groups, unwrap single children.
function simplify(node) {
  if (node == null || typeof node === 'string') return node;
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

export function parsePrereqs(text) {
  if (!text) return null;
  return simplify(parse(resolveCommas(tokenize(text))));
}
