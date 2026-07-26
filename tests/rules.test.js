/**
 * tests/rules.test.js — unit tests for the pure engine.
 * Run with:  node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  FINISH,
  HOME_ENTRY,
  MAX_SIX_STREAK,
  PHASE,
  SAFE_ABS,
  SCHEMA_VERSION,
  START_ABS,
  TRACK_LEN,
  auditState,
  createInitialState,
  createRng,
  deserialize,
  distanceToHome,
  isSafeAbs,
  progressOf,
  rollDie,
  serialize,
  standings,
  toAbs,
  toRel,
  tokensAtAbs,
} from '../src/engine/state.js';

import {
  EV,
  MOVE_KIND,
  applyMove,
  applyRoll,
  hasLegalMove,
  legalMoves,
  nextActiveSeat,
  passTurn,
  wouldPassTurn,
} from '../src/engine/rules.js';

import { makeGame, setTokens, armMove, snap, seatOf } from './helpers.js';

const types = (events) => events.map((e) => e.type);

/* ───────────────────────────── board topology ───────────────────────────── */

test('board topology: 52 ring cells, 8 safe squares, 4 distinct starts', () => {
  assert.equal(TRACK_LEN, 52);
  assert.equal(SAFE_ABS.length, 8);
  assert.equal(new Set(SAFE_ABS).size, 8);
  const starts = Object.values(START_ABS);
  assert.deepEqual(starts, [0, 13, 26, 39]);
  for (const s of starts) assert.ok(isSafeAbs(s), 'start square must be safe: ' + s);
});

test('board topology: toAbs/toRel round-trip for every colour and cell', () => {
  for (const color of Object.keys(START_ABS)) {
    for (let rel = 0; rel <= HOME_ENTRY; rel++) {
      const abs = toAbs(color, rel);
      assert.ok(abs >= 0 && abs < TRACK_LEN);
      assert.equal(toRel(color, abs), rel);
    }
  }
});

test('board topology: home column positions are off the shared ring', () => {
  assert.equal(toAbs('red', HOME_ENTRY + 1), -1);
  assert.equal(toAbs('red', FINISH), -1);
  assert.equal(distanceToHome(FINISH), 0);
  assert.equal(distanceToHome(BASE), FINISH + 1);
});

/* ────────────────────────────── state factory ───────────────────────────── */

test('createInitialState: seats are sorted clockwise by colour', () => {
  const s = makeGame(['yellow', 'red', 'blue', 'green']);
  assert.deepEqual(
    s.players.map((p) => p.color),
    ['red', 'green', 'yellow', 'blue']
  );
  assert.deepEqual(
    s.players.map((p) => p.id),
    [0, 1, 2, 3]
  );
});

test('createInitialState: rejects bad player counts and duplicate colours', () => {
  assert.throws(() => createInitialState({ players: [{ color: 'red' }] }), /2 to 4 players/);
  assert.throws(
    () => createInitialState({ players: [{ color: 'red' }, { color: 'red' }] }),
    /duplicate colour/
  );
  assert.throws(
    () => createInitialState({ players: [{ color: 'pink' }, { color: 'red' }] }),
    /unknown colour/
  );
});

test('createInitialState: everyone starts in base, awaiting a roll', () => {
  const s = makeGame();
  for (const p of s.players) {
    assert.deepEqual(p.tokens, [BASE, BASE, BASE, BASE]);
    assert.equal(p.finished, 0);
    assert.equal(p.rank, 0);
  }
  assert.equal(s.phase, PHASE.AWAIT_ROLL);
  assert.equal(s.dice, null);
  assert.deepEqual(auditState(s), []);
});

/* ─────────────────────────── leaving base needs a 6 ─────────────────────── */

test('a token can only leave base on a 6', () => {
  const s = makeGame();
  for (let d = 1; d <= 5; d++) {
    assert.deepEqual(legalMoves(s, d), [], 'die ' + d + ' must not open the base');
  }
  const six = legalMoves(s, 6);
  assert.equal(six.length, 1, 'four identical base tokens collapse to one move');
  assert.equal(six[0].kind, MOVE_KIND.EXIT);
  assert.equal(six[0].to, 0);
  assert.deepEqual(six[0].path, [0]);
});

test('exiting base lands the token on its own start square', () => {
  const s = armMove(makeGame(), 6);
  const { state, events } = applyMove(s, { tokenIndex: 2, to: 0 });
  assert.equal(state.players[0].tokens[2], 0);
  assert.ok(types(events).includes(EV.TOKEN_EXITED));
  assert.equal(toAbs('red', state.players[0].tokens[2]), START_ABS.red);
  assert.deepEqual(auditState(state), []);
});

test('rolling a 6 with everything home-or-blocked still passes the turn', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH, FINISH, FINISH, HOME_ENTRY + 3]); // needs exactly 3
  const { state, events } = applyRoll(s, 6);
  assert.ok(types(events).includes(EV.NO_MOVES));
  assert.equal(state.turn, 1);
  assert.equal(state.phase, PHASE.AWAIT_ROLL);
});

/* ───────────────────────────── extra turn on six ────────────────────────── */

test('rolling a 6 grants an extra turn', () => {
  const s = armMove(makeGame(), 6);
  const { state, events } = applyMove(s, { tokenIndex: 0 });
  assert.equal(state.turn, 0, 'same player keeps the turn');
  assert.equal(state.phase, PHASE.AWAIT_ROLL);
  const extra = events.find((e) => e.type === EV.EXTRA_TURN);
  assert.ok(extra);
  assert.equal(extra.reason, 'six');
});

test('a non-six move hands the turn to the next seat', () => {
  const s = makeGame();
  setTokens(s, 'red', [4, BASE, BASE, BASE]);
  armMove(s, 3);
  const { state, events } = applyMove(s, { tokenIndex: 0 });
  assert.equal(state.players[0].tokens[0], 7);
  assert.equal(state.turn, 1);
  const changed = events.find((e) => e.type === EV.TURN_CHANGED);
  assert.equal(changed.reason, 'moved');
});

test('SIX event is emitted on the roll for celebratory feedback', () => {
  const s = makeGame();
  setTokens(s, 'red', [4, BASE, BASE, BASE]);
  const { events } = applyRoll(s, 6);
  assert.ok(types(events).includes(EV.SIX));
});

/* ─────────────────────── three consecutive sixes forfeit ────────────────── */

test('three consecutive sixes forfeit the turn', () => {
  let s = makeGame();
  setTokens(s, 'red', [4, BASE, BASE, BASE]);

  let r = applyRoll(s, 6);
  assert.equal(r.state.sixStreak, 1);
  r = applyMove(r.state, { tokenIndex: 0 });
  assert.equal(r.state.sixStreak, 1, 'streak survives the extra turn');

  r = applyRoll(r.state, 6);
  assert.equal(r.state.sixStreak, 2);
  r = applyMove(r.state, { tokenIndex: 0 });
  assert.equal(r.state.sixStreak, 2);

  const third = applyRoll(r.state, 6);
  assert.ok(types(third.events).includes(EV.THREE_SIXES));
  assert.equal(third.moves.length, 0, 'no move is offered on the third six');
  assert.equal(third.state.turn, 1, 'turn is forfeited');
  assert.equal(third.state.sixStreak, 0);
  assert.equal(third.state.phase, PHASE.AWAIT_ROLL);
});

test('a non-six resets the six streak', () => {
  let s = makeGame();
  setTokens(s, 'red', [4, BASE, BASE, BASE]);
  let r = applyRoll(s, 6);
  r = applyMove(r.state, { tokenIndex: 0 });
  assert.equal(r.state.sixStreak, 1);
  r = applyRoll(r.state, 2);
  assert.equal(r.state.sixStreak, 0);
});

test('wouldPassTurn predicts the third-six forfeit without mutating', () => {
  const s = makeGame();
  setTokens(s, 'red', [4, BASE, BASE, BASE]);
  s.sixStreak = MAX_SIX_STREAK - 1;
  const before = snap(s);
  assert.equal(wouldPassTurn(s, 6), true);
  assert.equal(wouldPassTurn(s, 2), false);
  assert.equal(snap(s), before);
});

/* ──────────────────────────────── captures ─────────────────────────────── */

test('landing on an opponent on a normal square captures it', () => {
  const s = makeGame();
  // red rel 5 -> abs 5 ; green needs to be on abs 5 => rel = (5-13+52)%52 = 44
  setTokens(s, 'red', [2, BASE, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 5), BASE, BASE, BASE]);
  assert.equal(toAbs('green', toRel('green', 5)), 5);
  assert.ok(!isSafeAbs(5));

  armMove(s, 3);
  const move = legalMoves(s, 3).find((m) => m.to === 5);
  assert.equal(move.captures.length, 1);
  const { state, events } = applyMove(s, move);
  assert.equal(state.players[1].tokens[0], BASE, 'victim went back to base');
  assert.equal(state.players[0].captures, 1);
  assert.equal(state.players[1].losses, 1);
  const cap = events.find((e) => e.type === EV.TOKEN_CAPTURED);
  assert.equal(cap.color, 'green');
  assert.equal(cap.byColor, 'red');
  assert.deepEqual(auditState(state), []);
});

test('capture grants an extra turn', () => {
  const s = makeGame();
  setTokens(s, 'red', [2, BASE, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 5), BASE, BASE, BASE]);
  armMove(s, 3);
  const { state, events } = applyMove(s, { tokenIndex: 0 });
  assert.equal(state.turn, 0);
  assert.equal(events.find((e) => e.type === EV.EXTRA_TURN).reason, 'capture');
});

test('NO capture on a safe star square', () => {
  const s = makeGame();
  const star = 8;
  assert.ok(isSafeAbs(star));
  setTokens(s, 'red', [star - 2, BASE, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', star), BASE, BASE, BASE]);
  armMove(s, 2);
  const move = legalMoves(s, 2).find((m) => m.to === star);
  assert.equal(move.captures.length, 0);
  const { state, events } = applyMove(s, move);
  assert.equal(state.players[1].tokens[0], toRel('green', star), 'victim stays put');
  assert.ok(!types(events).includes(EV.TOKEN_CAPTURED));
  assert.equal(state.turn, 1, 'no capture means no extra turn');
  assert.deepEqual(auditState(state), []);
});

test('NO capture on a coloured start square', () => {
  const s = makeGame();
  const greenStart = START_ABS.green; // abs 13, safe
  setTokens(s, 'red', [toRel('red', greenStart) - 4, BASE, BASE, BASE]);
  setTokens(s, 'green', [0, BASE, BASE, BASE]);
  armMove(s, 4);
  const move = legalMoves(s, 4)[0];
  assert.equal(toAbs('red', move.to), greenStart);
  assert.equal(move.captures.length, 0);
  const { state } = applyMove(s, move);
  assert.equal(state.players[1].tokens[0], 0);
  assert.deepEqual(auditState(state), []);
});

test('NO self-capture: same colour stacks on one square', () => {
  const s = makeGame();
  setTokens(s, 'red', [10, 7, BASE, BASE]);
  armMove(s, 3);
  const move = legalMoves(s, 3).find((m) => m.from === 7);
  assert.equal(move.captures.length, 0);
  const { state } = applyMove(s, move);
  assert.equal(state.players[0].tokens[0], 10);
  assert.equal(state.players[0].tokens[1], 10, 'both red tokens share the cell');
  assert.deepEqual(auditState(state), []);
});

test('a capture removes an entire opponent stack', () => {
  const s = makeGame();
  setTokens(s, 'red', [2, BASE, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 5), toRel('green', 5), BASE, BASE]);
  armMove(s, 3);
  const move = legalMoves(s, 3)[0];
  assert.equal(move.captures.length, 2);
  const { state } = applyMove(s, move);
  assert.deepEqual(state.players[1].tokens, [BASE, BASE, BASE, BASE]);
  assert.equal(state.players[0].captures, 2);
});

test('tokens in a home column can never be captured', () => {
  const s = makeGame();
  setTokens(s, 'red', [HOME_ENTRY + 2, BASE, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 0), BASE, BASE, BASE]); // sitting on red's start abs 0
  const seat = seatOf(s, 'green');
  armMove(s, 1, seat);
  for (const m of legalMoves(s, 1)) assert.equal(m.captures.length, 0);
  assert.deepEqual(tokensAtAbs(s, -1), []);
});

/* ─────────────────────────── home column / finishing ────────────────────── */

test('an exact roll is required to finish', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 3, BASE, BASE, BASE]);
  const exact = legalMoves(s, 3);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].kind, MOVE_KIND.FINISH);
  assert.equal(exact[0].to, FINISH);
});

test('overshooting the finish is blocked', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 2, BASE, BASE, BASE]);
  assert.equal(legalMoves(s, 3).length, 0, 'die 3 overshoots');
  assert.equal(legalMoves(s, 4).length, 0, 'die 4 overshoots');
  assert.equal(legalMoves(s, 2).length, 1, 'die 2 is exact');
  assert.equal(legalMoves(s, 1).length, 1, 'die 1 stays inside the column');
});

test('finishing a token does NOT grant an extra turn', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 3, 4, BASE, BASE]);
  armMove(s, 3);
  const { state, events } = applyMove(s, { tokenIndex: 0 });
  assert.equal(state.players[0].finished, 1);
  assert.ok(types(events).includes(EV.TOKEN_FINISHED));
  assert.ok(!types(events).includes(EV.EXTRA_TURN));
  assert.equal(state.turn, 1);
});

test('finishing on a six still grants the six extra turn', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 6, 4, BASE, BASE]);
  armMove(s, 6);
  const { state, events } = applyMove(s, { tokenIndex: 0 });
  assert.equal(state.players[0].finished, 1);
  assert.equal(state.turn, 0);
  assert.ok(types(events).includes(EV.EXTRA_TURN));
});

test('a finished token is never offered a move again', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH, 3, BASE, BASE]);
  const moves = legalMoves(s, 2);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].tokenIndex, 1);
});

/* ───────────────────────── winning, ranks, game over ───────────────────── */

test('win detection: first player home wins and is rank 1', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH, FINISH, FINISH, FINISH - 2]);
  armMove(s, 2);
  const { state, events } = applyMove(s, { tokenIndex: 3 });
  const done = events.find((e) => e.type === EV.PLAYER_FINISHED);
  assert.equal(done.playerId, 0);
  assert.equal(done.rank, 1);
  assert.equal(state.players[0].rank, 1);
  assert.equal(state.ranks[0], 0);
  assert.equal(state.phase, PHASE.AWAIT_ROLL, '4-player game continues for ranks 2 and 3');
});

test('play continues after a winner so remaining players get ranks', () => {
  let s = makeGame();
  setTokens(s, 'red', [FINISH, FINISH, FINISH, FINISH]);
  s.players[0].rank = 1;
  s.ranks = [0];
  setTokens(s, 'green', [FINISH, FINISH, FINISH, FINISH - 1]);
  armMove(s, 1, 1);
  const r1 = applyMove(s, { tokenIndex: 3 });
  assert.equal(r1.state.players[1].rank, 2);
  assert.equal(r1.state.phase, PHASE.AWAIT_ROLL);

  setTokens(r1.state, 'yellow', [FINISH, FINISH, FINISH, FINISH - 4]);
  armMove(r1.state, 4, 2);
  const r2 = applyMove(r1.state, { tokenIndex: 3 });
  assert.equal(r2.state.players[2].rank, 3);
  assert.equal(r2.state.players[3].rank, 4, 'last player left takes last place');
  assert.equal(r2.state.phase, PHASE.GAME_OVER);
  const over = r2.events.find((e) => e.type === EV.GAME_OVER);
  assert.deepEqual(over.ranks, [0, 1, 2, 3]);
  assert.equal(over.winner, 0);
  assert.deepEqual(auditState(r2.state), []);
});

test('rank ordering is reflected in standings()', () => {
  const s = makeGame();
  s.players[2].rank = 1;
  s.players[0].rank = 2;
  const table = standings(s);
  assert.equal(table[0].color, 'yellow');
  assert.equal(table[1].color, 'red');
  assert.equal(table[0].rank, 1);
});

test('2-player game ends as soon as one player is home', () => {
  const s = makeGame(['red', 'yellow']);
  setTokens(s, 'red', [FINISH, FINISH, FINISH, FINISH - 5]);
  armMove(s, 5);
  const { state, events } = applyMove(s, { tokenIndex: 3 });
  assert.equal(state.phase, PHASE.GAME_OVER);
  assert.deepEqual(state.ranks, [0, 1]);
  assert.ok(types(events).includes(EV.GAME_OVER));
});

test('no moves are legal once the game is over', () => {
  const s = makeGame(['red', 'yellow']);
  s.phase = PHASE.GAME_OVER;
  assert.deepEqual(legalMoves(s, 6), []);
  assert.equal(hasLegalMove(s, 6), false);
});

/* ───────────────────────────── turn management ──────────────────────────── */

test('no legal move passes the turn automatically', () => {
  const s = makeGame();
  const { state, events } = applyRoll(s, 3); // everything still in base
  assert.ok(types(events).includes(EV.NO_MOVES));
  assert.equal(state.turn, 1);
  assert.equal(state.dice, null);
  assert.equal(state.phase, PHASE.AWAIT_ROLL);
});

test('finished players are skipped in the rotation', () => {
  const s = makeGame();
  setTokens(s, 'green', [FINISH, FINISH, FINISH, FINISH]);
  s.players[1].rank = 1;
  s.ranks = [1];
  assert.equal(nextActiveSeat(s, 0), 2, 'green is skipped');
  const { state } = applyRoll(s, 3);
  assert.equal(state.turn, 2);
});

test('passTurn is pure and advances one seat', () => {
  const s = makeGame();
  const before = snap(s);
  const { state, events } = passTurn(s, 'manual');
  assert.equal(state.turn, 1);
  assert.equal(snap(s), before, 'source state untouched');
  assert.equal(events[0].reason, 'manual');
});

/* ───────────────────────────── purity & guards ─────────────────────────── */

test('applyRoll and applyMove never mutate the input state', () => {
  const s = makeGame();
  setTokens(s, 'red', [4, BASE, BASE, BASE]);
  const before = snap(s);
  applyRoll(s, 6);
  assert.equal(snap(s), before);

  armMove(s, 3);
  const beforeMove = snap(s);
  applyMove(s, { tokenIndex: 0 });
  assert.equal(snap(s), beforeMove);
});

test('applyRoll rejects bad values and the wrong phase', () => {
  const s = makeGame();
  assert.throws(() => applyRoll(s, 0), /1\.\.6/);
  assert.throws(() => applyRoll(s, 7), /1\.\.6/);
  assert.throws(() => applyRoll(s, 2.5), /1\.\.6/);
  armMove(s, 6);
  assert.throws(() => applyRoll(s, 6), /expected awaitRoll/);
});

test('applyMove rejects illegal moves, foreign players and the wrong phase', () => {
  const s = makeGame();
  setTokens(s, 'red', [FINISH - 2, BASE, BASE, BASE]);
  assert.throws(() => applyMove(s, { tokenIndex: 0 }), /expected awaitMove/);
  armMove(s, 3);
  assert.throws(() => applyMove(s, { tokenIndex: 0 }), /illegal move/, 'overshoot');
  assert.throws(() => applyMove(s, { tokenIndex: 1 }), /illegal move/, 'base token, no six');
  assert.throws(() => applyMove(s, { playerId: 1, tokenIndex: 0 }), /not player 1's turn/);
  assert.throws(() => applyMove(s, { tokenIndex: 9 }), /bad tokenIndex/);
});

/* ──────────────────────── serialization round-trip ─────────────────────── */

test('serialize/deserialize is a lossless round-trip', () => {
  let s = makeGame(['red', 'green', 'blue']);
  setTokens(s, 'red', [0, 14, HOME_ENTRY + 2, FINISH]);
  setTokens(s, 'green', [BASE, 7, 7, FINISH]);
  s.players[0].captures = 3;
  s.turnCount = 17;
  const r = applyRoll(s, 6);
  s = r.state;

  const json = serialize(s);
  assert.equal(typeof json, 'string');
  const back = deserialize(json);
  assert.deepEqual(back, s);
  assert.equal(serialize(back), json, 'stable re-serialization');
  assert.equal(back.v, SCHEMA_VERSION);
});

test('deserialize accepts a plain object and rejects corrupt data', () => {
  const s = makeGame();
  const obj = JSON.parse(serialize(s));
  assert.deepEqual(deserialize(obj), s);

  assert.throws(() => deserialize({ ...obj, v: 99 }), /unsupported schema version/);
  assert.throws(() => deserialize({ ...obj, players: [] }), /invalid players/);
  assert.throws(() => deserialize({ ...obj, turn: 9 }), /bad turn index/);
  assert.throws(() => deserialize({ ...obj, phase: 'nope' }), /bad phase/);

  const badToken = JSON.parse(serialize(s));
  badToken.players[0].tokens[0] = 999;
  assert.throws(() => deserialize(badToken), /token out of range/);
});

test('a game state stays JSON-safe (no functions, no cycles)', () => {
  const s = makeGame();
  const walk = (v, path = '$') => {
    if (typeof v === 'function') throw new Error('function at ' + path);
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], path + '.' + k);
    }
  };
  walk(s);
  assert.doesNotThrow(() => JSON.stringify(s));
});

/* ──────────────────────────── misc / utilities ─────────────────────────── */

test('move objects expose the animation path', () => {
  const s = makeGame();
  setTokens(s, 'red', [10, BASE, BASE, BASE]);
  const m = legalMoves(s, 4)[0];
  assert.deepEqual(m.path, [11, 12, 13, 14]);
  assert.equal(m.to, 14);
});

test('progressOf and distanceToHome track forward progress', () => {
  const s = makeGame();
  setTokens(s, 'red', [BASE, 0, 10, FINISH]);
  assert.equal(progressOf(s.players[0]), 0 + 1 + 11 + (FINISH + 1));
  assert.ok(distanceToHome(10) > distanceToHome(20));
});

test('tokensAtAbs reports every colour standing on a ring cell', () => {
  const s = makeGame();
  setTokens(s, 'red', [8, 8, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 8), BASE, BASE, BASE]);
  const here = tokensAtAbs(s, 8);
  assert.equal(here.length, 3);
  assert.equal(here.filter((t) => t.color === 'red').length, 2);
});

test('createRng is deterministic and rollDie stays in 1..6', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
  const rng = createRng(7);
  for (let i = 0; i < 500; i++) {
    const d = rollDie(rng);
    assert.ok(Number.isInteger(d) && d >= 1 && d <= 6, 'bad die ' + d);
  }
});

test('auditState flags an illegal two-colour stack on an unsafe cell', () => {
  const s = makeGame();
  setTokens(s, 'red', [5, BASE, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 5), BASE, BASE, BASE]);
  const errs = auditState(s);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /illegal co-occupancy/);
});

test('options can disable the Ludo King capture bonus', () => {
  const s = makeGame(['red', 'green', 'yellow', 'blue'], {
    options: { extraTurnOnCapture: false },
  });
  setTokens(s, 'red', [2, BASE, BASE, BASE]);
  setTokens(s, 'green', [toRel('green', 5), BASE, BASE, BASE]);
  armMove(s, 3);
  const { state } = applyMove(s, { tokenIndex: 0 });
  assert.equal(state.turn, 1, 'turn passes when the bonus is off');
});
