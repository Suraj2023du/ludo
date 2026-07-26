/**
 * tests/ai.test.js — the bot must respect the stated priority order:
 * finish > capture > safe square > advance furthest > exit on 6.
 *
 * A fixed rng (() => 0.5) removes jitter so priority assertions are exact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BASE, FINISH, HOME_ENTRY, createRng, isSafeAbs, toRel } from '../src/engine/state.js';
import { legalMoves, applyMove, applyRoll, MOVE_KIND } from '../src/engine/rules.js';
import {
  LEVELS,
  TIER,
  chooseMove,
  evaluate,
  explainMove,
  threatCount,
  tokensHome,
  tokensInBase,
} from '../src/engine/ai.js';
import { makeGame, setTokens, armMove, snap } from './helpers.js';

const FIXED = () => 0.5; // no jitter, deterministic shortlist pick

test('AI: prefers finishing a token over capturing', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 3, 2, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 5), BASE, BASE, BASE]);
  armMove(s, 3);
  const move = chooseMove(s, 3, 0, { rng: FIXED, level: 'hard' });
  assert.equal(move.kind, MOVE_KIND.FINISH);
  assert.equal(move.tokenIndex, 0);
});

test('AI: prefers a capture over landing on a safe square', () => {
  const s = makeGame();
  setTokens(s, 'red', [5, 20, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 23), BASE, BASE, BASE]);
  armMove(s, 3);
  const move = chooseMove(s, 3, 0, { rng: FIXED, level: 'hard' });
  assert.equal(move.from, 20);
  assert.equal(move.captures.length, 1);
});

test('AI: prefers a safe square over a plain advance', () => {
  const s = makeGame();
  setTokens(s, 'red', [5, 30, BASE, BASE]);
  armMove(s, 3);
  const move = chooseMove(s, 3, 0, { rng: FIXED, level: 'hard' });
  assert.equal(move.to, 8, 'star square');
  assert.ok(isSafeAbs(8));
});

test('AI: advances the furthest token instead of opening a new one', () => {
  const s = makeGame();
  setTokens(s, 'red', [BASE, 8, 40, BASE]);
  armMove(s, 6);
  const move = chooseMove(s, 6, 0, { rng: FIXED, level: 'hard' });
  assert.equal(move.from, 40, 'furthest token moves');
  assert.notEqual(move.kind, MOVE_KIND.EXIT);
});

test('AI: opens a token when the board is nearly empty', () => {
  const s = makeGame();
  setTokens(s, 'red', [BASE, 44, BASE, BASE]);
  armMove(s, 6);
  const move = chooseMove(s, 6, 0, { rng: FIXED, level: 'hard' });
  assert.equal(move.kind, MOVE_KIND.EXIT);
});

test('AI: avoids stepping in front of an opponent', () => {
  const s = makeGame();
  setTokens(s, 'red', [10, 20, BASE, BASE]);
  setTokens(s, 'blue', [toRel('blue', 12), BASE, BASE, BASE]); // covers abs 13..18
  armMove(s, 5);
  const move = chooseMove(s, 5, 0, { rng: FIXED, level: 'hard' });
  assert.equal(move.from, 20, 'the 10 -> 15 landing is under fire');
});

test('AI: runs a threatened token away when progress is comparable', () => {
  const s = makeGame();
  setTokens(s, 'red', [20, 21, BASE, BASE]); // 21 is a star, 20 is exposed
  setTokens(s, 'blue', [toRel('blue', 16), BASE, BASE, BASE]); // covers abs 17..22
  armMove(s, 4);
  assert.equal(threatCount(s, s.players[0], 20, 0), 1);
  assert.equal(threatCount(s, s.players[0], 21, 1), 0, 'stars are never threatened');
  const move = chooseMove(s, 4, 0, { rng: FIXED, level: 'hard' });
  assert.equal(move.from, 20);
});

test('AI: threatCount ignores base tokens and home columns', () => {
  const s = makeGame();
  setTokens(s, 'red', [HOME_ENTRY + 2, BASE, BASE, BASE]);
  setTokens(s, 'blue', [BASE, BASE, BASE, BASE]);
  assert.equal(threatCount(s, s.players[0], HOME_ENTRY + 2, 0), 0);
  assert.equal(threatCount(s, s.players[0], BASE, 1), 0);
});

test('AI: never mutates the state and never returns an illegal move', () => {
  const rng = createRng(2024);
  for (let i = 0; i < 300; i++) {
    const s = makeGame();
    for (const color of ['red', 'green', 'yellow', 'blue']) {
      const tokens = [];
      for (let t = 0; t < 4; t++) {
        const r = Math.floor(rng() * (FINISH + 2)) - 1;
        tokens.push(r);
      }
      setTokens(s, color, tokens);
    }
    const dice = 1 + Math.floor(rng() * 6);
    const legal = legalMoves(s, dice);
    const before = snap(s);
    const move = chooseMove(s, dice, s.turn, { rng });
    assert.equal(snap(s), before, 'state untouched');
    if (legal.length === 0) {
      assert.equal(move, null);
    } else {
      assert.ok(
        legal.some((m) => m.from === move.from && m.to === move.to),
        'chosen move must be legal'
      );
    }
  }
});

test('AI: returns null when there is nothing to do', () => {
  const s = makeGame();
  assert.equal(chooseMove(s, 3, 0, { rng: FIXED }), null);
});

test('AI: refuses to move for a player that is not in turn', () => {
  const s = makeGame();
  setTokens(s, 'red', [4, 9, BASE, BASE]);
  armMove(s, 2);
  assert.throws(() => chooseMove(s, 2, 3, { rng: FIXED }), /not in turn/);
});

test('AI: is deterministic for a given seed', () => {
  const build = () => {
    const s = makeGame();
    setTokens(s, 'red', [3, 11, 25, BASE]);
    setTokens(s, 'green', [toRel('green', 30), 5, BASE, BASE]);
    return armMove(s, 5);
  };
  const a = chooseMove(build(), 5, 0, { rng: createRng(9), level: 'normal' });
  const b = chooseMove(build(), 5, 0, { rng: createRng(9), level: 'normal' });
  assert.deepEqual(a, b);
});

test('AI: evaluate() exposes tiers for every legal move', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 2, 5, 30, BASE]);
  armMove(s, 2);
  const scored = evaluate(s, 2, { levelName: 'hard' });
  assert.equal(scored.length, 3);
  const finish = scored.find((x) => x.move.kind === MOVE_KIND.FINISH);
  assert.equal(finish.tier, TIER.FINISH);
  for (const item of scored) {
    assert.ok(Math.abs(item.modifier) <= 95, 'modifiers stay clamped inside the tier');
  }
});

test('AI: explainMove describes the intent', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 1, BASE, BASE, BASE]);
  armMove(s, 1);
  const m = legalMoves(s, 1)[0];
  assert.equal(explainMove(s, m), 'bring a token home');
});

test('AI: easy bots blunder, hard bots do not', () => {
  const build = () => {
    const s = makeGame();
    setTokens(s, 'red', [FINISH - 3, 2, BASE, BASE]);
    setTokens(s, 'green', [toRel('green', 5), BASE, BASE, BASE]);
    return armMove(s, 3);
  };
  let easyBest = 0;
  let hardBest = 0;
  const rng = createRng(5);
  for (let i = 0; i < 200; i++) {
    if (chooseMove(build(), 3, 0, { rng, level: 'easy' }).kind === MOVE_KIND.FINISH) easyBest++;
    if (chooseMove(build(), 3, 0, { rng, level: 'hard' }).kind === MOVE_KIND.FINISH) hardBest++;
  }
  assert.equal(hardBest, 200, 'hard always finishes the token');
  assert.ok(easyBest < 200, 'easy sometimes does something else');
  assert.ok(LEVELS.easy.blunderChance > LEVELS.hard.blunderChance);
});

test('AI: token counters', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH, FINISH, BASE, 12]);
  assert.equal(tokensHome(s.players[0]), 2);
  assert.equal(tokensInBase(s.players[0]), 1);
});

test('AI: a hard bot beats three random players by a wide margin', () => {
  // Deterministic head-to-head: seat 0 plays with the real brain,
  // the other three pick uniformly at random from their legal moves.
  let botWins = 0;
  const games = 60;
  for (let g = 0; g < games; g++) {
    const rng = createRng(1000 + g);
    let state = makeGame();
    let guard = 0;
    while (state.phase !== 'gameOver') {
      if (++guard > 20000) throw new Error('game did not terminate');
      const value = 1 + Math.floor(rng() * 6);
      const rolled = applyRoll(state, value);
      state = rolled.state;
      if (state.phase !== 'awaitMove') continue;
      const moves = legalMoves(state, state.dice);
      const move =
        state.turn === 0
          ? chooseMove(state, state.dice, 0, { rng, level: 'hard' })
          : moves[Math.floor(rng() * moves.length) % moves.length];
      state = applyMove(state, move).state;
    }
    if (state.ranks[0] === 0) botWins++;
  }
  const rate = botWins / games;
  assert.ok(rate > 0.4, 'hard bot win rate should beat 40% (random baseline 25%), got ' + rate);
});
