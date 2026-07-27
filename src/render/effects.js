/**
 * render/effects.js — particles, rings and confetti. All code-drawn.
 *
 * A single flat array of particles with a hard cap keeps this cheap on low-end
 * hardware: no allocation per frame, no DOM, no images.
 */

import { withAlpha } from './board.js';

const MAX_PARTICLES = 260;

export function createEffects({ max = MAX_PARTICLES } = {}) {
  /** @type {object[]} */
  const parts = [];
  let confettiTime = 0;
  let confettiColors = null;
  let confettiBounds = null;

  function spawn(p) {
    if (parts.length >= max) parts.shift();
    parts.push(p);
  }

  /** Small dust burst — used for a landing token. */
  function burst(x, y, color, count = 10, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 1.4) * power;
      spawn({
        kind: 'dot',
        x,
        y,
        vx: Math.cos(a) * s * 60,
        vy: Math.sin(a) * s * 60 - 30,
        g: 320,
        life: 0,
        ttl: 380 + Math.random() * 260,
        size: 2 + Math.random() * 3,
        color,
      });
    }
  }

  /** Bigger, sharper burst — a capture. */
  function hit(x, y, color) {
    burst(x, y, color, 18, 1.7);
    ring(x, y, color, 46, 420);
  }

  /** Expanding ring — capture / six / finish. */
  function ring(x, y, color, radius = 40, ttl = 380) {
    spawn({ kind: 'ring', x, y, r0: radius * 0.25, r1: radius, life: 0, ttl, color });
  }

  /** Sparkle trail for a token entering home. */
  function sparkle(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      spawn({
        kind: 'star',
        x,
        y,
        vx: Math.cos(a) * (20 + Math.random() * 70),
        vy: Math.sin(a) * (20 + Math.random() * 70) - 40,
        g: 60,
        life: 0,
        ttl: 600 + Math.random() * 400,
        size: 3 + Math.random() * 4,
        spin: Math.random() * Math.PI,
        color,
      });
    }
  }

  /**
   * Winner confetti: rains for `ms` from the top of the given box.
   * Colours come from the theme so it always matches the board.
   */
  function confetti(bounds, colors, ms = 4200) {
    confettiBounds = bounds;
    confettiColors = colors && colors.length ? colors : ['#e63946', '#2a9d4a', '#f4b93c', '#2f74d0'];
    confettiTime = ms;
  }

  function spawnConfettiPiece() {
    const b = confettiBounds;
    spawn({
      kind: 'confetti',
      x: b.x + Math.random() * b.w,
      y: b.y - 12,
      vx: (Math.random() - 0.5) * 70,
      vy: 90 + Math.random() * 160,
      g: 42,
      life: 0,
      ttl: 2600 + Math.random() * 1600,
      size: 4 + Math.random() * 6,
      spin: Math.random() * Math.PI * 2,
      spinV: (Math.random() - 0.5) * 9,
      color: confettiColors[(Math.random() * confettiColors.length) | 0],
      sway: 0.6 + Math.random() * 1.6,
    });
  }

  function update(dt) {
    const s = dt / 1000;

    if (confettiTime > 0) {
      confettiTime -= dt;
      const n = Math.min(4, Math.ceil(dt / 26));
      for (let i = 0; i < n; i++) spawnConfettiPiece();
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.ttl) {
        parts.splice(i, 1);
        continue;
      }
      if (p.kind === 'ring') continue;
      p.vy += (p.g || 0) * s;
      p.x += (p.vx || 0) * s;
      p.y += (p.vy || 0) * s;
      if (p.spinV) p.spin += p.spinV * s;
      if (p.kind === 'confetti') {
        p.x += Math.sin(p.life / 220) * p.sway;
        if (confettiBounds && p.y > confettiBounds.y + confettiBounds.h + 20) {
          parts.splice(i, 1);
        }
      }
    }
  }

  function draw(ctx) {
    for (const p of parts) {
      const k = p.life / p.ttl;
      const alpha = 1 - k;
      if (p.kind === 'ring') {
        const r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - k, 2));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(p.color, alpha * 0.7);
        ctx.lineWidth = Math.max(1.5, 4 * alpha);
        ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = withAlpha(p.color, Math.min(1, alpha * 1.6));
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size * 0.55);
        ctx.restore();
      } else if (p.kind === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin || 0);
        ctx.fillStyle = withAlpha(p.color, alpha);
        ctx.fillRect(-p.size / 2, -p.size / 6, p.size, p.size / 3);
        ctx.fillRect(-p.size / 6, -p.size / 2, p.size / 3, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(p.color, alpha);
        ctx.fill();
      }
    }
  }

  return {
    burst,
    hit,
    ring,
    sparkle,
    confetti,
    update,
    draw,
    clear() {
      parts.length = 0;
      confettiTime = 0;
    },
    get count() {
      return parts.length;
    },
    get busy() {
      return parts.length > 0 || confettiTime > 0;
    },
  };
}
