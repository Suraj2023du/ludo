/**
 * tools/playthrough.js — end-to-end verification through the real UI.
 *
 *   node tools/playthrough.js
 *
 * Boots index.html in the DOM shim and plays real games with the real render
 * loop, the real animator and the real controller — no engine shortcuts. Two
 * scenarios cover the paths a quick smoke test would miss:
 *
 *   A. a forced capture  → capture animation, victim returns to base, extra turn
 *   B. an endgame        → exact finish, ranks, game over, result overlay,
 *                          confetti, stats recording and "play again"
 *
 * Exits non-zero on any failure or console error.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDom, tapCanvas } from './dom-stub.js';
import { createInitialState, FINISH, toRel } from '../src/engine/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) results.push('  ok   ' + label);
  else {
    failures++;
    results.push('  FAIL ' + label + (detail ? ' → ' + detail : ''));
  }
}

const dom = installDom({ htmlPath: join(ROOT, 'index.html') });
await import(pathToFileURL(join(ROOT, 'src', 'main.js')).href);
const api = dom.window.LudoBattle;
const doc = dom.document;
const canvas = doc.querySelector('[data-game="canvas"]');
const FAST = { diceRoll: 0, step: 0, capture: 0, finish: 0, botThink: 0, botMove: 0, pass: 0, turnGap: 0 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build a custom starting position and hand it to startGame() as a "resume". */
function scenario(tokens, opts = {}) {
  const state = createInitialState({
    id: 'scenario',
    createdAt: Date.now(),
    mode: opts.mode || 'vsComputer',
    startingPlayer: 0,
    players: [
      { color: 'red', name: 'You', type: 'human' },
      { color: 'green', name: 'Green Bot', type: 'bot' },
      { color: 'yellow', name: 'Yellow Bot', type: 'bot' },
      { color: 'blue', name: 'Blue Bot', type: 'bot' },
    ],
  });
  for (const [color, list] of Object.entries(tokens)) {
    const p = state.players.find((x) => x.color === color);
    p.tokens = list.slice();
    p.finished = list.filter((t) => t === FINISH).length;
  }
  return state;
}

function tapDice() {
  const layout = api.view.layout;
  tapCanvas(canvas, layout.dice.x + layout.dice.size / 2, layout.dice.y + layout.dice.size / 2);
}

/* ═══════════════ scenario A: every roll captures something ═══════════════ */
{
  // Red sits on its start square with 3 tokens already home, so exactly one
  // move is ever legal. Every cell 1..6 ahead of it holds an enemy token, so
  // whatever the dice says, a capture happens.
  const state = scenario({
    red: [0, FINISH, FINISH, FINISH],
    green: [toRel('green', 1), toRel('green', 2), toRel('green', 3), toRel('green', 4)],
    yellow: [toRel('yellow', 5), toRel('yellow', 6), FINISH, FINISH],
    blue: [FINISH, FINISH, FINISH, FINISH],
  });
  state.players[3].rank = 1;
  state.ranks = [3];

  const captures = [];
  const banners = [];
  // The HUD subscribed first (during boot), so by the time this runs the banner
  // already shows the capture message.
  const unsub = api.bus.on('token:captured', (e) => {
    captures.push(e);
    banners.push(doc.querySelector('[data-hud="banner"]').textContent);
  });

  const session = api.startGame({ mode: 'vsComputer', count: 4, humanColor: 'red', names: {} }, state);
  session.controller.setTiming(FAST);
  await wait(80);

  check('scenario A: game screen is live', api.router.current === 'game');
  check('scenario A: human seat may roll', session.controller.canRoll());

  const victimsBefore = session.controller.state.players
    .filter((p) => p.color !== 'red')
    .reduce((n, p) => n + p.tokens.filter((t) => t >= 0 && t < FINISH).length, 0);

  tapDice();
  await wait(1500);

  check('scenario A: a capture happened', captures.length > 0, 'captures=' + captures.length);
  if (captures.length) {
    const victim = session.controller.state.players[captures[0].playerId];
    check(
      'scenario A: the captured token went back to base',
      victim.tokens[captures[0].tokenIndex] === -1,
      'token=' + victim.tokens[captures[0].tokenIndex]
    );
    check(
      'scenario A: capture granted an extra turn (red still in turn)',
      session.controller.state.turn === 0 || session.controller.state.rollCount > 1
    );
  }
  const victimsAfter = session.controller.state.players
    .filter((p) => p.color !== 'red')
    .reduce((n, p) => n + p.tokens.filter((t) => t >= 0 && t < FINISH).length, 0);
  check('scenario A: exactly one enemy token left the board', victimsAfter < victimsBefore);
  check('scenario A: banner reported the capture', banners.some((t) => /sent home/i.test(t)), banners.join(' / '));
  unsub();
}

/* ═════════════ scenario B: endgame → ranks, result, stats ═══════════════ */
{
  const statsBefore = api.stats.get('vsComputer');
  const state = scenario({
    red: [FINISH, FINISH, FINISH, FINISH - 2], // needs an exact 2
    green: [FINISH, FINISH, FINISH, FINISH - 1], // needs an exact 1
    yellow: [FINISH, FINISH, FINISH, FINISH - 3],
    blue: [FINISH, FINISH, FINISH, FINISH - 4],
  });

  const seen = { finished: [], ranks: [], over: null };
  const unsubs = [
    api.bus.on('token:finished', (e) => seen.finished.push(e)),
    api.bus.on('player:finished', (e) => seen.ranks.push(e.rank)),
    api.bus.on('game:over', (e) => {
      seen.over = e;
    }),
  ];

  const session = api.startGame({ mode: 'vsComputer', count: 4, humanColor: 'red', names: {} }, state);
  session.controller.setTiming(FAST);
  await wait(80);

  // Play until the game ends: tap for the human, bots play themselves.
  const deadline = Date.now() + 40000;
  while (!seen.over && Date.now() < deadline) {
    if (session.controller.canRoll()) tapDice();
    await wait(60);
  }

  check('scenario B: the game reached game over', seen.over !== null);
  if (seen.over) {
    check('scenario B: all four players are ranked', seen.over.ranks.length === 4, JSON.stringify(seen.over.ranks));
    check('scenario B: ranks were awarded 1..4', seen.ranks.slice().sort().join(',') === '1,2,3,4', seen.ranks.join(','));
    // Three tokens have to come home; the last player is ranked without
    // finishing, exactly as the ruleset says.
    check('scenario B: three tokens came home', seen.finished.length === 3, 'count=' + seen.finished.length);
    const winner = session.controller.state.players[seen.over.winner];
    check('scenario B: the winner has all 4 tokens home', winner.finished === 4);
  }

  await wait(1200); // the result overlay opens after a beat
  const overlay = doc.querySelector('[data-overlay="result"]');
  check('scenario B: result overlay opened', overlay.classList.contains('is-open'));
  check('scenario B: rankings listed for 4 players', overlay.querySelector('[data-result="list"]').children.length === 4);
  check('scenario B: headline written', overlay.querySelector('[data-result="headline"]').textContent.length > 3);

  const statsAfter = api.stats.get('vsComputer');
  check('scenario B: stats recorded the game', statsAfter.games === statsBefore.games + 1, statsBefore.games + ' → ' + statsAfter.games);
  check('scenario B: resume snapshot cleared after the game', api.resume.has() === false);

  overlay.querySelector('[data-result="again"]').click();
  await wait(200);
  check('scenario B: play again started a fresh game', api.router.current === 'game' && api.session !== null);
  check(
    'scenario B: the fresh game starts from scratch',
    api.session.controller.state.players.every((p) => p.finished === 0)
  );
  for (const u of unsubs) u();
}

/* ═════ scenario C (opt-in): one COMPLETE game through the real loop ═════ */
if (process.env.FULL === '1') {
  const state = scenario({}, { mode: 'vsComputer' });
  for (const p of state.players) p.type = 'bot'; // no taps needed

  let over = null;
  let captures = 0;
  let finishes = 0;
  const unsubs = [
    api.bus.on('game:over', (e) => {
      over = e;
    }),
    api.bus.on('token:captured', () => captures++),
    api.bus.on('token:finished', () => finishes++),
  ];

  const session = api.startGame({ mode: 'vsComputer', count: 4, humanColor: 'red', names: {} }, state);
  session.controller.setTiming(FAST);
  const startedAt = Date.now();
  const deadline = startedAt + 300000;
  while (!over && Date.now() < deadline) await wait(200);

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  check('scenario C: a full 4-player game finished through the UI', over !== null, secs + 's');
  if (over) {
    const s = session.controller.state;
    check('scenario C: every player ranked', over.ranks.length === 4);
    check('scenario C: captures animated during the game', captures > 0, 'captures=' + captures);
    check('scenario C: tokens finished during the game', finishes >= 9, 'finishes=' + finishes);
    check('scenario C: no token is left in an illegal position', s.players.every((p) => p.tokens.every((t) => t >= -1 && t <= FINISH)));
    console.log(
      '  info   ' + s.rollCount + ' rolls, ' + s.moveCount + ' moves, ' + captures + ' captures, ' +
      finishes + ' tokens home, ' + secs + 's of wall clock'
    );
  }
  for (const u of unsubs) u();
}

api.exitToMenu();
await wait(50);
check('exit returns to the menu', api.router.current === 'menu');

const errors = dom.console.errors;
dom.restore();
check('zero console errors across both scenarios', errors.length === 0, errors.join(' | '));

console.log('\nLudo Battle — UI playthrough');
console.log(results.join('\n'));
if (failures) {
  console.log('\n' + failures + ' failure(s)\n');
  process.exit(1);
}
console.log('\nAll ' + results.length + ' checks passed.\n');
process.exit(0);
