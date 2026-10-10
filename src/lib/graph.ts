import dagre from '@dagrejs/dagre';
import type { Courses, Prereq, Status, Taken, Term } from './types';

// Rendered sizes of the node components. dagre needs these up front.
export const COURSE_SIZE = { width: 200, height: 60 };
export const JUNCTION_SIZE = { width: 64, height: 26 };

export interface GraphOptions {
  /** stop expanding past this many levels (Infinity = all) */
  maxDepth?: number;
  /** don't expand courses already taken */
  hideTaken?: boolean;
  /** courses to expand even past maxDepth */
  expanded?: ReadonlySet<string>;
  /** terms a course runs in */
  offeredIn?: (code: string) => Term[];
}

export interface CourseNodeData {
  code: string;
  title: string;
  status: Status;
  missing: boolean;
  isTarget: boolean;
  collapsed: boolean;
  offered: Term[];
  [key: string]: unknown;
}

export interface JunctionNodeData {
  label: 'one of' | 'all of';
  met: boolean;
  [key: string]: unknown;
}

export type GraphNode =
  | { id: string; type: 'course'; data: CourseNodeData; position: { x: number; y: number } }
  | { id: string; type: 'junction'; data: JunctionNodeData; position: { x: number; y: number } };

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  class: string;
}

/** Is a prerequisite tree satisfied by the set of taken courses? */
export function satisfied(tree: Prereq | null | undefined, done: Taken): boolean {
  if (tree == null) return true;
  if (typeof tree === 'string') return done.has(tree);
  return tree.op === 'and'
    ? tree.args.every((a) => satisfied(a, done))
    : tree.args.some((a) => satisfied(a, done));
}

/** 'done' | 'ready' (can take it now) | 'locked' */
export function courseStatus(code: string, courses: Courses, done: Taken): Status {
  if (done.has(code)) return 'done';
  return satisfied(courses[code]?.prereq, done) ? 'ready' : 'locked';
}

/**
 * Build the nodes/edges for everything leading up to `target`.
 *
 * Edges point from prerequisite to course. AND prerequisites connect straight
 * into the course (every incoming line is required). OR groups get a small
 * "one of" node, and an AND nested inside an OR gets an "all of" node.
 */
export function buildGraph(
  target: string,
  courses: Courses,
  done: Taken,
  { maxDepth = Infinity, hideTaken = true, expanded = new Set(), offeredIn = () => [] }: GraphOptions = {},
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, Omit<GraphNode, 'position'>>();
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

  const shouldExpand = (code: string, depth: number | undefined): boolean =>
    !!courses[code]?.prereq &&
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
    for (const ref of codesIn(courses[code].prereq)) {
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
        title: course?.title ?? 'Not in loaded data',
        status: courseStatus(code, courses, done),
        missing: !course,
        isTarget: code === target,
        collapsed: !!course?.prereq && !expand,
        offered: offeredIn(code),
      },
    });
    if (expand) connect(course.prereq!, code, true);
  }

  // Wire `tree` into the node `parentId`.
  function connect(tree: Prereq, parentId: string, parentIsCourse: boolean) {
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
      const newId = `j${junctions.size}`;
      id = newId;
      junctions.set(key, id);
      nodes.set(id, {
        id,
        type: 'junction',
        data: { label: tree.op === 'or' ? 'one of' : 'all of', met },
      });
      args.forEach((a) => connect(a, newId, false));
    }
    addEdge(id, parentId, met);
  }

  visitCourse(target);
  return layout([...nodes.values()], edges);
}

/** Every course code mentioned anywhere in a prerequisite tree. */
export function codesIn(tree: Prereq | null | undefined, out: string[] = []): string[] {
  if (typeof tree === 'string') out.push(tree);
  else if (tree) tree.args.forEach((a) => codesIn(a, out));
  return out;
}

function layout(nodes: Omit<GraphNode, 'position'>[], edges: GraphEdge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  // Copy the size: dagre writes x/y onto the label object it's given.
  for (const n of nodes) g.setNode(n.id, { ...(n.type === 'course' ? COURSE_SIZE : JUNCTION_SIZE) });
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
