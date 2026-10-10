import { expect, it } from 'vitest';
import { designationBadges } from './details';

it('designation badges', () => {
  expect(designationBadges('N/A')).toEqual([]);
  expect(designationBadges('Quantitative/Breadth-Science').map((b) => b.short)).toEqual(['Q', 'B-Sci']);
  expect(designationBadges('Writing/Breadth-Humanities/Social Sciences').map((b) => b.short)).toEqual([
    'W',
    'B-Hum/Soc',
  ]);
  // Every spelling found in the real data.
  const cases: Record<string, string[]> = {
    'Writing/Breadth-Social Sci': ['W', 'B-Soc'],
    'Quantitative/Breadth-Soc': ['Q', 'B-Soc'],
    'Breadth-Social Sci/Science': ['B-Soc/Sci'],
    'Writing/Breadth-Hum/Soc Sci': ['W', 'B-Hum/Soc'],
    'Writing/Quantitative': ['W', 'Q'],
    'Breadth-Humanities/Sciences': ['B-Hum/Sci'],
  };
  for (const [raw, shorts] of Object.entries(cases)) {
    expect(designationBadges(raw).map((b) => b.short), raw).toEqual(shorts);
  }
  expect(designationBadges('Quantitative/Breadth-Soc')[1].label).toBe('Breadth-Social Sciences');
});
