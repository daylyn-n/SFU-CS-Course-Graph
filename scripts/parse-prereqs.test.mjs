// Regression tests for the prerequisite parser, using real SFU calendar text.
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrereqs } from './parse-prereqs.mjs';

const DEPTS = new Set(['MATH', 'PHYS', 'CMPT', 'MACM', 'STAT', 'ECON', 'BUS', 'BUEC', 'ENSC', 'POL', 'SDA', 'MSE']);

// Compact rendering: AND is " & ", OR is " | ", nested groups in parentheses,
// non-course alternatives in brackets.
function show(tree, top = true) {
  if (tree == null) return 'null';
  if (typeof tree === 'string') return tree;
  if (tree.other) return `[${tree.other}]`;
  const inner = tree.args.map((a) => show(a, false)).join(tree.op === 'and' ? ' & ' : ' | ');
  return top ? inner : `(${inner})`;
}

const CASES = {
  'CMPT 410': [
    'Prerequisite: CMPT 310 and MACM 316, both with a minimum grade of C-.',
    'CMPT 310 & MACM 316',
  ],
  'CMPT 225': [
    'Prerequisite: (MACM 101 and (CMPT 125, CMPT 129 or CMPT 135)) or (ENSC 251 and ENSC 252), all with a minimum grade of C-.',
    '(MACM 101 & (CMPT 125 | CMPT 129 | CMPT 135)) | (ENSC 251 & ENSC 252)',
  ],
  'CMPT 307': [
    'Prerequisite: CMPT 225, (MACM 201 or CMPT 210), (MATH 150 or MATH 151), and (MATH 232 or MATH 240), all with a minimum grade of C-. MATH 154 or MATH 157 with a grade of at least B+ may be substituted for MATH 150 or MATH 151.',
    'CMPT 225 & (MACM 201 | CMPT 210) & (MATH 150 | MATH 151) & (MATH 232 | MATH 240)',
  ],
  'MACM 316': [
    'Prerequisite: MATH 152 or 155 or 158, and MATH 232 or 240, and computing experience.',
    '(MATH 152 | MATH 155 | MATH 158) & (MATH 232 | MATH 240)',
  ],
  // Not CMPT 125's own text (that is "CMPT 120 or CMPT 130"); the key is passed
  // as `self`, so it must not be one of the listed courses.
  'One of list': [
    'Prerequisite: One of CMPT 125, CMPT 128, CMPT 135 or CMPT 129, with a minimum grade of C-.',
    'CMPT 125 | CMPT 128 | CMPT 135 | CMPT 129',
  ],
  'STAT 270': [
    'Prerequisite or Corequisite: MATH 152 or 155 or 158, with a minimum grade of C-. Students wishing an intuitive appreciation of a broad range of statistical strategies may wish to take STAT 100 first.',
    'MATH 152 | MATH 155 | MATH 158',
  ],
  // A. Notes and self-references
  'CMPT 404': [
    'Prerequisite: (MACM 201 or CMPT 210) with a minimum grade of C-. CMPT 307 and 308 are recommended.',
    'MACM 201 | CMPT 210',
  ],
  'STAT 240': [
    'Prerequisite: One of STAT 201, STAT 203, STAT 205, STAT 270, BUS 232, or ECON 233, and one of CMPT 102, CMPT 120, CMPT 125, CMPT 128, CMPT 129, CMPT 130, all with a minimum grade of C- or permission of the instructor. STAT 260 is also recommended.',
    '((STAT 201 | STAT 203 | STAT 205 | STAT 270 | BUS 232 | ECON 233) & (CMPT 102 | CMPT 120 | CMPT 125 | CMPT 128 | CMPT 129 | CMPT 130)) | [permission of instructor]',
  ],
  'MATH 252': [
    'Prerequisite: MATH 240 or 232, and 251, all with a minimum grade of C-. MATH 240 or 232 may be taken concurrently.',
    '(MATH 240 | MATH 232) & MATH 251',
  ],
  'ENSC 351': [
    'Prerequisite: (ENSC 151 and ENSC 215 and ENSC 250) or ENSC 254 or (CMPT 225 and (CMPT 250 or CMPT 295)), all with a minimum grade of C- and a minimum of 60 units. ENSC 351 is a required course for all engineering science major and honours students (no course substitutions are permitted).',
    '(ENSC 151 & ENSC 215 & ENSC 250) | ENSC 254 | (CMPT 225 & (CMPT 250 | CMPT 295))',
  ],
  // B. Alternative paths
  'MATH 468': [
    'Prerequisite: One of MATH 348, MATH 360; or MATH 260 and STAT 330; or CMPT 305 and one of MATH 232, MATH 240; or two of MACM 316, MATH 314, MATH 418, MATH 467. All with a minimum grade of C-.',
    'MATH 348 | MATH 360 | (MATH 260 & STAT 330) | (CMPT 305 & (MATH 232 | MATH 240)) | MACM 316 | MATH 314 | MATH 418 | MATH 467',
  ],
  'MATH 360': [
    'Prerequisite: MATH 155 with a minimum grade of B-; or one of MATH 152 or MATH 158, and one of MATH 232 or MATH 240, all with a minimum grade of C-.',
    'MATH 155 | ((MATH 152 | MATH 158) & (MATH 232 | MATH 240))',
  ],
  'MATH 260': [
    'Prerequisite: MATH 152 with a minimum grade of C-; or MATH 155 or 158, with a grade of at least B; MATH 232 or 240, with a minimum grade of C-.',
    '(MATH 152 | MATH 155 | MATH 158) & (MATH 232 | MATH 240)',
  ],
  'MATH 418': [
    'Prerequisite: (MATH 260 or MATH 310) and one of MATH 314, MATH 320, MATH 322, PHYS 384, all with a minimum grade of C-. An alternative to the above prerequisite is both of (MATH 252 or MATH 254) and (MATH 260 or MATH 310), both with grades of at least A-.',
    '((MATH 260 | MATH 310) & (MATH 314 | MATH 320 | MATH 322 | PHYS 384)) | ((MATH 252 | MATH 254) & (MATH 260 | MATH 310))',
  ],
  'MSE 210': ['Prerequisite: PHYS 141 or equivalent. MATH 150 or MATH 151.', '(PHYS 141 | [equivalent]) & (MATH 150 | MATH 151)'],
  'MATH 232': [
    'Prerequisite: MATH 150 or 151 or MACM 101, with a minimum grade of C-; or MATH 154 or 157, both with a grade of at least B.',
    'MATH 150 | MATH 151 | MACM 101 | MATH 154 | MATH 157',
  ],
  // C. Oxford comma
  'CMPT 210': [
    'Prerequisite: MACM 101, MATH 152, CMPT 125 or CMPT 135, and (MATH 240 or MATH 232), all with a minimum grade of C-.',
    'MACM 101 & MATH 152 & (CMPT 125 | CMPT 135) & (MATH 240 | MATH 232)',
  ],
  // D. "both" / "all of"
  'STAT 380': [
    'Prerequisite: STAT 330, or all of: STAT 285, MATH 208W, and MATH 251, all with a minimum grade of C-.',
    'STAT 330 | (STAT 285 & MATH 208W & MATH 251)',
  ],
  'PHYS 416': [
    'Prerequisite: PHYS 385; PHYS 384 or both MATH 314 and MATH 419, or equivalent. All prerequisite courses require a minimum grade of C-.',
    'PHYS 385 & (PHYS 384 | (MATH 314 & MATH 419) | [equivalent])',
  ],
  'MATH 480W': [
    'Prerequisite: MACM 201 with a grade of at least B. At least one of MACM 201, MATH 240, MATH 242, MATH 251, MATH 252 with a grade of at least A, or both of MACM 203, MACM 204 with a grade of at least A. Or permission of the instructor.',
    'MACM 201 & (MACM 201 | MATH 240 | MATH 242 | MATH 251 | MATH 252 | (MACM 203 & MACM 204) | [permission of instructor])',
  ],
  // E. Department codes
  'MATH 126': [
    'Prerequisite: A grade of C+ or higher in Math 125 or Math 152, and permission of the department. Recommended Corequisite: Physics 126.',
    'MATH 125 | MATH 152',
  ],
  'ECON 333': [
    'Prerequisite: ECON 103 with a minimum grade of C- or ECON 113 with a minimum grade of B-; ECON 233, BUS (or BUEC) 232, STAT 270, or STAT 271, with a minimum grade of C-; MATH 150, MATH 151, MATH 154, or MATH 157, with a minimum grade of C-; 45 units. Students with a minimum grade of A- in ECON 233, BUS (or BUEC) 232, STAT 270, or STAT 271 can take ECON 333 after 30 units.',
    '(ECON 103 | ECON 113) & (ECON 233 | BUS 232 | BUEC 232 | STAT 270 | STAT 271) & (MATH 150 | MATH 151 | MATH 154 | MATH 157)',
  ],
  // F. "students" phrases
  'POL 201': [
    'Prerequisite: For students in the SDA minor, SDA 100 or Corequisite: For non-SDA minor students, POL 200W or permission of department.',
    '[SDA minor students] & SDA 100',
  ],
  'CMPT 426': [
    'Prerequisite: Students must complete Bridging Online (visit www.sfu.ca/coop/bol for further details) at least two terms before their anticipated co-op placement. Students must then enroll with the co-op program by the second week of the term preceding the work term. Normally, students will have completed a minimum of 45 units by the end of the term of application, CMPT 275 or 276, and have a minimum CGPA of 2.50.',
    'CMPT 275 | CMPT 276',
  ],
  // Paths limited to a program keep that restriction.
  'CMPT 295': [
    'Prerequisite: Either (MACM 101 and (CMPT 125 or CMPT 135)) or (MATH 151 and CMPT 102 for students in an Applied Physics program), all with a minimum grade of C-.',
    '(MACM 101 & (CMPT 125 | CMPT 135)) | (MATH 151 & CMPT 102 & [Applied Physics program students])',
  ],
  'BPK 448': [
    'Prerequisite: BPK 201 or 207, and BPK 306, or for biomedical engineering students, BPK 201 and 208.',
    '((BPK 201 | BPK 207) & BPK 306) | ([biomedical engineering students] & BPK 201 & BPK 208)',
  ],
  'MATH 251': [
    'Prerequisite: MATH 152 with a minimum grade of C-; or MATH 158 with a grade of at least B. Also, for students in the life sciences, MATH 154 with a minimum grade of C- and MATH 155 with a minimum grade of A-. Recommended: It is recommended that MATH 240 or 232 be taken before or concurrently with MATH 251.',
    'MATH 152 | MATH 158 | ([life sciences students] & MATH 154 & MATH 155)',
  ],
  // G. Non-course alternatives inside an OR
  'MATH 150': [
    'Prerequisite: Pre-Calculus 12 (or equivalent) with a grade of at least B+, or MATH 100 with a grade of at least B-, or MATH 110 with a grade of at least A-.',
    'MATH 100 | MATH 110 | [Pre-Calculus 12]',
  ],
  'CMPT 130': [
    'Prerequisite: BC Math 12 (or equivalent, or any of MATH 100, 150, 151, 154, or 157, with a minimum grade of C-).',
    'MATH 100 | MATH 150 | MATH 151 | MATH 154 | MATH 157 | [BC Math 12]',
  ],
  'MACM 101': [
    'Prerequisite: BC Pre-Calculus 12 or BC Calculus 12 (or equivalent), or any of MATH 100, 150, 151, 154, 157.',
    'MATH 100 | MATH 150 | MATH 151 | MATH 154 | MATH 157 | [Pre-Calculus 12] | [Calculus 12]',
  ],
  'MATH 125': [
    'Prerequisite: MATH 150 or MATH 151 or MATH 154 with a grade of at least B or IB Mathematics HL with a score of 6 or better or AP Calculus AB or BC with a grade of at least 4, or BC Calculus 12 and a pass on the Calculus Challenge Exam. And Permission of the Department. Recommended corequisite: Physics 125.',
    'MATH 150 | MATH 151 | MATH 154 | [IB Math HL] | [AP Calculus] | [Calculus 12]',
  ],
  'CHEM 121': [
    'Prerequisite: Chemistry 12 with a minimum grade of B, or CHEM 109 or 111 with a minimum grade of C- or CHEM 110 and 115, both with a minimum grade of C-.',
    '(CHEM 109 | CHEM 111 | CHEM 110 | [Chemistry 12]) & CHEM 115',
  ],
  'FREN 201': [
    'Prerequisite: Grade 12 French or FREN 102 or FREN 122 or permission of the Department of French.',
    'FREN 102 | FREN 122 | [French 12] | [permission of department]',
  ],
  'CMPT 401': [
    'Prerequisite: One of CMPT 307, PHIL 310, MACM 201; or a minimum of six upper division units in MATH.',
    'CMPT 307 | PHIL 310 | MACM 201 | [6 units in MATH]',
  ],
  'STAT 337': [
    'Prerequisite: STAT 336 or Job Practicum I from another department. Students must apply and receive permission from the co-op co-ordinator at least one term in advance.',
    'STAT 336 | [Job Practicum]',
  ],
  'STAT 180': [
    'Prerequisite: Enrollment in the Statistics or Actuarial Science major or honours program, or STAT 270 with a minimum grade of C-.',
    'STAT 270 | [program admission]',
  ],
  'CA 274': ['Prerequisite: CA 185; or 30 units; or permission of instructor.', 'CA 185 | [30 units] | [permission of instructor]'],
  // "or permission" after a plain list joins the list...
  'CA 247': ['Prerequisite: CA 140, 144, 146 or permission of instructor.', 'CA 140 | CA 144 | CA 146 | [permission of instructor]'],
  // ...but after a grade it is an alternative to the whole clause.
  'MBB 432': [
    'Prerequisite: MBB 308, MBB 309W and MBB 331, all with a minimum grade of C, or permission of instructor.',
    '(MBB 308 & MBB 309W & MBB 331) | [permission of instructor]',
  ],
  // "A (or B)" is an alternative, not a second requirement.
  'IAT 272': ['Prerequisite: IAT 271 (or WKTM 100).', 'IAT 271 | WKTM 100'],
  // Non-course requirements ANDed with courses are dropped.
  'IAT 420': [
    'Prerequisite: Completion of 60 units, including IAT 320 or IAT 336, with a minimum grade of C-.',
    'IAT 320 | IAT 336',
  ],
  'BUS 498': ['Prerequisite: Permission of the faculty and BUS 360W with a minimum grade of C-; 60 units.', 'BUS 360W'],
  'PHYS 120': [
    "Prerequisite: BC Principles of Physics 12 or PHYS 100 or equivalent, with a minimum grade of C-. This prerequisite may be waived, at the discretion of the department, as determined by the student's performance on a regularly scheduled PHYS 100 final exam.",
    'PHYS 100 | [Principles of Physics 12]',
  ],
  // No course requirements
  'MATH 100': [
    'Prerequisite: Pre-Calculus 11 or Foundations of Mathematics 11 (or equivalent) with a grade of at least B or Pre-Calculus 12 (or equivalent), with a grade of at least C and SFU FAN credit, or SFU FAN X92 or FAN X99 course with a grade of at least B-.',
    'null',
  ],
  'CMPT 120': ['Prerequisite: BC Math 12 or equivalent is recommended.', 'null'],
  'CMPT 721': ['Prerequisite: Recommended: CMPT 310 or CMPT 710.', 'null'],
  'MATH 499W': ['Prerequisite: 18 units of upper division MATH or MACM courses.', 'null'],
};

for (const [code, [text, expected]] of Object.entries(CASES)) {
  test(code, () => {
    assert.equal(show(parsePrereqs(text, { self: code, depts: DEPTS })), expected);
  });
}
