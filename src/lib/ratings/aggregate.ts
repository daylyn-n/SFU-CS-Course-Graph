// Rating types and the pure maths that turns individual ratings into the
// percentages shown in the UI. No storage or Svelte here, so it's easy to test.

export type RatingKind = 'course' | 'prof';

/** A score on the 5-point scale: 1 = worst, 5 = best. */
export type Score = 1 | 2 | 3 | 4 | 5;

export interface Dimension {
  key: string;
  label: string; // "Easy"
  low: string; // label for 1, e.g. "Very hard"
  high: string; // label for 5, e.g. "Very easy"
}

/** The two things each kind is rated on, in the order of `Rating.scores`. */
export const DIMENSIONS: Record<RatingKind, readonly [Dimension, Dimension]> = {
  course: [
    { key: 'easy', label: 'Easy', low: 'Very hard', high: 'Very easy' },
    { key: 'useful', label: 'Useful', low: 'Not useful', high: 'Very useful' },
  ],
  prof: [
    { key: 'clear', label: 'Clear', low: 'Confusing', high: 'Very clear' },
    { key: 'engaging', label: 'Engaging', low: 'Dull', high: 'Very engaging' },
  ],
};

export const REVIEW_MAX = 500;

/** What a user fills in. `subject` is a course code ("CMPT 225") or a prof's name. */
export interface RatingInput {
  kind: RatingKind;
  subject: string;
  scores: [Score, Score];
  liked: boolean | null; // null = didn't say
  review: string;
  term: string | null; // e.g. "2026/fall"
  /** the prof a course was taken with, or the course a prof taught */
  context: string | null;
}

export interface Rating extends RatingInput {
  id: string;
  updatedAt: number; // ms since epoch
  mine: boolean; // written from this browser
}

export interface DimensionSummary extends Dimension {
  count: number;
  mean: number | null;
  percent: number | null; // mean mapped onto 0-100, null with no ratings
  /** how many gave each score, index 0 = score 1 */
  distribution: [number, number, number, number, number];
}

export interface Summary {
  count: number;
  dims: [DimensionSummary, DimensionSummary];
  liked: { count: number; percent: number | null }; // count = how many answered
  /** ratings with a written review, newest first */
  reviews: Rating[];
  mine: Rating | null;
}

/** Map a mean on the 1-5 scale to 0-100: 1 -> 0%, 3 -> 50%, 5 -> 100%. */
export function toPercent(mean: number): number {
  return Math.round(((mean - 1) / 4) * 100);
}

export function summarize(kind: RatingKind, ratings: readonly Rating[]): Summary {
  const dims = DIMENSIONS[kind].map((d, i) => {
    const distribution: DimensionSummary['distribution'] = [0, 0, 0, 0, 0];
    let total = 0;
    for (const r of ratings) {
      distribution[r.scores[i] - 1]++;
      total += r.scores[i];
    }
    const mean = ratings.length ? total / ratings.length : null;
    return { ...d, count: ratings.length, mean, percent: mean === null ? null : toPercent(mean), distribution };
  }) as Summary['dims'];

  const answered = ratings.filter((r) => r.liked !== null);
  const likes = answered.filter((r) => r.liked).length;

  return {
    count: ratings.length,
    dims,
    liked: { count: answered.length, percent: answered.length ? Math.round((likes / answered.length) * 100) : null },
    reviews: ratings.filter((r) => r.review.trim()).sort((a, b) => b.updatedAt - a.updatedAt),
    mine: ratings.find((r) => r.mine) ?? null,
  };
}

const isScore = (n: unknown): n is Score => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;

/**
 * Tidy user input before it's stored: trims text, caps the review length and
 * turns blanks into null. Throws if the scores aren't on the 1-5 scale.
 */
export function cleanInput(input: RatingInput): RatingInput {
  if (input.kind !== 'course' && input.kind !== 'prof') throw new Error(`Unknown rating kind ${input.kind}`);
  if (!input.scores.every(isScore)) throw new Error('Scores must be whole numbers from 1 to 5');
  const subject = input.subject.trim().replace(/\s+/g, ' ');
  if (!subject) throw new Error('Nothing to rate');
  return {
    kind: input.kind,
    subject,
    scores: [input.scores[0], input.scores[1]],
    liked: typeof input.liked === 'boolean' ? input.liked : null,
    review: input.review.trim().slice(0, REVIEW_MAX),
    term: input.term?.trim() || null,
    context: input.context?.trim() || null,
  };
}

/** Same check as cleanInput for data read back from storage; returns null if malformed. */
export function parseRating(raw: unknown): Rating | null {
  try {
    const r = raw as Rating;
    const clean = cleanInput({ ...r, review: r.review ?? '' });
    if (typeof r.id !== 'string' || typeof r.updatedAt !== 'number') return null;
    return { ...clean, id: r.id, updatedAt: r.updatedAt, mine: !!r.mine };
  } catch {
    return null;
  }
}
