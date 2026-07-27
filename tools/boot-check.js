/**
 * tools/boot-check.js — proves the app boots clean, in Node.
 *
 *   node tools/boot-check.js
 *
 * 1. imports EVERY source module (catches syntax errors and bad import paths)
 * 2. loads index.html into the DOM shim and boots src/main.js
 * 3. clicks through the menu, starts a Quick Match, rolls the dice
 * 4. fails the process if anything was logged to console.error
 * 5. checks index.html / sw.js / manifest.json reference files that exist
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDom, tapCanvas } from './dom-stub.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function ok(label) {
  notes.push('  ok   ' + label);
}
function bad(label) {
  problems.push('  FAIL ' + label);
}

/* ───────────────────────── 1. import every module ────────────────────────── */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const modules = walk(join(ROOT, 'src'));
for (const file of modules) {
  try {
    await import(pathToFileURL(file).href);
    ok('import ' + relative(ROOT, file).replace(/\\/g, '/'));
  } catch (err) {
    bad('import ' + relative(ROOT, file).replace(/\\/g, '/') + ' → ' + err.message);
  }
}

/* ─────────────────── 2. static references actually exist ─────────────────── */

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  const target = join(ROOT, ref.replace('./', ''));
  if (existsSync(target)) ok('index.html → ' + ref);
  else bad('index.html references a missing file: ' + ref);
}

const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const listMatch = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
const precache = listMatch ? [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
if (!precache.length) bad('sw.js has no PRECACHE list');
for (const ref of precache) {
  if (ref === './') continue;
  const target = join(ROOT, ref.replace('./', ''));
  if (existsSync(target)) ok('precache → ' + ref);
  else bad('sw.js precaches a missing file: ' + ref);
}

// every shipped module must be precached
const shipped = modules
  .map((f) => './' + relative(ROOT, f).replace(/\\/g, '/'))
  .filter((p) => p.startsWith('./src/'));
for (const file of shipped) {
  if (!precache.includes(file)) bad('sw.js is missing ' + file + ' from PRECACHE');
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
for (const icon of manifest.icons) {
  const target = join(ROOT, icon.src.replace('./', ''));
  if (existsSync(target)) ok('manifest icon → ' + icon.src);
  else bad('manifest icon missing: ' + icon.src);
}

/* ──────────────────────────── 3. boot the app ────────────────────────────── */

const dom = installDom({ htmlPath: join(ROOT, 'index.html') });
let api = null;
try {
  await import(pathToFileURL(join(ROOT, 'src', 'main.js')).href + '?boot=1');
  api = dom.window.LudoBattle;
  if (!api) bad('boot did not expose window.LudoBattle');
  else ok('boot() ran and exposed window.LudoBattle');
} catch (err) {
  bad('boot threw: ' + (err && err.stack ? err.stack.split('\n')[0] : err));
}

if (api) {
  await dom.tick(60);

  // menu is reachable and the buttons are wired
  api.router.show('menu', { silent: true });
  const menuButtons = dom.document.querySelectorAll('[data-go]');
  if (menuButtons.length >= 5) ok('menu has ' + menuButtons.length + ' navigation buttons');
  else bad('expected 5 menu buttons, found ' + menuButtons.length);

  // Vs Computer → setup screen renders names for 4 seats
  menuButtons[0].click();
  await dom.tick(20);
  if (api.router.current === 'setup') ok('menu → setup');
  else bad('menu button did not open the setup screen');
  const nameRows = dom.document.querySelector('[data-setup="names"]').children.length;
  if (nameRows === 4) ok('setup rendered 4 name rows');
  else bad('setup rendered ' + nameRows + ' name rows, expected 4');

  // start a quick match and roll
  const session = api.startGame({ mode: 'quickMatch', count: 2, humanColor: 'red', names: {} });
  session.controller.setTiming({ diceRoll: 0, step: 0, capture: 0, finish: 0, botThink: 0, botMove: 0, pass: 0, turnGap: 0 });
  await dom.tick(60);
  if (api.router.current === 'game') ok('quick match started on the game screen');
  else bad('quick match did not switch to the game screen');
  if (session.controller.state.players.length === 2) ok('quick match seated 2 players');
  else bad('quick match seated ' + session.controller.state.players.length + ' players');

  const canvas = dom.document.querySelector('[data-game="canvas"]');
  const ctx = canvas.getContext('2d');
  await dom.tick(80);
  if (ctx.calls > 50) ok('canvas painted (' + ctx.calls + ' draw calls)');
  else bad('canvas barely painted: ' + ctx.calls + ' draw calls');

  const before = session.controller.state.rollCount;
  const layout = api.view.layout;
  tapCanvas(canvas, layout.dice.x + layout.dice.size / 2, layout.dice.y + layout.dice.size / 2);
  await dom.tick(700);
  if (session.controller.state.rollCount > before) ok('tapping the dice rolled it');
  else bad('tapping the dice did nothing (rollCount stayed ' + before + ')');

  // pause / resume / exit
  dom.document.querySelector('[data-game="pause"]').click();
  await dom.tick(20);
  if (session.controller.paused) ok('pause button paused the game');
  else bad('pause button did not pause');
  dom.document.querySelector('[data-pause="resume"]').click();
  await dom.tick(20);
  if (!session.controller.paused) ok('resume button resumed the game');
  else bad('resume button did not resume');

  // themes
  for (const id of ['midnight', 'royal', 'candy', 'classic']) {
    api.prefs.set('theme', id);
    await dom.tick(20);
  }
  ok('all board themes applied without error');

  // persistence
  if (api.resume.has()) ok('mid-game snapshot is stored for "resume last game"');
  else bad('no resume snapshot was written');

  api.exitToMenu();
  await dom.tick(20);
  if (api.router.current === 'menu') ok('exit returned to the menu');
  else bad('exit did not return to the menu');
}

/* ───────────────────────────── 4. console clean ───────────────────────────── */

const errors = dom.console.errors;
dom.restore();

if (errors.length === 0) ok('zero console errors during boot and play');
else for (const e of errors) bad('console.error: ' + e);

/* ───────────────────────────────── report ────────────────────────────────── */

console.log('\nLudo Battle — boot check');
console.log(notes.join('\n'));
if (problems.length) {
  console.log('\n' + problems.join('\n'));
  console.log('\n' + problems.length + ' problem(s) found\n');
  process.exit(1);
}
console.log('\nAll ' + notes.length + ' checks passed. No console errors.\n');
