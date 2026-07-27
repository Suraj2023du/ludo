/**
 * render/avatar.js — procedural avatars, level rings, the mascot and podiums.
 *
 * DRAWING ONLY. Avatars are generated from a numeric seed (like an identicon),
 * so thousands of distinct player pictures cost zero bytes of assets and no
 * privacy questions.
 */

import { withAlpha } from './board.js';
import { drawFrameRing } from './skins.js';
import { AVATAR_STYLES } from '../meta/account.js';

const hsl = (h, s, l, a = 1) => 'hsla(' + ((h % 360) + 360) % 360 + ',' + s + '%,' + l + '%,' + a + ')';

/** Deterministic 0..1 stream from a seed. */
function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export function randomAvatar(rng = Math.random) {
  return {
    seed: Math.floor(rng() * 1e9),
    style: AVATAR_STYLES[Math.floor(rng() * AVATAR_STYLES.length)],
    tint: Math.floor(rng() * 360),
  };
}

/**
 * Paint the avatar picture (no frame) as a disc.
 * @param {object} avatar { seed, style, tint }
 * @param {string} [initial] letter drawn on top
 */
export function drawAvatar(ctx, cx, cy, r, avatar = {}, initial = '') {
  const rnd = seeded(avatar.seed || 1);
  const tint = Number.isFinite(avatar.tint) ? avatar.tint : 210;
  const style = avatar.style || 'bloom';

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  const bg = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  bg.addColorStop(0, hsl(tint, 68, 62));
  bg.addColorStop(1, hsl(tint + 40, 62, 34));
  ctx.fillStyle = bg;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  const ink = hsl(tint + 180, 75, 88, 0.55);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;

  if (style === 'bloom') {
    const petals = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + rnd();
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r * 0.34, cy + Math.sin(a) * r * 0.34, r * 0.34, r * 0.16, a, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === 'beam') {
    const rays = 6 + Math.floor(rnd() * 6);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a, a + Math.PI / rays);
      ctx.closePath();
      ctx.fillStyle = withAlpha('#ffffff', 0.12 + rnd() * 0.16);
      ctx.fill();
    }
  } else if (style === 'ring') {
    for (let i = 4; i >= 1; i--) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r * i) / 4.4, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#ffffff', 0.18 + i * 0.05);
      ctx.lineWidth = r * 0.14;
      ctx.stroke();
    }
  } else if (style === 'wave') {
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const y = cy - r + (i * r * 2) / 4;
      ctx.moveTo(cx - r, y);
      for (let x = -r; x <= r; x += r / 6) {
        ctx.lineTo(cx + x, y + Math.sin((x / r) * 3 + i) * r * 0.16);
      }
      ctx.strokeStyle = withAlpha('#ffffff', 0.22);
      ctx.lineWidth = r * 0.16;
      ctx.stroke();
    }
  } else if (style === 'spark') {
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.9;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.05 + rnd() * 0.09), 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#ffffff', 0.3 + rnd() * 0.4);
      ctx.fill();
    }
  } else {
    const n = 4;
    const cell = (r * 2) / n;
    for (let gx = 0; gx < n; gx++) {
      for (let gy = 0; gy < n; gy++) {
        if (rnd() > 0.55) continue;
        ctx.fillStyle = withAlpha('#ffffff', 0.14 + rnd() * 0.22);
        ctx.fillRect(cx - r + gx * cell, cy - r + gy * cell, cell, cell);
      }
    }
  }

  // soft top light
  const gl = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  gl.addColorStop(0, withAlpha('#ffffff', 0.28));
  gl.addColorStop(0.55, withAlpha('#ffffff', 0));
  ctx.fillStyle = gl;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  if (initial) {
    ctx.save();
    ctx.font = '800 ' + Math.round(r * 0.95) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = withAlpha('#ffffff', 0.92);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = r * 0.25;
    ctx.fillText(initial.slice(0, 1).toUpperCase(), cx, cy + r * 0.04);
    ctx.restore();
  }
}

/** XP progress ring drawn just outside the avatar. */
export function drawLevelRing(ctx, cx, cy, r, ratio, color = '#ffd24a') {
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = r * 0.14;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, Math.min(1, ratio)) * Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.14;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/**
 * Avatar + frame + optional level ring and badge — the unit used in the HUD,
 * the lobby and every list.
 * @param {object} o { avatar, frame, initial, level, xpRatio, badge, t }
 */
export function drawAvatarBlock(ctx, cx, cy, r, o = {}) {
  drawAvatar(ctx, cx, cy, r, o.avatar, o.initial);
  if (o.xpRatio !== undefined) drawLevelRing(ctx, cx, cy, r * 1.14, o.xpRatio, o.ringColor);
  if (o.frame) drawFrameRing(ctx, cx, cy, r * 1.06, o.frame, o.t || 0);

  if (o.level) {
    const bx = cx - r * 0.86;
    const by = cy + r * 0.86;
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = o.levelColor || '#ffb703';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.font = '800 ' + Math.round(r * 0.36) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2b1a00';
    ctx.fillText(String(o.level), bx, by + r * 0.02);
  }
}

/**
 * Render an avatar into a standalone canvas element for DOM lists.
 * @returns {HTMLCanvasElement}
 */
export function makeAvatarCanvas(size, opts = {}, dpr = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = opts.frame ? size * 0.09 : size * 0.02;
    drawAvatarBlock(ctx, size / 2, size / 2, size / 2 - pad, opts);
  }
  return canvas;
}

/* ─────────────────────────────── mascot ─────────────────────────────── */

/** A friendly dice mascot that breathes and blinks. Pure canvas. */
export function drawMascot(ctx, cx, cy, size, t = 0) {
  const bob = Math.sin(t / 620) * size * 0.03;
  const y = cy + bob;
  const s = size * 0.5;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.5, size * 0.42, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();

  // body
  ctx.translate(cx, y);
  ctx.rotate(Math.sin(t / 900) * 0.04);
  const g = ctx.createLinearGradient(-s, -s, s, s);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#cfd6e4');
  ctx.beginPath();
  const rr = s * 0.32;
  ctx.moveTo(-s + rr, -s);
  ctx.arcTo(s, -s, s, s, rr);
  ctx.arcTo(s, s, -s, s, rr);
  ctx.arcTo(-s, s, -s, -s, rr);
  ctx.arcTo(-s, -s, s, -s, rr);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = 'rgba(20,28,48,0.65)';
  ctx.stroke();

  // eyes (blink every ~4s)
  const blink = (t % 4200) < 160;
  for (const dx of [-0.32, 0.32]) {
    ctx.beginPath();
    if (blink) {
      ctx.moveTo(s * dx - s * 0.16, -s * 0.1);
      ctx.lineTo(s * dx + s * 0.16, -s * 0.1);
      ctx.strokeStyle = '#1b2436';
      ctx.lineWidth = size * 0.03;
      ctx.stroke();
    } else {
      ctx.arc(s * dx, -s * 0.12, s * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = '#1b2436';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * dx + s * 0.06, -s * 0.18, s * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }

  // smile
  ctx.beginPath();
  ctx.arc(0, s * 0.16, s * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = '#1b2436';
  ctx.lineWidth = size * 0.032;
  ctx.stroke();

  // cheeks
  for (const dx of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.arc(s * dx, s * 0.18, s * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,120,140,0.55)';
    ctx.fill();
  }
  ctx.restore();
}

/* ────────────────────────────── podium ─────────────────────────────── */

/** Leaderboard podium block for place 1/2/3. */
export function drawPodium(ctx, x, y, w, h, place, color = '#ffd24a') {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, withAlpha(color, 0.95));
  g.addColorStop(1, withAlpha(color, 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.font = '800 ' + Math.round(h * 0.44) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(String(place), x + w / 2, y + h * 0.55);
}
