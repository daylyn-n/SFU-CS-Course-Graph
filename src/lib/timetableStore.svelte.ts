// Timetable choices shared by the side panel's "Add to timetable" buttons and
// TimetableView, persisted in localStorage.

const STORAGE_KEY = 'sfu-prereqs:timetable';

interface Saved {
  term: string | null;
  campus: string;
  /** term id -> course code -> section name, in the order added */
  picks: Record<string, Record<string, string>>;
}

function load(): Saved {
  const empty: Saved = { term: null, campus: '', picks: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return empty;
    const picks: Saved['picks'] = {};
    for (const [term, byCode] of Object.entries(raw.picks ?? {})) {
      if (!byCode || typeof byCode !== 'object') continue;
      picks[term] = {};
      for (const [code, section] of Object.entries(byCode)) {
        if (typeof section === 'string') picks[term][code] = section;
      }
    }
    return {
      term: typeof raw.term === 'string' ? raw.term : null,
      campus: typeof raw.campus === 'string' ? raw.campus : '',
      picks,
    };
  } catch {
    return empty;
  }
}

class TimetableStore {
  term = $state<string | null>(null);
  campus = $state('');
  picks = $state<Record<string, Record<string, string>>>({});

  constructor() {
    const saved = load();
    this.term = saved.term;
    this.campus = saved.campus;
    this.picks = saved.picks;
  }

  save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ term: this.term, campus: this.campus, picks: this.picks }),
      );
    } catch {}
  }

  /** course code -> section name for a term */
  for(term: string): Record<string, string> {
    return this.picks[term] ?? {};
  }

  sectionOf(term: string, code: string): string | undefined {
    return this.picks[term]?.[code];
  }

  /** Add a course, or switch it to another section. */
  set(term: string, code: string, section: string) {
    this.picks[term] = { ...this.for(term), [code]: section };
    this.save();
  }

  remove(term: string, code: string) {
    const { [code]: _, ...rest } = this.for(term);
    this.picks[term] = rest;
    this.save();
  }

  replace(term: string, picks: Record<string, string>) {
    // keep the existing order so colours don't shuffle
    const ordered: Record<string, string> = {};
    for (const code of Object.keys(this.for(term))) if (code in picks) ordered[code] = picks[code];
    this.picks[term] = { ...ordered, ...picks };
    this.save();
  }

  clear(term: string) {
    this.picks[term] = {};
    this.save();
  }

  setTerm(term: string) {
    this.term = term;
    this.save();
  }

  setCampus(campus: string) {
    this.campus = campus;
    this.save();
  }
}

export const timetable = new TimetableStore();
