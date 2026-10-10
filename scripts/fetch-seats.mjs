// Seat counts for the terms in public/data/offerings.json, from SFU
// Institutional Research's public Course Section Availability Report: a
// spreadsheet with one row per section per day during registration (only
// sections with at least 1 enrolment). Writes public/data/seats.json:
//   { fetched, terms: { "2026/fall": { asOf: "2026-09-29",
//       sourceModified: "<the xlsx's Last-Modified, ISO>",
//       sections: { "CMPT 225": { "D100": { max: 200, enrolled: 28 } } } } } }
// Only rows from the latest date in the file are kept; asOf is that date.
//
// Cheap refresh: each term's xlsx (~8 MB) is HEAD-requested first, and if its
// Last-Modified matches the stored sourceModified, the old data is kept.
// Terms without a report page yet are skipped.
//
// Usage: node scripts/fetch-seats.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const IRP = 'https://www.sfu.ca/irp/courses/course-section-availability-report';
const OFFERINGS = new URL('../public/data/offerings.json', import.meta.url);
const OUT = new URL('../public/data/seats.json', import.meta.url);
const SEASON_DIGIT = { spring: 1, summer: 4, fall: 7 };

/** '2026/fall' -> '1267'. */
function termCode(termId) {
  const [year, season] = termId.split('/');
  return `1${year.slice(2)}${SEASON_DIGIT[season]}`;
}

/** Excel serial day (1900 date system) -> 'YYYY-MM-DD'. Passes other text through. */
function excelDate(v) {
  if (!/^\d+(\.\d+)?$/.test(v)) return v;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000).toISOString().slice(0, 10);
}

// --- Minimal .xlsx reading: a zip of XML files. ---

/** Zip entries by name, each a function returning its contents. */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported zip method ${method} for ${name}`);
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function unxml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Column letters -> 0-based index: 'A' -> 0, 'AA' -> 26. */
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

const texts = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('');

/** Rows (arrays of strings) of each worksheet, in order. */
function* sheets(buf) {
  const files = unzip(buf);
  const sst = files['xl/sharedStrings.xml']?.().toString('utf8') ?? '';
  const shared = [...sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => unxml(texts(m[1])));
  const names = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const name of names) {
    const xml = files[name]().toString('utf8');
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const vals = [];
      for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        // Empty cells are often omitted, so place values by their r="B12" reference.
        const ref = /\br="([A-Z]+)\d+"/.exec(c[1]);
        const type = /\bt="(\w+)"/.exec(c[1])?.[1];
        const body = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        vals[ref ? colIndex(ref[1]) : vals.length] =
          type === 's' ? (shared[Number(v)] ?? '') : unxml(type === 'inlineStr' ? texts(body) : v);
      }
      rows.push(Array.from(vals, (x) => x ?? ''));
    }
    yield { name, rows };
  }
}

// --- Fetching. ---

/** The database xlsx URL linked from a term's report page, or null if there's no page. */
async function findXlsx(code) {
  const res = await fetch(`${IRP}/${code}.html`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`report page: HTTP ${res.status}`);
  const links = [...(await res.text()).matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => m[1]);
  // Pages sometimes also link an older term's database, so match the term code.
  const href = links.find((l) => new RegExp(`database[-._]${code}\\.xlsx$`, 'i').test(l));
  if (!href) throw new Error(`no database-${code}.xlsx link on the report page`);
  return new URL(href, 'https://www.sfu.ca/').href;
}

/** Last-Modified of a URL as ISO, via HEAD; '' if absent. */
async function lastModified(url) {
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) throw new Error(`HEAD xlsx: HTTP ${res.status}`);
  const h = res.headers.get('last-modified');
  return h ? new Date(h).toISOString() : '';
}

/** Parse the database xlsx into { asOf, sections }, keeping the latest date only. */
function parseDatabase(buf, stats) {
  for (const { rows } of sheets(buf)) {
    const h = rows.findIndex((r) => r.includes('Subject') && r.includes('CatNbr') && r.includes('Section'));
    if (h < 0) continue;
    const col = Object.fromEntries(rows[h].map((name, i) => [name.trim(), i]));
    for (const name of ['Date', 'Subject', 'CatNbr', 'Section', 'MaxEnrol', 'ActEnrol']) {
      if (col[name] === undefined) throw new Error(`no ${name} column`);
    }
    const data = rows.slice(h + 1).filter((r) => r[col.Subject] && r[col.Section]);
    const asOf = data.reduce((max, r) => {
      const d = excelDate(r[col.Date]);
      return d > max ? d : max;
    }, '');
    const sections = {};
    const everSeen = new Set();
    for (const r of data) {
      const code = `${r[col.Subject].trim().toUpperCase()} ${r[col.CatNbr].trim().toUpperCase()}`;
      const section = r[col.Section].trim().toUpperCase();
      everSeen.add(`${code} ${section}`);
      if (excelDate(r[col.Date]) !== asOf) continue;
      const max = Number(r[col.MaxEnrol]) || 0;
      const enrolled = Number(r[col.ActEnrol]) || 0;
      const byCode = (sections[code] ??= {});
      // Never seen in SFU's files so far, but if a section ever has several
      // rows on one day (e.g. per location), add them up.
      if (byCode[section]) {
        byCode[section].max += max;
        byCode[section].enrolled += enrolled;
        stats.combined++;
      } else byCode[section] = { max, enrolled };
    }
    let latest = 0;
    for (const s of Object.values(sections)) latest += Object.keys(s).length;
    stats.dropped = everSeen.size - latest;
    return { asOf, sections };
  }
  throw new Error('no sheet with a Subject/CatNbr/Section header');
}

const started = Date.now();
const { terms } = JSON.parse(await readFile(OFFERINGS, 'utf8'));
const old = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
console.log(`Terms: ${terms.map((t) => `${t.label} (${termCode(t.id)})`).join(', ')}`);

const out = {};
const summary = { updated: [], unchanged: [], missing: [], failed: [] };
for (const term of terms) {
  const code = termCode(term.id);
  try {
    const url = await findXlsx(code);
    if (!url) {
      console.log(`  ${term.label}: no report page yet, skipped`);
      summary.missing.push(term.label);
      continue;
    }
    const modified = await lastModified(url);
    const prev = old.terms?.[term.id];
    if (prev && modified && prev.sourceModified === modified) {
      console.log(`  ${term.label}: unchanged since ${modified}, kept data as of ${prev.asOf}`);
      out[term.id] = prev;
      summary.unchanged.push(term.label);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET xlsx: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const stats = { combined: 0, dropped: 0 };
    const { asOf, sections } = parseDatabase(buf, stats);
    const count = Object.values(sections).reduce((n, s) => n + Object.keys(s).length, 0);
    out[term.id] = { asOf, ...(modified ? { sourceModified: modified } : {}), sections };
    summary.updated.push(term.label);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `  ${term.label}: ${count} sections in ${Object.keys(sections).length} courses as of ${asOf} ` +
        `(file modified ${modified || 'unknown'}${prev ? `, was ${prev.sourceModified}` : ''}; ` +
        `${(buf.length / 1e6).toFixed(1)} MB; ${secs}s)`,
    );
    if (stats.dropped) console.log(`    (${stats.dropped} sections listed on earlier days but not on ${asOf})`);
    if (stats.combined) console.log(`    (${stats.combined} same-day duplicate rows added together)`);
  } catch (err) {
    // Keep the previous data for this term rather than losing it.
    console.warn(`  ! ${term.label}: ${err.message}${old.terms?.[term.id] ? '; kept previous data' : ''}`);
    if (old.terms?.[term.id]) out[term.id] = old.terms[term.id];
    summary.failed.push(term.label);
  }
}

const json = JSON.stringify({ fetched: new Date().toISOString(), terms: out });
await writeFile(OUT, json);
console.log(
  `Wrote public/data/seats.json (${(json.length / 1024).toFixed(0)} KB) in ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
for (const [k, v] of Object.entries(summary)) if (v.length) console.log(`  ${k}: ${v.join(', ')}`);
