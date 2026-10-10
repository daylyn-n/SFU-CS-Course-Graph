import type { Courses } from './types';

export interface FuzzyMatch {
  score: number;
  /** indices into the text that matched, for highlighting */
  hits: number[];
}

const isWordStart = (text: string, i: number) => i === 0 || /[\s\-_/(&,.]/.test(text[i - 1]);

/**
 * Scores `query` against `text`, or returns null if the query's letters don't
 * all appear in order. A contiguous run (especially at a word start) always
 * beats letters scattered across the text.
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };

  // Best case: the query appears as-is. Prefer word starts, then earlier positions.
  let best: FuzzyMatch | null = null;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + 1)) {
    const score = 100 + q.length * 10 + (isWordStart(t, i) ? 40 : 0) + (i === 0 ? 20 : 0) - Math.min(i, 30);
    if (!best || score > best.score) best = { score, hits: Array.from(q, (_, k) => i + k) };
  }
  if (best) return best;

  // Otherwise walk the text greedily. Jumping ahead to word starts usually
  // scores better, but can strand later letters, so fall back to a plain walk.
  return scatteredMatch(q, t, true) ?? scatteredMatch(q, t, false);
}

function scatteredMatch(q: string, t: string, preferWordStarts: boolean): FuzzyMatch | null {
  const hits: number[] = [];
  let score = 0;
  let ti = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    let at = t.indexOf(ch, ti);
    if (at === -1) return null;
    if (preferWordStarts) {
      for (let j = at; j < t.length; j++) {
        if (t[j] === ch && isWordStart(t, j)) {
          if (hits.length === 0 || j - at < 12) at = j;
          break;
        }
      }
    }
    const prev = hits[hits.length - 1];
    score += 1;
    if (prev !== undefined && at === prev + 1) score += 6;
    if (isWordStart(t, at)) score += 8;
    if (prev !== undefined) score -= Math.min(at - prev - 1, 8) * 0.5;
    hits.push(at);
    ti = at + 1;
  }
  return { score, hits };
}

export interface CourseMatch {
  code: string;
  title: string;
  score: number;
  codeHits: number[];
  titleHits: number[];
}

/**
 * Ranks courses by how well `query` matches their code or title. The code is
 * matched with spaces ignored ("cmpt410" finds "CMPT 410") and counts for more
 * than the title. Title words can come in any order ("systems operating").
 */
export function rankCourses(query: string, courses: Courses, limit = 50): CourseMatch[] {
  const q = query.trim();
  if (!q) return [];
  const qCompact = q.replace(/\s+/g, '');
  const words = q.split(/\s+/);
  const out: CourseMatch[] = [];

  for (const [code, { title }] of Object.entries(courses)) {
    const space = code.indexOf(' ');
    const compact = code.replace(' ', '');
    let codeHits: number[] = [];
    let codeScore = -Infinity;
    const cm = fuzzyScore(qCompact, compact);
    if (cm) {
      codeScore = cm.score * 2 + (compact.toLowerCase() === qCompact.toLowerCase() ? 500 : 0);
      codeHits = cm.hits.map((i) => (space !== -1 && i >= space ? i + 1 : i));
    }

    // Every query word has to appear somewhere in the title.
    let titleScore = -Infinity;
    let titleHits: number[] = [];
    const tms = words.map((w) => fuzzyScore(w, title));
    if (tms.every(Boolean)) {
      titleScore = tms.reduce((s, m) => s + m!.score, 0);
      titleHits = [...new Set(tms.flatMap((m) => m!.hits))];
    }

    const score = Math.max(codeScore, titleScore);
    if (score === -Infinity) continue;
    // Only highlight whichever side actually earned the match.
    out.push({
      code,
      title,
      score,
      codeHits: codeScore >= titleScore ? codeHits : [],
      titleHits: titleScore > codeScore ? titleHits : [],
    });
  }

  return out.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit);
}
