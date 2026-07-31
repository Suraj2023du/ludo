/**
 * render/snakeboard.js — the Snakes & Ladders board, drawn entirely in code.
 *
 * No images: the grid, the numbers, every ladder and every snake are procedural,
 * so the whole second game costs a few KB and scales to any screen. Pure drawing
 * — it reads a state and paints, and owns nothing.
 */

import { BOARD_SIZE, LAST_CELL, allJumps, cellToGrid } from '../engine/snakes.js';
import { getTheme, playerPalette } from './board.js';

/**
 * Work out the pixel geometry for a square board inside a viewport.
 * @returns {{x:number, y:number, size:number, cell:number}}
 */
export function snakeLayout(width, height, pad = 10) {
  const size = Math.max(80, Math.min(width, height) - pad * 2);
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    size,
    cell: size / BOARD_SIZE,
  };
}

/** Centre of a cell in pixels. Row 0 is the BOTTOM row. */
export function cellCenter(layout, cell) {
  const { col, row } = cellToGrid(cell);
  return {
    x: layout.x + (col + 0.5) * layout.cell,
    y: layout.y + layout.size - (row + 0.5) * layout.cell,
  };
}

/** Six friendly cell tints, cycled so no two neighbours match. */
const TINTS = ['#f7d76a', '#8fd6a0', '#8fc4ee', '#f3a8a8', '#c9b3f0', '#f6c48a'];

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/* ─────────────────────────────── the grid ──────────────────────────────── */

export function drawSnakeGrid(ctx, layout, themeId = 'classic') {
  const theme = getTheme(themeId);
  const { x, y, size, cell } = layout;

  ctx.save();
  // frame
  ctx.fillStyle = theme.pageAlt;
  roundRect(ctx, x - cell * 0.22, y - cell * 0.22, size + cell * 0.44, size + cell * 0.44, cell * 0.35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.stroke();

  const fontSize = Math.max(7, Math.round(cell * 0.26));
  ctx.font = '600 ' + fontSize + 'px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let n = 1; n <= LAST_CELL; n++) {
    const { col, row } = cellToGrid(n);
    const cx = x + col * cell;
    const cy = y + size - (row + 1) * cell;
    ctx.fillStyle = TINTS[(col + row * 3) % TINTS.length];
    ctx.globalAlpha = 0.92;
    roundRect(ctx, cx + cell * 0.03, cy + cell * 0.03, cell * 0.94, cell * 0.94, cell * 0.16);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(24,28,40,0.72)';
    ctx.fillText(String(n), cx + cell * 0.12, cy + cell * 0.1);
  }

  // the finish square gets a crown of colour
  const finish = cellCenter(layout, LAST_CELL);
  ctx.fillStyle = 'rgba(244,185,60,0.9)';
  roundRect(ctx, finish.x - cell * 0.47, finish.y - cell * 0.47, cell * 0.94, cell * 0.94, cell * 0.16);
  ctx.fill();
  ctx.fillStyle = '#5a3b04';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 ' + Math.round(cell * 0.3) + 'px system-ui, sans-serif';
  ctx.fillText('100', finish.x, finish.y);
  ctx.restore();
}

/* ─────────────────────────────── ladders ──────────────────────────────── */

export function drawLadder(ctx, layout, from, to) {
  const a = cellCenter(layout, from);
  const b = cellCenter(layout, to);
  const cell = layout.cell;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // unit normal, for the two rails
  const nx = (-dy / len) * cell * 0.17;
  const ny = (dx / len) * cell * 0.17;

  ctx.save();
  ctx.lineCap = 'round';

  // rails
  ctx.strokeStyle = '#b5762f';
  ctx.lineWidth = Math.max(1.6, cell * 0.075);
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(a.x + nx * s, a.y + ny * s);
    ctx.lineTo(b.x + nx * s, b.y + ny * s);
    ctx.stroke();
  }

  // rungs
  const rungs = Math.max(2, Math.round(len / (cell * 0.44)));
  ctx.strokeStyle = '#e0a253';
  ctx.lineWidth = Math.max(1.2, cell * 0.055);
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    ctx.beginPath();
    ctx.moveTo(px + nx, py + ny);
    ctx.lineTo(px - nx, py - ny);
    ctx.stroke();
  }
  ctx.restore();
}

/* ──────────────────────────────── snakes ──────────────────────────────── */

/** Snake bodies are tapered beziers so they read as snakes, not as lines. */
export function drawSnake(ctx, layout, from, to, hue = 140) {
  const head = cellCenter(layout, from);
  const tail = cellCenter(layout, to);
  const cell = layout.cell;
  const dx = tail.x - head.x;
  const dy = tail.y - head.y;
  const len = Math.hypot(dx, dy) || 1;
  const wave = Math.min(cell * 1.5, len * 0.28);
  const nx = (-dy / len) * wave;
  const ny = (dx / len) * wave;

  const c1 = { x: head.x + dx * 0.3 + nx, y: head.y + dy * 0.3 + ny };
  const c2 = { x: head.x + dx * 0.7 - nx, y: head.y + dy * 0.7 - ny };

  const point = (t) => {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * head.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * tail.x,
      y: mt * mt * mt * head.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * tail.y,
    };
  };

  ctx.save();
  ctx.lineCap = 'round';
  // body, drawn as tapering segments (thick at the head, thin at the tail)
  const steps = 26;
  let prev = point(0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = point(t);
    ctx.strokeStyle = 'hsl(' + hue + ' 52% ' + Math.round(34 + t * 22) + '%)';
    ctx.lineWidth = Math.max(1.4, cell * (0.34 - t * 0.2));
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    prev = p;
  }

  // belly stripes
  ctx.fillStyle = 'hsl(' + hue + ' 62% 74%)';
  for (let i = 2; i < steps - 2; i += 4) {
    const p = point(i / steps);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.8, cell * 0.055), 0, Math.PI * 2);
    ctx.fill();
  }

  // head
  const dir = point(0.06);
  const angle = Math.atan2(dir.y - head.y, dir.x - head.x);
  ctx.translate(head.x, head.y);
  ctx.rotate(angle);
  const r = cell * 0.24;
  ctx.fillStyle = 'hsl(' + hue + ' 55% 30%)';
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.25, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.arc(-r * 0.25, s * r * 0.4, Math.max(0.9, r * 0.26), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#111';
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.arc(-r * 0.2, s * r * 0.4, Math.max(0.5, r * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  // tongue
  ctx.strokeStyle = '#e8464f';
  ctx.lineWidth = Math.max(0.8, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(-r * 1.2, 0);
  ctx.lineTo(-r * 1.9, 0);
  ctx.stroke();
  ctx.restore();
}

/** Every jump on the board, snakes on top of ladders. */
export function drawJumps(ctx, layout) {
  const jumps = allJumps();
  for (const j of jumps) {
    if (j.kind === 'ladder') drawLadder(ctx, layout, j.from, j.to);
  }
  let hue = 96;
  for (const j of jumps) {
    if (j.kind !== 'snake') continue;
    drawSnake(ctx, layout, j.from, j.to, hue);
    hue = (hue + 47) % 360;
  }
}

/* ──────────────────────────────── tokens ──────────────────────────────── */

/**
 * Draw the pawns. Players sharing a cell are fanned out so all of them stay
 * visible, and `positions` can override a cell mid-animation.
 * @param {object} o { state, layout, themeId, positions }
 */
export function drawSnakeTokens(ctx, o) {
  const { state, layout } = o;
  const theme = getTheme(o.themeId || 'classic');
  const cell = layout.cell;
  const positions = o.positions || {};

  // group by the cell each pawn is drawn on
  const groups = new Map();
  state.players.forEach((p) => {
    const at = positions[p.id] !== undefined ? positions[p.id] : p.cell;
    const key = String(Math.round(at * 100) / 100);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ player: p, at });
  });

  for (const [, list] of groups) {
    list.forEach((entry, i) => {
      const { player, at } = entry;
      const pal = playerPalette(theme, player.color);
      const spread = list.length > 1 ? (i - (list.length - 1) / 2) * cell * 0.26 : 0;

      let cx;
      let cy;
      if (at < 1) {
        // waiting off the board, in a row under the bottom-left corner
        cx = layout.x + cell * (0.5 + player.id * 0.42);
        cy = layout.y + layout.size + cell * 0.55;
      } else {
        const c = cellCenter(layout, at);
        cx = c.x + spread;
        cy = c.y - cell * 0.06;
      }

      const r = cell * 0.26;
      ctx.save();
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.85, r * 0.8, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();

      // pawn body
      const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      grad.addColorStop(0, pal.light);
      grad.addColorStop(1, pal.dark);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.72, cy + r * 0.7);
      ctx.quadraticCurveTo(cx - r * 0.2, cy + r * 0.2, cx - r * 0.34, cy - r * 0.1);
      ctx.arc(cx, cy - r * 0.42, r * 0.5, Math.PI * 0.85, Math.PI * 0.15);
      ctx.quadraticCurveTo(cx + r * 0.2, cy + r * 0.2, cx + r * 0.72, cy + r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(0.6, r * 0.1);
      ctx.stroke();

      if (player.rank === 1) {
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath();
        ctx.arc(cx, cy - r * 1.05, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }
}

/** One call that paints the whole board. */
export function drawSnakeBoard(ctx, o) {
  drawSnakeGrid(ctx, o.layout, o.themeId);
  drawJumps(ctx, o.layout);
  drawSnakeTokens(ctx, o);
}
