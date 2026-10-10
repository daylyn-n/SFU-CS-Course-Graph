// Turn what someone typed into a course code: "cmpt225", "CMPT 225 — Data
// Structures…", or a title like "machine learning" (if only one course matches).

const CODE = /^([A-Za-z]{2,5})\s*(\d{3}[A-Za-z]?)\b/;

export function matchCourse(query, courses) {
  const q = query.trim();
  if (!q) return null;
  const m = q.match(CODE);
  if (m) {
    const code = `${m[1]} ${m[2]}`.toUpperCase();
    if (code in courses) return code;
  }
  const hits = searchCourses(q, courses, 2);
  return hits.length === 1 || hits[0]?.exact ? hits[0].code : null;
}

const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Courses matching by code or by name, best first. Name matching is by
 * words in any order, each matching the start of a title word, so "intro
 * prog" finds "Introduction to Computing Science and Programming I".
 */
export function searchCourses(query, courses, limit = 8) {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const compact = q.replace(/\s/g, '');
  const qWords = words(q);
  const hits = [];
  for (const [code, c] of Object.entries(courses)) {
    const title = (c.title ?? '').toLowerCase();
    const codeCompact = code.toLowerCase().replace(' ', '');
    let score = -1;
    if (codeCompact === compact || title === q) score = 0;
    else if (codeCompact.startsWith(compact)) score = 1;
    else if (title.startsWith(q)) score = 2;
    else {
      const tWords = words(`${code} ${title}`);
      if (qWords.length && qWords.every((w) => tWords.some((t) => t.startsWith(w)))) score = 3;
      else if (title.includes(q)) score = 4;
    }
    if (score >= 0) hits.push({ code, score, exact: score === 0 });
  }
  hits.sort((a, b) => a.score - b.score || a.code.localeCompare(b.code, 'en', { numeric: true }));
  return hits.slice(0, limit);
}
