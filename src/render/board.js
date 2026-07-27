/**
 * render/board.js — board geometry, themes and the static board painting.
 *
 * DRAWING ONLY. No game logic, no state mutation. This module owns the mapping
 * from an engine position (a plain integer) to a pixel — the engine itself never
 * knows a board exists.
 *
 * The static board is painted once into an offscreen canvas and blitted every
 * frame, so a 60fps loop on a cheap Android only redraws tokens, dice and
 * particles.
 *
 * ── 15x15 LAYOUT ─────────────────────────────────────────────────────────────
 *   bases      6x6 corner blocks (red TL, green TR, yellow BR, blue BL)
 *   arms       rows/cols 6-8, six cells long
 *   ring       52 cells: 13 per quadrant, clockwise, abs 0 = red start (r6,c1)
 *   home cols  the middle line of each arm, 5 cells + the centre finish
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { COLORS, HOME_ENTRY, STAR_ABS, START_ABS, toAbs } from '../engine/state.js';

export const GRID = 15;

/**
 * The 52 ring cells as [row, col], in ABSOLUTE engine order.
 * abs 0 is red's start square; the walk is clockwise.
 */
export const TRACK_CELLS = Object.freeze([
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],                     // 0-4   left arm, top line
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],             // 5-10  top arm, left line
  [0, 7],                                                     // 11    top tip (green home entry)
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],             // 12-17 top arm, right line
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],        // 18-23 right arm, top line
  [7, 14],                                                    // 24    right tip (yellow home entry)
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],        // 25-30 right arm, bottom line
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],        // 31-36 bottom arm, right line
  [14, 7],                                                    // 37    bottom tip (blue home entry)
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],        // 38-43 bottom arm, left line
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],             // 44-49 left arm, bottom line
  [7, 0],                                                     // 50    left tip (red home entry)
  [6, 0],                                                     // 51    corner
]);

/** The five private home-column cells per colour, outermost first. */
export const HOME_CELLS = Object.freeze({
  red: Object.freeze([[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]]),
  green: Object.freeze([[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]]),
  yellow: Object.freeze([[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]]),
  blue: Object.freeze([[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]),
});

/** Base (yard) slots in continuous grid units {x, y}, one per token. */
export const BASE_SLOTS = Object.freeze({
  red: Object.freeze([
    { x: 1.8, y: 1.8 }, { x: 4.2, y: 1.8 }, { x: 1.8, y: 4.2 }, { x: 4.2, y: 4.2 },
  ]),
  green: Object.freeze([
    { x: 10.8, y: 1.8 }, { x: 13.2, y: 1.8 }, { x: 10.8, y: 4.2 }, { x: 13.2, y: 4.2 },
  ]),
  yellow: Object.freeze([
    { x: 10.8, y: 10.8 }, { x: 13.2, y: 10.8 }, { x: 10.8, y: 13.2 }, { x: 13.2, y: 13.2 },
  ]),
  blue: Object.freeze([
    { x: 1.8, y: 10.8 }, { x: 4.2, y: 10.8 }, { x: 1.8, y: 13.2 }, { x: 4.2, y: 13.2 },
  ]),
});

/** Where a finished token parks inside the centre triangle. */
export const FINISH_SPOTS = Object.freeze({
  red: { x: 6.9, y: 7.5 },
  green: { x: 7.5, y: 6.9 },
  yellow: { x: 8.1, y: 7.5 },
  blue: { x: 7.5, y: 8.1 },
});

/** Corner block origin (in cells) for each colour's base. */
const BASE_BLOCKS = Object.freeze({
  red: { r: 0, c: 0 },
  green: { r: 0, c: 9 },
  yellow: { r: 9, c: 9 },
  blue: { r: 9, c: 0 },
});

/** Direction a token travels when it leaves the base, for the start arrow. */
const START_ARROW = Object.freeze({ red: 'right', green: 'down', yellow: 'left', blue: 'up' });

/* ─────────────────────────────────── themes ───────────────────────────────── */

function palette(main, dark, light) {
  return { main, dark, light };
}

export const THEMES = Object.freeze({
  classic: {
    id: 'classic',
    label: 'Classic',
    page: '#12213a',
    pageAlt: '#1b3157',
    board: '#fdfaf1',
    boardEdge: '#e2d5b8',
    frame: '#0d1b30',
    line: '#c9bfa6',
    track: '#ffffff',
    center: '#f4eddc',
    text: '#0d1b30',
    star: '#8b7f63',
    players: {
      red: palette('#e63946', '#a4252f', '#ff8b93'),
      green: palette('#2a9d4a', '#1b6b32', '#7ce095'),
      yellow: palette('#f4b93c', '#b8842a', '#ffe08a'),
      blue: palette('#2f74d0', '#1d4c8c', '#89bdf5'),
    },
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    page: '#070b16',
    pageAlt: '#101a2e',
    board: '#16203a',
    boardEdge: '#0b1226',
    frame: '#04070f',
    line: '#2c3b5e',
    track: '#1e2b4a',
    center: '#243657',
    text: '#e8eeff',
    star: '#7f93c4',
    players: {
      red: palette('#ff5d6c', '#b32b39', '#ffa8b0'),
      green: palette('#3ddc84', '#1f9257', '#9df3c2'),
      yellow: palette('#ffd166', '#c79a2c', '#ffe9ab'),
      blue: palette('#5aa9ff', '#2a63b8', '#a9d3ff'),
    },
  },
  royal: {
    id: 'royal',
    label: 'Royal',
    page: '#1a1030',
    pageAlt: '#2a1a4d',
    board: '#f6f0ff',
    boardEdge: '#d8c8f0',
    frame: '#2a1a4d',
    line: '#cbb9e8',
    track: '#ffffff',
    center: '#efe4ff',
    text: '#2a1a4d',
    star: '#8a6fc0',
    players: {
      red: palette('#d6336c', '#96214b', '#ff8fb5'),
      green: palette('#0ca678', '#077152', '#6ee7c4'),
      yellow: palette('#f59f00', '#b97600', '#ffd67f'),
      blue: palette('#4263eb', '#2b429e', '#9db1ff'),
    },
  },
  candy: {
    id: 'candy',
    label: 'Candy',
    page: '#2b1b2e',
    pageAlt: '#40284a',
    board: '#fff5fa',
    boardEdge: '#f6d9e6',
    frame: '#3b2340',
    line: '#f0cadd',
    track: '#ffffff',
    center: '#ffeaf4',
    text: '#3b2340',
    star: '#c98aa8',
    players: {
      red: palette('#ff4d6d', '#c3234a', '#ffa3b5'),
      green: palette('#43c59e', '#218a6b', '#a7f0da'),
      yellow: palette('#ffc857', '#c9932c', '#ffe6ab'),
      blue: palette('#5f8dff', '#33559f', '#aec6ff'),
    },
  },
});

export const THEME_IDS = Object.freeze(Object.keys(THEMES));

export function getTheme(id) {
  return THEMES[id] || THEMES.classic;
}

export function playerPalette(theme, color) {
  return (theme.players && theme.players[color]) || THEMES.classic.players[color];
}

/* ─────────────────────────────────── layout ───────────────────────────────── */

/**
 * Work out where the board and the dice tray live inside the canvas.
 * Portrait first: the board is a centred square, the dice sits in the strip
 * underneath it.
 *
 * @param {number} w css pixels
 * @param {number} h css pixels
 */
export function computeLayout(w, h) {
  const pad = Math.max(6, Math.min(w, h) * 0.02);
  const trayMin = 74;
  const tray = Math.max(trayMin, Math.min(h * 0.16, 128));
  let size = Math.min(w - pad * 2, h - tray - pad * 2);
  size = Math.max(120, Math.floor(size));
  const cell = size / GRID;
  const x = Math.round((w - size) / 2);
  const y = Math.round(pad);
  const trayY = y + size;
  const trayH = Math.max(trayMin, h - trayY - pad / 2);
  const diceSize = Math.min(Math.max(48, cell * 2.1), trayH * 0.72, 92);
  return {
    w,
    h,
    pad,
    cell,
    board: { x, y, size },
    tray: { x: 0, y: trayY, w, h: trayH },
    dice: {
      size: diceSize,
      x: Math.round(w / 2 - diceSize / 2),
      y: Math.round(trayY + (trayH - diceSize) / 2),
    },
  };
}

/** Top-left pixel of a grid cell. */
export function cellRect(layout, row, col) {
  const { board, cell } = layout;
  return { x: board.x + col * cell, y: board.y + row * cell, w: cell, h: cell };
}

/** Centre pixel of a grid cell. */
export function cellCenter(layout, row, col) {
  const { board, cell } = layout;
  return { x: board.x + (col + 0.5) * cell, y: board.y + (row + 0.5) * cell };
}

/** Pixel for a continuous grid coordinate ({x,y} in cell units). */
export function gridPoint(layout, gx, gy) {
  const { board, cell } = layout;
  return { x: board.x + gx * cell, y: board.y + gy * cell };
}

/**
 * Pixel position of a token.
 * @param {object} layout
 * @param {string} color
 * @param {number} rel   engine position (-1 base, 0..50 ring, 51..56 home)
 * @param {number} tokenIndex used for base slots
 */
export function positionPoint(layout, color, rel, tokenIndex = 0) {
  if (rel < 0) {
    const slot = BASE_SLOTS[color][tokenIndex % 4];
    return gridPoint(layout, slot.x, slot.y);
  }
  if (rel <= HOME_ENTRY) {
    const [r, c] = TRACK_CELLS[toAbs(color, rel)];
    return cellCenter(layout, r, c);
  }
  if (rel < HOME_ENTRY + 6) {
    const [r, c] = HOME_CELLS[color][rel - HOME_ENTRY - 1];
    return cellCenter(layout, r, c);
  }
  const spot = FINISH_SPOTS[color];
  return gridPoint(layout, spot.x, spot.y);
}

/** Which grid cell is under a pixel? null when outside the board. */
export function hitCell(layout, px, py) {
  const { board, cell } = layout;
  const col = Math.floor((px - board.x) / cell);
  const row = Math.floor((py - board.y) / cell);
  if (row < 0 || col < 0 || row >= GRID || col >= GRID) return null;
  return { row, col };
}

/** Is a pixel inside the dice tray hit area (generously padded for thumbs)? */
export function hitDice(layout, px, py) {
  const d = layout.dice;
  const grow = d.size * 0.45;
  return (
    px >= d.x - grow && px <= d.x + d.size + grow && py >= d.y - grow && py <= d.y + d.size + grow
  );
}

/* ──────────────────────────────── static board ────────────────────────────── */

/**
 * Paint the whole immutable board: bases, ring, home columns, centre, stars.
 * Call it into a cached offscreen canvas whenever the size or theme changes.
 */
export function drawBoard(ctx, layout, theme) {
  const { board, cell } = layout;
  const t = theme;

  ctx.save();
  ctx.clearRect(0, 0, layout.w, layout.h);

  // board plate
  const r = Math.max(8, cell * 0.5);
  roundRect(ctx, board.x - cell * 0.28, board.y - cell * 0.28, board.size + cell * 0.56, board.size + cell * 0.56, r);
  const g = ctx.createLinearGradient(board.x, board.y, board.x + board.size, board.y + board.size);
  g.addColorStop(0, t.board);
  g.addColorStop(1, t.boardEdge);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(2, cell * 0.16);
  ctx.strokeStyle = t.frame;
  ctx.stroke();

  drawBases(ctx, layout, t);
  drawRing(ctx, layout, t);
  drawHomeColumns(ctx, layout, t);
  drawCenter(ctx, layout, t);
  ctx.restore();
}

function drawBases(ctx, layout, t) {
  const { cell } = layout;
  for (const color of COLORS) {
    const blk = BASE_BLOCKS[color];
    const p = playerPalette(t, color);
    const o = gridPoint(layout, blk.c, blk.r);
    const size = cell * 6;

    // outer coloured block
    roundRect(ctx, o.x, o.y, size, size, cell * 0.55);
    const g = ctx.createLinearGradient(o.x, o.y, o.x + size, o.y + size);
    g.addColorStop(0, p.light);
    g.addColorStop(0.45, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, cell * 0.08);
    ctx.strokeStyle = t.frame;
    ctx.stroke();

    // inner yard
    const inset = cell * 0.95;
    roundRect(ctx, o.x + inset, o.y + inset, size - inset * 2, size - inset * 2, cell * 0.42);
    ctx.fillStyle = t.board;
    ctx.fill();
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.strokeStyle = p.dark;
    ctx.stroke();

    // four parking rings
    for (const slot of BASE_SLOTS[color]) {
      const c = gridPoint(layout, slot.x, slot.y);
      ctx.beginPath();
      ctx.arc(c.x, c.y, cell * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(p.main, 0.16);
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.strokeStyle = withAlpha(p.dark, 0.55);
      ctx.stroke();
    }
  }
}

function drawRing(ctx, layout, t) {
  const { cell } = layout;
  const startAbs = new Map(COLORS.map((c) => [START_ABS[c], c]));
  // Each star sits in one arm; tint it with that arm's colour.
  const ARM_OWNER = ['green', 'yellow', 'blue', 'red'];
  const starArm = {};
  STAR_ABS.forEach((abs, i) => {
    starArm[abs] = ARM_OWNER[i];
  });

  for (let abs = 0; abs < TRACK_CELLS.length; abs++) {
    const [row, col] = TRACK_CELLS[abs];
    const rect = cellRect(layout, row, col);
    const owner = startAbs.get(abs);

    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    if (owner) {
      const p = playerPalette(t, owner);
      const g = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      g.addColorStop(0, p.light);
      g.addColorStop(1, p.main);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = t.track;
    }
    ctx.fill();
    ctx.lineWidth = Math.max(1, cell * 0.045);
    ctx.strokeStyle = t.line;
    ctx.stroke();

    if (owner) drawArrow(ctx, rect, START_ARROW[owner], t.board, cell);
    else if (starArm[abs]) drawStar(ctx, rect, playerPalette(t, starArm[abs]).main, cell);
  }
}

function drawHomeColumns(ctx, layout, t) {
  const { cell } = layout;
  for (const color of COLORS) {
    const p = playerPalette(t, color);
    for (const [row, col] of HOME_CELLS[color]) {
      const rect = cellRect(layout, row, col);
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      const g = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
      g.addColorStop(0, p.light);
      g.addColorStop(1, p.main);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.045);
      ctx.strokeStyle = withAlpha(p.dark, 0.6);
      ctx.stroke();
    }
  }
}

function drawCenter(ctx, layout, t) {
  const { cell } = layout;
  const o = gridPoint(layout, 6, 6);
  const size = cell * 3;
  const cx = o.x + size / 2;
  const cy = o.y + size / 2;

  ctx.beginPath();
  ctx.rect(o.x, o.y, size, size);
  ctx.fillStyle = t.center;
  ctx.fill();

  // four triangles pointing at the centre, one per colour
  const corners = {
    red: [[o.x, o.y], [o.x, o.y + size]],
    green: [[o.x, o.y], [o.x + size, o.y]],
    yellow: [[o.x + size, o.y], [o.x + size, o.y + size]],
    blue: [[o.x, o.y + size], [o.x + size, o.y + size]],
  };
  for (const color of COLORS) {
    const [a, b] = corners[color];
    const p = playerPalette(t, color);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(a[0], a[1], cx, cy);
    g.addColorStop(0, p.main);
    g.addColorStop(1, p.light);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, cell * 0.04);
    ctx.strokeStyle = withAlpha(t.frame, 0.5);
    ctx.stroke();
  }

  // crown-ish centre badge
  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = t.board;
  ctx.fill();
  ctx.lineWidth = Math.max(1, cell * 0.06);
  ctx.strokeStyle = t.frame;
  ctx.stroke();
  drawStar(ctx, { x: cx - cell * 0.4, y: cy - cell * 0.4, w: cell * 0.8, h: cell * 0.8 }, t.star, cell);

  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.strokeStyle = t.line;
  ctx.strokeRect(o.x, o.y, size, size);
}

/* ───────────────────────────────── primitives ─────────────────────────────── */

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawArrow(ctx, rect, dir, color, cell) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const s = rect.w * 0.3;
  const pts =
    dir === 'right'
      ? [[-s, -s], [s * 0.9, 0], [-s, s]]
      : dir === 'left'
        ? [[s, -s], [-s * 0.9, 0], [s, s]]
        : dir === 'down'
          ? [[-s, -s], [0, s * 0.9], [s, -s]]
          : [[-s, s], [0, -s * 0.9], [s, s]];
  ctx.beginPath();
  ctx.moveTo(cx + pts[0][0], cy + pts[0][1]);
  ctx.lineTo(cx + pts[1][0], cy + pts[1][1]);
  ctx.lineTo(cx + pts[2][0], cy + pts[2][1]);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, 0.9);
  ctx.fill();
  ctx.lineWidth = Math.max(1, cell * 0.03);
  ctx.strokeStyle = withAlpha('#000000', 0.15);
  ctx.stroke();
}

export function drawStar(ctx, rect, color, cell, points = 5) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const outer = rect.w * 0.42;
  const inner = outer * 0.46;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, 0.85);
  ctx.fill();
  ctx.lineWidth = Math.max(1, cell * 0.035);
  ctx.strokeStyle = withAlpha('#000000', 0.2);
  ctx.stroke();
}

/** #rrggbb + alpha → rgba(). Accepts rgba() strings untouched. */
export function withAlpha(hex, alpha) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/* ──────────────────────────────── board cache ─────────────────────────────── */

/**
 * Offscreen cache for the static board. `ensure()` repaints only when the
 * size or the theme actually changed.
 */
export function createBoardCache(createCanvas) {
  let canvas = null;
  let ctx = null;
  let key = '';

  const make =
    createCanvas ||
    ((w, h) => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
      const el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      return el;
    });

  return {
    /** @returns {object} the cached canvas, ready to blit */
    ensure(layout, theme, dpr) {
      const w = Math.max(1, Math.ceil(layout.w * dpr));
      const h = Math.max(1, Math.ceil(layout.h * dpr));
      const k = w + 'x' + h + ':' + theme.id;
      if (canvas && key === k) return canvas;
      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = make(w, h);
        canvas.width = w;
        canvas.height = h;
        ctx = canvas.getContext('2d');
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, layout.w, layout.h);
      drawBoard(ctx, layout, theme);
      key = k;
      return canvas;
    },
    invalidate() {
      key = '';
    },
    get canvas() {
      return canvas;
    },
  };
}
