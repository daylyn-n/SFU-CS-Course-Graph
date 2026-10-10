// Small helpers shared by the data scripts.

export const CALENDAR_API = 'https://www.sfu.ca/bin/wcm/academic-calendar';
export const OUTLINES_API = 'https://www.sfu.ca/bin/wcm/course-outlines';

const notFound = new Set();

/** GET `${base}?${path}` as JSON, retrying; null if it never succeeds. */
export async function getJson(base, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}?${path}`);
      // The API sometimes 404s under load, so 404s get retried too.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) {
        if (err.message === 'HTTP 404') notFound.add(path);
        else console.warn(`  ! ${path}: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/** Paths that 404'd on every attempt, for a summary at the end. */
export function missingPaths() {
  return [...notFound];
}

/** Run fn over items with at most `limit` requests in flight. */
export async function pool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length) await fn(queue.shift());
    }),
  );
}
