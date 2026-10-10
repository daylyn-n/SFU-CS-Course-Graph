// Calendar descriptions and breadth/WQB designations, in public/data/details.json:
//   { fetched, details: { "CMPT 120": { description, designation, notes? } } }
// It's about 350 KB gzipped, so it's only fetched the first time someone
// opens a course's details, not at startup.

let pending = null;

/** Load (once) and return the details map, or {} if it can't be loaded. */
export function loadDetails() {
  pending ??= fetch(`${import.meta.env.BASE_URL}data/details.json`)
    .then((r) => (r.ok ? r.json() : { details: {} }))
    .then((d) => d.details ?? {})
    .catch(() => {
      pending = null; // allow a retry later
      return {};
    });
  return pending;
}

// SFU spells some designations several ways ("Breadth-Social Sci",
// "Breadth-Soc", ...). Each maps to [short badge, full label].
const KNOWN = {
  Writing: ['W', 'Writing'],
  Quantitative: ['Q', 'Quantitative'],
  'Breadth-Science': ['B-Sci', 'Breadth-Science'],
  'Breadth-Humanities': ['B-Hum', 'Breadth-Humanities'],
  'Breadth-Social Sciences': ['B-Soc', 'Breadth-Social Sciences'],
  'Breadth-Social Sci': ['B-Soc', 'Breadth-Social Sciences'],
  'Breadth-Soc': ['B-Soc', 'Breadth-Social Sciences'],
  'Breadth-Humanities/Social Sciences': ['B-Hum/Soc', 'Breadth-Humanities or Social Sciences'],
  'Breadth-Hum/Soc Sci': ['B-Hum/Soc', 'Breadth-Humanities or Social Sciences'],
  'Breadth-Social Sci/Science': ['B-Soc/Sci', 'Breadth-Social Sciences or Science'],
  'Breadth-Humanities/Sciences': ['B-Hum/Sci', 'Breadth-Humanities or Science'],
};

/**
 * Split SFU's designation string ("Quantitative/Breadth-Science") into
 * badges: [{ short: 'Q', label: 'Quantitative' }, { short: 'B-Sci', ... }].
 * "N/A" and empty give [].
 */
export function designationBadges(designation) {
  if (!designation || /^n\/?a$/i.test(designation.trim())) return [];
  // "Breadth-Humanities/Social Sciences" is one designation, so only split on
  // a slash that starts a new top-level designation.
  const parts = designation.split(/\/(?=Writing|Quantitative|Breadth)/);
  return parts.map((part) => {
    const [short, label] = KNOWN[part.trim()] ?? [part.trim(), part.trim()];
    return { short, label };
  });
}
