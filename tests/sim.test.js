/**
 * tests/sim.test.js — full-game simulation harness.
 *
 * Plays 200 complete games (every mode, every player count, random-legal and
 * AI policies) and asserts, after EVERY single roll and move:
 *   • no exception is thrown
 *   • auditState() reports zero rule violations
 *   • the state survives a serialize → deserialize round-trip
 * and, once finished, that the game terminated with a real winner and a
 * complete ranking.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODE,
  PHASE,
  TOKENS_PER_PLAYER,
  auditState,
  createInitialState,
  createRng,
  deserialize,
  rollDie,
  serialize,
} from '../src/engine/state.js';
import { applyMove, applyRoll, legalMoves } from '../src/engine/rules.js';
import { chooseMove } from '../src/engine/ai.js';

const ALL_COLORS = ['red', 'green', 'yellow', 'blue'];
const MAX_ROLLS = 20000;

/* ────────────────────────────── policies ─────────────────────────────── */

const randomPolicy = (state, dice, moves, rng) =>
  moves[Math.floor(rng() * moves.length) % moves.length];

const aiPolicy = (level) => (state, dice, moves, rng) =>
  chooseMove(state, dice, state.turn, { rng, level });

const mixedPolicy = (state, dice, moves, rng) => {
  const seat = state.turn;
  if (seat % 2 === 0) return chooseMove(state, dice, seat, { rng, level: 'hard' });
  if (seat % 3 === 0) return chooseMove(state, dice, seat, { rng, level: 'easy' });
  return randomPolicy(state, dice, moves, rng);
};

/* ────────────────────────────── the harness ───────────────────────────── */

/**
 * Play one game to completion, auditing every intermediate state.
 * @returns {{state:object, rolls:number, moves:number, captures:number, sixes:number}}
 */
export function simulateGame({ seed, colors, mode, policy, types: playerTypes }) {
  const rng = createRng(seed);
  let state = createInitialState({
    id: 'sim-' + seed,
    createdAt: 0,
    mode,
    players: colors.map((color, i) => ({
      color,
      name: color,
      type: playerTypes ? playerTypes[i] : 'bot',
      botLevel: 'hard',
    })),
  });

  const audit = (label) => {
    const errs = auditState(state);
    assert.deepEqual(errs, [], 'illegal state after ' + label + ' (seed ' + seed + '): ' + errs);
  };
  audit('setup');

  let rolls = 0;
  let moves = 0;
  let captures = 0;
  let sixes = 0;

  while (state.phase !== PHASE.GAME_OVER) {
    rolls++;
    assert.ok(rolls <= MAX_ROLLS, 'game ' + seed + ' did not terminate in ' + MAX_ROLLS + ' rolls');

    const value = rollDie(rng);
    if (value === 6) sixes++;

    const rolled = applyRoll(state, value);
    state = rolled.state;
    audit('roll ' + value);

    if (state.phase !== PHASE.AWAIT_MOVE) continue; // engine already passed the turn

    const legal = legalMoves(state, state.dice);
    assert.ok(legal.length > 0, 'awaitMove with no legal moves (seed ' + seed + ')');

    const move = policy(state, state.dice, legal, rng);
    assert.ok(move, 'policy returned no move (seed ' + seed + ')');
    assert.ok(
      legal.some((m) => m.from === move.from && m.to === move.to),
      'policy returned an illegal move (seed ' + seed + ')'
    );

    const applied = applyMove(state, move);
    state = applied.state;
    moves++;
    captures += applied.events.filter((e) => e.type === 'token:captured').length;
    audit('move');

    // Round-trip the live state the way Phase 2 will (DB write → DB read).
    const round = deserialize(serialize(state));
    assert.deepEqual(round, state, 'serialize round-trip drifted (seed ' + seed + ')');
  }

  return { state, rolls, moves, captures, sixes };
}

function assertFinished(result, colors) {
  const { state } = result;
  assert.equal(state.phase, PHASE.GAME_OVER);
  assert.equal(state.dice, null);
  assert.equal(state.ranks.length, colors.length, 'every player must be ranked');
  assert.equal(new Set(state.ranks).size, colors.length, 'ranks must be unique');

  const winner = state.players[state.ranks[0]];
  assert.equal(winner.rank, 1);
  assert.equal(winner.finished, TOKENS_PER_PLAYER, 'the winner brought all tokens home');

  state.ranks.forEach((pid, i) => {
    assert.equal(state.players[pid].rank, i + 1, 'rank order must match the ranks array');
  });
  assert.deepEqual(auditState(state), []);
}

/* ─────────────────────────────── the 200 games ─────────────────────────── */

const BATCHES = [
  { name: '4P random-legal (vs computer)', count: 80, colors: ALL_COLORS, mode: MODE.VS_COMPUTER, policy: randomPolicy },
  { name: '4P hard AI', count: 40, colors: ALL_COLORS, mode: MODE.VS_COMPUTER, policy: aiPolicy('hard') },
  { name: '3P mixed (pass & play)', count: 40, colors: ['red', 'green', 'blue'], mode: MODE.PASS_PLAY, policy: mixedPolicy },
  { name: '2P quick match', count: 40, colors: ['red', 'yellow'], mode: MODE.QUICK_MATCH, policy: mixedPolicy },
];

const totals = { games: 0, rolls: 0, moves: 0, captures: 0, sixes: 0 };
let seed = 1;

for (const batch of BATCHES) {
  test('sim: ' + batch.count + ' x ' + batch.name, () => {
    for (let i = 0; i < batch.count; i++) {
      const result = simulateGame({
        seed: seed++,
        colors: batch.colors,
        mode: batch.mode,
        policy: batch.policy,
      });
      assertFinished(result, batch.colors);
      totals.games++;
      totals.rolls += result.rolls;
      totals.moves += result.moves;
      totals.captures += result.captures;
      totals.sixes += result.sixes;
    }
  });
}

test('sim: 200 games completed with clean stats', () => {
  assert.equal(totals.games, 200, 'exactly 200 full games must have been played');
  const avgRolls = totals.rolls / totals.games;
  const sixRate = totals.sixes / totals.rolls;
  assert.ok(avgRolls > 20 && avgRolls < 2000, 'average rolls per game looks sane: ' + avgRolls);
  assert.ok(sixRate > 0.1 && sixRate < 0.24, 'dice stay fair (~1/6): ' + sixRate);
  assert.ok(totals.captures > 0, 'captures happened');
  console.log(
    '    games=%d  rolls=%d (avg %s/game)  moves=%d  captures=%d  six-rate=%s',
    totals.games,
    totals.rolls,
    avgRolls.toFixed(1),
    totals.moves,
    totals.captures,
    sixRate.toFixed(4)
  );
});

/* ───────────────────── resume / save-load during a game ───────────────── */

test('sim: a game can be saved and resumed mid-flight without drift', () => {
  const rng = createRng(777);
  let state = createInitialState({
    id: 'resume',
    createdAt: 0,
    mode: MODE.VS_COMPUTER,
    players: ALL_COLORS.map((color) => ({ color, type: 'bot' })),
  });

  // Play 120 rolls, saving and reloading every 10 rolls.
  for (let i = 0; i < 120 && state.phase !== PHASE.GAME_OVER; i++) {
    if (i % 10 === 0) state = deserialize(serialize(state));
    const rolled = applyRoll(state, rollDie(rng));
    state = rolled.state;
    if (state.phase === PHASE.AWAIT_MOVE) {
      const move = chooseMove(state, state.dice, state.turn, { rng, level: 'normal' });
      state = applyMove(state, move).state;
    }
    assert.deepEqual(auditState(state), []);
  }

  // Finish the game from the reloaded snapshot.
  let resumed = deserialize(serialize(state));
  let guard = 0;
  while (resumed.phase !== PHASE.GAME_OVER) {
    assert.ok(++guard < MAX_ROLLS, 'resumed game did not terminate');
    const rolled = applyRoll(resumed, rollDie(rng));
    resumed = rolled.state;
    if (resumed.phase === PHASE.AWAIT_MOVE) {
      const move = chooseMove(resumed, resumed.dice, resumed.turn, { rng, level: 'hard' });
      resumed = applyMove(resumed, move).state;
    }
  }
  assert.equal(resumed.ranks.length, 4);
  assert.deepEqual(auditState(resumed), []);
});

/* ───────────────────────── deterministic replay ───────────────────────── */

test('sim: identical seeds replay identically (Phase 2 sync guarantee)', () => {
  const run = () =>
    simulateGame({
      seed: 424242,
      colors: ALL_COLORS,
      mode: MODE.VS_COMPUTER,
      policy: aiPolicy('hard'),
    });
  const a = run();
  const b = run();
  assert.equal(serialize(a.state), serialize(b.state));
  assert.equal(a.rolls, b.rolls);
});
