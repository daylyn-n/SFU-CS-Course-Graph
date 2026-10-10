// Merging two copies of the saved document (this device's and the account's).
// Pure functions; see docs/accounts-design.md, Layer 3.
//
// Each course, schedule slot and setting merges on its own: the copy with the
// later stamp wins, and on a tie this device's copy is kept. Stamps come from
// a monotonic clock that has seen the other device's stamps (doc.ts Clock),
// so a fast clock elsewhere can't win every later merge.

import type { AppDoc, CourseState, Settings } from '../persist/doc';

export type Side = 'local' | 'remote';

export interface CourseChange {
  code: string;
  /** state in the merged document */
  state: CourseState;
  /** state the losing side had (undefined: it didn't have the course) */
  was: CourseState | undefined;
}

export interface SlotChange {
  index: number;
  name: string;
}

/** What one side contributed where the two copies differed. */
export interface SideReport {
  courses: CourseChange[];
  slots: SlotChange[];
  settings: (keyof Settings)[];
  /** keys of `unknown` (sections from a newer version) taken from this side */
  unknown: string[];
}

export interface MergeReport {
  /** kept from this device, where the account had something else */
  local: SideReport;
  /** taken from the account, where this device had something else */
  remote: SideReport;
}

const emptySide = (): SideReport => ({ courses: [], slots: [], settings: [], unknown: [] });

/** JSON with object keys sorted, so key order (jsonb reorders) never matters. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** Same content (courses, slots, settings, unknown sections, schema); owner ignored. */
export function sameContent(a: AppDoc, b: AppDoc): boolean {
  const strip = (d: AppDoc) => ({ ...d, owner: null, unknown: d.unknown ?? {} });
  return canonical(strip(a)) === canonical(strip(b));
}

const courseValue = (c: { state: CourseState } | undefined) => c?.state;

/** Merge this device's document with the account's. Never mutates its inputs. */
export function mergeDocs(local: AppDoc, remote: AppDoc): { doc: AppDoc; report: MergeReport } {
  const report: MergeReport = { local: emptySide(), remote: emptySide() };

  // Courses: union; a missing course counts as "never touched" (at -1), so a
  // tombstone ('none' with a stamp) beats it and an untouched side never wins.
  const courses: AppDoc['courses'] = {};
  for (const code of new Set([...Object.keys(local.courses), ...Object.keys(remote.courses)])) {
    const l = local.courses[code];
    const r = remote.courses[code];
    const remoteWins = r !== undefined && (l === undefined || r.at > l.at);
    const win = remoteWins ? r : l!;
    courses[code] = { ...win };
    if (courseValue(l) === courseValue(r)) continue;
    // A course the losing side never had and the winner has as 'none' isn't a difference anyone sees.
    const was = remoteWins ? courseValue(l) : courseValue(r);
    if (was === undefined && win.state === 'none') continue;
    report[remoteWins ? 'remote' : 'local'].courses.push({ code, state: win.state, was });
  }

  const slots: AppDoc['slots'] = [];
  const n = Math.max(local.slots.length, remote.slots.length);
  for (let i = 0; i < n; i++) {
    const l = local.slots[i];
    const r = remote.slots[i];
    const remoteWins = r !== undefined && (l === undefined || r.at > l.at);
    const win = remoteWins ? r : l!;
    slots[i] = structuredClone(win);
    if (l && r && canonical(l.value) === canonical(r.value)) continue;
    report[remoteWins ? 'remote' : 'local'].slots.push({ index: i, name: win.value.name });
  }

  const settings = { ...local.settings } as AppDoc['settings'];
  for (const key of Object.keys(local.settings) as (keyof Settings)[]) {
    const l = local.settings[key];
    const r = remote.settings[key];
    if (!r) continue;
    const remoteWins = r.at > l.at;
    (settings as Record<string, unknown>)[key] = { ...(remoteWins ? r : l) };
    if (l.value !== r.value) report[remoteWins ? 'remote' : 'local'].settings.push(key);
  }

  // Sections from a newer version: keep everything from both; where both
  // have a section, the copy from the newer schema wins (tie: local).
  let unknown: Record<string, unknown> | undefined;
  if (local.unknown || remote.unknown) {
    const preferRemote = remote.schema > local.schema;
    const lu = local.unknown ?? {};
    const ru = remote.unknown ?? {};
    unknown = {};
    for (const key of new Set([...Object.keys(lu), ...Object.keys(ru)])) {
      const fromRemote = !(key in lu) || (key in ru && preferRemote);
      unknown[key] = fromRemote ? ru[key] : lu[key];
      if (key in lu && key in ru && canonical(lu[key]) === canonical(ru[key])) continue;
      report[fromRemote ? 'remote' : 'local'].unknown.push(key);
    }
  }

  const doc: AppDoc = {
    schema: Math.max(local.schema, remote.schema),
    owner: local.owner ?? remote.owner,
    courses,
    slots,
    settings,
    ...(unknown ? { unknown } : {}),
  };
  return { doc, report };
}

/** True when either side contributed anything. */
export function changedAnything(report: MergeReport): boolean {
  return sideSize(report.local) + sideSize(report.remote) > 0;
}

export function sideSize(s: SideReport): number {
  return s.courses.length + s.slots.length + s.settings.length + s.unknown.length;
}

const SETTING_NAMES: Record<keyof Settings, string> = {
  assumePrereqs: 'the prerequisites setting',
  program: 'your program',
  planPerTerm: 'courses per term',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function slotLabel(s: SlotChange): string {
  return s.name.trim() || `Schedule ${s.index + 1}`;
}

function describeSide(side: SideReport, from: 'from this device' | 'from your account'): string[] {
  const parts: string[] = [];
  if (side.slots.length) parts.push(`kept ${listNames(side.slots.map(slotLabel))} ${from}`);

  const taken = side.courses.filter((c) => c.state === 'taken').length;
  const notTaken = side.courses.filter((c) => c.state === 'notTaken').length;
  const removed = side.courses.filter((c) => c.state === 'none').length;
  const verb = from === 'from your account' ? 'added' : 'kept';
  if (taken) parts.push(`${verb} ${plural(taken, 'taken course')} ${from}`);
  if (notTaken) parts.push(`${verb} ${plural(notTaken, 'course')} marked not taken ${from}`);
  if (removed) parts.push(`unticked ${plural(removed, 'course')} ${from}`);

  if (side.settings.length) parts.push(`kept ${listNames(side.settings.map((k) => SETTING_NAMES[k]))} ${from}`);
  if (side.unknown.length) parts.push(`kept data from a newer version ${from}`);
  return parts;
}

/**
 * A short sentence for a toast, e.g. "Kept Schedule 2 from this device; added
 * 3 taken courses from your account". '' when nothing differed.
 */
export function describeMerge(report: MergeReport): string {
  const parts = [...describeSide(report.local, 'from this device'), ...describeSide(report.remote, 'from your account')];
  if (!parts.length) return '';
  const text = parts.join('; ');
  return text[0].toUpperCase() + text.slice(1);
}
