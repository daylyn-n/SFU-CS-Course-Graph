import { describe, expect, it } from 'vitest';
import { cleanInput, parseRating, summarize, toPercent, type Rating, type RatingInput } from './aggregate';
import { LocalRatingsStore, type KeyValueStorage } from './store';
import { createRatingsStore } from './index';
import { recentTerms, termLabel } from './context';

let n = 0;
function rating(over: Partial<Rating> = {}): Rating {
  return {
    id: String(++n),
    kind: 'course',
    subject: 'CMPT 225',
    scores: [3, 3],
    liked: null,
    review: '',
    term: null,
    context: null,
    updatedAt: n,
    mine: false,
    ...over,
  };
}

const input = (over: Partial<RatingInput> = {}): RatingInput => ({
  kind: 'course',
  subject: 'CMPT 225',
  scores: [4, 5],
  liked: true,
  review: '',
  term: null,
  context: null,
  ...over,
});

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('toPercent', () => {
  it('maps the 1-5 scale onto 0-100', () => {
    expect(toPercent(1)).toBe(0);
    expect(toPercent(3)).toBe(50);
    expect(toPercent(5)).toBe(100);
    expect(toPercent(4.2)).toBe(80);
  });
});

describe('summarize', () => {
  it('has no numbers when there are no ratings', () => {
    const s = summarize('course', []);
    expect(s.count).toBe(0);
    expect(s.dims.map((d) => d.percent)).toEqual([null, null]);
    expect(s.liked).toEqual({ count: 0, percent: null });
    expect(s.mine).toBeNull();
  });

  it('averages each dimension, labels them by kind and counts the distribution', () => {
    const s = summarize('course', [rating({ scores: [1, 5] }), rating({ scores: [4, 5] }), rating({ scores: [4, 2] })]);
    expect(s.count).toBe(3);
    expect(s.dims[0]).toMatchObject({ key: 'easy', label: 'Easy', mean: 3, percent: 50, distribution: [1, 0, 0, 2, 0] });
    expect(s.dims[1]).toMatchObject({ key: 'useful', mean: 4, percent: 75, distribution: [0, 1, 0, 0, 2] });
    expect(summarize('prof', []).dims.map((d) => d.label)).toEqual(['Clear', 'Engaging']);
  });

  it('only counts people who answered "liked"', () => {
    const s = summarize('course', [rating({ liked: true }), rating({ liked: false }), rating({ liked: true }), rating()]);
    expect(s.liked).toEqual({ count: 3, percent: 67 });
  });

  it('lists written reviews newest first and finds your own rating', () => {
    const old = rating({ review: 'old', updatedAt: 10 });
    const mine = rating({ review: 'new', updatedAt: 20, mine: true });
    const s = summarize('course', [old, rating({ review: '   ' }), mine]);
    expect(s.reviews).toEqual([mine, old]);
    expect(s.mine).toBe(mine);
  });
});

describe('cleanInput', () => {
  it('trims text, caps the review and blanks to null', () => {
    const c = cleanInput(input({ subject: '  Jane   Doe ', review: ' x'.repeat(400), term: ' ', context: '' }));
    expect(c.subject).toBe('Jane Doe');
    expect(c.review.length).toBe(500);
    expect(c.term).toBeNull();
    expect(c.context).toBeNull();
  });

  it('rejects scores off the scale', () => {
    expect(() => cleanInput(input({ scores: [0, 3] as never }))).toThrow();
    expect(() => cleanInput(input({ scores: [3, 2.5] as never }))).toThrow();
    expect(() => cleanInput(input({ subject: ' ' }))).toThrow();
  });

  it('parseRating drops malformed stored data', () => {
    expect(parseRating({ nope: true })).toBeNull();
    expect(parseRating(null)).toBeNull();
    expect(parseRating(rating({ mine: true }))).toMatchObject({ mine: true, subject: 'CMPT 225' });
  });
});

describe('LocalRatingsStore', () => {
  it('saves, lists, updates and removes this browser’s ratings', async () => {
    const storage = memoryStorage();
    const store = new LocalRatingsStore(storage);
    expect(store.shared).toBe(false);
    expect(await store.list('course', ['CMPT 225'])).toEqual([]);

    const first = await store.save(input({ review: 'Lots of work' }));
    expect(first).toMatchObject({ mine: true, scores: [4, 5], review: 'Lots of work' });

    // One rating per subject: saving again replaces it, keeping the id.
    const second = await store.save(input({ scores: [2, 2] }));
    expect(second.id).toBe(first.id);
    expect(await store.list('course', ['CMPT 225', 'CMPT 300'])).toEqual([second]);

    // Same name as a different kind doesn't collide.
    await store.save(input({ kind: 'prof', subject: 'CMPT 225', scores: [5, 5] }));
    expect(await store.list('course', ['CMPT 225'])).toEqual([second]);

    // Persists across instances sharing the same storage.
    expect(await new LocalRatingsStore(storage).list('course', ['CMPT 225'])).toEqual([second]);

    await store.remove('course', 'CMPT 225');
    expect(await store.list('course', ['CMPT 225'])).toEqual([]);
    expect(await store.list('prof', ['CMPT 225'])).toHaveLength(1);
  });

  it('ignores corrupt storage', async () => {
    const storage = memoryStorage();
    storage.data.set('sfu-prereqs:ratings', '{not json');
    expect(await new LocalRatingsStore(storage).list('course', ['CMPT 225'])).toEqual([]);
    storage.data.set('sfu-prereqs:ratings', JSON.stringify({ a: { kind: 'course', subject: 'X', scores: [9, 9] } }));
    expect(await new LocalRatingsStore(storage).list('course', ['X'])).toEqual([]);
  });

  it('keeps working in memory when storage throws', async () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new LocalRatingsStore(broken);
    await store.save(input());
    expect(await store.list('course', ['CMPT 225'])).toHaveLength(1);
    expect(await new LocalRatingsStore(null).list('course', ['CMPT 225'])).toEqual([]);
  });

  it('is the default without Supabase env vars', () => {
    expect(createRatingsStore({}).shared).toBe(false);
    expect(createRatingsStore({ VITE_SUPABASE_URL: 'https://x.supabase.co' }).shared).toBe(false);
    expect(createRatingsStore({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' }).shared).toBe(
      true,
    );
  });
});

describe('terms', () => {
  it('walks back through spring, summer and fall', () => {
    expect(recentTerms('2026/spring', 4).map((t) => t.id)).toEqual([
      '2026/spring',
      '2025/fall',
      '2025/summer',
      '2025/spring',
    ]);
    expect(recentTerms('nonsense', 3)).toEqual([]);
    expect(termLabel('2026/fall')).toBe('Fall 2026');
  });
});
