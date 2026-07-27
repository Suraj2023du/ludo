/**
 * tests/ui.test.js — boots the real index.html + src/main.js inside the Node DOM
 * shim (tools/dom-stub.js) and drives it with real clicks.
 *
 * This is what backs the claim "the game boots with zero console errors": the
 * whole module graph is loaded, every screen is wired, the canvas paints and the
 * dice actually rolls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { installDom, tapCanvas } from '../tools/dom-stub.js';
import { renderResult } from '../src/ui/screens.js';
import { createPrefs } from '../src/storage/prefs.js';
import { makeGame, setTokens } from './helpers.js';
import { FINISH } from '../src/engine/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const dom = installDom({ htmlPath: join(ROOT, 'index.html') });
await import(pathToFileURL(join(ROOT, 'src', 'main.js')).href);
const api = dom.window.LudoBattle;
const doc = dom.document;
const tick = dom.tick;

const INSTANT = {
  diceRoll: 0,
  step: 0,
  capture: 0,
  finish: 0,
  botThink: 0,
  botMove: 0,
  pass: 0,
  turnGap: 0,
};

test('ui: index.html boots and exposes the app', () => {
  assert.ok(api, 'window.LudoBattle must exist');
  assert.equal(doc.getElementById('app') !== null, true);
  assert.equal(doc.querySelectorAll('[data-screen]').length, 6, 'six screens in the shell');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: menu navigates to setup and renders one name row per seat', async () => {
  api.router.show('menu', { silent: true });
  const buttons = doc.querySelectorAll('[data-go]');
  assert.equal(buttons.length, 5);

  buttons[0].click(); // Vs Computer
  await tick(20);
  assert.equal(api.router.current, 'setup');
  assert.equal(doc.querySelector('[data-setup="names"]').children.length, 4);

  // switching to 2 players re-renders the list
  const countChips = doc.querySelector('[data-setup="count"]').children;
  countChips[0].click(); // "2P"
  await tick(20);
  assert.equal(doc.querySelector('[data-setup="names"]').children.length, 2);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: starting a game paints the board and builds the HUD panels', async () => {
  const session = api.startGame({ mode: 'vsComputer', count: 4, humanColor: 'red', names: {} });
  session.controller.setTiming(INSTANT);
  await tick(80);

  assert.equal(api.router.current, 'game');
  assert.equal(session.controller.state.players.length, 4);
  assert.equal(doc.querySelector('[data-hud="panels"]').children.length, 4);

  const canvas = doc.querySelector('[data-game="canvas"]');
  assert.ok(canvas.getContext('2d').calls > 50, 'the canvas painted');
  assert.match(doc.querySelector('[data-hud="banner"]').textContent, /turn/i);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: tapping the dice rolls it and the turn advances', async () => {
  const session = api.session;
  const canvas = doc.querySelector('[data-game="canvas"]');
  const layout = api.view.layout;
  const before = session.controller.state.rollCount;

  assert.equal(session.controller.canRoll(), true, 'the human seat is waiting for a roll');
  tapCanvas(canvas, layout.dice.x + layout.dice.size / 2, layout.dice.y + layout.dice.size / 2);
  await tick(700);

  assert.ok(session.controller.state.rollCount > before, 'the dice was rolled');
  assert.ok(session.controller.state.rollCount >= 1);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: pause and resume are wired to the controller', async () => {
  const session = api.session;
  doc.querySelector('[data-game="pause"]').click();
  await tick(20);
  assert.equal(session.controller.paused, true);
  assert.equal(doc.querySelector('[data-overlay="pause"]').classList.contains('is-open'), true);

  doc.querySelector('[data-pause="resume"]').click();
  await tick(20);
  assert.equal(session.controller.paused, false);
  assert.equal(doc.querySelector('[data-overlay="pause"]').classList.contains('is-open'), false);
});

test('ui: pass & play shows the "pass the phone" privacy screen', async () => {
  const session = api.startGame({
    mode: 'passPlay',
    count: 2,
    humanColor: 'red',
    names: { red: 'Asha', yellow: 'Ravi' },
  });
  session.controller.setTiming(INSTANT);
  await tick(40);

  const overlay = doc.querySelector('[data-overlay="pass"]');
  assert.equal(overlay.classList.contains('is-open'), true, 'the gate blocks the first turn');
  assert.equal(doc.querySelector('[data-pass="name"]').textContent, 'Asha');
  assert.equal(session.controller.canRoll(), false, 'nobody may roll behind the privacy screen');

  doc.querySelector('[data-pass="ok"]').click();
  await tick(40);
  assert.equal(overlay.classList.contains('is-open'), false);
  assert.equal(session.controller.canRoll(), true, 'the seat can play once it confirms');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: settings toggles persist and themes apply', async () => {
  api.router.show('settings', { silent: true });
  const soundBtn = doc.querySelector('[data-set="sound"]');
  const before = api.prefs.get('sound');
  soundBtn.click();
  assert.equal(api.prefs.get('sound'), !before);
  assert.equal(soundBtn.getAttribute('aria-pressed'), String(!before));
  soundBtn.click();
  assert.equal(api.prefs.get('sound'), before);

  for (const id of ['midnight', 'royal', 'candy', 'classic']) {
    api.prefs.set('theme', id);
    await tick(10);
    assert.equal(api.prefs.get('theme'), id);
  }
  // a fresh prefs instance reads the same localStorage
  assert.equal(createPrefs().get('theme'), 'classic');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: a mid-game snapshot is saved and can be described', () => {
  const summary = api.resume.describe();
  assert.ok(summary, 'a resume snapshot exists while a game is running');
  assert.equal(summary.players, 2);
  assert.ok(summary.mode);
});

test('ui: the result overlay renders full rankings', () => {
  const state = makeGame();
  setTokens(state, 'green', [FINISH, FINISH, FINISH, FINISH]);
  state.players[1].rank = 1;
  state.players[0].rank = 2;
  state.players[2].rank = 3;
  state.players[3].rank = 4;
  state.ranks = [1, 0, 2, 3];
  state.turnCount = 88;

  const el = doc.querySelector('[data-overlay="result"]');
  const out = renderResult({ el, state, prefs: api.prefs, humanId: 0 });
  assert.equal(out.winner.color, 'green');
  assert.equal(el.querySelector('[data-result="list"]').children.length, 4);
  assert.match(el.querySelector('[data-result="headline"]').textContent, /2nd/);
  assert.match(el.querySelector('[data-result="sub"]').textContent, /88 turns/);
});

test('ui: exit to menu tears the session down cleanly', async () => {
  api.exitToMenu();
  await tick(30);
  assert.equal(api.router.current, 'menu');
  assert.equal(api.session, null);
  assert.equal(api.resume.has(), false, 'the snapshot is cleared on exit');
  assert.deepEqual(dom.console.errors, []);
  dom.restore();
});
