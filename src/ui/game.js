/**
 * ui/game.js — the canvas view: render loop, input, and the animator the
 * controller awaits.
 *
 * This module NEVER mutates game state. It reads the state it receives through
 * the event bus and turns user taps into controller calls.
 *
 * Performance notes (India 2G/3G, low-end Android):
 *   • one requestAnimationFrame loop, delta-timed
 *   • devicePixelRatio capped at 2
 *   • the static board is cached offscreen and blitted
 *   • the loop idles (skips drawing) when nothing is moving
 */

import { PHASE, currentPlayer } from '../engine/state.js';
import { EV } from '../engine/rules.js';
import { EVENTS } from '../game/events.js';
import {
  computeLayout,
  createBoardCache,
  getTheme,
  hitDice,
  playerPalette,
  positionPoint,
  withAlpha,
} from '../render/board.js';
import { createTokenLayer, tokenKey } from '../render/tokens.js';
import { createDiceLayer } from '../render/dice.js';
import { createEffects } from '../render/effects.js';

const MAX_DPR = 2;

export function createGameView({ canvas, bus, audio, prefs }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const boardCache = createBoardCache();
  const tokens = createTokenLayer();
  const dice = createDiceLayer();
  const fx = createEffects();

  let theme = getTheme(prefs.get('theme'));
  let layout = computeLayout(320, 480);
  let dpr = 1;
  let state = null;
  let controller = null;
  let highlights = new Set();
  let targets = [];
  let rafId = 0;
  let lastTs = 0;
  let visible = false;
  let dirty = true;
  let flash = 0;
  let flashColor = null;
  const stepTimers = new Set();

  /* ────────────────────────────── sizing ─────────────────────────────── */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(200, Math.round(rect.width || canvas.clientWidth || 320));
    const cssH = Math.max(260, Math.round(rect.height || canvas.clientHeight || 480));
    dpr = Math.min(MAX_DPR, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    layout = computeLayout(cssW, cssH);
    boardCache.invalidate();
    dirty = true;
  }

  function setTheme(id) {
    theme = getTheme(id);
    boardCache.invalidate();
    dirty = true;
  }

  /* ────────────────────────────── the loop ───────────────────────────── */

  function frame(ts) {
    if (!visible) return;
    const dt = lastTs ? Math.min(50, ts - lastTs) : 16;
    lastTs = ts;

    tokens.update(dt);
    dice.update(dt);
    fx.update(dt);
    if (flash > 0) flash = Math.max(0, flash - dt);

    const busy = tokens.isAnimating() || dice.rolling || fx.busy || flash > 0 || highlights.size > 0;
    if (busy || dirty) {
      draw(ts);
      dirty = busy;
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (visible) return;
    visible = true;
    lastTs = 0;
    resize();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    visible = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ────────────────────────────── painting ───────────────────────────── */

  function draw(ts) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.page;
    ctx.fillRect(0, 0, layout.w, layout.h);

    const cached = boardCache.ensure(layout, theme, dpr);
    if (cached) ctx.drawImage(cached, 0, 0, layout.w, layout.h);

    if (state) {
      drawTargets();
      tokens.draw(ctx, state, layout, theme, { highlights, now: ts });
      drawDice();
      if (flash > 0 && flashColor) drawFlash();
    }
    fx.draw(ctx);
  }

  function drawTargets() {
    if (!targets.length) return;
    const cell = layout.cell;
    const t = (Date.now() % 1000) / 1000;
    for (const target of targets) {
      ctx.beginPath();
      ctx.arc(target.x, target.y, cell * (0.3 + t * 0.16), 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(target.color, 0.75 * (1 - t));
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(target.x, target.y, cell * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(target.color, 0.5);
      ctx.fill();
    }
  }

  function drawDice() {
    const player = state.phase === PHASE.GAME_OVER ? null : currentPlayer(state);
    const canRoll = !!controller && controller.canRoll();
    dice.draw(ctx, layout, theme, {
      color: player ? player.color : null,
      canRoll,
    });

    if (player) {
      const label = canRoll ? 'TAP TO ROLL' : player.type === 'bot' ? 'THINKING…' : '';
      if (label) {
        ctx.save();
        ctx.font = '600 ' + Math.max(10, Math.round(layout.cell * 0.62)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = withAlpha(theme.text === '#0d1b30' ? '#ffffff' : theme.text, 0.72);
        const y = layout.dice.y + layout.dice.size + Math.max(12, layout.cell * 0.9);
        ctx.fillText(label, layout.w / 2, Math.min(layout.h - 8, y));
        ctx.restore();
      }
    }
  }

  function drawFlash() {
    const a = (flash / 420) * 0.35;
    const g = ctx.createRadialGradient(
      layout.w / 2,
      layout.board.y + layout.board.size / 2,
      layout.board.size * 0.2,
      layout.w / 2,
      layout.board.y + layout.board.size / 2,
      layout.board.size * 0.8
    );
    g.addColorStop(0, withAlpha(flashColor, a));
    g.addColorStop(1, withAlpha(flashColor, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.w, layout.h);
  }

  /* ────────────────────────────── input ──────────────────────────────── */

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches && e.touches.length ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function onPointerDown(e) {
    if (!state || !controller) return;
    const { x, y } = pointFromEvent(e);

    if (hitDice(layout, x, y)) {
      if (controller.canRoll()) {
        audio.unlock();
        controller.roll();
      } else {
        audio.sfx.deny();
      }
      return;
    }

    if (!controller.canMove()) return;
    const moves = controller.currentMoves();
    const idx = tokens.pick(layout, state, x, y, moves);
    if (idx === null) return;
    audio.unlock();
    if (!controller.selectToken(idx)) audio.sfx.deny();
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    false
  );

  /* ───────────────────────────── the animator ────────────────────────── */

  /**
   * Read a duration from the controller's timing table.
   * Uses an explicit finite check so an injected 0 (tests, "instant" mode) is
   * honoured instead of falling back to the default.
   */
  function ms(key, fallback) {
    const table = controller && controller.timing;
    const value = table ? table[key] : undefined;
    return Number.isFinite(value) ? value : fallback;
  }

  function stepMs() {
    return ms('step', 110);
  }

  function scheduleStepSounds(count) {
    const gap = stepMs();
    for (let i = 0; i < count; i++) {
      const id = setTimeout(() => {
        stepTimers.delete(id);
        audio.sfx.step(i % 3);
      }, i * gap);
      stepTimers.add(id);
    }
  }

  function clearStepSounds() {
    for (const id of stepTimers) clearTimeout(id);
    stepTimers.clear();
  }

  const animator = {
    async roll(value, player) {
      const duration = ms('diceRoll', 560);
      audio.sfx.dice(duration);
      fx.ring(
        layout.dice.x + layout.dice.size / 2,
        layout.dice.y + layout.dice.size / 2,
        playerPalette(theme, player.color).main,
        layout.dice.size * 0.9,
        duration * 0.6
      );
      dirty = true;
      await dice.roll(value, duration);
    },

    async move(ev) {
      const player = state.players[ev.playerId];
      const pts = tokens.pathPoints(layout, player.color, ev);
      const key = tokenKey(ev.playerId, ev.tokenIndex);
      scheduleStepSounds(ev.path.length);
      dirty = true;
      await tokens.walk(key, pts, stepMs());
      clearStepSounds();
      const end = pts[pts.length - 1];
      const pal = playerPalette(theme, player.color);
      fx.burst(end.x, end.y, pal.main, 8, 0.8);
      audio.sfx.land();
    },

    async capture(ev) {
      const victim = state.players[ev.playerId];
      const pal = playerPalette(theme, victim.color);
      const from = positionPoint(layout, victim.color, ev.from, ev.tokenIndex);
      const to = tokens.baseSlotPoint(layout, victim.color, ev.tokenIndex);
      fx.hit(from.x, from.y, pal.main);
      audio.sfx.capture();
      flash = 420;
      flashColor = playerPalette(theme, ev.byColor).main;
      dirty = true;
      await tokens.fly(tokenKey(ev.playerId, ev.tokenIndex), from, to, ms('capture', 380));
    },

    async finish(ev) {
      const player = state.players[ev.playerId];
      const pal = playerPalette(theme, player.color);
      const at = positionPoint(layout, player.color, 56, ev.tokenIndex);
      fx.sparkle(at.x, at.y, pal.light, 16);
      fx.ring(at.x, at.y, pal.main, layout.cell * 2.2, 520);
      audio.sfx.finish();
      dirty = true;
      await tokens.pop(tokenKey(ev.playerId, ev.tokenIndex), at, ms('finish', 260));
    },
  };

  /* ─────────────────────────── bus subscriptions ─────────────────────── */

  function setState(next) {
    state = next;
    dirty = true;
  }

  bus.on(EVENTS.GAME_STARTED, (p) => {
    setState(p.state);
    tokens.clear();
    fx.clear();
    dice.setValue(6);
  });
  bus.on(EVENTS.STATE_CHANGED, (p) => setState(p.state));

  bus.on(EVENTS.MOVES_AVAILABLE, (p) => {
    if (!state) return;
    const player = state.players[p.playerId];
    const keys = new Set();
    const marks = [];
    const pal = playerPalette(theme, player.color);
    for (const move of p.moves) {
      // highlight every token standing on that origin (a stack moves as one)
      for (let i = 0; i < player.tokens.length; i++) {
        if (player.tokens[i] === move.from) keys.add(tokenKey(player.id, i));
      }
      const pt = positionPoint(layout, player.color, move.to, move.tokenIndex);
      marks.push({ x: pt.x, y: pt.y, color: pal.dark });
    }
    // A bot's turn should not paint tap targets.
    const isBot = player.type === 'bot';
    highlights = isBot ? new Set() : keys;
    targets = isBot ? [] : marks;
    dirty = true;
  });

  bus.on(EVENTS.MOVES_CLEARED, () => {
    highlights = new Set();
    targets = [];
    dirty = true;
  });

  bus.on(EV.SIX, (p) => {
    flash = 420;
    flashColor = playerPalette(theme, p.color).main;
    audio.sfx.six();
    dirty = true;
  });

  bus.on(EV.THREE_SIXES, () => audio.sfx.penalty());
  bus.on(EV.NO_MOVES, () => audio.sfx.noMoves());
  bus.on(EV.TURN_CHANGED, () => audio.sfx.turn());

  bus.on(EV.GAME_OVER, (p) => {
    const colors = state ? state.players.map((pl) => playerPalette(theme, pl.color).main) : null;
    fx.confetti({ x: 0, y: 0, w: layout.w, h: layout.h }, colors, 5200);
    highlights = new Set();
    targets = [];
    dirty = true;
    void p;
  });

  bus.on(EVENTS.MOVE_REJECTED, () => audio.sfx.deny());

  /* ───────────────────────────── public API ──────────────────────────── */

  return {
    animator,
    start,
    stop,
    resize,
    setTheme,
    attach(next) {
      controller = next;
      if (controller) controller.setAnimator(animator);
      dice.setValue(next && next.state.dice ? next.state.dice : 6);
      return this;
    },
    detach() {
      controller = null;
      tokens.clear();
      dice.cancel();
      clearStepSounds();
      fx.clear();
      highlights = new Set();
      targets = [];
    },
    celebrate(colors) {
      fx.confetti({ x: 0, y: 0, w: layout.w, h: layout.h }, colors, 4200);
      dirty = true;
    },
    get layout() {
      return layout;
    },
    get busy() {
      return tokens.isAnimating() || dice.rolling;
    },
  };
}
