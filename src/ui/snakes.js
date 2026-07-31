/**
 * ui/snakes.js — the Snakes & Ladders screen.
 *
 * Owns the canvas, the pawn animation and the dice button, and nothing else: the
 * rules live in engine/snakes.js and the turn loop in game/snakeGame.js.
 */

import { LAST_CELL, SEV, createSnakeState } from '../engine/snakes.js';
import { SNAKE_EVENTS, createSnakeController } from '../game/snakeGame.js';
import { EVENTS } from '../game/events.js';
import { cellCenter, drawSnakeBoard, snakeLayout } from '../render/snakeboard.js';
import { drawDiceFace } from '../render/skins.js';
import { getTheme, playerPalette } from '../render/board.js';
import { h, mount } from './dom.js';

const DPR_CAP = 2;

/**
 * @param {object} o { el, bus, i18n, audio, prefs, catalog, onExit }
 */
export function createSnakeScreen(o) {
  const { el, bus, i18n, audio, prefs, catalog } = o;
  const t = (k, v) => i18n.t(k, v);
  const canvas = el.querySelector('[data-snake="canvas"]');
  const diceCanvas = el.querySelector('[data-snake="dice"]');
  const bannerEl = el.querySelector('[data-snake="banner"]');
  const seatsEl = el.querySelector('[data-snake="seats"]');

  let controller = null;
  let layout = { x: 0, y: 0, size: 100, cell: 10 };
  let raf = 0;
  let visible = false;
  /** Pawn positions while walking: id → fractional cell. */
  let anim = {};
  let diceValue = 1;
  let diceSpin = 0;

  /* ─────────────────────────────── painting ───────────────────────────── */

  function ctx2d(node) {
    return node && node.getContext ? node.getContext('2d') : null;
  }

  function sizeCanvas(node) {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const dpr = Math.min(DPR_CAP, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const w = Math.max(80, Math.round(rect.width || 320));
    const hh = Math.max(80, Math.round(rect.height || 320));
    node.width = Math.round(w * dpr);
    node.height = Math.round(hh * dpr);
    return { w, h: hh, dpr };
  }

  function resize() {
    const box = sizeCanvas(canvas);
    if (!box) return;
    layout = snakeLayout(box.w, box.h, Math.max(8, box.w * 0.03));
    paint();
    paintDice();
  }

  function paint() {
    const ctx = ctx2d(canvas);
    if (!ctx || !controller) return;
    const dpr = Math.min(DPR_CAP, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    drawSnakeBoard(ctx, {
      state: controller.state,
      layout,
      themeId: prefs.get('theme'),
      positions: anim,
    });
  }

  function paintDice() {
    const ctx = ctx2d(diceCanvas);
    if (!ctx) return;
    const box = sizeCanvas(diceCanvas);
    if (!box) return;
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const size = Math.min(box.w, box.h) * 0.92;
    ctx.save();
    ctx.translate(box.w / 2, box.h / 2);
    if (diceSpin > 0) ctx.rotate(diceSpin);
    ctx.translate(-size / 2, -size / 2);
    const art = catalog ? catalog.equippedItem('dice').art : {};
    drawDiceFace(ctx, size, diceValue, art || {});
    ctx.restore();
  }

  function loop() {
    if (!visible) return;
    paint();
    if (diceSpin > 0) paintDice();
    raf = requestAnimationFrame(loop);
  }

  /* ────────────────────────────── animation ───────────────────────────── */

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /** Move a pawn cell by cell, so you can count the squares like a real board. */
  function walk(ev) {
    const steps = Math.abs(ev.to - ev.from);
    if (steps === 0) return Promise.resolve();
    const per = Math.max(40, controller.timing.hop);
    return new Promise((resolve) => {
      const startAt = Date.now();
      const total = per * steps;
      const tick = () => {
        const p = Math.min(1, (Date.now() - startAt) / total);
        anim[ev.seat] = ev.from + (ev.to - ev.from) * p;
        if (p >= 1) {
          delete anim[ev.seat];
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
      audio.sfx.step();
    });
  }

  /** Slide down a snake or climb a ladder: one smooth eased hop. */
  function jump(ev) {
    const total = Math.max(120, controller.timing.jump);
    if (ev.type === SEV.CLIMBED) audio.sfx.six();
    else audio.sfx.capture();
    return new Promise((resolve) => {
      const startAt = Date.now();
      const tick = () => {
        const p = Math.min(1, (Date.now() - startAt) / total);
        anim[ev.seat] = ev.from + (ev.to - ev.from) * ease(p);
        if (p >= 1) {
          delete anim[ev.seat];
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function rollAnim(value) {
    const total = Math.max(160, controller.timing.diceRoll);
    audio.sfx.dice();
    return new Promise((resolve) => {
      const startAt = Date.now();
      const tick = () => {
        const p = Math.min(1, (Date.now() - startAt) / total);
        diceSpin = (1 - p) * Math.PI * 4;
        diceValue = p < 1 ? 1 + Math.floor(Math.random() * 6) : value;
        paintDice();
        if (p >= 1) {
          diceSpin = 0;
          paintDice();
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /* ──────────────────────────────── chrome ────────────────────────────── */

  function renderSeats() {
    if (!controller) return;
    const theme = getTheme(prefs.get('theme'));
    mount(
      seatsEl,
      ...controller.state.players.map((p) =>
        h(
          'div.snake-seat',
          {
            class: { 'is-turn': p.id === controller.state.turn && p.rank === 0, 'is-done': p.rank > 0 },
            dataset: { seat: String(p.id) },
            style: { '--seat': playerPalette(theme, p.color).main },
          },
          h('i.snake-dot'),
          h('b.snake-seat-name', { text: p.name }),
          h('span.snake-seat-cell', { text: p.rank > 0 ? '#' + p.rank : String(p.cell) })
        )
      )
    );
  }

  function banner(text) {
    if (bannerEl) bannerEl.textContent = text;
  }

  /* ───────────────────────────── subscriptions ────────────────────────── */

  bus.on(SNAKE_EVENTS.TURN, (p) => {
    renderSeats();
    banner(p.bot ? t('game.thinking', { name: p.player.name }) : t('game.yourTurn', { name: p.player.name }));
  });
  bus.on(SNAKE_EVENTS.STATE, () => renderSeats());
  bus.on(SEV.CLIMBED, (ev) => {
    bus.emit(EVENTS.TOAST, { key: 'snake.climb', vars: { cell: ev.to }, kind: 'good' });
  });
  bus.on(SEV.BITTEN, (ev) => {
    bus.emit(EVENTS.TOAST, { key: 'snake.bite', vars: { cell: ev.to }, kind: 'warn' });
  });
  bus.on(SNAKE_EVENTS.ENDED, (ev) => {
    renderSeats();
    banner(t('snake.win', { name: ev.winnerName }));
    audio.sfx.win();
  });

  /* ─────────────────────────────── controls ───────────────────────────── */

  el.querySelector('[data-snake="rollbtn"]').addEventListener('click', () => {
    audio.unlock();
    if (!controller || !controller.canRoll()) return;
    controller.roll();
  });

  el.querySelector('[data-snake="exit"]').addEventListener('click', () => {
    audio.sfx.tap();
    if (o.onExit) o.onExit();
  });

  /* ──────────────────────────────── session ───────────────────────────── */

  /**
   * @param {object} setup { count, humanColor, names, botLevel, options }
   */
  function start(setup = {}) {
    stop();
    const count = Math.max(2, Math.min(4, setup.count || 2));
    const colors = ['red', 'green', 'yellow', 'blue'].slice(0, count);
    const humanColor = colors.includes(setup.humanColor) ? setup.humanColor : colors[0];
    const names = setup.names || {};

    const state = createSnakeState({
      players: colors.map((color) => ({
        color,
        name: (names[color] || '').trim() || (color === humanColor ? t('common.you') : t('common.bot') + ' ' + color),
        type: color === humanColor ? 'human' : 'bot',
        botLevel: setup.botLevel || 'hard',
      })),
      options: setup.options,
    });

    controller = createSnakeController({ state, bus, timing: setup.timing });
    controller.setSpeed(prefs.get('speed'));
    controller.setAnimator({ roll: rollAnim, walk, jump });
    anim = {};
    diceValue = 1;
    renderSeats();
    resize();
    visible = true;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    controller.start();
    return controller;
  }

  function stop() {
    visible = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (controller) controller.destroy();
    controller = null;
    anim = {};
  }

  return {
    start,
    stop,
    resize,
    renderSeats,
    get controller() {
      return controller;
    },
    get layout() {
      return layout;
    },
    /** Pixel centre of a cell — used by tests to tap the board. */
    centerOf(cell) {
      return cellCenter(layout, Math.max(1, Math.min(LAST_CELL, cell)));
    },
    pause() {
      if (controller) controller.pause();
    },
    resumeGame() {
      if (controller) controller.resume();
    },
  };
}
