import dagre from '@dagrejs/dagre';

// Rendered sizes of the node components. dagre needs these up front.
export const COURSE_SIZE = { width: 172, height: 60 };
export const JUNCTION_SIZE = { width: 64, height: 26 };

/** Is a prerequisite tree satisfied by the set of taken courses? */
export function satisfied(tree, done) {
  if (tree == null) return true;
  if (typeof tree === 'string') return done.has(tree);
  return tree.op === 'and'
    ? tree.args.every((a) => satisfied(a, done))
    : tree.args.some((a) => satisfied(a, done));
}

/** 'done' | 'ready' (can take it now) | 'locked' */
export function courseStatus(code, courses, done) {
  if (done.has(code)) return 'done';
  return satisfied(courses[code]?.prereq, done) ? 'ready' : 'locked';
}

/**
 * Build the nodes/edges for everything leading up to `target`.
 *
 * Edges point from prerequisite to course. AND prerequisites connect straight
 * into the course (every incoming line is required). OR groups get a small
 * "one of" node, and an AND nested inside an OR gets an "all of" node.
 *
 * @param {object} opts
 * @param {number} opts.maxDepth  stop expanding past this many levels (Infinity = all)
 * @param {boolean} opts.hideTaken  don't expand courses already taken
 * @param {Set<string>} opts.expanded  courses to expand even past maxDepth
 */
export function buildGraph(
  target,
  courses,
  done,
  { maxDepth = Infinity, hideTaken = true, expanded = new Set() } = {},
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

  const shouldExpand = (code, depth) =>
    courses[code]?.prereq &&
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
    for (const ref of codesIn(courses[code].prereq)) {
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
        title: course?.title ?? 'Not in loaded data',
        status: courseStatus(code, courses, done),
        missing: !course,
        isTarget: code === target,
        collapsed: !!course?.prereq && !expand,
      },
    });
    if (expand) connect(course.prereq, code, true);
  }

  // Wire `tree` into the node `parentId`.
  function connect(tree, parentId, parentIsCourse) {
    if (typeof tree === 'string') {
      visitCourse(tree);
      addEdge(tree, parentId, done.has(tree));
      return;
    }
    if (tree.op === 'and' && parentIsCourse) {
      tree.args.forEach((a) => connect(a, parentId, true));
      return;
    }
    const met = satisfied(tree, done);
    // Once a "one of" is satisfied, the untaken alternatives are just noise.
    const args =
      hideTaken && met && tree.op === 'or' ? tree.args.filter((a) => satisfied(a, done)) : tree.args;
    if (args.length === 1) {
      connect(args[0], parentId, parentIsCourse);
      return;
    }
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
      args.forEach((a) => connect(a, id, false));
    }
    addEdge(id, parentId, met);
  }

  visitCourse(target);
  return layout([...nodes.values()], edges);
}

function codesIn(tree, out = []) {
  if (typeof tree === 'string') out.push(tree);
  else if (tree) tree.args.forEach((a) => codesIn(a, out));
  return out;
}

function layout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  // Copy the size: dagre writes x/y onto the label object it's given.
  for (const n of nodes) g.setNode(n.id, { ...(n.type === 'course' ? COURSE_SIZE : JUNCTION_SIZE) });
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
