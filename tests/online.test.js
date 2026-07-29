/**
 * tests/online.test.js — the online layer.
 *
 * The point of these tests is that "online" is not a mock: a real controller
 * runs a real table where the seats this device does not own are driven only by
 * actions crossing the adapter, applied through controller.applyRemoteAction().
 * That is the exact code path Phase 2's FirebaseAdapter will use.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PHASE, PLAYER_TYPE } from '../src/engine/state.js';
import { EV } from '../src/engine/rules.js';
import { createEventBus, EVENTS } from '../src/game/events.js';
import { createController } from '../src/game/controller.js';
import { MODE_META, ONLINE_MODE, buildConfig, createGame, pickColors } from '../src/game/modes.js';
import { SimulatedOnlineAdapter } from '../src/sync/simulated.js';
import { ACTION, SYNC_STATUS, assertAdapter, rollAction } from '../src/sync/adapter.js';
import { STAKE_TIERS, createWallet, tierById } from '../src/meta/wallet.js';
import { createSave } from '../src/storage/save.js';
import { makeGame } from './helpers.js';

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

/** Deterministic 0..1 generator, so a failure is always reproducible. */
function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve when the table finishes; reject if it stalls (a deadlock is a bug). */
function untilGameOver(bus, controller, limitMs = 15000) {
  if (controller.state.phase === PHASE.GAME_OVER) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('the table stalled before anyone won')), limitMs);
    bus.on(EV.GAME_OVER, () => {
      clearTimeout(guard);
      resolve();
    });
  });
}

/** Play our own seat as soon as the controller allows it. */
function autoplayLocalSeat(controller) {
  const id = setInterval(() => {
    if (controller.canRoll()) controller.roll();
    else if (controller.canMove()) controller.selectMove(controller.currentMoves()[0]);
  }, 1);
  if (id && typeof id.unref === 'function') id.unref();
  return () => clearInterval(id);
}

/** A 2-seat online table: seat 0 is us, seat 1 arrives over the wire. */
function onlineTable(opts = {}) {
  const bus = createEventBus();
  const state = makeGame(['red', 'green'], { mode: ONLINE_MODE });
  state.players[1].type = PLAYER_TYPE.BOT;
  let controller = null;
  const adapter = new SimulatedOnlineAdapter({
    bus,
    getState: () => (controller ? controller.state : state),
    mySeat: 0,
    rng: seeded(opts.seed || 11),
    latency: { min: 0, max: 0 },
    spectator: !!opts.spectator,
  });
  controller = createController({
    state,
    bus,
    adapter,
    rng: seeded((opts.seed || 11) + 1),
    timing: INSTANT,
  });
  return { bus, adapter, controller };
}

/* ─────────────────────────────── contract ──────────────────────────────── */

test('online: the simulated adapter satisfies the SyncAdapter contract', () => {
  const { adapter } = onlineTable();
  assert.doesNotThrow(() => assertAdapter(adapter));
  assert.equal(adapter.status, SYNC_STATUS.OFFLINE);
  assert.equal(adapter.isAuthoritative(), true);
  assert.deepEqual(adapter.history(), []);
});

test('online: only our own seat is local, and a spectator owns nothing', () => {
  const mine = onlineTable().adapter;
  assert.equal(mine.isLocalSeat(0), true);
  assert.equal(mine.isLocalSeat(1), false);

  const watcher = onlineTable({ spectator: true }).adapter;
  assert.equal(watcher.isLocalSeat(0), false);
  assert.equal(watcher.isLocalSeat(1), false);
  assert.equal(watcher.isAuthoritative(), false, 'a watcher never owns the dice');
  assert.equal(watcher.presence().self, null);
});

test('online: connect goes online, publishes the roster and can be closed', async () => {
  const { adapter, controller } = onlineTable();
  const seen = [];
  adapter.onPlayersChanged((seats) => seen.push(seats));
  await adapter.connect({ id: 'gold' });
  assert.equal(adapter.status, SYNC_STATUS.ONLINE);
  assert.equal(seen.length, 1);
  assert.deepEqual(
    seen[0].map((s) => [s.seat, s.local]),
    [
      [0, true],
      [1, false],
    ]
  );
  assert.equal(adapter.describe().room.id, 'gold');
  await adapter.disconnect();
  assert.equal(adapter.status, SYNC_STATUS.OFFLINE);
  controller.destroy();
});

/* ─────────────────────────── the ordered log ───────────────────────────── */

test('online: the log is ordered and a repeated delivery is rejected', () => {
  const { adapter } = onlineTable();
  const first = rollAction(1, 6, 1);
  assert.equal(adapter._record(first), true);
  assert.equal(adapter._record({ ...first }), false, 'same n twice must be dropped');
  assert.equal(adapter._record(rollAction(1, 3, 2)), true);
  assert.equal(adapter._record({ t: ACTION.ROLL, seat: 1, value: 4 }), false, 'no n, no entry');
  assert.deepEqual(adapter.history().map((a) => a.n), [1, 2]);
});

test('online: the server renumbers what a client sends, so nothing collides', async () => {
  const { adapter } = onlineTable();
  // A remote seat is recorded first, then our own action claims the same n.
  adapter._record(rollAction(1, 5, 1));
  await adapter.sendMove(rollAction(0, 2, 1));
  await adapter.sendMove(rollAction(0, 3, 2));
  const log = adapter.history();
  assert.deepEqual(log.map((a) => a.n), [1, 2, 3], 'one increasing stream');
  assert.deepEqual(log.map((a) => a.seat), [1, 0, 0]);
});

/* ───────────────────────── a real online table ─────────────────────────── */

test('online: a remote seat plays only through applyRemoteAction', async () => {
  const { bus, adapter, controller } = onlineTable({ seed: 23 });
  const remoteApplied = [];
  bus.on(EVENTS.SYNC_REMOTE_ACTION, (a) => remoteApplied.push(a));

  await adapter.connect();
  controller.start();

  // Our seat opens the game: nothing may happen until we roll.
  assert.equal(controller.canRoll(), true, 'our seat is playable');
  assert.equal(remoteApplied.length, 0);

  // We play our seat; seat 1 can only reach the board over the wire. 25 remote
  // actions is plenty to prove the round trip — the spectator test below plays a
  // whole table out.
  const stop = autoplayLocalSeat(controller);
  await new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('no remote traffic')), 15000);
    const check = setInterval(() => {
      if (remoteApplied.length < 25 && controller.state.phase !== PHASE.GAME_OVER) return;
      clearInterval(check);
      clearTimeout(guard);
      resolve();
    }, 2);
    if (check && typeof check.unref === 'function') check.unref();
  });
  stop();

  assert.ok(remoteApplied.length >= 25, 'seat 1 acted over the wire');
  assert.ok(
    remoteApplied.every((a) => a.seat === 1),
    'only the seat we do not own arrives remotely'
  );
  const numbers = adapter.history().map((a) => a.n);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'log stays ordered');
  assert.equal(new Set(numbers).size, numbers.length, 'no duplicate action numbers');
  controller.destroy();
  await adapter.disconnect();
});

test('online: a spectator table plays itself and stays unplayable', async () => {
  const { bus, adapter, controller } = onlineTable({ spectator: true, seed: 41 });
  await adapter.connect();
  controller.start();

  const watchdog = setInterval(() => {
    assert.equal(controller.canRoll(), false, 'a watcher can never roll');
    assert.equal(controller.canMove(), false, 'a watcher can never move');
  }, 5);
  if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
  await untilGameOver(bus, controller);
  clearInterval(watchdog);

  assert.equal(controller.state.phase, PHASE.GAME_OVER, 'the watched table finished on its own');
  assert.ok(adapter.history().length > 20, 'every action crossed the wire');
  const winner = controller.state.players.find((p) => p.rank === 1);
  assert.ok(winner, 'someone won');
  controller.destroy();
  await adapter.disconnect();
});

test('online: disconnecting stops the wire dead', async () => {
  const { adapter, controller } = onlineTable({ seed: 5 });
  await adapter.connect();
  controller.start();
  controller.roll();
  await tick(0);
  await adapter.disconnect();
  const frozen = adapter.history().length;
  await tick(30);
  assert.equal(adapter.history().length, frozen, 'no action after disconnect');
  controller.destroy();
});

/* ──────────────────────────── mode + seating ───────────────────────────── */

test('online: the mode is wired without touching the engine', () => {
  assert.equal(ONLINE_MODE, 'online');
  assert.equal(MODE_META[ONLINE_MODE].statsKey, 'online');
  assert.equal(MODE_META[ONLINE_MODE].staked, true);

  const setup = { mode: ONLINE_MODE, count: 4, humanColor: 'yellow', names: {} };
  const config = buildConfig(setup);
  assert.equal(config.mode, 'online');
  assert.equal(config.players.length, 4);
  assert.equal(config.players.filter((p) => p.type === PLAYER_TYPE.HUMAN).length, 1, 'one seat is ours');
  assert.equal(config.players[config.startingPlayer].color, 'yellow', 'we open the table');
});

test('online: opponent names land on the seats we do not own', () => {
  const humanColor = 'red';
  const colors = pickColors(4, humanColor);
  const opponents = [{ name: 'Aarav' }, { name: 'Priya' }, { name: 'Kabir' }];
  const names = {};
  let i = 0;
  for (const color of colors) {
    if (color === humanColor) continue;
    names[color] = opponents[i++].name;
  }
  const game = createGame({
    setup: { mode: ONLINE_MODE, count: 4, humanColor, names },
    bus: createEventBus(),
  });
  const seated = game.state.players.map((p) => p.name);
  assert.ok(seated.includes('Aarav') && seated.includes('Priya') && seated.includes('Kabir'));
  assert.equal(
    game.state.players.filter((p) => p.type === PLAYER_TYPE.HUMAN).length,
    1,
    'the other seats are not ours to play'
  );
  game.controller.destroy();
});

/* ─────────────────────────── stakes round trip ─────────────────────────── */

let walletKey = 0;
function freshWallet(coins) {
  const save = createSave({ debounceMs: 0, key: 'ludoBattle.online.' + ++walletKey });
  const wallet = createWallet({ save });
  wallet._set(coins);
  return wallet;
}

test('online: entry fee is taken once and the winner is paid the advertised prize', () => {
  const tier = tierById('bronze');
  const wallet = freshWallet(tier.entry * 2);

  assert.equal(wallet.stake('bronze'), true);
  assert.equal(wallet.coins, tier.entry, 'exactly one entry fee left the balance');

  const prize = wallet.settle('bronze', 1, 2);
  assert.equal(prize, tier.winner);
  assert.equal(wallet.coins, tier.entry + tier.winner);
});

test('online: losing a staked table costs the entry and pays nothing', () => {
  const tier = tierById('silver');
  const wallet = freshWallet(tier.entry);
  assert.equal(wallet.stake('silver'), true);
  assert.equal(wallet.coins, 0);
  assert.equal(wallet.settle('silver', 4, 4), 0);
  assert.equal(wallet.coins, 0);
});

test('online: second place on a 4-seat table gets part of the entry back', () => {
  const tier = tierById('gold');
  const wallet = freshWallet(tier.entry);
  wallet.stake('gold');
  const prize = wallet.settle('gold', 2, 4);
  assert.equal(prize, Math.round(tier.entry * 0.6));
  assert.equal(wallet.coins, prize);
  // …but not on a 2-seat table, where second place is simply the loser
  const duel = freshWallet(tier.entry);
  duel.stake('gold');
  assert.equal(duel.settle('gold', 2, 2), 0);
});

test('online: a table you cannot afford is refused before anything starts', () => {
  const tier = tierById('diamond');
  const wallet = freshWallet(tier.entry - 1);
  assert.equal(wallet.stake('diamond'), false);
  assert.equal(wallet.coins, tier.entry - 1, 'a refused stake never moves money');
});

test('online: every stake tier pays a winner more than the entry', () => {
  for (const tier of STAKE_TIERS) {
    assert.ok(tier.winner > tier.entry, tier.id + ' must be worth playing');
    assert.ok(tier.exp > 0, tier.id + ' must grant XP');
  }
});
