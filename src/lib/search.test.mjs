import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCourse, searchCourses } from './search.js';
import { designationBadges } from './details.js';

const courses = {
  'CMPT 120': { title: 'Introduction to Computing Science and Programming I' },
  'CMPT 125': { title: 'Introduction to Computing Science and Programming II' },
  'CMPT 225': { title: 'Data Structures and Programming' },
  'CMPT 410': { title: 'Machine Learning' },
  'PHIL 100W': { title: 'Knowledge and Reality' },
};
const codes = (q) => searchCourses(q, courses).map((h) => h.code);

test('codes in any spacing or case', () => {
  assert.equal(matchCourse('cmpt225', courses), 'CMPT 225');
  assert.equal(matchCourse('CMPT 225 — Data Structures and Programming', courses), 'CMPT 225');
  assert.equal(matchCourse('phil 100w', courses), 'PHIL 100W');
});

test('names, including words out of order and partial words', () => {
  assert.equal(matchCourse('machine learning', courses), 'CMPT 410');
  assert.deepEqual(codes('intro prog'), ['CMPT 120', 'CMPT 125']);
  assert.deepEqual(codes('programming data'), ['CMPT 225']);
  assert.equal(matchCourse('intro prog', courses), null); // ambiguous
});

test('code prefixes rank before name matches', () => {
  assert.deepEqual(codes('cmpt 12'), ['CMPT 120', 'CMPT 125']);
});

test('no match', () => {
  assert.deepEqual(codes('zzz'), []);
  assert.equal(matchCourse('', courses), null);
});

test('designation badges', () => {
  assert.deepEqual(designationBadges('N/A'), []);
  assert.deepEqual(
    designationBadges('Quantitative/Breadth-Science').map((b) => b.short),
    ['Q', 'B-Sci'],
  );
  assert.deepEqual(
    designationBadges('Writing/Breadth-Humanities/Social Sciences').map((b) => b.short),
    ['W', 'B-Hum/Soc'],
  );
  // Every spelling found in the real data.
  const cases = {
    'Writing/Breadth-Social Sci': ['W', 'B-Soc'],
    'Quantitative/Breadth-Soc': ['Q', 'B-Soc'],
    'Breadth-Social Sci/Science': ['B-Soc/Sci'],
    'Writing/Breadth-Hum/Soc Sci': ['W', 'B-Hum/Soc'],
    'Writing/Quantitative': ['W', 'Q'],
    'Breadth-Humanities/Sciences': ['B-Hum/Sci'],
  };
  for (const [raw, shorts] of Object.entries(cases)) {
    assert.deepEqual(designationBadges(raw).map((b) => b.short), shorts, raw);
  }
  assert.equal(designationBadges('Quantitative/Breadth-Soc')[1].label, 'Breadth-Social Sciences');
});
