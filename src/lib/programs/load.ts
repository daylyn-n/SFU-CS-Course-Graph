// Lazy loading of degree programs. The index (public/data/programs/index.json)
// is fetched once for the picker; a program's own file only when it's chosen.
// Hand-written programs (src/data/programs.ts) replace their calendar
// versions and need no download. Nothing here touches localStorage: only the
// chosen id is persisted, by persist/store (settings.program).

import { PROGRAMS } from '../../data/programs';
import type { Program } from '../degree';
import { CURATED_CALENDAR_IDS, type ProgramIndexEntry } from './ids';

export type { ProgramIndexEntry } from './ids';

const BASE = `${import.meta.env.BASE_URL}data/programs/`;

/** Program ids are file names: keep anything else from reaching fetch. */
const SAFE_ID = /^[a-z0-9][a-z0-9~-]*$/;

/**
 * The calendar id for a saved program id. Older saves hold the hand-written
 * ids ('cmpt-major-bsc'); those map to their calendar ids.
 */
export function resolveProgramId(id: string | null | undefined): string {
  const v = (id ?? '').trim();
  return CURATED_CALENDAR_IDS[v] ?? v;
}

/** The hand-written program for a calendar (or legacy) id, if there is one. */
export function curatedProgram(id: string): Program | undefined {
  const cal = resolveProgramId(id);
  return PROGRAMS.find((p) => p.calendarId === cal);
}

let indexPending: Promise<ProgramIndexEntry[]> | null = null;

/** Load (once) the list of programs; [] if it can't be loaded (retried next call). */
export function loadProgramIndex(fetcher: typeof fetch = fetch): Promise<ProgramIndexEntry[]> {
  indexPending ??= fetcher(`${BASE}index.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<ProgramIndexEntry[]>;
    })
    .catch(() => {
      indexPending = null;
      return [];
    });
  return indexPending;
}

const programs = new Map<string, Promise<Program | null>>();

/**
 * Load (once per id) a program: the hand-written one if it exists, else the
 * converted calendar file. Resolves null for an unknown id or a failed load
 * (failed loads are retried on the next call).
 */
export function loadProgram(id: string, fetcher: typeof fetch = fetch): Promise<Program | null> {
  const cal = resolveProgramId(id);
  const curated = curatedProgram(cal);
  if (curated) return Promise.resolve(curated);
  if (!SAFE_ID.test(cal)) return Promise.resolve(null);
  let p = programs.get(cal);
  if (!p) {
    p = fetcher(`${BASE}${cal}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Program>) : r.status === 404 ? null : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => {
        programs.delete(cal);
        return null;
      });
    programs.set(cal, p);
  }
  return p;
}

/** Name shown in the picker: "Biological Sciences Major (BSc)", "Computing Studies Certificate". */
export function programLabel(e: Pick<ProgramIndexEntry, 'fullTitle' | 'credential' | 'awardType'>): string {
  const name = e.fullTitle.trim();
  const cred = e.credential.trim();
  if (!cred || name.toLowerCase().includes(cred.toLowerCase())) return name;
  return `${name} (${cred})`;
}

/** Options for ProgramPicker. */
export function pickerOptions(index: readonly ProgramIndexEntry[]): { id: string; name: string; faculty?: string }[] {
  return index.map((e) => ({ id: e.id, name: programLabel(e), faculty: e.faculty || undefined }));
}

/** For tests: forget cached loads. */
export function clearProgramCache(): void {
  indexPending = null;
  programs.clear();
}
