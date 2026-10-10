import dagre from '@dagrejs/dagre';

// Rendered sizes of the node components. dagre needs these up front.
export const COURSE_SIZE = { width: 200, height: 60 };
export const JUNCTION_SIZE = { width: 64, height: 26 };
export const OTHER_SIZE = { width: 170, height: 26 };

/**
 * Is a prerequisite tree satisfied by the set of taken courses? Leaves like
 * { other: 'Pre-Calculus 12' } can't be checked: they count as `others`
 * (false by default, i.e. not definitely met).
 */
export function satisfied(tree, done, others = false) {
  if (tree == null) return true;
  if (typeof tree === 'string') return done.has(tree);
  if (tree.other) return others;
  return tree.op === 'and'
    ? tree.args.every((a) => satisfied(a, done, others))
    : tree.args.some((a) => satisfied(a, done, others));
}

/**
 * 'done' | 'ready' (can take it now) | 'locked' | 'unknown' (the calendar lists
 * requirements we couldn't turn into courses, like "45 units", or a non-course
 * alternative like "Pre-Calculus 12" would do). Courses missing from the data
 * are 'locked'.
 */
export function courseStatus(code, courses, done) {
  if (done.has(code)) return 'done';
  const course = courses[code];
  if (!course) return 'locked';
  const tree = prune(course.prereq, code);
  if (!satisfied(tree, done)) return satisfied(tree, done, true) ? 'unknown' : 'locked';
  return !tree && hasUnreadRequirements(course.prereqText) ? 'unknown' : 'ready';
}

// True when prerequisite text has something besides advice, e.g. "60 units"
// or "BC Pre-Calculus 12", which the parser can't turn into courses.
function hasUnreadRequirements(text = '') {
  const rest = text
    .replace(/^\s*prerequisites?:?/i, '')
    .split(/\brecommended\s*:/i)[0]
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/recommend/i.test(sentence))
    .join('');
  return rest.replace(/[\s.:;,]/g, '').length > 0;
}

/**
 * What to take next on the way to `target`: a list of groups, where a group
 * of one course is required and a larger group means "pick one of these".
 * Looks at the whole prerequisite tree (not just what's drawn). For each
 * unsatisfied "one of", it follows the alternative needing the fewest
 * untaken courses, so the list stays short.
 */
export function nextSteps(target, courses, done) {
  const costs = new Map();
  // Untaken courses needed to be able to take `code`, along the cheapest path.
  function cost(code) {
    if (done.has(code)) return 0;
    if (costs.has(code)) return costs.get(code) ?? 1; // null = in progress (cycle)
    costs.set(code, null);
    const c = 1 + treeCost(prune(courses[code]?.prereq, code, done));
    costs.set(code, c);
    return c;
  }
  function treeCost(tree) {
    if (tree == null) return 0;
    // Most students have Pre-Calculus 12 and the like, so those are free. But
    // "or permission"/"or equivalent" and program-only paths ("for Applied
    // Physics students") shouldn't hide the regular course route.
    if (tree.other) return tree.only || /permission|equivalent|admission/i.test(tree.other) ? 50 : 0;
    if (typeof tree === 'string') return cost(tree);
    const each = tree.args.map(treeCost);
    return tree.op === 'and' ? each.reduce((a, b) => a + b, 0) : Math.min(...each);
  }

  const groups = [];
  const seen = new Set();
  function plan(tree) {
    if (tree == null || tree.other || satisfied(tree, done)) return;
    if (typeof tree === 'string') {
      if (seen.has(tree)) return;
      seen.add(tree);
      const status = courseStatus(tree, courses, done);
      if (status === 'ready' || status === 'unknown') groups.push([tree]);
      else plan(prune(courses[tree]?.prereq, tree, done));
      return;
    }
    if (tree.op === 'and') return tree.args.forEach(plan);
    const each = tree.args.map(treeCost);
    const best = tree.args.filter((_, i) => each[i] === Math.min(...each));
    const takeable = (a) => typeof a === 'string' && courses[a] && courseStatus(a, courses, done) !== 'locked';
    if (best.length > 1 && best.every(takeable)) groups.push(best);
    else plan(best[0]);
  }
  plan(prune(courses[target]?.prereq, target, done));

  // A course that's required on its own makes any "pick one" containing it moot.
  const required = new Set(groups.filter((g) => g.length === 1).map((g) => g[0]));
  const keys = new Set();
  return groups.filter((g) => {
    if (g.length > 1 && g.some((c) => required.has(c))) return false;
    const key = [...g].sort().join();
    return keys.has(key) ? false : keys.add(key);
  });
}

/**
 * The part of a prerequisite tree worth drawing: drops references to the
 * course itself and, with `done` given, the untaken alternatives of any
 * "one of" that is already satisfied.
 */
function prune(tree, self, done = null) {
  if (tree == null || tree.other) return tree;
  if (typeof tree === 'string') return tree === self ? null : tree;
  let args = tree.args.map((a) => prune(a, self, done)).filter((a) => a != null);
  if (done && tree.op === 'or' && args.some((a) => satisfied(a, done))) {
    args = args.filter((a) => satisfied(a, done));
  }
  if (args.length === 0) return null;
  return args.length === 1 ? args[0] : { op: tree.op, args };
}

/**
 * Build the nodes/edges for everything leading up to `target`.
 *
 * Edges point from prerequisite to course. AND prerequisites connect straight
 * into the course (every incoming line is required). OR groups get a small
 * "one of" node, and an AND nested inside an OR gets an "all of" node.
 * Non-course alternatives ("Pre-Calculus 12") get a small 'other' node each.
 *
 * @param {object} opts
 * @param {number} opts.maxDepth  stop expanding past this many levels (Infinity = all)
 * @param {boolean} opts.hideTaken  don't expand courses already taken
 * @param {Set<string>} opts.expanded  courses to expand even past maxDepth
 * @param {(code: string) => object[]} opts.offeredIn  terms a course runs in
 */
export function buildGraph(
  target,
  courses,
  done,
  { maxDepth = Infinity, hideTaken = true, expanded = new Set(), offeredIn = () => [] } = {},
) {
  const nodes = new Map();
  const edges = [];
  // Identical groups (e.g. "one of MATH 150, MATH 151") share one node.
  const junctions = new Map();

  function addEdge(source, targetId, met) {
    if (edges.some((e) => e.source === source && e.target === targetId)) return;
    edges.push({
      id: `${source}->${targetId}`,
      source,
      target: targetId,
      class: met ? 'met' : '',
    });
  }

  const prereqOf = (code) => prune(courses[code]?.prereq, code, hideTaken ? done : null);
  const shouldExpand = (code, depth) =>
    prereqOf(code) &&
    (depth < maxDepth || expanded.has(code)) &&
    !(hideTaken && done.has(code));

  // Breadth-first pass so each course gets the depth of its shortest path
  // to the target, which decides where the depth cutoff lands.
  const depthOf = new Map([[target, 0]]);
  const queue = [target];
  while (queue.length) {
    const code = queue.shift();
    const depth = depthOf.get(code);
    if (!shouldExpand(code, depth)) continue;
    for (const ref of codesIn(prereqOf(code))) {
      if (!depthOf.has(ref)) {
        depthOf.set(ref, depth + 1);
        queue.push(ref);
      }
    }
  }

  function visitCourse(code) {
    if (nodes.has(code)) return;
    const course = courses[code];
    const expand = shouldExpand(code, depthOf.get(code));
    nodes.set(code, {
      id: code,
      type: 'course',
      data: {
        code,
        title: course?.title ?? 'Not in catalog',
        status: courseStatus(code, courses, done),
        missing: !course,
        isTarget: code === target,
        collapsed: !!prereqOf(code) && !expand,
        offered: offeredIn(code),
      },
    });
    if (expand) connect(prereqOf(code), code, true);
  }

  // Wire `tree` into the node `parentId`.
  function connect(tree, parentId, parentIsCourse) {
    if (typeof tree === 'string') {
      visitCourse(tree);
      addEdge(tree, parentId, done.has(tree));
      return;
    }
    if (tree.other) {
      const id = `other:${tree.other}`;
      if (!nodes.has(id)) nodes.set(id, { id, type: 'other', data: { label: tree.other } });
      addEdge(id, parentId, false);
      return;
    }
    if (tree.op === 'and' && parentIsCourse) {
      tree.args.forEach((a) => connect(a, parentId, true));
      return;
    }
    const met = satisfied(tree, done);
    const key = JSON.stringify(tree);
    let id = junctions.get(key);
    if (!id) {
      id = `j${junctions.size}`;
      junctions.set(key, id);
      nodes.set(id, {
        id,
        type: 'junction',
        data: { label: tree.op === 'or' ? 'one of' : 'all of', met },
      });
      tree.args.forEach((a) => connect(a, id, false));
    }
    addEdge(id, parentId, met);
  }

  visitCourse(target);
  return layout([...nodes.values()], edges);
}

function codesIn(tree, out = []) {
  if (typeof tree === 'string') out.push(tree);
  else if (tree?.args) tree.args.forEach((a) => codesIn(a, out));
  return out;
}

function layout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  // Copy the size: dagre writes x/y onto the label object it's given.
  const sizes = { course: COURSE_SIZE, junction: JUNCTION_SIZE, other: OTHER_SIZE };
  for (const n of nodes) g.setNode(n.id, { ...sizes[n.type] });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const { x, y, width, height } = g.node(n.id);
      // dagre gives centres; Svelte Flow wants top-left corners.
      return { ...n, position: { x: x - width / 2, y: y - height / 2 } };
    }),
    edges,
  };
}

/** Ids of every node upstream or downstream of `id` (plus `id` itself). */
export function pathThrough({ edges }, id) {
  const keep = new Set([id]);
  const walk = (from, to) => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const e of edges) {
        if (e[to] === cur && !keep.has(e[from])) {
          keep.add(e[from]);
          stack.push(e[from]);
        }
      }
    }
  };
  walk('source', 'target'); // prerequisites (upstream)
  walk('target', 'source'); // what it leads to (downstream)
  return keep;
}
