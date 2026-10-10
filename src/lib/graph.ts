import dagre from '@dagrejs/dagre';
import type { Courses, OtherReq, Prereq, Status, Taken, Term } from './types';

// Rendered sizes of the node components. dagre needs these up front.
export const COURSE_SIZE = { width: 224, height: 60 };
export const JUNCTION_SIZE = { width: 64, height: 26 };
export const OTHER_SIZE = { width: 170, height: 26 };

export interface GraphOptions {
  /** stop expanding past this many levels (Infinity = all) */
  maxDepth?: number;
  /** don't expand courses already taken */
  hideTaken?: boolean;
  /** courses to expand even past maxDepth */
  expanded?: ReadonlySet<string>;
  /** terms a course runs in */
  offeredIn?: (code: string) => Term[];
  /** courses filled in from the ones you've ticked (see implied.ts) */
  implied?: ReadonlyMap<string, { via: string; certain: boolean }>;
}

export interface CourseNodeData {
  code: string;
  title: string;
  status: Status;
  missing: boolean;
  isTarget: boolean;
  collapsed: boolean;
  offered: Term[];
  /** filled in from a ticked course: required ('certain') or our guess ('assumed') */
  inferred: 'certain' | 'assumed' | null;
  /** the course it was filled in from */
  via: string | null;
  [key: string]: unknown;
}

export interface JunctionNodeData {
  label: 'one of' | 'all of';
  met: boolean;
  [key: string]: unknown;
}

export interface OtherNodeData {
  label: string;
  [key: string]: unknown;
}

type Position = { x: number; y: number };
export type GraphNode =
  | { id: string; type: 'course'; data: CourseNodeData; position: Position }
  | { id: string; type: 'junction'; data: JunctionNodeData; position: Position }
  | { id: string; type: 'other'; data: OtherNodeData; position: Position };
type UnplacedNode = GraphNode extends infer N ? (N extends GraphNode ? Omit<N, 'position'> : never) : never;

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  class: string;
}

const isOther = (tree: Prereq): tree is OtherReq => typeof tree === 'object' && 'other' in tree;

/**
 * Is a prerequisite tree satisfied by the set of taken courses? Leaves like
 * { other: 'Pre-Calculus 12' } can't be checked: they count as `others`
 * (false by default, i.e. not definitely met).
 */
export function satisfied(tree: Prereq | null | undefined, done: Taken, others = false): boolean {
  if (tree == null) return true;
  if (typeof tree === 'string') return done.has(tree);
  if (isOther(tree)) return others;
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
export function courseStatus(code: string, courses: Courses, done: Taken): Status {
  if (done.has(code)) return 'done';
  const course = courses[code];
  if (!course) return 'locked';
  const tree = prune(course.prereq, code);
  if (!satisfied(tree, done)) return satisfied(tree, done, true) ? 'unknown' : 'locked';
  return !tree && hasUnreadRequirements(course.prereqText) ? 'unknown' : 'ready';
}

// True when prerequisite text has something besides advice, e.g. "60 units"
// or "BC Pre-Calculus 12", which the parser can't turn into courses.
function hasUnreadRequirements(text = ''): boolean {
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
export function nextSteps(target: string, courses: Courses, done: Taken): string[][] {
  const costs = new Map<string, number | null>();
  // Untaken courses needed to be able to take `code`, along the cheapest path.
  function cost(code: string): number {
    if (done.has(code)) return 0;
    if (costs.has(code)) return costs.get(code) ?? 1; // null = in progress (cycle)
    costs.set(code, null);
    const c = 1 + treeCost(prune(courses[code]?.prereq, code, done));
    costs.set(code, c);
    return c;
  }
  function treeCost(tree: Prereq | null): number {
    if (tree == null) return 0;
    // Most students have Pre-Calculus 12 and the like, so those are free. But
    // "or permission"/"or equivalent" and program-only paths ("for Applied
    // Physics students") shouldn't hide the regular course route.
    if (isOther(tree)) return tree.only || /permission|equivalent|admission/i.test(tree.other) ? 50 : 0;
    if (typeof tree === 'string') return cost(tree);
    const each = tree.args.map(treeCost);
    return tree.op === 'and' ? each.reduce((a, b) => a + b, 0) : Math.min(...each);
  }

  const groups: string[][] = [];
  const seen = new Set<string>();
  function plan(tree: Prereq | null): void {
    if (tree == null || isOther(tree) || satisfied(tree, done)) return;
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
    const takeable = (a: Prereq): a is string =>
      typeof a === 'string' && !!courses[a] && courseStatus(a, courses, done) !== 'locked';
    if (best.length > 1 && best.every(takeable)) groups.push(best as string[]);
    else plan(best[0]);
  }
  plan(prune(courses[target]?.prereq, target, done));

  // A course that's required on its own makes any "pick one" containing it moot.
  const required = new Set(groups.filter((g) => g.length === 1).map((g) => g[0]));
  const keys = new Set<string>();
  return groups.filter((g) => {
    if (g.length > 1 && g.some((c) => required.has(c))) return false;
    const key = [...g].sort().join();
    return keys.has(key) ? false : !!keys.add(key);
  });
}

/**
 * The part of a prerequisite tree worth drawing: drops references to the
 * course itself and, with `done` given, the untaken alternatives of any
 * "one of" that is already satisfied.
 */
function prune(tree: Prereq | null | undefined, self: string, done: Taken | null = null): Prereq | null {
  if (tree == null) return null;
  if (isOther(tree)) return tree;
  if (typeof tree === 'string') return tree === self ? null : tree;
  let args = tree.args.map((a) => prune(a, self, done)).filter((a): a is Prereq => a != null);
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
 */
export function buildGraph(
  target: string,
  courses: Courses,
  done: Taken,
  {
    maxDepth = Infinity,
    hideTaken = true,
    expanded = new Set(),
    offeredIn = () => [],
    implied = new Map(),
  }: GraphOptions = {},
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, UnplacedNode>();
  const edges: GraphEdge[] = [];
  // Identical groups (e.g. "one of MATH 150, MATH 151") share one node.
  const junctions = new Map<string, string>();

  function addEdge(source: string, targetId: string, met: boolean) {
    if (edges.some((e) => e.source === source && e.target === targetId)) return;
    edges.push({
      id: `${source}->${targetId}`,
      source,
      target: targetId,
      class: met ? 'met' : '',
    });
  }

  const prereqOf = (code: string) => prune(courses[code]?.prereq, code, hideTaken ? done : null);
  const shouldExpand = (code: string, depth: number | undefined): boolean =>
    !!prereqOf(code) &&
    depth !== undefined &&
    (depth < maxDepth || expanded.has(code)) &&
    !(hideTaken && done.has(code));

  // Breadth-first pass so each course gets the depth of its shortest path
  // to the target, which decides where the depth cutoff lands.
  const depthOf = new Map<string, number>([[target, 0]]);
  const queue = [target];
  while (queue.length) {
    const code = queue.shift()!;
    const depth = depthOf.get(code)!;
    if (!shouldExpand(code, depth)) continue;
    for (const ref of codesIn(prereqOf(code))) {
      if (!depthOf.has(ref)) {
        depthOf.set(ref, depth + 1);
        queue.push(ref);
      }
    }
  }

  function visitCourse(code: string) {
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
        inferred: implied.has(code) ? (implied.get(code)!.certain ? 'certain' : 'assumed') : null,
        via: implied.get(code)?.via ?? null,
      },
    });
    const tree = prereqOf(code);
    if (expand && tree) connect(tree, code, true);
  }

  // Wire `tree` into the node `parentId`.
  function connect(tree: Prereq, parentId: string, parentIsCourse: boolean) {
    if (typeof tree === 'string') {
      visitCourse(tree);
      addEdge(tree, parentId, done.has(tree));
      return;
    }
    if (isOther(tree)) {
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
      const newId = `j${junctions.size}`;
      id = newId;
      junctions.set(key, newId);
      nodes.set(newId, {
        id: newId,
        type: 'junction',
        data: { label: tree.op === 'or' ? 'one of' : 'all of', met },
      });
      tree.args.forEach((a) => connect(a, newId, false));
    }
    addEdge(id, parentId, met);
  }

  visitCourse(target);
  return layout([...nodes.values()], edges);
}

/** Every course code mentioned anywhere in a prerequisite tree. */
export function codesIn(tree: Prereq | null | undefined, out: string[] = []): string[] {
  if (typeof tree === 'string') out.push(tree);
  else if (tree && !isOther(tree)) tree.args.forEach((a) => codesIn(a, out));
  return out;
}

function layout(nodes: UnplacedNode[], edges: GraphEdge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  // Copy the size: dagre writes x/y onto the label object it's given.
  const sizes = { course: COURSE_SIZE, junction: JUNCTION_SIZE, other: OTHER_SIZE };
  for (const n of nodes) g.setNode(n.id, { ...sizes[n.type] });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  return {
    nodes: nodes.map((n): GraphNode => {
      const { x, y, width, height } = g.node(n.id);
      // dagre gives centres; Svelte Flow wants top-left corners.
      return { ...n, position: { x: x - width / 2, y: y - height / 2 } } as GraphNode;
    }),
    edges,
  };
}

/** Ids of every node upstream or downstream of `id` (plus `id` itself). */
export function pathThrough({ edges }: { edges: GraphEdge[] }, id: string): Set<string> {
  const keep = new Set([id]);
  const walk = (from: 'source' | 'target', to: 'source' | 'target') => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
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
