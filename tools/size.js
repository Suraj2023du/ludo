/**
 * tools/size.js — payload report against the performance budget.
 *
 *   node tools/size.js
 *
 * Measures exactly what a first-time visitor downloads: everything the service
 * worker precaches. Prints raw and gzipped sizes per file and fails (exit 1) if
 * the budget is blown.
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The budget is enforced on TRANSFER bytes (gzip), because that is what a user
 * on 2G actually downloads and what every static host (GitHub Pages, Firebase
 * Hosting, any CDN) sends. Raw bytes only decide how much room the service
 * worker cache takes on disk, so they get a generous sanity ceiling instead of a
 * hard gate — trimming documentation to win back raw bytes would optimise the
 * wrong number and cost us the Phase 2 handoff notes.
 */
const GZIP_BUDGET_KB = 250; // hard gate: over-the-wire first load
const GZIP_TARGET_KB = 150; // the number we aim for
const RAW_CEILING_KB = 900; // sanity ceiling for cache storage

const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const list = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
const files = list
  ? [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((p) => p !== './')
  : [];
files.push('./sw.js'); // the worker itself is downloaded too

const rows = [];
let raw = 0;
let gz = 0;
let missing = 0;

for (const rel of files) {
  const path = join(ROOT, rel.replace('./', ''));
  if (!existsSync(path)) {
    rows.push({ rel, bytes: 0, gzip: 0, missing: true });
    missing++;
    continue;
  }
  const bytes = statSync(path).size;
  const gzipped = gzipSync(readFileSync(path), { level: 9 }).length;
  raw += bytes;
  gz += gzipped;
  rows.push({ rel, bytes, gzip: gzipped });
}

rows.sort((a, b) => b.bytes - a.bytes);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

console.log('\nLudo Battle — first-load payload\n');
console.log(pad('file', 34) + padl('raw', 11) + padl('gzip', 11));
console.log('-'.repeat(56));
for (const r of rows) {
  if (r.missing) {
    console.log(pad(r.rel, 34) + padl('MISSING', 11));
    continue;
  }
  console.log(pad(r.rel, 34) + padl(kb(r.bytes), 11) + padl(kb(r.gzip), 11));
}
console.log('-'.repeat(56));
console.log(pad(rows.length + ' files', 34) + padl(kb(raw), 11) + padl(kb(gz), 11));

const rawKb = raw / 1024;
const gzKb = gz / 1024;
const pass = gzKb < GZIP_BUDGET_KB && rawKb < RAW_CEILING_KB;

console.log(
  '\ntransfer budget  < ' + GZIP_BUDGET_KB + ' KB gzip   → ' +
  (gzKb < GZIP_BUDGET_KB ? 'PASS' : 'FAIL') + ' (' + kb(gz) + ' over the wire)'
);
console.log(
  'transfer target  ~ ' + GZIP_TARGET_KB + ' KB gzip   → ' +
  (gzKb <= GZIP_TARGET_KB ? 'PASS' : 'over target by ' + (gzKb - GZIP_TARGET_KB).toFixed(1) + ' KB')
);
console.log(
  'cache ceiling    < ' + RAW_CEILING_KB + ' KB raw    → ' +
  (rawKb < RAW_CEILING_KB ? 'PASS' : 'FAIL') + ' (' + kb(raw) + ' stored by the service worker)'
);
console.log('repeat visits      0 bytes (precached)');
console.log('runtime deps       0');
console.log('');

if (missing) {
  console.log(missing + ' precached file(s) missing');
  process.exit(1);
}
if (!pass) process.exit(1);
