/**
 * engine/ai.js — PURE bot brain.
 *
 * ZERO DOM, ZERO canvas, ZERO imports outside engine/. chooseMove() never
 * mutates the state; it returns one of the moves from rules.legalMoves().
 *
 * Strict priority tiers: FINISH > CAPTURE > SAFE > ADVANCE > EXIT.
 * Inside a tier, modifiers (progress, threat, escape value) refine the choice.
 * Modifiers are clamped to ±95 while tiers are 200 apart, so a modifier can
 * never flip the priority order. Moves within `tolerance` of the best are
 * treated as equal and one is picked at random, so the bot does not feel
 * mechanical. EXIT is promoted when the board is empty.
 */

import { legalMoves, MOVE_KIND } from './rules.js';
import {
  BASE,
  FINISH,
  HOME_ENTRY,
  TRACK_LEN,
  currentPlayer,
  distanceToHome,
  isSafeAbs,
  onTrack,
  toAbs,
} from './state.js';

/** Priority tiers, 200 apart. */
export const TIER = Object.freeze({
  EXIT: 300,
  ADVANCE: 500,
  SAFE: 700,
  CAPTURE: 900,
  FINISH: 1100,
});

/** Per-level behaviour knobs. */
export const LEVELS = Object.freeze({
  easy: { blunderChance: 0.55, jitter: 120, threatAware: false, tolerance: 40 },
  normal: { blunderChance: 0.12, jitter: 45, threatAware: true, tolerance: 25 },
  hard: { blunderChance: 0, jitter: 8, threatAware: true, tolerance: 10 },
});

const MODIFIER_CAP = 95;

/**
 * Pick a move for a bot.
 *
 * @param {object} state   current game state (never mutated)
 * @param {number} dice    the die value already rolled
 * @param {number} [playerId] sanity check — must be the player in turn
 * @param {object} [opts]  { rng, level }
 * @returns {object|null}  a move object from legalMoves(), or null when stuck
 */
export function chooseMove(state, dice, playerId, opts = {}) {
  const moves = legalMoves(state, dice);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const actor = currentPlayer(state);
  if (playerId !== undefined && playerId !== null && playerId !== actor.id) {
    throw new Error('chooseMove: player ' + playerId + ' is not in turn');
  }

  const rng = opts.rng || Math.random;
  const level = LEVELS[opts.level || actor.botLevel] || LEVELS.hard;

  // Easy bots throw a game away now and then, like a distracted human.
  if (level.blunderChance > 0 && rng() < level.blunderChance) {
    return moves[Math.floor(rng() * moves.length) % moves.length];
  }

  const scored = evaluate(state, dice, { level, rng });

  let best = -Infinity;
  for (const item of scored) if (item.score > best) best = item.score;

  const shortlist = scored.filter((item) => best - item.score <= level.tolerance);
  const pick = shortlist[Math.floor(rng() * shortlist.length) % shortlist.length];
  return pick.move;
}

/**
 * Score every legal move. Exported for tests, tuning and the (Phase 2) hint button.
 * @returns {{move:object, score:number, tier:number, modifier:number}[]}
 */
export function evaluate(state, dice, opts = {}) {
  const level = opts.level || LEVELS[opts.levelName || 'hard'] || LEVELS.hard;
  const rng = opts.rng || null;
  const moves = legalMoves(state, dice);
  const actor = currentPlayer(state);
  const onBoard = actor.tokens.filter((rel) => onTrack(rel)).length;

  return moves.map((move) => {
    const tier = tierOf(move, onBoard);
    const modifier = clamp(modifierOf(state, actor, move, level), -MODIFIER_CAP, MODIFIER_CAP);
    const noise = rng && level.jitter ? (rng() - 0.5) * 2 * level.jitter : 0;
    return { move, tier, modifier, score: tier + modifier + noise };
  });
}

/* ───────────────────────────────── tiers ──────────────────────────────────── */

function tierOf(move, onBoard) {
  if (move.kind === MOVE_KIND.FINISH) return TIER.FINISH;
  if (move.captures.length > 0) return TIER.CAPTURE;
  if (move.kind === MOVE_KIND.EXIT) {
    // With an empty board, getting a token out is the whole game. With a single
    // token out it still beats pushing that lone token further.
    if (onBoard === 0) return TIER.SAFE + 100;
    if (onBoard === 1) return TIER.ADVANCE + 120;
    return TIER.EXIT;
  }
  if (move.to > HOME_ENTRY) return TIER.SAFE; // slipping into the private column
  if (isSafeRelForMove(move)) return TIER.SAFE;
  return TIER.ADVANCE;
}

function isSafeRelForMove(move) {
  return move.safe === true;
}

/* ─────────────────────────────── modifiers ────────────────────────────────── */

function modifierOf(state, actor, move, level) {
  let m = 0;

  // Forward progress, and a nudge towards the token that is furthest along.
  m += 0.6 * Math.max(0, move.to);
  m += 0.5 * Math.max(0, move.from);

  // Value of the token we would remove: killing a nearly-home token hurts most.
  if (move.captures.length > 0) {
    let victimValue = 0;
    for (const c of move.captures) victimValue += c.from + 1;
    m += Math.min(35, 0.6 * victimValue) + 6 * (move.captures.length - 1);
  }

  // Reaching the centre-adjacent cells is worth a little extra.
  if (move.to > HOME_ENTRY) m += 10 + (move.to - HOME_ENTRY) * 2;

  if (level.threatAware) {
    // Running away from a square where we can be hit — worth more the deeper
    // the token already is, because we would lose more progress.
    const riskNow = threatCount(state, actor, move.from, move.tokenIndex);
    if (riskNow > 0) m += Math.min(45, 10 * riskNow + 0.4 * Math.max(0, move.from));

    // Walking into a square where we can be hit.
    const riskNext = threatCount(state, actor, move.to, move.tokenIndex);
    m -= Math.min(48, 12 * riskNext);

    // Deep tokens are more valuable, so exposing them costs more.
    if (riskNext > 0) m -= Math.min(20, move.to * 0.25);

    // Prefer keeping a buddy on a safe square (stacking is legal for one colour).
    if (move.safe && sameColorAt(state, actor, move.to, move.tokenIndex) > 0) m += 8;
  }

  // Slight preference for closing out a token that is nearly home.
  if (distanceToHome(move.to) <= 6 && move.to > HOME_ENTRY) m += 12;

  return m;
}

/**
 * How many opponent die faces (1..6) would capture a token standing on `rel`.
 * 0 for base / home column / safe squares.
 */
export function threatCount(state, actor, rel, tokenIndex) {
  if (!onTrack(rel)) return 0;
  const abs = toAbs(actor.color, rel);
  if (isSafeAbs(abs)) return 0;
  let count = 0;
  for (const opp of state.players) {
    if (opp.id === actor.id) continue;
    for (let i = 0; i < opp.tokens.length; i++) {
      const oRel = opp.tokens[i];
      if (!onTrack(oRel)) continue; // base tokens cannot attack, they exit onto a safe square
      const oAbs = toAbs(opp.color, oRel);
      const need = (abs - oAbs + TRACK_LEN) % TRACK_LEN;
      if (need >= 1 && need <= 6 && oRel + need <= HOME_ENTRY) count++;
    }
  }
  void tokenIndex;
  return count;
}

function sameColorAt(state, actor, rel, exceptIndex) {
  if (!onTrack(rel)) return 0;
  let n = 0;
  for (let i = 0; i < actor.tokens.length; i++) {
    if (i === exceptIndex) continue;
    if (actor.tokens[i] === rel) n++;
  }
  return n;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ───────────────────────────── introspection ─────────────────────────────── */

/**
 * Human-readable reason for a move — used by the "hint" affordance and by
 * tests to assert the bot's intent.
 */
export function explainMove(state, move, onBoard = 2) {
  const tier = tierOf(move, onBoard);
  if (tier === TIER.FINISH) return 'bring a token home';
  if (tier === TIER.CAPTURE) return 'capture an opponent';
  if (move.kind === MOVE_KIND.EXIT) return 'bring a new token out';
  if (tier === TIER.SAFE) return move.to > HOME_ENTRY ? 'enter the home column' : 'reach a safe square';
  return 'advance the furthest token';
}

/** Number of a player's tokens still waiting in the base. */
export function tokensInBase(player) {
  return player.tokens.filter((rel) => rel === BASE).length;
}

/** Number of a player's tokens already home. */
export function tokensHome(player) {
  return player.tokens.filter((rel) => rel === FINISH).length;
}
