/**
 * tests/tournament.test.js — arena sessions: entry, lives, scoring, ranking and
 * the payout when the clock runs out.
 *
 * Time is injected, so the 24-hour arena is tested in microseconds without
 * touching the system clock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ARENAS, RANK_POINTS, arenaById, createTournament, scoreGame } from '../src/meta/tournament.js';
import { createWallet } from '../src/meta/wallet.js';
import { createSave } from '../src/storage/save.js';
import { createEventBus } from '../src/game/events.js';
import { formatClock } from '../src/ui/tournament.js';

let keyCounter = 0;

/** A fresh arena with its own save document, wallet and clock. */
function arena(coins = 500000) {
  const save = createSave({ debounceMs: 0, key: 'ludoBattle.tour.' + ++keyCounter });
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  wallet._set(coins);
  let clock = 1000000;
  const pool = Array.from({ length: 40 }, (_, i) => ({
    id: 'p' + i,
    name: 'Rival ' + i,
    level: 5 + (i % 30),
    avatar: { seed: i, style: 'bloom', tint: i * 9 },
    frame: null,
  }));
  const social = {
    pool: () => pool.slice(),
    me: () => ({ id: 'me', name: 'You', level: 12, avatar: { seed: 1, style: 'beam', tint: 40 }, frame: null }),
  };
  const tournament = createTournament({
    save,
    bus,
    wallet,
    social,
    now: () => clock,
  });
  return {
    tournament,
    wallet,
    bus,
    save,
    advance(ms) {
      clock += ms;
    },
  };
}

/* ──────────────────────────────── scoring ──────────────────────────────── */

test('tournament: winning scores more than any other finish', () => {
  const win = scoreGame({ rank: 1, finished: 4, captures: 3, turns: 60 });
  const second = scoreGame({ rank: 2, finished: 4, captures: 3, turns: 60 });
  const last = scoreGame({ rank: 4, finished: 1, captures: 0, turns: 60 });
  assert.ok(win > second, 'first beats second');
  assert.ok(second > last, 'second beats last');
  assert.equal(scoreGame({ rank: 4 }), RANK_POINTS[3], 'a bare last place is just the base');
});

test('tournament: tokens home and captures both add score', () => {
  const bare = scoreGame({ rank: 3, turns: 100 });
  assert.equal(scoreGame({ rank: 3, finished: 2, turns: 100 }), bare + 80);
  assert.equal(scoreGame({ rank: 3, captures: 2, turns: 100 }), bare + 50);
});

test('tournament: a faster win scores higher, and only a win gets the bonus', () => {
  const fast = scoreGame({ rank: 1, turns: 40 });
  const slow = scoreGame({ rank: 1, turns: 118 });
  assert.ok(fast > slow, 'a short win is worth more');
  assert.equal(scoreGame({ rank: 1, turns: 500 }), RANK_POINTS[0], 'a very long win keeps only the base');
  assert.equal(scoreGame({ rank: 2, turns: 10 }), RANK_POINTS[1], 'no speed bonus for losers');
});

test('tournament: a missing or silly result never produces NaN', () => {
  assert.equal(Number.isFinite(scoreGame()), true);
  assert.equal(Number.isFinite(scoreGame({ rank: 99, finished: 'x' })), true);
  // An unranked player (rank 0, which is what the engine uses before ranking)
  // scores as last place: not finishing must never be worth a win.
  assert.equal(scoreGame({ rank: 0 }), RANK_POINTS[3]);
  assert.equal(scoreGame({ rank: 99 }), RANK_POINTS[3], 'out-of-range ranks clamp to last');
});

/* ───────────────────────────── entry + lives ───────────────────────────── */

test('tournament: entering costs the fee once and grants the arena lives', () => {
  const { tournament, wallet } = arena();
  const all = arenaById('allDay');
  const before = wallet.coins;

  assert.equal(tournament.state('allDay').entered, false);
  assert.equal(tournament.enter('allDay'), true);
  assert.equal(wallet.coins, before - all.entry);

  const state = tournament.state('allDay');
  assert.equal(state.entered, true);
  assert.equal(state.lives, all.lives);
  assert.equal(state.canPlay, true);

  // entering again while the session is live is free
  assert.equal(tournament.enter('allDay'), true);
  assert.equal(wallet.coins, before - all.entry, 'no second fee');
});

test('tournament: an arena you cannot afford is refused and costs nothing', () => {
  const { tournament, wallet } = arena(100);
  assert.equal(tournament.enter('allDay'), false);
  assert.equal(wallet.coins, 100);
  assert.equal(tournament.state('allDay').entered, false);
});

test('tournament: every table spends a life and the last one closes the door', () => {
  const { tournament } = arena();
  const blitz = arenaById('blitz');
  tournament.enter('blitz');
  for (let i = 0; i < blitz.lives; i++) {
    assert.equal(tournament.useLife('blitz'), true, 'life ' + (i + 1));
  }
  assert.equal(tournament.useLife('blitz'), false, 'no lives left');
  assert.equal(tournament.state('blitz').canPlay, false);

  tournament.addLife('blitz');
  assert.equal(tournament.state('blitz').lives, 1, 'a rewarded video buys one more');
  assert.equal(tournament.useLife('blitz'), true);
});

test('tournament: lives cannot be spent or bought without entering', () => {
  const { tournament } = arena();
  assert.equal(tournament.useLife('blitz'), false);
  assert.equal(tournament.addLife('blitz'), 0);
});

/* ────────────────────────── scoring a session ──────────────────────────── */

test('tournament: only your best score of the session is kept', () => {
  const { tournament, bus } = arena();
  const scores = [];
  bus.on('tour:score', (e) => scores.push(e));
  tournament.enter('allDay');

  const first = tournament.submit('allDay', { rank: 2, players: 4, finished: 4, captures: 1, turns: 90 });
  assert.equal(first.improved, true);
  assert.equal(first.best, first.score);

  const worse = tournament.submit('allDay', { rank: 4, players: 4, finished: 1, captures: 0, turns: 120 });
  assert.equal(worse.improved, false);
  assert.equal(worse.best, first.score, 'a bad game cannot lower your best');

  const better = tournament.submit('allDay', { rank: 1, players: 4, finished: 4, captures: 5, turns: 50 });
  assert.equal(better.improved, true);
  assert.ok(better.best > first.score);

  assert.equal(tournament.state('allDay').games, 3, 'every table is counted');
  assert.equal(scores.length, 3);
});

/* ──────────────────────────── the leaderboard ──────────────────────────── */

test('tournament: the board ranks you against a stable field', () => {
  const { tournament } = arena();
  tournament.enter('allDay');
  const board = tournament.board('allDay');
  assert.equal(board.length, arenaById('allDay').field + 1, 'the field plus you');
  assert.equal(board.filter((r) => r.isMe).length, 1);

  for (let i = 1; i < board.length; i++) {
    assert.ok(board[i - 1].score >= board[i].score, 'sorted by score');
    assert.equal(board[i].rank, i + 1);
  }

  // identical input must produce an identical board
  assert.deepEqual(
    tournament.board('allDay').map((r) => r.id + ':' + r.score),
    board.map((r) => r.id + ':' + r.score)
  );

  // a zero score puts you last; a huge score puts you first
  assert.equal(tournament.myRank('allDay'), board.length);
  tournament.submit('allDay', { rank: 1, players: 4, finished: 4, captures: 20, turns: 30 });
  assert.ok(tournament.myRank('allDay') < board.length, 'scoring moves you up');
});

test('tournament: prize brackets fall off with rank and never go negative', () => {
  const { tournament } = arena();
  const entry = arenaById('allDay').entry;
  assert.equal(tournament.prizeFor('allDay', 1), entry * 8);
  assert.equal(tournament.prizeFor('allDay', 3), entry * 4);
  assert.equal(tournament.prizeFor('allDay', 10), entry * 2);
  assert.equal(tournament.prizeFor('allDay', 25), entry);
  assert.equal(tournament.prizeFor('allDay', 26), 0);
  assert.ok(tournament.prizeFor('blitz', 1) < tournament.prizeFor('allDay', 1), 'cheaper arena, smaller prize');
});

/* ──────────────────────────── the clock closes ─────────────────────────── */

test('tournament: the session expires when the clock runs out', () => {
  const { tournament, advance } = arena();
  const all = arenaById('allDay');
  tournament.enter('allDay');
  assert.equal(tournament.state('allDay').expired, false);

  advance(all.durationMs - 1000);
  assert.equal(tournament.state('allDay').expired, false, 'one second left');
  assert.equal(tournament.state('allDay').canPlay, true);

  advance(2000);
  const state = tournament.state('allDay');
  assert.equal(state.expired, true);
  assert.equal(state.canPlay, false, 'no table starts after the bell');
  assert.equal(state.msLeft, 0);
});

test('tournament: closing an expired session pays the prize and resets it', () => {
  const { tournament, wallet, advance, bus } = arena();
  const closes = [];
  bus.on('tour:closed', (e) => closes.push(e));
  tournament.enter('allDay');
  // a very high score guarantees first place in the simulated field
  tournament.submit('allDay', { rank: 1, players: 4, finished: 4, captures: 40, turns: 30 });
  const rank = tournament.myRank('allDay');
  const expected = tournament.prizeFor('allDay', rank);

  assert.deepEqual(tournament.settle('allDay'), { closed: false, rank: 0, prize: 0 }, 'not while it is running');

  advance(arenaById('allDay').durationMs + 1);
  const before = wallet.coins;
  const out = tournament.settle('allDay');
  assert.equal(out.closed, true);
  assert.equal(out.rank, rank);
  assert.equal(out.prize, expected);
  assert.equal(wallet.coins, before + expected);
  assert.equal(closes.length, 1);

  const after = tournament.state('allDay');
  assert.equal(after.entered, false, 'the session is gone');
  assert.equal(after.best, 0);
});

test('tournament: an expired session with no games played pays nothing', () => {
  const { tournament, wallet, advance } = arena();
  tournament.enter('blitz');
  const before = wallet.coins;
  advance(arenaById('blitz').durationMs + 1);
  const out = tournament.settle('blitz');
  assert.equal(out.closed, true);
  assert.equal(out.prize, 0);
  assert.equal(wallet.coins, before, 'no games, no prize');
});

test('tournament: the session lives in the save document Phase 2 syncs', () => {
  const clock = 5000;
  const social = { pool: () => [], me: () => ({ id: 'me', name: 'You', level: 1 }) };

  const saveA = createSave({ debounceMs: 0, key: 'ludoBattle.tour.a' + ++keyCounter });
  const walletA = createWallet({ save: saveA });
  walletA._set(500000);
  const first = createTournament({ save: saveA, wallet: walletA, social, now: () => clock });
  first.enter('blitz');
  first.useLife('blitz');
  first.submit('blitz', { rank: 1, players: 2, finished: 4, captures: 2, turns: 70 });
  const best = first.state('blitz').best;

  // This is the document that goes to users/{uid}/save — the whole session is in it.
  const doc = saveA.all();
  assert.ok(doc.tournament.blitz, 'the arena section is part of the save document');
  assert.equal(doc.tournament.blitz.best, best);

  // Restore it on "another device" and the session is exactly where it was.
  const saveB = createSave({ debounceMs: 0, key: 'ludoBattle.tour.b' + ++keyCounter });
  saveB.load(doc);
  const walletB = createWallet({ save: saveB });
  const second = createTournament({ save: saveB, wallet: walletB, social, now: () => clock });
  const state = second.state('blitz');
  assert.equal(state.entered, true, 'still in the arena on the other device');
  assert.equal(state.best, best);
  assert.equal(state.lives, arenaById('blitz').lives - 1, 'the spent life is remembered');
  assert.equal(state.games, 1);
});

/* ───────────────────────────── arena shape ─────────────────────────────── */

test('tournament: both arenas are sane and distinct', () => {
  assert.equal(ARENAS.length, 2);
  for (const a of ARENAS) {
    assert.ok(a.entry > 0 && a.lives > 0 && a.durationMs > 0 && a.field > 0, a.id);
    assert.ok(a.seats === 2 || a.seats === 4, a.id + ' seats');
  }
  assert.ok(arenaById('blitz').durationMs < arenaById('allDay').durationMs, 'blitz is the short one');
  assert.equal(arenaById('nope').id, ARENAS[0].id, 'an unknown arena falls back safely');
});

test('tournament: the clock reads hh:mm:ss for a long arena and mm:ss for a short one', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(65000), '01:05');
  assert.equal(formatClock(3600000), '1:00:00');
  assert.equal(formatClock(23 * 3600000 + 61000), '23:01:01');
  assert.equal(formatClock(-500), '00:00', 'a passed deadline never goes negative');
});
