// Share links and progress backups.
//
// A share link carries the target and the taken set in the hash, using the
// compact form of each code so links stay short and paste cleanly into chats:
//   #CMPT-410?taken=CMPT120,MACM101

const CODE = /^([A-Za-z]{2,5})[\s\-+_.]*(\d{3}[A-Za-z]?)$/;

/** "CMPT 120" -> "CMPT120" */
export const compactCode = (code: string) => code.replace(/\s+/g, '');

/** Normalises any reasonable spelling ("cmpt120", "CMPT-120", "CMPT+120") to "CMPT 120", or null. */
export function parseCode(raw: string): string | null {
  const m = raw.trim().match(CODE);
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

function uniqueCodes(raw: Iterable<unknown>): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const code = typeof r === 'string' && parseCode(r);
    if (code) out.add(code);
  }
  return [...out].sort();
}

/** Builds the hash for a target and taken set. Taken is left off when empty. */
export function encodeShareHash(target: string, taken: Iterable<string>): string {
  const codes = uniqueCodes(taken).map(compactCode);
  return '#' + target.replace(' ', '-') + (codes.length ? '?taken=' + codes.join(',') : '');
}

export interface SharedState {
  target: string | null;
  /** null when the link has no taken set at all (an old-style link) */
  taken: string[] | null;
}

/** Reads a hash written by encodeShareHash, tolerating hand edits and URL-encoding. */
export function decodeShareHash(hash: string): SharedState {
  let s = hash.replace(/^#/, '');
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep the raw text; a stray "%" shouldn't lose the whole link
  }
  const q = s.indexOf('?');
  const target = parseCode(q === -1 ? s : s.slice(0, q));
  if (q === -1) return { target, taken: null };

  const raw = new URLSearchParams(s.slice(q + 1)).get('taken');
  if (raw === null) return { target, taken: null };
  // Commas separate codes; fall back to whitespace for hand-typed lists ("CMPT120 MACM101").
  const parts = raw.split(/[,;]+/).flatMap((p) => (parseCode(p) ? [p] : p.split(/\s+/)));
  return { target, taken: uniqueCodes(parts) };
}

/** Full URL for the current page with the given state in the hash. */
export function shareUrl(target: string, taken: Iterable<string>, base: string = location.href): string {
  return base.replace(/#.*$/, '') + encodeShareHash(target, taken);
}

/** What changes if `incoming` were applied on top of `local`. */
export function compareTaken(local: Iterable<string>, incoming: Iterable<string>) {
  const have = new Set(local);
  const want = new Set(incoming);
  const added = [...want].filter((c) => !have.has(c)).sort();
  const removed = [...have].filter((c) => !want.has(c)).sort();
  return { added, removed, same: added.length === 0 && removed.length === 0 };
}

// ---- JSON backup ----------------------------------------------------------

const APP_ID = 'sfu-prereqs';

export interface Backup {
  app: typeof APP_ID;
  version: 1;
  exported: string;
  target: string;
  taken: string[];
}

export function makeBackup(target: string, taken: Iterable<string>, now = new Date()): Backup {
  return { app: APP_ID, version: 1, exported: now.toISOString(), target, taken: uniqueCodes(taken) };
}

/**
 * Parses a backup file. Also accepts a bare array of codes (what's stored in
 * localStorage), so a copy-pasted value works too. Throws a readable Error.
 */
export function parseBackup(text: string): { target: string | null; taken: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (Array.isArray(data)) return { target: null, taken: uniqueCodes(data) };
  if (data && typeof data === 'object' && Array.isArray((data as Backup).taken)) {
    const b = data as Partial<Backup>;
    if (b.app !== undefined && b.app !== APP_ID) throw new Error("That file isn't an SFU Prerequisite Map backup.");
    return { target: typeof b.target === 'string' ? parseCode(b.target) : null, taken: uniqueCodes(b.taken!) };
  }
  throw new Error("That file doesn't contain a list of taken courses.");
}

// ---- Browser helpers ------------------------------------------------------

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers, or a page without clipboard permission.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Copy failed');
  }
}

export function download(filename: string, data: Blob | string): void {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBackup(target: string, taken: Iterable<string>): void {
  const json = JSON.stringify(makeBackup(target, taken), null, 2);
  download(`sfu-prereqs-${new Date().toISOString().slice(0, 10)}.json`, new Blob([json], { type: 'application/json' }));
}

/** Opens a file picker and resolves with the chosen file's text, or null if cancelled. */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? file.text() : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ---- Chart image ----------------------------------------------------------

// The PNG export needs the Svelte Flow instance, which only exists inside
// <SvelteFlow>. ChartSnapshot.svelte registers itself here while the chart is shown.
type Snapshot = () => Promise<string>;
let snapshot: Snapshot | null = null;

export function registerChartSnapshot(fn: Snapshot): () => void {
  snapshot = fn;
  return () => {
    if (snapshot === fn) snapshot = null;
  };
}

export const chartAvailable = () => snapshot !== null;

/** Downloads the chart as a PNG. Throws if the chart isn't on screen. */
export async function downloadChartPng(target: string): Promise<void> {
  if (!snapshot) throw new Error('Switch to the chart view to export an image.');
  download(`${compactCode(target)}-prereqs.png`, await snapshot());
}
