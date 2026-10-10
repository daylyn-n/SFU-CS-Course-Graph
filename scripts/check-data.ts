// Run after a data refresh, before committing it: `node scripts/check-data.ts <before-dir>`,
// where <before-dir> is a copy of public/data from before the fetch.
//
// 1. Fails (exit 1) if the new data looks broken: a file missing or not JSON,
//    or far fewer courses/sections/programs than before. SFU's APIs sometimes
//    fail under load, and a half-empty file shouldn't go live.
// 2. Puts back the old copy of any file whose only change is its "fetched"
//    time, so a refresh that found nothing new makes no commit.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const before = process.argv[2];
if (!before) throw new Error('usage: node scripts/check-data.ts <copy of public/data from before the fetch>');
const after = 'public/data';

const problems: string[] = [];

/** Every .json file under `dir`, as paths relative to `after`. */
async function jsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsonFiles(p)));
    else if (e.name.endsWith('.json')) out.push(relative(after, p));
  }
  return out;
}

async function load(dir: string, file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(join(dir, file), 'utf8'));
  } catch {
    return undefined;
  }
}

/** New count must be at least `share` of the old one (and at least `min`). */
function atLeast(what: string, now: number, then: number | undefined, share: number, min = 1) {
  if (now < min) problems.push(`${what}: ${now} (expected at least ${min})`);
  else if (then && now < then * share) problems.push(`${what}: ${now}, down from ${then} (more than ${Math.round((1 - share) * 100)}% lost)`);
  else console.log(`  ok  ${what}: ${now}${then !== undefined ? ` (was ${then})` : ''}`);
}

const count = (o: object | undefined) => (o ? Object.keys(o).length : 0);

// --- Every file parses.
const files = await jsonFiles(after);
const now = new Map<string, any>();
for (const f of files) {
  const data = await load(after, f);
  if (data === undefined) problems.push(`${f}: not valid JSON`);
  else now.set(f, data);
}
for (const f of ['courses.json', 'details.json', 'offerings.json', 'seats.json', 'programs/index.json']) {
  if (!now.has(f)) problems.push(`${f}: missing`);
}

// --- Sizes compared with before.
const old = (f: string) => load(before, f);
{
  const [c, o] = [now.get('courses.json'), await old('courses.json')];
  atLeast('courses', count(c?.courses), o && count(o.courses), 0.95, 3000);
}
{
  const [d, o] = [now.get('details.json'), await old('details.json')];
  atLeast('course details', count(d?.details), o && count(o.details), 0.9, 2000);
}
{
  const [n, o] = [now.get('offerings.json'), await old('offerings.json')];
  atLeast('offered courses (all terms)', count(n?.offerings), undefined, 0, 1000);
  // Per term, only for terms in both: a newly published term starts small.
  const perTerm = (data: any, term: string) =>
    Object.values<Record<string, unknown[]>>(data?.offerings ?? {}).filter((byTerm) => byTerm[term]?.length).length;
  for (const t of n?.terms ?? []) {
    if (o?.terms?.some((x: { id: string }) => x.id === t.id)) atLeast(`  ${t.label} courses`, perTerm(n, t.id), perTerm(o, t.id), 0.8);
  }
}
{
  const [n, o] = [now.get('seats.json'), await old('seats.json')];
  for (const [term, s] of Object.entries<{ sections?: object }>(n?.terms ?? {})) {
    const prev = o?.terms?.[term]?.sections;
    if (prev) atLeast(`seats ${term} courses`, count(s.sections), count(prev), 0.5);
  }
}
{
  const [n, o] = [now.get('programs/index.json'), await old('programs/index.json')];
  atLeast('programs', n?.length ?? 0, o?.length, 0.95, 300);
  for (const p of n ?? []) if (!now.has(`programs/${p.id}.json`)) problems.push(`programs/${p.id}.json: in the index but missing`);
}

if (problems.length) {
  console.error('\nThe refreshed data looks broken, so it will not be committed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// --- Undo timestamp-only changes.
const withoutFetched = (d: any) => JSON.stringify(d && typeof d === 'object' && !Array.isArray(d) ? { ...d, fetched: undefined } : d);
let restored = 0;
for (const [f, data] of now) {
  const raw = await readFile(join(before, f), 'utf8').catch(() => undefined);
  if (raw === undefined) continue;
  let prev: unknown;
  try {
    prev = JSON.parse(raw);
  } catch {
    continue;
  }
  if (withoutFetched(prev) === withoutFetched(data)) {
    await writeFile(join(after, f), raw);
    restored++;
  }
}
console.log(`\nData looks fine. ${restored} of ${now.size} files had no real change (kept as they were).`);
