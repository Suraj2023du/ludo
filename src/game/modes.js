/**
 * game/modes.js — mode orchestration.
 *
 * Turns a bit of UI setup ("3 players, I'm green, vs computer") into a real
 * engine config + controller, and owns the pass-and-play privacy gate.
 * Still no DOM: the gate talks to the UI through the event bus.
 */

import { COLORS, MODE, PLAYER_TYPE, createInitialState } from '../engine/state.js';
import { createController } from './controller.js';
import { EVENTS } from './events.js';

export const MODE_META = Object.freeze({
  [MODE.VS_COMPUTER]: {
    id: MODE.VS_COMPUTER,
    title: 'Vs Computer',
    blurb: 'You against smart bots',
    minPlayers: 2,
    maxPlayers: 4,
    defaultPlayers: 4,
    humans: 1,
    statsKey: 'vsComputer',
  },
  [MODE.PASS_PLAY]: {
    id: MODE.PASS_PLAY,
    title: 'Pass & Play',
    blurb: '2-4 players, one phone',
    minPlayers: 2,
    maxPlayers: 4,
    defaultPlayers: 2,
    humans: 4,
    statsKey: 'passPlay',
  },
  [MODE.QUICK_MATCH]: {
    id: MODE.QUICK_MATCH,
    title: 'Quick Match',
    blurb: 'Fast 1 v 1 against a bot',
    minPlayers: 2,
    maxPlayers: 2,
    defaultPlayers: 2,
    humans: 1,
    statsKey: 'quickMatch',
  },
});

export const DEFAULT_NAMES = Object.freeze({
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  blue: 'Blue',
});

/**
 * Choose which colours are in play: always includes the human's colour and
 * spreads the rest around the board (2 players sit opposite each other).
 * @returns {string[]} colours in clockwise seat order
 */
export function pickColors(count, humanColor = 'red') {
  const base = COLORS.indexOf(humanColor) === -1 ? 0 : COLORS.indexOf(humanColor);
  const offsets = count === 2 ? [0, 2] : count === 3 ? [0, 1, 2] : [0, 1, 2, 3];
  const chosen = offsets.slice(0, count).map((o) => COLORS[(base + o) % COLORS.length]);
  return COLORS.filter((c) => chosen.includes(c)); // clockwise order
}

/**
 * Build the player list for a mode.
 * @param {object} setup { mode, count, humanColor, names:{color:name}, botLevel }
 */
export function buildPlayers(setup) {
  const mode = setup.mode || MODE.VS_COMPUTER;
  const meta = MODE_META[mode] || MODE_META[MODE.VS_COMPUTER];
  const count = clamp(setup.count || meta.defaultPlayers, meta.minPlayers, meta.maxPlayers);
  const humanColor = setup.humanColor || 'red';
  const colors = setup.colors && setup.colors.length === count ? setup.colors : pickColors(count, humanColor);
  const names = setup.names || {};
  const allHuman = mode === MODE.PASS_PLAY;

  return colors.map((color) => {
    const human = allHuman || color === humanColor;
    return {
      color,
      name: (names[color] || '').trim() || (human ? DEFAULT_NAMES[color] : DEFAULT_NAMES[color] + ' Bot'),
      type: human ? PLAYER_TYPE.HUMAN : PLAYER_TYPE.BOT,
      botLevel: setup.botLevel || 'hard',
    };
  });
}

/** Full engine config for createInitialState(). */
export function buildConfig(setup) {
  const mode = setup.mode || MODE.VS_COMPUTER;
  const players = buildPlayers(setup);
  const humanColor = setup.humanColor || 'red';
  const humanSeat = Math.max(0, players.findIndex((p) => p.color === humanColor));
  return {
    mode,
    players,
    // The human opens the game in bot modes; seat 0 opens a pass-and-play game.
    startingPlayer: mode === MODE.PASS_PLAY ? 0 : humanSeat,
    options: setup.options,
  };
}

/**
 * The pass-the-phone gate. Returns an async function suitable for
 * controller.setGate(): it emits PASS_DEVICE and resolves when the UI confirms.
 */
export function createPassDeviceGate(bus, { enabled = true } = {}) {
  if (!enabled) return null;
  return (player, state) =>
    new Promise((resolve) => {
      bus.emit(EVENTS.PASS_DEVICE, {
        player,
        playerId: player.id,
        name: player.name,
        color: player.color,
        state,
        confirm: resolve,
      });
    });
}

/**
 * Create a ready-to-start game for a mode.
 * @returns {{controller:object, state:object, config:object, meta:object}}
 */
export function createGame({ setup, bus, adapter, rng, timing, speed, state: resumeState }) {
  const config = buildConfig(setup);
  const state = resumeState || createInitialState(config);
  const mode = state.mode || config.mode;
  const meta = MODE_META[mode] || MODE_META[MODE.VS_COMPUTER];

  const controller = createController({ state, bus, adapter, rng, timing });
  if (speed) controller.setSpeed(speed);

  // Only pass-and-play hides the board between turns.
  const humanSeats = state.players.filter((p) => p.type === PLAYER_TYPE.HUMAN).length;
  if (mode === MODE.PASS_PLAY && humanSeats > 1) {
    controller.setGate(createPassDeviceGate(bus));
  }

  return { controller, state, config, meta, mode };
}

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}
