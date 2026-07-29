/**
 * tools/audit.js — whole-repo static audit. Zero dependencies.
 *
 *   node tools/audit.js          report only
 *   node tools/audit.js --strict exit 1 on any error-level finding
 *
 * Checks
 *  1  unused imports in every src module
 *  2  DOM selectors used in JS that do not exist in index.html
 *  3  i18n keys used in code but missing from the English dictionary
 *  4  i18n dictionary keys nobody uses (dead strings)
 *  5  CSS classes referenced from JS/HTML but never styled
 *  6  CSS classes styled but never referenced
 *  7  event names emitted with no listener, and listened with no emitter
 *  8  leftover console.log / debugger / TODO in shipped code
 *  9  layering rules: engine/ must not import outside engine/
 * 10  timers and listeners that are never cleaned up (informational)
 * 11  sw.js precache completeness vs the real file list
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

const errors = [];
const warns = [];
const infos = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const info = (m) => infos.push(m);

/* ─────────────────────────────── inputs ──────────────────────────────── */

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const srcFiles = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
const testFiles = walk(join(ROOT, 'tests')).filter((f) => f.endsWith('.js'));
const toolFiles = walk(join(ROOT, 'tools')).filter((f) => f.endsWith('.js'));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'src/ui/styles.css'), 'utf8');
const swSrc = readFileSync(join(ROOT, 'sw.js'), 'utf8');

const src = new Map(srcFiles.map((f) => [f, readFileSync(f, 'utf8')]));
const allJs = new Map([...src, ...testFiles.map((f) => [f, readFileSync(f, 'utf8')])]);

/** Strip comments and string literals so scans do not trip over prose. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/* ───────────────────── 1. unused imports ─────────────────────────────── */

for (const [file, text] of src) {
  const body = code(text);
  const importRe = /import\s+([^'"]+?)\s+from\s+['"][^'"]+['"]/g;
  let m;
  while ((m = importRe.exec(body))) {
    const clause = m[1];
    const names = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.push(name);
      }
    }
    const bare = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (bare && !bare.startsWith('*')) names.push(bare);

    const after = body.slice(m.index + m[0].length);
    for (const name of names) {
      const used = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b').test(after);
      if (!used) err('unused import `' + name + '` in ' + rel(file));
    }
  }
}

/* ──────────────── 2. DOM selectors that do not exist ─────────────────── */

const attrSelectors = new Set();
for (const [, text] of src) {
  const re = /querySelector(?:All)?\(\s*'(\[[^']+\])'/g;
  let m;
  while ((m = re.exec(text))) attrSelectors.add(m[1]);
}
for (const sel of attrSelectors) {
  // [data-x="y"] → data-x="y" must appear in the markup, unless it is built in JS
  const pair = sel.match(/^\[([\w-]+)="([^"]+)"\]$/);
  if (!pair) continue;
  const needle = pair[1] + '="' + pair[2] + '"';
  const inHtml = html.includes(needle);
  const prop = pair[1].replace(/^data-/, '').replace(/-(\w)/g, (x, c) => c.toUpperCase());
  const builtInJs = [...src.values()].some(
    (t) =>
      t.includes('.dataset.' + prop) ||
      // ui/dom.js props: h('b', { dataset: { tour: 'clock' } })
      new RegExp('dataset:\\s*\\{[^}]*\\b' + prop + ":\\s*'" + pair[2] + "'").test(t)
  );
  if (!inHtml && !builtInJs) err('selector ' + sel + ' matches nothing in index.html');
}

/* ─────────────────────── 3+4. i18n coverage ──────────────────────────── */

const i18nSrc = readFileSync(join(ROOT, 'src/i18n/index.js'), 'utf8');
const enBlock = i18nSrc.slice(i18nSrc.indexOf('const EN = {'), i18nSrc.indexOf('const HI = {'));
const enKeys = new Set([...enBlock.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
const hiBlock = i18nSrc.slice(i18nSrc.indexOf('const HI = {'), i18nSrc.indexOf('const DICTS'));
const hiKeys = new Set([...hiBlock.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));

/** Strings that stay English on purpose (brand, universal shorthands). */
const I18N_EXEMPT = new Set(['app.name', 'online.2p', 'online.4p', 'game.timeLeft']);

const usedKeys = new Set(); // referenced anywhere (src + tests)
const shippedKeys = new Set(); // referenced from src only
for (const [file, text] of allJs) {
  if (file.endsWith('i18n/index.js')) continue;
  const found = new Set();
  for (const m of text.matchAll(/\bt\(\s*'([\w.]+\.[\w.]+)'/g)) found.add(m[1]);
  for (const m of text.matchAll(/i18n\.t\(\s*'([\w.]+\.[\w.]+)'/g)) found.add(m[1]);
  for (const m of text.matchAll(/(?:titleKey|labelKey|subKey|badgeKey|key):\s*'([\w.]+\.[\w.]+)'/g)) found.add(m[1]);
  for (const m of text.matchAll(/data-i18n="([\w.]+)"/g)) found.add(m[1]);
  for (const key of found) {
    usedKeys.add(key);
    if (src.has(file)) shippedKeys.add(key);
  }
}
for (const m of html.matchAll(/data-i18n(?:-aria|-ph)?="([\w.]+)"/g)) {
  usedKeys.add(m[1]);
  shippedKeys.add(m[1]);
}
// Any dotted string literal in src that equals a known key counts as used —
// this covers keys held in maps or picked by a ternary.
for (const [, text] of src) {
  for (const m of text.matchAll(/'([a-z][\w]*(?:\.[\w]+)+)'/g)) {
    if (enKeys.has(m[1])) {
      usedKeys.add(m[1]);
      shippedKeys.add(m[1]);
    }
  }
}
for (const key of shippedKeys) {
  if (!enKeys.has(key)) err('i18n key used but missing from EN: ' + key);
  else if (!hiKeys.has(key) && !I18N_EXEMPT.has(key)) warn('i18n key not translated to Hindi: ' + key);
}
for (const key of enKeys) {
  if (!usedKeys.has(key)) info('i18n key never used: ' + key);
}

/* ───────────────────────── 5+6. CSS classes ──────────────────────────── */

// comments stripped first so file names in prose ('.js', '.css') are not
// mistaken for class selectors; chained selectors (.a.b) must still be seen.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const cssClasses = new Set([...cssNoComments.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
const usedClasses = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/)) if (c) usedClasses.add(c);
}
const CLASS_TOKEN = /^[a-z][\w-]*$/;
for (const [, text] of src) {
  // className = 'a b' / className = 'a b' + something → only take the literal part
  for (const m of text.matchAll(/className\s*=\s*'([a-z][\w\- ]*)'/g)) {
    for (const c of m[1].split(/\s+/)) if (CLASS_TOKEN.test(c)) usedClasses.add(c);
  }
  for (const m of text.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*'([\w-]+)'/g)) usedClasses.add(m[1]);
  // class="..." inside template strings
  for (const m of text.matchAll(/class="([a-z][\w\- ]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (CLASS_TOKEN.test(c)) usedClasses.add(c);
  }
  // ui/dom.js element specs: h('button.chip.is-on#go', …)
  for (const m of text.matchAll(/\bh\(\s*'([a-z][\w.#-]*)'/g)) {
    for (const c of m[1].split('#')[0].split('.').slice(1)) if (CLASS_TOKEN.test(c)) usedClasses.add(c);
  }
  // class: { 'gold-x2': cond } / class: ['a', 'b'] object and array forms
  for (const m of text.matchAll(/class:\s*[[{]([^\]}]*)[\]}]/g)) {
    for (const q of m[1].matchAll(/'([a-z][\w-]*)'/g)) usedClasses.add(q[1]);
  }
}
for (const c of usedClasses) {
  if (!cssClasses.has(c) && !c.startsWith('is-') && !c.includes('--')) {
    warn('class "' + c + '" is used but has no CSS rule');
  }
}
for (const c of cssClasses) {
  // `x--variant` and `is-state` classes are composed at runtime ('tile tile--' + kind)
  if (c.includes('--') || c.startsWith('is-')) continue;
  if (!usedClasses.has(c)) info('CSS class never used: .' + c);
}

/* ──────────────────────── 7. event name wiring ───────────────────────── */

const emitted = new Map();
const listened = new Map();
const addTo = (map, name, file) => {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(rel(file));
};
for (const [file, text] of src) {
  for (const m of text.matchAll(/bus\.emit\(\s*'([\w:]+)'/g)) addTo(emitted, m[1], file);
  for (const m of text.matchAll(/emit\(\s*'([\w:]+)'/g)) addTo(emitted, m[1], file);
  for (const m of text.matchAll(/bus\.on(?:ce)?\(\s*'([\w:]+)'/g)) addTo(listened, m[1], file);
  // Files that subscribe through a variable (bus.on(evt, ...) inside a loop over
  // a list of names) count every event-shaped literal they contain as listened.
  if (/bus\.on\(\s*[a-z_$][\w$]*\s*,/.test(text)) {
    for (const m of text.matchAll(/'([a-z][\w]*:[\w]+)'/g)) addTo(listened, m[1], file);
  }
}
// engine events flow through rules.js EV and are emitted via emitAll
const engineEvents = new Set(
  [...readFileSync(join(ROOT, 'src/engine/rules.js'), 'utf8').matchAll(/:\s*'([\w:]+)'/g)].map((m) => m[1])
);
for (const [name, files] of listened) {
  if (!emitted.has(name) && !engineEvents.has(name)) {
    err('event "' + name + '" is listened to (' + [...files].join(', ') + ') but never emitted');
  }
}
/**
 * Events that exist as a deliberate public hook (Phase 2 / analytics / tests)
 * even though nothing in this build subscribes yet.
 */
const PUBLIC_EVENTS = new Set([
  'account:xp',
  'catalog:progress',
  'rewards:spins',
  'rewards:daily',
  'rewards:lucky',
  'tasks:reset',
  'tasks:points',
  'tasks:claimed',
  'tasks:milestone',
  'wallet:earned',
  'wallet:spent',
  'wallet:settled',
  'ads:start',
  'ads:cancelled',
  'ads:reward',
  'shop:refused',
  'shop:purchased',
  'shop:granted',
  'social:like',
  'social:reported',
]);
for (const [name, files] of emitted) {
  if (PUBLIC_EVENTS.has(name)) continue;
  if (!listened.has(name) && !name.startsWith('sync:') && !name.startsWith('chat:')) {
    info('event "' + name + '" emitted with no listener (' + [...files].join(', ') + ')');
  }
}
// EVENTS constants that point at nothing
const eventsSrc = readFileSync(join(ROOT, 'src/game/events.js'), 'utf8');
for (const m of eventsSrc.matchAll(/^\s*([A-Z_]+):\s*'([\w:]+)',/gm)) {
  const [, constName, value] = m;
  const usedAnywhere = [...src.values()].some((t) => t.includes('EVENTS.' + constName));
  if (!usedAnywhere && !value.startsWith('sync:') && !value.startsWith('chat:')) {
    info('EVENTS.' + constName + " ('" + value + "') is never referenced");
  }
}

/* ───────────────── 8. leftovers in shipped code ──────────────────────── */

for (const [file, text] of src) {
  const body = code(text);
  if (/\bdebugger\b/.test(body)) err('debugger statement in ' + rel(file));
  for (const m of body.matchAll(/console\.(log|debug|info)\(/g)) {
    warn('console.' + m[1] + ' left in ' + rel(file));
  }
  for (const m of text.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) warn(m[1] + ' marker in ' + rel(file));
}

/* ─────────────────────── 9. layering rules ───────────────────────────── */

for (const [file, text] of src) {
  const path = rel(file);
  for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
    const target = m[1];
    if (!target.startsWith('.')) continue;
    if (path.startsWith('src/engine/') && !/^\.\/[\w.]+\.js$/.test(target)) {
      err('engine layer violation: ' + path + ' imports ' + target);
    }
    if (path.startsWith('src/render/') && target.includes('/ui/')) {
      err('render must not import ui: ' + path + ' → ' + target);
    }
    if (path.startsWith('src/meta/') && (target.includes('/ui/') || target.includes('/render/'))) {
      err('meta must not import ui/render: ' + path + ' → ' + target);
    }
  }
}

/* ─────────────────── 10. uncleaned timers / listeners ────────────────── */

for (const [file, text] of src) {
  const intervals = (text.match(/setInterval\(/g) || []).length;
  const clears = (text.match(/clearInterval\(/g) || []).length;
  if (intervals > clears) warn('setInterval without a matching clearInterval in ' + rel(file));
}

/* ───────────────────── 11. precache completeness ─────────────────────── */

const list = swSrc.match(/const PRECACHE = \[([\s\S]*?)\];/);
const precache = list ? [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
for (const file of srcFiles) {
  const path = './' + rel(file);
  if (!precache.includes(path)) err('sw.js PRECACHE is missing ' + path);
}
for (const entry of precache) {
  if (entry === './') continue;
  if (!existsSync(join(ROOT, entry.replace('./', '')))) err('sw.js precaches a missing file: ' + entry);
}
for (const file of [...toolFiles, ...testFiles]) {
  if (precache.includes('./' + rel(file))) err('dev-only file is precached: ' + rel(file));
}

/* ──────────────────────────── report ─────────────────────────────────── */

const show = (label, list) => {
  if (!list.length) return;
  console.log('\n' + label + ' (' + list.length + ')');
  for (const line of list) console.log('  ' + line);
};

console.log('Ludo Battle — repo audit');
console.log(
  '  ' + srcFiles.length + ' source files · ' + testFiles.length + ' test files · ' +
  enKeys.size + ' EN strings · ' + hiKeys.size + ' HI strings · ' + cssClasses.size + ' CSS classes'
);
show('ERRORS', errors);
show('WARNINGS', warns);
show('NOTES', infos);
console.log(
  '\n' + errors.length + ' error(s), ' + warns.length + ' warning(s), ' + infos.length + ' note(s)\n'
);
if (STRICT && errors.length) process.exit(1);
