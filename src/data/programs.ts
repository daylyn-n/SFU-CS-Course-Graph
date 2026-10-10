// SFU Computing Science program requirements, transcribed by hand from the
// Fall 2026 academic calendar. Each program records its source page; anything
// the calendar leaves open is listed in `caveats` rather than guessed.
//
// The Table I concentration lists are shared by the major and the minor.

import type { CourseSet, Program, Requirement } from '../lib/degree';

const CAL = 'https://www.sfu.ca/students/calendar/2026/fall/programs';
const CALENDAR = 'Fall 2026';

const MATH_FOOTNOTE = 'MATH 154/155/157/158 only with a grade of at least B+ and with school permission.';

/** Table I – Computing Science Concentrations (major and minor pages). */
export const TABLE_I: { name: string; codes: string[] }[] = [
  {
    name: 'Artificial Intelligence',
    codes: ['CMPT 310', 'CMPT 340', 'CMPT 410', 'CMPT 411', 'CMPT 413', 'CMPT 417', 'CMPT 419', 'CMPT 420'],
  },
  {
    name: 'Visual and Interactive Computing',
    codes: ['CMPT 361', 'CMPT 363', 'CMPT 365', 'CMPT 412', 'CMPT 461', 'CMPT 464', 'CMPT 466', 'CMPT 467', 'CMPT 469'],
  },
  {
    name: 'Computing Systems',
    codes: [
      'CMPT 303', 'CMPT 305', 'CMPT 371', 'CMPT 379', 'CMPT 403', 'CMPT 431',
      'CMPT 433', 'CMPT 450', 'CMPT 471', 'CMPT 479', 'CMPT 499',
    ],
  },
  {
    name: 'Information Systems',
    codes: ['CMPT 353', 'CMPT 354', 'CMPT 362', 'CMPT 372', 'CMPT 441', 'CMPT 454', 'CMPT 456', 'CMPT 459', 'CMPT 474'],
  },
  {
    name: 'Programming Languages and Software',
    codes: ['CMPT 373', 'CMPT 383', 'CMPT 384', 'CMPT 473', 'CMPT 475', 'CMPT 477', 'CMPT 489'],
  },
  {
    name: 'Theoretical Computing Science',
    codes: [
      'CMPT 307', 'CMPT 308', 'CMPT 404', 'CMPT 405', 'CMPT 406', 'CMPT 407',
      'CMPT 409', 'CMPT 476', 'MACM 476', 'MACM 300',
    ],
  },
];

/** Table III – Computing Mathematics Courses. (Table II currently lists no courses.) */
export const TABLE_III = ['MACM 316', 'MACM 401', 'MACM 442', 'MATH 308', 'MATH 340', 'MATH 343'];

const TABLE_I_CODES = TABLE_I.flatMap((a) => a.codes);

/** Cross-listed courses that only count once. */
const EQUIVALENTS = [['CMPT 476', 'MACM 476']];

const UPPER_ANY: CourseSet = { ranges: [{ subjects: ['*'], from: 300, to: 499 }] };
const UPPER_CMPT: CourseSet = { ranges: [{ subjects: ['CMPT'], from: 300, to: 499 }] };

const calculus = (): Requirement[] => [
  {
    id: 'calc1',
    title: 'Calculus I',
    kind: 'oneOf',
    options: [['MATH 150'], ['MATH 151'], ['MATH 154'], ['MATH 157']],
    note: MATH_FOOTNOTE,
  },
  {
    id: 'calc2',
    title: 'Calculus II',
    kind: 'oneOf',
    options: [['MATH 152'], ['MATH 155'], ['MATH 158']],
    note: MATH_FOOTNOTE,
  },
];

const req = (code: string): Requirement => ({ id: code, title: code, kind: 'course', code });

export const PROGRAMS: Program[] = [
  {
    id: 'cmpt-major-bsc',
    name: 'Computing Science Major',
    credential: 'BSc',
    calendar: CALENDAR,
    source: `${CAL}/computing-science/major/bachelor-of-science-or-bachelor-of-arts.html`,
    equivalents: EQUIVALENTS,
    sections: [
      {
        title: 'Lower division',
        requirements: [
          ...['CMPT 105W', 'CMPT 120', 'CMPT 125', 'CMPT 201', 'CMPT 210', 'CMPT 225', 'CMPT 276', 'CMPT 295', 'MACM 101', 'STAT 271'].map(req),
          ...calculus(),
          { id: 'linalg', title: 'Linear algebra', kind: 'oneOf', options: [['MATH 232'], ['MATH 240']] },
        ],
      },
      {
        title: 'Upper division core',
        note: 'CMPT 354 is also recommended.',
        requirements: [req('CMPT 307'), req('CMPT 376W')],
      },
      {
        title: 'Breadth and depth',
        requirements: [
          {
            id: 'breadth',
            title: 'Breadth: four of the six Table I areas',
            kind: 'areas',
            count: 4,
            areas: TABLE_I,
            shared: true,
            note: 'One course from each of four different areas; one of them must be CMPT 307.',
          },
          {
            id: 'depth',
            title: 'Depth: 12 units of CMPT 400-level',
            kind: 'choose',
            from: { ranges: [{ subjects: ['CMPT'], from: 400, to: 499 }], exclude: ['CMPT 415', 'CMPT 416', 'CMPT 498'] },
            units: 12,
            shared: true,
            note: 'CMPT 415, 416 and 498 count only by special permission.',
          },
        ],
      },
      {
        title: 'BSc credential',
        note: 'In addition to the 30 upper division CMPT units.',
        requirements: [
          req('MACM 316'),
          {
            id: 'bsc-tables',
            title: 'Two courses from Table I, II or III',
            kind: 'choose',
            from: { codes: [...TABLE_I_CODES, ...TABLE_III], exclude: ['MACM 316'] },
            courses: 2,
            note: 'Must be beyond the 30 upper division CMPT units below.',
          },
        ],
      },
      {
        title: 'Unit totals',
        requirements: [
          {
            id: 'ud-cmpt',
            title: '30 upper division CMPT units',
            kind: 'choose',
            from: UPPER_CMPT,
            units: 30,
            shared: true,
            notCountingFrom: ['bsc-tables'],
          },
          {
            id: 'ud-total',
            title: '45 upper division units',
            kind: 'choose',
            from: UPPER_ANY,
            units: 45,
            shared: true,
            note: 'Any subject. Only courses in this app’s data can be suggested; electives elsewhere count too.',
          },
        ],
      },
    ],
    caveats: [
      'The BSc credential lists "two courses chosen from Table I, Table II or Table III" next to MACM 316. This reads it as MACM 316 plus two more courses, both beyond the 30 upper division CMPT units; check with an advisor.',
      'Breadth and depth are treated as overlapping the other requirements (a course can count for both), as the calendar says concentration courses may also meet other requirements.',
      'Courses in "Other Courses Per Department Approval" (CMPT 318, 415, 416, 496, 497, 498) need school permission to count in a table, so they are not counted here.',
      'Not modelled: GPA and grade minimums, WQB, residency, total degree units (120), and the BA/BEd credentials.',
    ],
  },
  {
    id: 'sosy-major-bsc',
    name: 'Software Systems Major',
    credential: 'BSc',
    calendar: CALENDAR,
    source: `${CAL}/software-systems/major/bachelor-of-science.html`,
    equivalents: EQUIVALENTS,
    sections: [
      {
        title: 'Lower division',
        requirements: [
          {
            id: 'writing',
            title: 'Writing',
            kind: 'oneOf',
            options: [['CMPT 105W'], ['ENSC 105W'], ['MSE 101W'], ['SEE 101W']],
          },
          ...['CMPT 130', 'CMPT 135', 'CMPT 201', 'CMPT 210', 'CMPT 213', 'CMPT 225', 'CMPT 276', 'CMPT 295', 'MACM 101', 'STAT 271'].map(req),
          ...calculus(),
          {
            id: 'linalg',
            title: 'Linear algebra',
            kind: 'oneOf',
            options: [['MATH 232'], ['MATH 240']],
            note: 'MATH 240 only with a grade of at least B+ and with school permission.',
          },
        ],
      },
      {
        title: 'Upper division core',
        requirements: [req('CMPT 307'), req('CMPT 376W')],
      },
      {
        title: 'Systems',
        requirements: [
          {
            id: 'systems',
            title: '12 units of systems courses',
            kind: 'choose',
            from: { codes: ['CMPT 303', 'CMPT 354', 'CMPT 371', 'CMPT 372', 'CMPT 431', 'CMPT 433', 'CMPT 454', 'CMPT 471'] },
            units: 12,
          },
        ],
      },
      {
        title: 'Software engineering',
        requirements: [
          req('CMPT 373'),
          req('CMPT 473'),
          {
            id: 'se-electives',
            title: 'Two software engineering electives',
            kind: 'choose',
            from: { codes: ['CMPT 379', 'CMPT 383', 'CMPT 384', 'CMPT 474', 'CMPT 477'] },
            courses: 2,
          },
        ],
      },
      {
        title: 'Capstone',
        requirements: [
          {
            id: 'capstone',
            title: 'Capstone project',
            kind: 'oneOf',
            options: [
              ['CMPT 494', 'CMPT 495'],
              ['CMPT 379', 'CMPT 431'],
              ['CMPT 379', 'CMPT 433'],
              ['CMPT 431', 'CMPT 433'],
            ],
            note: 'Either CMPT 494 and 495, or two of CMPT 379, 431, 433.',
          },
        ],
      },
      {
        title: 'Depth and totals',
        requirements: [
          {
            id: 'sosy-depth',
            title: '6 more CMPT or MACM units at the 300/400 level',
            kind: 'choose',
            from: { ranges: [{ subjects: ['CMPT', 'MACM'], from: 300, to: 499 }], exclude: ['CMPT 415', 'CMPT 416', 'CMPT 498'] },
            units: 6,
            note: '"Additional" to the courses above. CMPT 415, 416 and 498 only with school permission.',
          },
          {
            id: 'sosy-400',
            title: '12 CMPT or MACM units at the 400 level',
            kind: 'choose',
            from: { ranges: [{ subjects: ['CMPT', 'MACM'], from: 400, to: 499 }], exclude: ['CMPT 415', 'CMPT 416', 'CMPT 498'] },
            units: 12,
            shared: true,
          },
          {
            id: 'ud-total',
            title: '45 upper division units',
            kind: 'choose',
            from: UPPER_ANY,
            units: 45,
            shared: true,
            note: 'Any subject. Only courses in this app’s data can be suggested; electives elsewhere count too.',
          },
        ],
      },
    ],
    caveats: [
      'The calendar doesn’t say whether CMPT 379/431/433 used for the capstone may also count toward the systems or software engineering lists. Here each course counts for only one of those three.',
      'CMPT 120/125 are not listed as substitutes for CMPT 130/135; ask an advisor if you took those.',
      'ENSC 105W, MSE 101W and SEE 101W are not in this app’s course data, but still count if marked taken.',
      'Not modelled: GPA and grade minimums, WQB, residency and total degree units.',
    ],
  },
  {
    id: 'cmpt-minor',
    name: 'Computing Science Minor',
    credential: 'Minor',
    calendar: CALENDAR,
    source: `${CAL}/computing-science/minor.html`,
    equivalents: EQUIVALENTS,
    sections: [
      {
        title: 'Lower division',
        note: 'You must also meet CMPT 225’s prerequisites: CMPT 125, 126 or 135, and MACM 101 (or equivalents).',
        requirements: [req('CMPT 225')],
      },
      {
        title: 'Upper division',
        requirements: [
          {
            id: 'minor-list',
            title: '12 units from the minor list',
            kind: 'choose',
            from: { codes: [...TABLE_I_CODES, ...TABLE_III] },
            units: 12,
            note: 'Any of the six concentration areas or the computing mathematics courses.',
          },
          {
            id: 'minor-ud',
            title: '15 upper division CMPT or MACM units',
            kind: 'choose',
            from: { ranges: [{ subjects: ['CMPT', 'MACM'], from: 300, to: 499 }] },
            units: 15,
            shared: true,
            note: 'Includes the 12 units above.',
          },
        ],
      },
    ],
    caveats: [
      'The list includes MATH 308, 340 and 343 (Table III) even though the 15-unit total names only CMPT or MACM courses, so a MATH course counts toward the 12 but not the 15.',
      'Open only to students majoring outside computing science. Not modelled: the 2.00 upper division GPA.',
    ],
  },
];

export const DEFAULT_PROGRAM = PROGRAMS[0].id;
