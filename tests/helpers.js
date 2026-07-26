/**
 * tests/helpers.js — tiny fixture helpers shared by the test files.
 * No dependencies, no framework: plain ES modules for `node --test`.
 */

import {
  BASE,
  FINISH,
  PHASE,
  TOKENS_PER_PLAYER,
  createInitialState,
} from '../src/engine/state.js';

/** Build a 2/3/4 player game with deterministic ids and colour-ordered seats. */
export function makeGame(colors = ['red', 'green', 'yellow', 'blue'], overrides = {}) {
  return createInitialState({
    id: 'test',
    createdAt: 0,
    mode: overrides.mode || 'vsComputer',
    startingPlayer: overrides.startingPlayer || 0,
    options: overrides.options,
    players: colors.map((color) => ({ color, name: color.toUpperCase(), type: 'human' })),
  });
}

/** Overwrite one player's tokens and keep derived counters consistent. */
export function setTokens(state, color, tokens) {
  const p = state.players.find((x) => x.color === color);
  if (!p) throw new Error('setTokens: no such colour ' + color);
  const next = tokens.slice();
  while (next.length < TOKENS_PER_PLAYER) next.push(BASE);
  p.tokens = next;
  p.finished = next.filter((t) => t === FINISH).length;
  return state;
}

/** Put the state into "a die has been rolled, waiting for a move". */
export function armMove(state, dice, seat = state.turn) {
  state.turn = seat;
  state.dice = dice;
  state.phase = PHASE.AWAIT_MOVE;
  return state;
}

/** Deep structural equality via JSON (states are always JSON-safe). */
export function snap(state) {
  return JSON.stringify(state);
}

export function seatOf(state, color) {
  return state.players.findIndex((p) => p.color === color);
}
