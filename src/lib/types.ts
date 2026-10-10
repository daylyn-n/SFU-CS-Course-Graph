/**
 * A prerequisite tree: a course code, an and/or group of subtrees, or a
 * non-course requirement such as `{ other: 'Pre-Calculus 12' }`. Non-course
 * leaves only appear inside an OR, except program restrictions
 * (`only: true`, e.g. "Applied Physics program students"), which are ANDed
 * into the path they restrict.
 */
export type Prereq = string | { op: 'and' | 'or'; args: Prereq[] } | OtherReq;

export interface OtherReq {
  other: string;
  only?: true;
}

export interface Course {
  title: string;
  units: string;
  prereqText: string;
  prereq: Prereq | null;
}

export type Courses = Record<string, Course>;

/** public/data/courses.json */
export interface CourseData {
  term: string;
  fetched: string;
  depts: Record<string, string>;
  courses: Courses;
}

export interface Term {
  id: string; // e.g. "2026/fall"
  label: string; // "Fall 2026"
  short: string; // "Fa26"
  current: boolean;
}

/** One weekly meeting pattern, e.g. Tu/Th 11:30–13:20 (24h, zero-padded). */
export interface Block {
  days: string[];
  start: string;
  end: string;
  campus?: string;
}

export interface Section {
  section: string; // "D100"
  type?: string; // "LEC", "LAB", "TUT", ...
  /** true for the section you enrol in; false for its labs/tutorials */
  enrol?: boolean;
  /** links an enrol section to its components */
  assoc?: string;
  instructors?: string[];
  campus?: string;
  delivery?: string;
  /** human-readable meeting times, '' when online/TBA */
  schedule?: string;
  blocks?: Block[];
  exam?: { date: string; start: string; end: string };
}

/** course code -> term id -> sections (lectures and their labs/tutorials) */
export type Offerings = Record<string, Record<string, Section[]>>;

/** public/data/offerings.json */
export interface OfferingData {
  fetched: string;
  terms: Term[];
  offerings: Offerings;
}

/**
 * 'unknown' means the course may be open to you through a requirement that
 * isn't an SFU course (Pre-Calculus 12, permission, a units count).
 */
export type Status = 'done' | 'ready' | 'locked' | 'unknown';

/** Read-only view of the taken set; SvelteSet and Set both fit. */
export type Taken = ReadonlySet<string>;

/** Which main view the canvas shows. */
export type View = 'graph' | 'list' | 'explore' | 'plan' | 'degree' | 'schedule';
