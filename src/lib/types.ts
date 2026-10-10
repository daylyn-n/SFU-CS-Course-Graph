/** A prerequisite tree: a course code, or an and/or group of subtrees. */
export type Prereq = string | { op: 'and' | 'or'; args: Prereq[] };

export interface Course {
  title: string;
  units: string;
  prereqText: string;
  prereq: Prereq | null;
}

export type Courses = Record<string, Course>;

export interface Term {
  id: string; // e.g. "2026/fall"
  label: string; // "Fall 2026"
  short: string; // "Fa26"
  current: boolean;
}

export interface Section {
  section: string;
  instructors: string[];
  campus: string;
  delivery: string;
  schedule: string;
}

/** course code -> term id -> lecture sections */
export type Offerings = Record<string, Record<string, Section[]>>;

export type Status = 'done' | 'ready' | 'locked';

/** Read-only view of the taken set; SvelteSet and Set both fit. */
export type Taken = ReadonlySet<string>;

/** Which main view the canvas shows. */
export type View = 'graph' | 'list' | 'explore' | 'plan' | 'timetable' | 'degree';
