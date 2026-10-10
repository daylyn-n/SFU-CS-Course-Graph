// Program ids shared by the app and scripts/fetch-programs.ts (no imports, so
// Node can load it directly).

/** Calendar program value ('computing-science/minor') -> file-safe id ('computing-science~minor'). */
export const programIdFromValue = (value: string): string => value.replace(/\//g, '~');

/** File-safe id -> calendar program value. */
export const valueFromProgramId = (id: string): string => id.replace(/~/g, '/');

/** Calendar page for a program value. */
export const calendarUrl = (term: string, value: string): string =>
  `https://www.sfu.ca/students/calendar/${term}/programs/${value}.html`;

/**
 * Hand-written programs (src/data/programs.ts) and the calendar programs they
 * replace. The curated version wins: it's more precise than the converter.
 */
export const CURATED_CALENDAR_IDS: Record<string, string> = {
  'cmpt-major-bsc': 'computing-science~major~bachelor-of-science-or-bachelor-of-arts',
  'sosy-major-bsc': 'software-systems~major~bachelor-of-science',
  'cmpt-minor': 'computing-science~minor',
};

/** One row of public/data/programs/index.json. */
export interface ProgramIndexEntry {
  /** File-safe id; the program file is programs/<id>.json. */
  id: string;
  /** e.g. 'Biological Sciences' */
  title: string;
  /** e.g. 'Biological Sciences Major' */
  fullTitle: string;
  /** Short credential: 'BSc', 'BA or BBA', 'Minor', 'Certificate', ... */
  credential: string;
  /** Calendar award type: 'Major', 'Honours', 'Joint Major', 'Minor', '' (certificates) ... */
  awardType: string;
  faculty: string;
  /** Area of study it's listed under (calendar value). */
  area: string;
  /** A hand-written version exists and is used instead of the converted file. */
  curated?: string;
}
