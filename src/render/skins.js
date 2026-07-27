/**
 * render/skins.js — painters for every cosmetic recipe from meta/catalog.js.
 *
 * DRAWING ONLY. Each function takes the item's `art` object, so a skin is data
 * plus a shared painter — no images anywhere.
 */

import { roundRect, withAlpha } from './board.js';

/* ─────────────────────────────── dice ──────────────────────────────── */

const PIPS = {
  1: [[0, 0]],
  2: [[-0.45, -0.45], [0.45, 0.45]],
  3: [[-0.45, -0.45], [0, 0], [0.45, 0.45]],
  4: [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]],
  5: [[-0.45, -0.45], [0.45, -0.45], [0, 0], [-0.45, 0.45], [0.45, 0.45]],
  6: [[-0.45, -0.5], [0.45, -0.5], [-0.45, 0], [0.45, 0], [-0.45, 0.5], [0.45, 0.5]],
};

/**
 * Draw a die face centred on (0,0) in the current transform.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size edge length
 * @param {number} value 1..6
 * @param {object} art catalog dice recipe
 * @param {object} [opts] { accent } accent tints the border with the player colour
 */
export function drawDiceFace(ctx, size, value, art = {}, opts = {}) {
  const half = size / 2;
  const body = art.body || ['#ffffff', '#d8dbe2'];
  const pip = art.pip || '#1b2436';
  const style = art.style || 'dots';

  if (art.glow) {
    ctx.save();
    ctx.shadowColor = art.glow;
    ctx.shadowBlur = size * 0.35;
  }
  roundRect(ctx, -half, -half, size, size, size * 0.22);
  const g = ctx.createLinearGradient(-half, -half, half, half);
  g.addColorStop(0, body[0]);
  g.addColorStop(1, body[1]);
  ctx.fillStyle = g;
  ctx.fill();
  if (art.glow) ctx.restore();

  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.strokeStyle = opts.accent ? withAlpha(opts.accent, 0.9) : withAlpha(pip, 0.5);
  ctx.stroke();

  // face-specific decoration
  if (style === 'wood') {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, -half, -half, size, size, size * 0.22);
    ctx.clip();
    ctx.strokeStyle = withAlpha(pip, 0.18);
    ctx.lineWidth = Math.max(1, size * 0.02);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-half, (i * size) / 7 + Math.sin(i) * size * 0.03);
      ctx.lineTo(half, (i * size) / 7 - Math.sin(i) * size * 0.03);
      ctx.stroke();
    }
    ctx.restore();
  } else if (style === 'metal') {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, -half, -half, size, size, size * 0.22);
    ctx.clip();
    const sh = ctx.createLinearGradient(-half, half, half, -half);
    sh.addColorStop(0, withAlpha('#ffffff', 0));
    sh.addColorStop(0.5, withAlpha('#ffffff', 0.35));
    sh.addColorStop(1, withAlpha('#ffffff', 0));
    ctx.fillStyle = sh;
    ctx.fillRect(-half, -half, size, size);
    ctx.restore();
  }
  if (art.seam) {
    ctx.beginPath();
    ctx.arc(0, 0, half * 0.86, -0.5, 0.5);
    ctx.strokeStyle = withAlpha('#ffffff', 0.5);
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.stroke();
  }

  if (style === 'numeral') {
    ctx.fillStyle = pip;
    ctx.font = '800 ' + Math.round(size * 0.56) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), 0, size * 0.04);
    return;
  }

  const pr = size * (style === 'gem' ? 0.1 : 0.085);
  for (const [ux, uy] of PIPS[value] || PIPS[1]) {
    const x = ux * half * 0.78;
    const y = uy * half * 0.78;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, Math.PI * 2);
    ctx.fillStyle = pip;
    ctx.fill();
    if (style === 'gem') {
      ctx.beginPath();
      ctx.arc(x - pr * 0.3, y - pr * 0.3, pr * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#ffffff', 0.75);
      ctx.fill();
    }
  }
}

/* ─────────────────────────────── tokens ─────────────────────────────── */

/**
 * Draw one token centred at (x, y).
 * @param {object} p player palette { main, dark, light }
 * @param {object} art catalog token recipe
 */
export function drawTokenShape(ctx, x, y, r, p, art = {}, opts = {}) {
  const shape = art.shape || 'pawn';
  const accent = art.accent || '#ffffff';

  // shared soft shadow (the board layer draws its own lift-aware one)
  if (opts.shadow !== false) {
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.85, r * 0.76, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fill();
  }

  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.15, x, y, r * 1.15);
  body.addColorStop(0, p.light);
  body.addColorStop(0.55, p.main);
  body.addColorStop(1, p.dark);

  if (shape === 'ball' || shape === 'gulal') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.strokeStyle = withAlpha('#000000', 0.3);
    ctx.stroke();
    if (shape === 'gulal') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42, r * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(accent, 0.85);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.ellipse(x - r * 0.3, y - r * 0.36, r * 0.26, r * 0.16, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#ffffff', 0.7);
      ctx.fill();
    }
    if (art.thread) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.02, Math.PI * 0.15, Math.PI * 0.85);
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.stroke();
    }
    return;
  }

  if (shape === 'kite') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.2);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.85, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.85, 0);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = withAlpha('#000000', 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.moveTo(-r * 0.85, 0);
    ctx.lineTo(r * 0.85, 0);
    ctx.strokeStyle = withAlpha(accent, 0.8);
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (shape === 'diya') {
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.25, r, r * 0.55, 0, Math.PI, 0);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = withAlpha('#000000', 0.3);
    ctx.stroke();
    // flame
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.95);
    ctx.quadraticCurveTo(x + r * 0.36, y - r * 0.2, x, y - r * 0.05);
    ctx.quadraticCurveTo(x - r * 0.36, y - r * 0.2, x, y - r * 0.95);
    const f = ctx.createLinearGradient(x, y - r, x, y);
    f.addColorStop(0, '#fff3b0');
    f.addColorStop(1, accent);
    ctx.fillStyle = f;
    ctx.fill();
    return;
  }

  if (shape === 'bird') {
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.1, r * 0.9, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = withAlpha('#000000', 0.3);
    ctx.stroke();
    for (const dx of [-0.28, 0.28]) {
      ctx.beginPath();
      ctx.arc(x + r * dx, y - r * 0.18, r * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + r * dx, y - r * 0.18, r * 0.07, 0, Math.PI * 2);
      ctx.fillStyle = '#22252b';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x - r * 0.16, y + r * 0.16);
    ctx.lineTo(x + r * 0.16, y + r * 0.16);
    ctx.lineTo(x, y + r * 0.42);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.fill();
    return;
  }

  if (shape === 'wicket') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = withAlpha('#000000', 0.3);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(accent, 0.95);
    ctx.lineWidth = Math.max(1, r * 0.13);
    for (const dx of [-0.32, 0, 0.32]) {
      ctx.beginPath();
      ctx.moveTo(x + r * dx, y - r * 0.5);
      ctx.lineTo(x + r * dx, y + r * 0.5);
      ctx.stroke();
    }
    return;
  }

  // pawn (default) and crown
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.16);
  ctx.strokeStyle = withAlpha('#000000', 0.35);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y - r * 0.06, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha('#ffffff', 0.55);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.42, r * 0.26, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha('#ffffff', 0.75);
  ctx.fill();

  if (shape === 'crown') {
    if (art.glow) {
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = r * 1.2;
    }
    ctx.beginPath();
    ctx.moveTo(x - r * 0.62, y - r * 0.5);
    ctx.lineTo(x - r * 0.3, y - r * 1.05);
    ctx.lineTo(x, y - r * 0.55);
    ctx.lineTo(x + r * 0.3, y - r * 1.05);
    ctx.lineTo(x + r * 0.62, y - r * 0.5);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.strokeStyle = withAlpha('#000000', 0.4);
    ctx.stroke();
    if (art.glow) ctx.restore();
  }
}

/* ──────────────────────────── avatar frames ─────────────────────────── */

/**
 * Draw an avatar frame ring around (cx, cy) with radius r.
 * @param {object} art catalog frame recipe
 */
export function drawFrameRing(ctx, cx, cy, r, art = {}, t = 0) {
  const ring = art.ring || ['#ffffff', '#c8d2e4'];
  const width = (art.width || 0.11) * r * 2;

  if (art.glow) {
    ctx.save();
    ctx.shadowColor = ring[0];
    ctx.shadowBlur = r * 0.55;
  }
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, ring[0]);
  g.addColorStop(1, ring[1]);
  ctx.beginPath();
  ctx.arc(cx, cy, r + width * 0.15, 0, Math.PI * 2);
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.stroke();
  if (art.glow) ctx.restore();

  const orn = art.ornament || 'none';
  if (orn === 'none') return;

  const count = orn === 'crown' ? 1 : orn === 'bat' ? 2 : orn === 'diya' ? 3 : 5;
  const spin = orn === 'star' ? t / 2600 : 0;
  for (let i = 0; i < count; i++) {
    const a = orn === 'crown' ? -Math.PI / 2 : -Math.PI / 2 + (i / count) * Math.PI * 2 + spin;
    const px = cx + Math.cos(a) * (r + width * 0.1);
    const py = cy + Math.sin(a) * (r + width * 0.1);
    const s = r * (orn === 'crown' ? 0.42 : 0.26);
    ctx.save();
    ctx.translate(px, py);
    if (orn === 'lotus' || orn === 'wave') {
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.5, s * 0.22, (k / 4) * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(k % 2 ? ring[1] : '#ffffff', 0.9);
        ctx.fill();
      }
    } else if (orn === 'bell' || orn === 'diya') {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = orn === 'bell' ? '#ffd24a' : '#ff9f1c';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.34, s * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#000000', 0.35);
      ctx.fill();
    } else if (orn === 'bat') {
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = '#d9a862';
      ctx.fillRect(-s * 0.1, -s * 0.55, s * 0.2, s * 1.1);
      ctx.beginPath();
      ctx.arc(0, s * 0.62, s * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = '#e63946';
      ctx.fill();
    } else if (orn === 'crown') {
      ctx.beginPath();
      ctx.moveTo(-s, s * 0.35);
      ctx.lineTo(-s * 0.5, -s * 0.5);
      ctx.lineTo(0, s * 0.1);
      ctx.lineTo(s * 0.5, -s * 0.5);
      ctx.lineTo(s, s * 0.35);
      ctx.closePath();
      ctx.fillStyle = '#ffd24a';
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.strokeStyle = withAlpha('#8a5a00', 0.8);
      ctx.stroke();
    } else {
      // star
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const rad = k % 2 ? s * 0.2 : s * 0.5;
        const ang = (Math.PI / 5) * k - Math.PI / 2;
        const lx = Math.cos(ang) * rad;
        const ly = Math.sin(ang) * rad;
        if (k === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.restore();
  }
}

/* ───────────────────────────── chat boxes ───────────────────────────── */

/** CSS-ready style for a chat bubble skin (the chat feed is DOM). */
export function chatboxStyle(art = {}) {
  return {
    '--bubble-bg': art.bg || '#f3f5fa',
    '--bubble-border': art.border || '#c9d3e6',
    '--bubble-text': art.text || '#16233a',
    ornament: art.ornament || '',
  };
}

/* ───────────────────────── mini previews (shop) ─────────────────────── */

/** A 15×15 board reduced to a readable thumbnail. */
export function drawMiniBoard(ctx, size, theme) {
  const c = size / 15;
  ctx.fillStyle = theme.board;
  roundRect(ctx, 0, 0, size, size, size * 0.12);
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.strokeStyle = theme.frame;
  ctx.stroke();

  const blocks = [
    ['red', 0, 0],
    ['green', 9, 0],
    ['blue', 0, 9],
    ['yellow', 9, 9],
  ];
  for (const [color, cx, cy] of blocks) {
    const p = theme.players[color];
    roundRect(ctx, cx * c, cy * c, c * 6, c * 6, c);
    const g = ctx.createLinearGradient(cx * c, cy * c, (cx + 6) * c, (cy + 6) * c);
    g.addColorStop(0, p.light);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.fill();
    for (const [ox, oy] of [[1.6, 1.6], [3.6, 1.6], [1.6, 3.6], [3.6, 3.6]]) {
      ctx.beginPath();
      ctx.arc((cx + ox) * c + c * 0.4, (cy + oy) * c + c * 0.4, c * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(theme.board, 0.85);
      ctx.fill();
    }
  }

  // arms
  ctx.fillStyle = theme.track;
  ctx.fillRect(6 * c, 0, 3 * c, 15 * c);
  ctx.fillRect(0, 6 * c, 15 * c, 3 * c);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = Math.max(0.5, size * 0.006);
  for (let i = 0; i <= 15; i++) {
    ctx.beginPath();
    ctx.moveTo(6 * c, i * c);
    ctx.lineTo(9 * c, i * c);
    ctx.moveTo(i * c, 6 * c);
    ctx.lineTo(i * c, 9 * c);
    ctx.stroke();
  }

  // home columns
  const cols = [
    ['red', 7, 1, 1, 5, true],
    ['green', 1, 7, 5, 1, false],
    ['yellow', 9, 7, 5, 1, false],
    ['blue', 7, 9, 1, 5, true],
  ];
  for (const [color, gx, gy, w, h] of cols) {
    ctx.fillStyle = theme.players[color].main;
    ctx.fillRect(gx * c, gy * c, w * c, h * c);
  }

  // centre
  const o = 6 * c;
  const s = 3 * c;
  const mid = o + s / 2;
  const tri = {
    red: [[o, o], [o, o + s]],
    green: [[o, o], [o + s, o]],
    yellow: [[o + s, o], [o + s, o + s]],
    blue: [[o, o + s], [o + s, o + s]],
  };
  for (const key of Object.keys(tri)) {
    const [a, b] = tri[key];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(mid, mid);
    ctx.closePath();
    ctx.fillStyle = theme.players[key].main;
    ctx.fill();
  }
}

/** Four tokens in a row — the token-skin thumbnail. */
export function drawTokenPreview(ctx, size, theme, art) {
  const r = size * 0.16;
  const colors = ['red', 'green', 'yellow', 'blue'];
  colors.forEach((color, i) => {
    const x = size * (0.26 + (i % 2) * 0.48);
    const y = size * (0.32 + Math.floor(i / 2) * 0.4);
    drawTokenShape(ctx, x, y, r, theme.players[color], art);
  });
}
