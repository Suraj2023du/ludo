/**
 * tests/snakes.test.js — Snakes & Ladders: the pure engine, the turn loop and a
 * 200-game simulation.
 *
 * The engine is pure, so every test here is exact: given a state and a roll, the
 * next state and the event list are the only correct answer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_SIZE,
  DEFAULT_SNAKE_OPTIONS,
  LADDERS,
  LAST_CELL,
  OFF_BOARD,
  SEV,
  SNAKES,
  SNAKE_PHASE,
  activePlayers,
  allJumps,
  applySnakeRoll,
  auditBoard,
  cellToGrid,
  createSnakeState,
  currentSnakePlayer,
  deserializeSnakeState,
  gridToCell,
  isSnakeGameOver,
  jumpAt,
  rollSnakeDie,
  serializeSnakeState,
  targetOf,
} from '../src/engine/snakes.js';
import { SNAKE_EVENTS, createSnakeController } from '../src/game/snakeGame.js';
import { createEventBus } from '../src/game/events.js';
import { cellCenter, snakeLayout } from '../src/render/snakeboard.js';

/** Deterministic generator, so a failure is always reproducible. */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function twoPlayers(options) {
  return createSnakeState({
    id: 'test',
    createdAt: 1,
    players: [
      { name: 'You', color: 'red', type: 'human' },
      { name: 'Bot', color: 'green', type: 'bot' },
    ],
    options,
  });
}

/** Put a player on a cell without going through the rules. */
function at(state, seat, cell) {
  const next = JSON.parse(JSON.stringify(state));
  next.players[seat].cell = cell;
  return next;
}

const types = (events) => events.map((e) => e.type);

/* ──────────────────────────────── the board ────────────────────────────── */

test('snakes: the board is legal', () => {
  assert.deepEqual(auditBoard(), [], 'no illegal snake, ladder or chained jump');
  assert.equal(Object.keys(LADDERS).length, 9);
  assert.equal(Object.keys(SNAKES).length, 10);
  assert.equal(allJumps().length, 19);
});

test('snakes: every ladder climbs and every snake bites downwards', () => {
  for (const [from, to] of Object.entries(LADDERS)) {
    assert.ok(to > Number(from), 'ladder ' + from + ' → ' + to);
    assert.ok(to <= LAST_CELL);
  }
  for (const [from, to] of Object.entries(SNAKES)) {
    assert.ok(to < Number(from), 'snake ' + from + ' → ' + to);
    assert.ok(to >= 1);
  }
});

test('snakes: cell numbering is boustrophedon and reversible', () => {
  // bottom row runs left → right
  assert.deepEqual(cellToGrid(1), { col: 0, row: 0 });
  assert.deepEqual(cellToGrid(10), { col: 9, row: 0 });
  // the next row runs right → left
  assert.deepEqual(cellToGrid(11), { col: 9, row: 1 });
  assert.deepEqual(cellToGrid(20), { col: 0, row: 1 });
  // and the finish sits top-left
  assert.deepEqual(cellToGrid(LAST_CELL), { col: 0, row: 9 });

  for (let cell = 1; cell <= LAST_CELL; cell++) {
    const { col, row } = cellToGrid(cell);
    assert.equal(gridToCell(col, row), cell, 'round trip for cell ' + cell);
    assert.ok(col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE);
  }
});

test('snakes: jumpAt reports ladders, snakes and plain cells', () => {
  assert.deepEqual(jumpAt(1), { kind: 'ladder', to: 38 });
  assert.deepEqual(jumpAt(16), { kind: 'snake', to: 6 });
  assert.equal(jumpAt(2), null);
  assert.equal(jumpAt(LAST_CELL), null, 'the finish is never a jump');
});

/* ──────────────────────────────── setup ────────────────────────────────── */

test('snakes: a new game starts everyone off the board', () => {
  const state = twoPlayers();
  assert.equal(state.players.length, 2);
  assert.equal(state.phase, SNAKE_PHASE.AWAIT_ROLL);
  assert.equal(state.turn, 0);
  assert.equal(state.turnCount, 1);
  for (const p of state.players) {
    assert.equal(p.cell, OFF_BOARD);
    assert.equal(p.rank, 0);
  }
  assert.deepEqual(state.options, DEFAULT_SNAKE_OPTIONS);
  assert.equal(currentSnakePlayer(state).name, 'You');
  assert.equal(activePlayers(state).length, 2);
  assert.equal(isSnakeGameOver(state), false);
});

test('snakes: fewer than two players is refused', () => {
  assert.throws(() => createSnakeState({ players: [{ name: 'Alone' }] }), /at least 2/);
});

test('snakes: four players are seated in order', () => {
  const state = createSnakeState({
    players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
    startingPlayer: 2,
  });
  assert.equal(state.players.length, 4);
  assert.equal(state.turn, 2);
  assert.deepEqual(state.players.map((p) => p.id), [0, 1, 2, 3]);
});

/* ──────────────────────────────── rolling ──────────────────────────────── */

test('snakes: a plain roll walks forward and passes the turn', () => {
  const state = at(twoPlayers(), 0, 10);
  const { state: next, events } = applySnakeRoll(state, 3);
  assert.equal(next.players[0].cell, 13);
  assert.deepEqual(types(events), [SEV.ROLLED, SEV.MOVED, SEV.TURN_PASSED]);
  assert.equal(next.turn, 1);
  assert.equal(next.turnCount, 2);
  assert.equal(state.players[0].cell, 10, 'the input state is untouched');
});

test('snakes: landing on a ladder foot climbs it', () => {
  const state = at(twoPlayers(), 0, 6); // 6 + 3 = 9, a ladder to 31
  const { state: next, events } = applySnakeRoll(state, 3);
  assert.deepEqual(types(events), [SEV.ROLLED, SEV.MOVED, SEV.CLIMBED, SEV.TURN_PASSED]);
  assert.equal(next.players[0].cell, 31);
  assert.equal(next.players[0].climbs, 1);
  const climb = events.find((e) => e.type === SEV.CLIMBED);
  assert.equal(climb.from, 9);
  assert.equal(climb.to, 31);
});

test('snakes: landing on a snake head slides down', () => {
  const state = at(twoPlayers(), 0, 12); // 12 + 4 = 16, a snake to 6
  const { state: next, events } = applySnakeRoll(state, 4);
  assert.deepEqual(types(events), [SEV.ROLLED, SEV.MOVED, SEV.BITTEN, SEV.TURN_PASSED]);
  assert.equal(next.players[0].cell, 6);
  assert.equal(next.players[0].bites, 1);
});

test('snakes: a six earns another turn', () => {
  const state = at(twoPlayers(), 0, 20);
  const { state: next, events } = applySnakeRoll(state, 6);
  assert.equal(next.players[0].cell, 26);
  assert.ok(types(events).includes(SEV.EXTRA_TURN));
  assert.ok(!types(events).includes(SEV.TURN_PASSED));
  assert.equal(next.turn, 0, 'still our turn');
  assert.equal(next.players[0].sixes, 1);
});

test('snakes: three sixes in a row only costs the bonus turn, not the move', () => {
  let state = at(twoPlayers(), 0, 20);
  let events;
  ({ state, events } = applySnakeRoll(state, 6));
  assert.ok(types(events).includes(SEV.EXTRA_TURN), 'first six');
  ({ state, events } = applySnakeRoll(state, 6));
  assert.ok(types(events).includes(SEV.EXTRA_TURN), 'second six');
  ({ state, events } = applySnakeRoll(state, 6));

  const passed = events.find((e) => e.type === SEV.TURN_PASSED);
  assert.ok(passed, 'the third six hands the dice over');
  assert.equal(passed.forfeited, true);
  assert.equal(state.players[0].cell, 38, '20 + 6 + 6 + 6 — the move still counted');
  assert.equal(state.turn, 1);
  assert.equal(state.sixStreak, 0, 'the streak resets');
});

test('snakes: the extra-turn rule can be switched off', () => {
  const state = at(twoPlayers({ extraTurnOnSix: false }), 0, 20);
  const { state: next, events } = applySnakeRoll(state, 6);
  assert.ok(types(events).includes(SEV.TURN_PASSED));
  assert.equal(next.turn, 1);
});

test('snakes: rolling when it is not roll time is refused', () => {
  const state = twoPlayers();
  state.phase = SNAKE_PHASE.GAME_OVER;
  assert.throws(() => applySnakeRoll(state, 3), /not waiting for a roll/);
});

test('snakes: a silly dice value is clamped into 1..6', () => {
  const state = at(twoPlayers(), 0, 40); // 41..46 are all plain cells
  assert.equal(applySnakeRoll(state, 99).state.players[0].cell, 46, 'clamped to 6');
  assert.equal(applySnakeRoll(state, -4).state.players[0].cell, 41, 'clamped to 1');
  assert.equal(applySnakeRoll(state, 2.6).state.players[0].cell, 43, 'and rounded');
});

/* ─────────────────────────────── the finish ────────────────────────────── */

test('snakes: an exact roll wins the game', () => {
  const state = at(twoPlayers(), 0, 97);
  const { state: next, events } = applySnakeRoll(state, 3);
  assert.equal(next.players[0].cell, LAST_CELL);
  assert.equal(next.players[0].rank, 1);
  assert.ok(types(events).includes(SEV.FINISHED));
  const over = events.find((e) => e.type === SEV.GAME_OVER);
  assert.ok(over, 'a two-player game ends the moment one finishes');
  assert.equal(over.winner, 0);
  assert.equal(over.winnerName, 'You');
  assert.deepEqual(over.ranks, [0, 1]);
  assert.equal(next.phase, SNAKE_PHASE.GAME_OVER);
  assert.equal(next.players[1].rank, 2, 'the other player is ranked too');
  assert.equal(isSnakeGameOver(next), true);
});

test('snakes: overshooting the finish does nothing and says what you need', () => {
  const state = at(twoPlayers(), 0, 97);
  assert.deepEqual(targetOf(state, 97, 6), { to: 97, blocked: true });
  const { state: next, events } = applySnakeRoll(state, 6);
  assert.equal(next.players[0].cell, 97, 'nobody moves');
  const blocked = events.find((e) => e.type === SEV.BLOCKED);
  assert.ok(blocked);
  assert.equal(blocked.need, 3);
  assert.ok(types(events).includes(SEV.TURN_PASSED), 'a blocked roll ends the turn, even on a six');
  assert.equal(next.turn, 1);
});

test('snakes: with exactFinish off, an overshoot bounces back', () => {
  const state = at(twoPlayers({ exactFinish: false }), 0, 97);
  assert.deepEqual(targetOf(state, 97, 6), { to: 97, blocked: false }, '103 bounces all the way back');
  assert.deepEqual(targetOf(state, 97, 5), { to: 98, blocked: false }, '102 bounces to 98');

  const { state: next, events } = applySnakeRoll(state, 5);
  // …and 98 is a snake head, so bouncing back is punished immediately.
  assert.equal(next.players[0].cell, 78, '97 + 5 bounces to 98, where a snake drops it to 78');
  assert.deepEqual(types(events), [SEV.ROLLED, SEV.MOVED, SEV.BITTEN, SEV.TURN_PASSED]);

  // a clean bounce onto a plain cell simply lands there
  const clean = at(twoPlayers({ exactFinish: false }), 0, 96);
  assert.equal(applySnakeRoll(clean, 5).state.players[0].cell, 99, '96 + 5 = 101, bouncing to 99');
});

test('snakes: the ladder at 80 is a shortcut straight to the win', () => {
  const state = at(twoPlayers(), 0, 78);
  const { state: next, events } = applySnakeRoll(state, 2); // 80 → 100
  assert.equal(next.players[0].cell, LAST_CELL);
  assert.deepEqual(types(events).slice(0, 4), [SEV.ROLLED, SEV.MOVED, SEV.CLIMBED, SEV.FINISHED]);
  assert.equal(next.players[0].rank, 1);
});

test('snakes: a four-player game keeps going until only one is left', () => {
  let state = createSnakeState({
    players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
  });
  state = at(state, 0, 99);
  const first = applySnakeRoll(state, 1);
  assert.equal(first.state.players[0].rank, 1);
  assert.equal(first.state.phase, SNAKE_PHASE.AWAIT_ROLL, 'three players are still running');
  assert.equal(first.state.turn, 1, 'a finished player is skipped');
  assert.equal(activePlayers(first.state).length, 3);

  let next = at(first.state, 1, 99);
  next = applySnakeRoll(next, 1).state;
  assert.equal(next.players[1].rank, 2);
  next = at(next, 2, 99);
  const last = applySnakeRoll(next, 1);
  assert.equal(last.state.players[2].rank, 3);
  assert.equal(last.state.players[3].rank, 4, 'the last one home is ranked automatically');
  assert.equal(last.state.phase, SNAKE_PHASE.GAME_OVER);
});

/* ───────────────────────────── serialization ───────────────────────────── */

test('snakes: a state survives a JSON round trip', () => {
  let state = at(twoPlayers(), 0, 44);
  state = applySnakeRoll(state, 5).state;
  const wire = JSON.parse(JSON.stringify(serializeSnakeState(state)));
  const back = deserializeSnakeState(wire);
  assert.deepEqual(back, state);
  // and the restored state keeps playing correctly
  assert.equal(applySnakeRoll(back, 2).state.turn, applySnakeRoll(state, 2).state.turn);
});

test('snakes: a foreign or stale payload is rejected instead of guessed at', () => {
  assert.equal(deserializeSnakeState(null), null);
  assert.equal(deserializeSnakeState({}), null);
  assert.equal(deserializeSnakeState({ game: 'ludo', v: 1, players: [1, 2] }), null);
  assert.equal(deserializeSnakeState({ game: 'snakes', v: 99, players: [1, 2] }), null);
  assert.equal(deserializeSnakeState({ game: 'snakes', v: 1, players: [1] }), null);
});

test('snakes: the die only ever produces 1..6', () => {
  const rng = seeded(9);
  for (let i = 0; i < 600; i++) {
    const v = rollSnakeDie(rng);
    assert.ok(v >= 1 && v <= 6 && Number.isInteger(v), 'got ' + v);
  }
  assert.ok(rollSnakeDie(() => 0) === 1);
  assert.ok(rollSnakeDie(() => 0.999999) === 6);
});

/* ─────────────────────────────── geometry ──────────────────────────────── */

test('snakes: the layout is square, centred, and cell 1 sits bottom-left', () => {
  const layout = snakeLayout(400, 600, 10);
  assert.equal(layout.size, 380);
  assert.equal(layout.cell, 38);
  assert.equal(layout.x, 10);
  assert.equal(layout.y, 110, 'centred vertically');

  const one = cellCenter(layout, 1);
  const ten = cellCenter(layout, 10);
  const hundred = cellCenter(layout, 100);
  assert.ok(one.x < ten.x, 'the bottom row runs left to right');
  assert.equal(one.y, ten.y, 'and stays on one row');
  assert.ok(hundred.y < one.y, 'the finish is at the top');
  assert.ok(Math.abs(hundred.x - one.x) < 0.01, 'cell 100 sits above cell 1');
});

/* ─────────────────────────── the turn loop ─────────────────────────────── */

const INSTANT = { diceRoll: 0, hop: 0, jump: 0, botThink: 0, turnGap: 0, blocked: 0 };

function loopGame(seed = 3, options) {
  const bus = createEventBus();
  const state = twoPlayers(options);
  const controller = createSnakeController({ state, bus, rng: seeded(seed), timing: INSTANT });
  return { bus, controller };
}

function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('snakes loop: the human is asked to roll and the bot rolls itself', async () => {
  const { bus, controller } = loopGame(5);
  const turns = [];
  bus.on(SNAKE_EVENTS.TURN, (p) => turns.push({ id: p.playerId, bot: !!p.bot }));

  controller.start();
  assert.equal(turns.length, 1, 'the first turn is announced synchronously');
  assert.deepEqual(turns[0], { id: 0, bot: false });
  assert.equal(controller.canRoll(), true);

  assert.equal(controller.roll(), true);
  await tick(20);
  assert.ok(controller.state.players[0].cell > 0 || controller.state.players[0].rank > 0, 'we moved');
  assert.ok(turns.length > 1, 'play continued past our turn');
  controller.destroy();
});

test('snakes loop: the dice is locked while it is not your turn', async () => {
  const { controller } = loopGame(11);
  controller.start();
  controller.roll();
  assert.equal(controller.canRoll(), false, 'no double-rolling');
  await tick(20);
  controller.destroy();
});

test('snakes loop: a paused game does not advance, and resuming continues it', async () => {
  const { controller } = loopGame(21);
  controller.start();
  controller.pause();
  const before = JSON.stringify(controller.state);
  await tick(30);
  assert.equal(JSON.stringify(controller.state), before, 'nothing moved while paused');
  assert.equal(controller.canRoll(), false);
  controller.resume();
  await tick(20);
  controller.destroy();
});

test('snakes loop: destroy stops the game dead', async () => {
  const { controller } = loopGame(31);
  controller.start();
  controller.destroy();
  const before = JSON.stringify(controller.state);
  await tick(30);
  assert.equal(JSON.stringify(controller.state), before);
  assert.equal(controller.roll(), false);
});

test('snakes loop: a forced roll makes the whole game reproducible', async () => {
  const { bus, controller } = loopGame(41);
  const ended = [];
  bus.on(SNAKE_EVENTS.ENDED, (e) => ended.push(e));
  controller.start();
  // walk our token to the finish with exact rolls only
  for (let i = 0; i < 30 && !ended.length; i++) {
    const me = controller.state.players[0];
    if (controller.state.turn !== 0) {
      await tick(2);
      continue;
    }
    const need = LAST_CELL - me.cell;
    controller.force(need >= 1 && need <= 6 ? need : 6);
    await tick(4);
  }
  assert.equal(ended.length, 1, 'the game ended exactly once');
  assert.equal(ended[0].winner, 0);
  controller.destroy();
});

test('snakes loop: speed presets scale every timing, slow > normal > fast', () => {
  const { controller } = loopGame(51);
  controller.setSpeed('slow');
  const slow = controller.timing.hop;
  controller.setSpeed('normal');
  const normal = controller.timing.hop;
  controller.setSpeed('fast');
  const fast = controller.timing.hop;
  assert.ok(slow > normal && normal > fast, slow + ' > ' + normal + ' > ' + fast);
  controller.destroy();
});

/* ────────────────────────── 200-game simulation ────────────────────────── */

test('snakes sim: 200 games always finish, rank everyone, and stay legal', () => {
  const games = 200;
  let totalRolls = 0;
  let ladderUses = 0;
  let snakeBites = 0;
  const winners = [0, 0, 0, 0];

  for (let g = 0; g < games; g++) {
    const rng = seeded(g * 7919 + 13);
    const count = 2 + (g % 3); // 2, 3 and 4 player games
    let state = createSnakeState({
      players: Array.from({ length: count }, (_, i) => ({ name: 'P' + i, type: i === 0 ? 'human' : 'bot' })),
      startingPlayer: g % count,
    });

    let guard = 0;
    while (state.phase !== SNAKE_PHASE.GAME_OVER) {
      guard += 1;
      assert.ok(guard < 6000, 'game ' + g + ' did not finish in 6000 rolls');

      const seat = state.turn;
      assert.equal(state.players[seat].rank, 0, 'a finished player never gets the dice');

      const res = applySnakeRoll(state, rollSnakeDie(rng));
      state = res.state;
      totalRolls += 1;
      for (const ev of res.events) {
        if (ev.type === SEV.CLIMBED) ladderUses += 1;
        if (ev.type === SEV.BITTEN) snakeBites += 1;
      }

      for (const p of state.players) {
        assert.ok(p.cell >= 0 && p.cell <= LAST_CELL, 'cell ' + p.cell + ' is off the board');
        assert.equal(jumpAt(p.cell) === null || p.cell === 0, true, 'a pawn never rests on a jump');
      }
    }

    // everyone ranked, exactly once, 1..count
    const ranks = state.players.map((p) => p.rank).sort((a, b) => a - b);
    assert.deepEqual(
      ranks,
      Array.from({ length: count }, (_, i) => i + 1),
      'game ' + g + ' ranked everyone'
    );
    assert.equal(state.ranks.length, count);
    assert.equal(new Set(state.ranks).size, count, 'no seat is ranked twice');

    const winner = state.players.find((p) => p.rank === 1);
    assert.equal(winner.cell, LAST_CELL, 'the winner is on 100');
    winners[winner.id] += 1;
  }

  // the game must actually use its board
  assert.ok(ladderUses > games, 'ladders are being climbed (' + ladderUses + ')');
  assert.ok(snakeBites > games, 'snakes are biting (' + snakeBites + ')');
  // and no seat can be structurally hopeless
  assert.ok(winners[0] > 0 && winners[1] > 0, 'seats 0 and 1 both win games');
  const avg = totalRolls / games;
  assert.ok(avg > 10 && avg < 400, 'a game takes a sane number of rolls (' + Math.round(avg) + ')');
});

test('snakes sim: identical seeds replay identically', () => {
  const play = () => {
    const rng = seeded(4242);
    let state = twoPlayers();
    const log = [];
    while (state.phase !== SNAKE_PHASE.GAME_OVER) {
      const value = rollSnakeDie(rng);
      const res = applySnakeRoll(state, value);
      state = res.state;
      log.push(value + ':' + state.players.map((p) => p.cell).join(','));
    }
    return log;
  };
  assert.deepEqual(play(), play(), 'the engine is deterministic');
});
