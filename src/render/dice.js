/**
 * render/dice.js — the dice: code-drawn faces, rolling animation, idle nudge.
 *
 * DRAWING ONLY. roll(value) returns a promise the controller awaits, so the
 * result is never revealed before the animation lands.
 */

import { playerPalette, roundRect, withAlpha } from './board.js';

/** Pip layout per face, in unit coordinates (-1..1). */
const PIPS = {
  1: [[0, 0]],
  2: [[-0.45, -0.45], [0.45, 0.45]],
  3: [[-0.45, -0.45], [0, 0], [0.45, 0.45]],
  4: [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]],
  5: [[-0.45, -0.45], [0.45, -0.45], [0, 0], [-0.45, 0.45], [0.45, 0.45]],
  6: [[-0.45, -0.5], [0.45, -0.5], [-0.45, 0], [0.45, 0], [-0.45, 0.5], [0.45, 0.5]],
};

export function createDiceLayer() {
  let value = 6;
  let rolling = false;
  let elapsed = 0;
  let duration = 0;
  let faceTimer = 0;
  let faceShown = 6;
  let resolve = null;
  let landAt = 0;
  let idle = 0;
  let rng = Math.random;

  /**
   * Spin, then land on `finalValue`.
   * @returns {Promise<void>} resolves once the die has settled
   */
  function roll(finalValue, ms) {
    if (resolve) resolve();
    value = finalValue;
    rolling = true;
    elapsed = 0;
    // 40ms is only a sanity floor; real timings come from controller.timing
    duration = Math.max(40, ms);
    landAt = duration * 0.78; // last 22% is the settle bounce
    faceTimer = 0;
    return new Promise((r) => {
      resolve = () => {
        resolve = null;
        rolling = false;
        r();
      };
    });
  }

  function update(dt) {
    idle += dt;
    if (!rolling) return;
    elapsed += dt;
    faceTimer += dt;
    if (elapsed < landAt) {
      // cycle random faces while airborne
      const every = 55 + (elapsed / landAt) * 70; // slows down as it settles
      if (faceTimer >= every) {
        faceTimer = 0;
        let next = 1 + Math.floor(rng() * 6);
        if (next === faceShown) next = (next % 6) + 1;
        faceShown = next;
      }
    } else {
      faceShown = value;
    }
    if (elapsed >= duration && resolve) resolve();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} layout
   * @param {object} theme
   * @param {object} opts { color, active, canRoll, label }
   */
  function draw(ctx, layout, theme, opts = {}) {
    const d = layout.dice;
    const size = d.size;
    const p = opts.color ? playerPalette(theme, opts.color) : { main: '#ffffff', dark: '#888', light: '#fff' };

    let cx = d.x + size / 2;
    let cy = d.y + size / 2;
    let scale = 1;
    let rot = 0;

    if (rolling) {
      const k = Math.min(1, elapsed / duration);
      if (elapsed < landAt) {
        const air = elapsed / landAt;
        rot = air * Math.PI * 4.5;
        scale = 1 + Math.sin(air * Math.PI) * 0.22;
        cy -= Math.sin(air * Math.PI) * size * 0.34;
        cx += Math.sin(air * Math.PI * 2) * size * 0.1;
      } else {
        const b = (k - 0.78) / 0.22;
        scale = 1 + Math.sin(b * Math.PI) * -0.1 * (1 - b);
        rot = 0;
      }
    } else if (opts.canRoll) {
      // gentle "tap me" breathing
      scale = 1 + Math.sin(idle / 420) * 0.035;
    }

    // tray glow behind the die when it is the local player's turn
    if (opts.canRoll || rolling) {
      const glow = ctx.createRadialGradient(cx, cy, size * 0.2, cx, cy, size * 1.15);
      glow.addColorStop(0, withAlpha(p.main, 0.42));
      glow.addColorStop(1, withAlpha(p.main, 0));
      ctx.beginPath();
      ctx.arc(cx, cy, size * 1.15, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);

    // shadow
    ctx.beginPath();
    ctx.ellipse(0, size * 0.62, size * 0.42, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // body
    const half = size / 2;
    roundRect(ctx, -half, -half, size, size, size * 0.22);
    const g = ctx.createLinearGradient(-half, -half, half, half);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f3f4f6');
    g.addColorStop(1, '#d8dbe2');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(2, size * 0.045);
    ctx.strokeStyle = withAlpha(p.dark, 0.85);
    ctx.stroke();

    // pips
    const face = rolling ? faceShown : value;
    const pr = size * 0.085;
    ctx.fillStyle = p.dark;
    for (const [ux, uy] of PIPS[face] || PIPS[1]) {
      ctx.beginPath();
      ctx.arc(ux * half * 0.78, uy * half * 0.78, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    roll,
    update,
    draw,
    get value() {
      return value;
    },
    get rolling() {
      return rolling;
    },
    setValue(v) {
      value = v;
      faceShown = v;
    },
    setRng(fn) {
      rng = fn || Math.random;
    },
    cancel() {
      if (resolve) resolve();
      rolling = false;
    },
  };
}
