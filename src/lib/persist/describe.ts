// Plain-English descriptions of a change between two sets of values, for
// undo/redo toasts: "removed CMPT 225 from Schedule 2", "ticked CMPT 120",
// "3 changes".

import type { Values } from './doc';

export interface Description {
  text: string;
  /** the schedule slot the change was in, when all of it was in one slot */
  slot: number | null;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function diff(before: string[], after: string[]) {
  const a = new Set(before);
  const b = new Set(after);
  return { added: after.filter((c) => !a.has(c)), removed: before.filter((c) => !b.has(c)) };
}

export function describe(before: Values, after: Values): Description {
  const parts: string[] = [];
  const slots = new Set<number>();

  const taken = diff(before.taken, after.taken);
  if (taken.added.length && !taken.removed.length && taken.added.length > 1) parts.push(`ticked ${plural(taken.added.length, 'course')}`);
  else if (taken.removed.length && !taken.added.length && taken.removed.length > 1)
    parts.push(`unticked ${plural(taken.removed.length, 'course')}`);
  else {
    for (const c of taken.added) parts.push(`ticked ${c}`);
    for (const c of taken.removed) parts.push(`unticked ${c}`);
  }

  const notTaken = diff(before.notTaken, after.notTaken);
  for (const c of notTaken.added) if (!taken.removed.includes(c)) parts.push(`marked ${c} as not taken`);
  for (const c of notTaken.removed) if (!taken.added.includes(c)) parts.push(`allowed ${c} to be filled in`);

  const count = Math.max(before.slots.length, after.slots.length);
  for (let i = 0; i < count; i++) {
    const was = before.slots[i];
    const now = after.slots[i];
    if (!was || !now || sameJson(was, now)) continue;
    slots.add(i);
    const name = now.name;
    const n = parts.length;
    const codes = diff(
      was.courses.map((c) => c.code),
      now.courses.map((c) => c.code),
    );
    if (was.name !== now.name) {
      // A new name and new courses: copied over by "Duplicate to…".
      if (codes.added.length || codes.removed.length) {
        parts.push(`replaced ${was.name} with ${now.name}`);
        continue;
      }
      parts.push(`renamed ${was.name} to ${now.name}`);
    }
    if (!now.courses.length && was.courses.length > 1) parts.push(`cleared ${was.name}`);
    else {
      for (const c of codes.added) parts.push(`added ${c} to ${name}`);
      for (const c of codes.removed) parts.push(`removed ${c} from ${name}`);
    }
    if (was.term !== now.term) {
      // Changing term re-picks sections too; that's one change.
      parts.push(`changed the term of ${name}`);
    } else {
      const repicked = now.courses.filter((c) => {
        const old = was.courses.find((o) => o.code === c.code);
        return old && !sameJson(old.picks, c.picks);
      });
      if (repicked.length === 1) parts.push(`changed sections for ${repicked[0].code}`);
      else if (repicked.length > 1) parts.push(`changed sections in ${name}`);
    }
    // Course order alone, or anything else not covered above.
    if (parts.length === n) parts.push(`changed ${name}`);
  }

  const s = before.settings;
  const t = after.settings;
  if (s.assumePrereqs !== t.assumePrereqs) parts.push(`turned ${t.assumePrereqs ? 'on' : 'off'} filling in prerequisites`);
  if (s.program !== t.program) parts.push(t.program ? 'changed program' : 'cleared program');
  if (s.planPerTerm !== t.planPerTerm) parts.push(`set ${plural(t.planPerTerm, 'course')} per term`);

  const slot = slots.size === 1 ? [...slots][0] : null;
  if (!parts.length) return { text: 'no changes', slot };
  return { text: parts.length === 1 ? parts[0] : `${parts.length} changes`, slot };
}
