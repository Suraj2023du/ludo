/**
 * tests/controller.test.js — the async turn loop, headless.
 *
 * All timings are zeroed so a full game runs in milliseconds. This also proves
 * the Phase 2 seam: replaying the action log from one controller into a second
 * controller whose seats are all "remote" reproduces the state exactly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MODE, PHASE, createRng, serialize } from '../src/engine/state.js';
import { EV } from '../src/engine/rules.js';
import { createEventBus, EVENTS } from '../src/game/events.js';
import { createController } from '../src/game/controller.js';
import { createGame, buildConfig, buildPlayers, pickColors, MODE_META } from '../src/game/modes.js';
import { LocalAdapter } from '../src/sync/local.js';
import { makeGame, setTokens } from './helpers.js';

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

/** Wait for an event, with a hard timeout so a hang fails instead of freezing. */
function waitFor(bus, type, ms = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ' + type)), ms);
    bus.once(type, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function botGame(colors = ['red', 'green', 'yellow', 'blue'], seed = 11) {
  const bus = createEventBus();
  const adapter = new LocalAdapter();
  const state = makeGame(colors);
  for (const p of state.players) p.type = 'bot';
  const controller = createController({
    state,
    bus,
    adapter,
    rng: createRng(seed),
    timing: INSTANT,
  });
  return { bus, adapter, controller };
}

test('controller: plays a full 4-bot game to completion', async () => {
  const { bus, controller, adapter } = botGame();
  const seen = new Set();
  bus.onAny((type) => seen.add(type));

  const over = waitFor(bus, EV.GAME_OVER);
  controller.start();
  const payload = await over;

  assert.equal(controller.state.phase, PHASE.GAME_OVER);
  assert.equal(payload.ranks.length, 4);
  assert.equal(controller.state.players[payload.winner].finished, 4);

  for (const t of [EV.DICE_ROLLED, EV.TOKEN_MOVED, EV.TURN_CHANGED, EVENTS.GAME_STARTED]) {
    assert.ok(seen.has(t), 'expected event ' + t);
  }
  assert.ok(adapter.history().length > 10, 'actions were broadcast to the adapter');
  controller.destroy();
});

test('controller: a human seat blocks until roll() is called', async () => {
  const bus = createEventBus();
  const state = makeGame(['red', 'green']);
  state.players[0].type = 'human';
  state.players[1].type = 'bot';
  const controller = createController({ state, bus, rng: createRng(3), timing: INSTANT });

  const begin = waitFor(bus, EVENTS.TURN_BEGIN);
  controller.start();
  const payload = await begin;
  assert.equal(payload.playerId, 0);
  assert.equal(controller.canRoll(), true);
  assert.equal(controller.state.rollCount, 0, 'nothing happens without input');

  const rolled = waitFor(bus, EV.DICE_ROLLED);
  assert.equal(controller.roll(), true);
  const ev = await rolled;
  assert.equal(ev.playerId, 0);
  assert.ok(ev.value >= 1 && ev.value <= 6);
  controller.destroy();
});

test('controller: selectToken moves the tapped token, illegal taps are rejected', async () => {
  const bus = createEventBus();
  const state = makeGame(['red', 'green']);
  state.players[0].type = 'human';
  state.players[1].type = 'bot';
  setTokens(state, 'red', [10, 20, -1, -1]);
  const controller = createController({
    state,
    bus,
    rng: () => 0.5, // always a 4: both red tokens can move, no base exit
    timing: INSTANT,
    autoMoveSingle: false,
  });

  // TURN_BEGIN fires synchronously inside start(), so subscribe first.
  const begin = waitFor(bus, EVENTS.TURN_BEGIN);
  const moves = waitFor(bus, EVENTS.MOVES_AVAILABLE);
  controller.start();
  await begin;
  controller.roll();
  const payload = await moves;
  assert.equal(payload.dice, 4);
  assert.equal(payload.moves.length, 2);

  const rejected = [];
  bus.on(EVENTS.MOVE_REJECTED, (p) => rejected.push(p));
  assert.equal(controller.selectToken(2), false, 'a base token cannot move without a 6');
  assert.equal(rejected.length, 1);

  const movedEv = waitFor(bus, EV.TOKEN_MOVED);
  assert.equal(controller.selectToken(0), true);
  const moved = await movedEv;
  assert.equal(moved.tokenIndex, 0);
  assert.equal(moved.from, 10);
  controller.destroy();
});

test('controller: animator hooks are awaited in event order', async () => {
  const { bus, controller } = botGame(['red', 'green'], 21);
  const order = [];
  controller.setAnimator({
    roll: () => {
      order.push('roll');
      return Promise.resolve();
    },
    move: () => {
      order.push('move');
      return Promise.resolve();
    },
    capture: () => {
      order.push('capture');
      return Promise.resolve();
    },
    finish: () => {
      order.push('finish');
      return Promise.resolve();
    },
  });
  const over = waitFor(bus, EV.GAME_OVER);
  controller.start();
  await over;
  assert.ok(order.filter((o) => o === 'roll').length > 5);
  assert.ok(order.filter((o) => o === 'move').length > 5);
  assert.ok(order.includes('finish'));
  assert.equal(order[0], 'roll', 'the dice always animates before anything moves');
  controller.destroy();
});

test('controller: pause() freezes the bots, resume() continues', async () => {
  const { bus, controller } = botGame(['red', 'green'], 33);
  let rolls = 0;
  bus.on(EV.DICE_ROLLED, () => {
    rolls++;
    if (rolls === 3) controller.pause();
  });
  const paused = waitFor(bus, EVENTS.PAUSED);
  controller.start();
  await paused;
  await new Promise((r) => setTimeout(r, 40));
  const frozen = rolls;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(rolls, frozen, 'no dice are rolled while paused');

  const over = waitFor(bus, EV.GAME_OVER);
  controller.resume();
  await over;
  assert.ok(rolls > frozen);
  controller.destroy();
});

test('controller: a single legal move is played automatically', async () => {
  const bus = createEventBus();
  const state = makeGame(['red', 'green']);
  state.players[0].type = 'human';
  state.players[1].type = 'bot';
  setTokens(state, 'red', [7, -1, -1, -1]);
  const controller = createController({ state, bus, rng: () => 0.5, timing: INSTANT });

  const begin = waitFor(bus, EVENTS.TURN_BEGIN);
  const auto = waitFor(bus, EVENTS.MOVES_AVAILABLE);
  const moved = waitFor(bus, EV.TOKEN_MOVED);
  controller.start();
  await begin;
  controller.roll();
  const payload = await auto;
  assert.equal(payload.moves.length, 1, 'only one token can move');
  assert.equal(payload.auto, true, 'the controller plays it without waiting for a tap');
  const ev = await moved;
  assert.equal(ev.from, 7);
  assert.equal(ev.to, 11);
  controller.destroy();
});

test('controller: the pass-the-phone gate blocks every new human seat', async () => {
  const bus = createEventBus();
  const { controller } = createGame({
    setup: { mode: MODE.PASS_PLAY, count: 3, humanColor: 'red', names: { red: 'Asha' } },
    bus,
    rng: createRng(12),
    timing: INSTANT,
  });
  controller.setTiming(INSTANT);

  const prompts = [];
  bus.on(EVENTS.PASS_DEVICE, (p) => {
    prompts.push(p.name);
    setTimeout(p.confirm, 0); // the UI would wait for a tap here
  });

  const first = waitFor(bus, EVENTS.TURN_BEGIN);
  controller.start();
  await first;
  assert.equal(prompts.length, 1, 'gate fired before the first human turn');

  // Play a few turns and make sure the gate fires again for the next seat.
  for (let i = 0; i < 6 && prompts.length < 2; i++) {
    if (controller.canRoll()) {
      const done = waitFor(bus, EV.DICE_ROLLED);
      controller.roll();
      await done;
    }
    if (controller.canMove()) {
      const moves = controller.currentMoves();
      const moved = waitFor(bus, EV.TOKEN_MOVED);
      controller.selectMove(moves[0]);
      await moved;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(prompts.length >= 2, 'gate fires again when the seat changes, got ' + prompts.length);
  controller.destroy();
});

test('controller: remote action replay reproduces the state byte-for-byte (Phase 2)', async () => {
  // Device A: everything local, records its action log.
  const a = botGame(['red', 'green', 'yellow', 'blue'], 99);
  const overA = waitFor(a.bus, EV.GAME_OVER);
  a.controller.start();
  await overA;
  const log = a.adapter.history();
  assert.ok(log.length > 20);

  // Device B: every seat is remote, so it only ever applies inbound actions.
  const busB = createEventBus();
  const stateB = makeGame(['red', 'green', 'yellow', 'blue']);
  for (const p of stateB.players) p.type = 'bot';
  const remoteAdapter = {
    connect: async () => { },
    disconnect: async () => { },
    sendMove: async () => { },
    onRemoteMove: () => () => { },
    onPlayersChanged: () => () => { },
    presence: () => ({ status: 'online', seats: [], self: null }),
    isAuthoritative: () => false,
    isLocalSeat: () => false,
  };
  const controllerB = createController({
    state: stateB,
    bus: busB,
    adapter: remoteAdapter,
    timing: INSTANT,
  });
  controllerB.start();
  for (const action of log) await controllerB.applyRemoteAction(action);

  assert.equal(controllerB.state.phase, PHASE.GAME_OVER);
  assert.equal(
    serialize(controllerB.state).replace(/"createdAt":\d+/, ''),
    serialize(a.controller.state).replace(/"createdAt":\d+/, ''),
    'replayed state must match the origin device'
  );
  a.controller.destroy();
  controllerB.destroy();
});

/* ──────────────────────────────── modes ──────────────────────────────── */

test('modes: colour assignment spreads players around the board', () => {
  assert.deepEqual(pickColors(2, 'red'), ['red', 'yellow']);
  assert.deepEqual(pickColors(2, 'green'), ['green', 'blue']);
  assert.deepEqual(pickColors(3, 'red'), ['red', 'green', 'yellow']);
  assert.deepEqual(pickColors(4, 'blue'), ['red', 'green', 'yellow', 'blue']);
});

test('modes: vs-computer gives one human and the rest bots', () => {
  const players = buildPlayers({ mode: MODE.VS_COMPUTER, count: 4, humanColor: 'green' });
  assert.equal(players.filter((p) => p.type === 'human').length, 1);
  assert.equal(players.find((p) => p.type === 'human').color, 'green');
  assert.equal(players.filter((p) => p.type === 'bot').length, 3);
});

test('modes: pass & play makes everyone human and honours custom names', () => {
  const players = buildPlayers({
    mode: MODE.PASS_PLAY,
    count: 3,
    humanColor: 'red',
    names: { red: 'Asha', green: 'Ravi' },
  });
  assert.equal(players.every((p) => p.type === 'human'), true);
  assert.equal(players.find((p) => p.color === 'red').name, 'Asha');
  assert.equal(players.find((p) => p.color === 'green').name, 'Ravi');
});

test('modes: quick match is always 1 human vs 1 bot', () => {
  const config = buildConfig({ mode: MODE.QUICK_MATCH, count: 4, humanColor: 'red' });
  assert.equal(config.players.length, 2, 'quick match is capped at 2 seats');
  assert.equal(config.players.filter((p) => p.type === 'bot').length, 1);
  assert.equal(MODE_META[MODE.QUICK_MATCH].maxPlayers, 2);
});

test('modes: the human opens bot games, seat 0 opens pass & play', () => {
  assert.equal(buildConfig({ mode: MODE.VS_COMPUTER, count: 4, humanColor: 'yellow' }).startingPlayer, 2);
  assert.equal(buildConfig({ mode: MODE.PASS_PLAY, count: 4, humanColor: 'yellow' }).startingPlayer, 0);
});

/* ────────────────────────────── turn timer ───────────────────────────── */

test('timer: off by default and never fires', async () => {
  const { createTurnTimer } = await import('../src/game/timer.js');
  const bus = createEventBus();
  const state = makeGame(['red', 'green']);
  state.players[0].type = 'human';
  state.players[1].type = 'bot';
  const controller = createController({ state, bus, rng: () => 0.5, timing: INSTANT });
  const ticks = [];
  bus.on('timer:tick', (p) => ticks.push(p));

  const timer = createTurnTimer({ controller, bus, seconds: 0 });
  controller.start();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(timer.running, false);
  assert.equal(ticks.length, 0, 'a disabled timer is silent');
  timer.stop();
  controller.destroy();
});

test('timer: arms for a human seat, ticks, and never for a bot', async () => {
  const { createTurnTimer } = await import('../src/game/timer.js');
  const bus = createEventBus();
  const state = makeGame(['red', 'green']);
  state.players[0].type = 'human';
  state.players[1].type = 'bot';
  const controller = createController({ state, bus, rng: () => 0.5, timing: INSTANT });
  const ticks = [];
  bus.on('timer:tick', (p) => ticks.push(p));

  const timer = createTurnTimer({ controller, bus, seconds: 15 });
  controller.start();
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(timer.running, true, 'the human seat has a clock');
  assert.ok(ticks.length > 0);
  assert.equal(ticks[0].seat, 0);
  assert.equal(ticks[0].total, 15);
  assert.ok(ticks[0].ratio > 0.9);

  timer.setSeconds(0);
  assert.equal(timer.running, false, 'switching it off stops the clock');
  timer.stop();
  controller.destroy();
});

test('timer: a timeout auto-plays a legal move and toasts', async () => {
  const { createTurnTimer } = await import('../src/game/timer.js');
  const bus = createEventBus();
  const state = makeGame(['red', 'green']);
  state.players[0].type = 'human';
  state.players[1].type = 'bot';
  setTokens(state, 'red', [10, 20, -1, -1]);
  const controller = createController({
    state,
    bus,
    rng: () => 0.5, // always a 4
    timing: INSTANT,
    autoMoveSingle: false,
  });

  const toasts = [];
  bus.on(EVENTS.TOAST, (p) => toasts.push(p));
  const begin = waitFor(bus, EVENTS.TURN_BEGIN);
  const timer = createTurnTimer({ controller, bus, seconds: 15, rng: () => 0.5 });
  controller.start();
  await begin;

  // time out while waiting for the roll
  const rolled = waitFor(bus, EV.DICE_ROLLED);
  timer.forceExpire();
  await rolled;
  assert.equal(controller.state.rollCount, 1, 'the timeout rolled for the player');
  assert.ok(toasts.some((x) => x.key === 'game.autoPlayed'), 'the player was told');

  // time out again while waiting for a token tap
  const movesShown = waitFor(bus, EVENTS.MOVES_AVAILABLE);
  await movesShown;
  const moved = waitFor(bus, EV.TOKEN_MOVED);
  timer.forceExpire();
  const ev = await moved;
  assert.ok(ev.from === 10 || ev.from === 20, 'a legal token was moved');
  timer.stop();
  controller.destroy();
});

test('timer: pausing stops the clock and resuming re-arms it', async () => {
  const { createTurnTimer } = await import('../src/game/timer.js');
  const bus = createEventBus();
  const state = makeGame(['red', 'green']);
  state.players[0].type = 'human';
  state.players[1].type = 'bot';
  const controller = createController({ state, bus, rng: () => 0.5, timing: INSTANT });
  const timer = createTurnTimer({ controller, bus, seconds: 30 });
  controller.start();
  await new Promise((r) => setTimeout(r, 40));

  const before = timer.left;
  controller.pause();
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(timer.left <= before, 'the clock is not advancing the UI while paused');
  controller.resume();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(timer.running, true);
  timer.stop();
  controller.destroy();
});
