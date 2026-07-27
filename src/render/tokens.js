/**
 * render/tokens.js — token drawing + movement animation.
 *
 * DRAWING ONLY. The layer never changes game state; it reads the state and,
 * while an animation is running, overrides where a token is *painted*.
 *
 * The controller calls the animator (built in ui/game.js) which calls
 * walk()/fly()/pop() here. Each returns a promise that resolves when the
 * animation finishes, which is what gates the controller's turn loop.
 */

import { BASE, FINISH, HOME_ENTRY, onTrack, toAbs } from '../engine/state.js';
import { BASE_SLOTS, playerPalette, positionPoint, withAlpha } from './board.js';

export const tokenKey = (playerId, tokenIndex) => playerId + ':' + tokenIndex;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export function createTokenLayer() {
  /** @type {Map<string, object>} key → animation */
  const anims = new Map();

  /* ─────────────────────────── animation drivers ─────────────────────────── */

  function start(key, anim) {
    const existing = anims.get(key);
    if (existing) existing.resolve();
    return new Promise((resolve) => {
      anim.t = 0;
      anim.resolve = () => {
        if (anims.get(key) === anim) anims.delete(key);
        resolve();
      };
      anims.set(key, anim);
    });
  }

  /**
   * Step a token along a list of cells, one hop at a time (Ludo King feel).
   * @param {string} key
   * @param {{x:number,y:number}[]} points first point is the origin
   * @param {number} stepMs per cell
   */
  function walk(key, points, stepMs) {
    const hops = Math.max(1, points.length - 1);
    return start(key, {
      kind: 'walk',
      points,
      duration: Math.max(40, hops * stepMs),
      hops,
    });
  }

  /** Captured token flying back to its base slot. */
  function fly(key, from, to, duration) {
    return start(key, { kind: 'fly', from, to, duration: Math.max(40, duration) });
  }

  /** Little celebration when a token reaches the centre. */
  function pop(key, at, duration) {
    return start(key, { kind: 'pop', at, duration: Math.max(40, duration) });
  }

  function update(dt) {
    if (anims.size === 0) return;
    for (const [, anim] of [...anims]) {
      anim.t += dt;
      if (anim.t >= anim.duration) anim.resolve();
    }
  }

  function isAnimating(key) {
    return key === undefined ? anims.size > 0 : anims.has(key);
  }

  function clear() {
    for (const [, anim] of [...anims]) anim.resolve();
    anims.clear();
  }

  /** Where should this token be painted right now? */
  function pointFor(layout, player, tokenIndex, rel) {
    const key = tokenKey(player.id, tokenIndex);
    const anim = anims.get(key);
    const rest = positionPoint(layout, player.color, rel, tokenIndex);
    if (!anim) return { p: rest, lift: 0, scale: 1 };

    const k = Math.min(1, anim.t / anim.duration);
    if (anim.kind === 'walk') {
      const total = anim.hops;
      const travelled = k * total;
      const i = Math.min(total - 1, Math.floor(travelled));
      const frac = easeInOut(travelled - i);
      const a = anim.points[i];
      const b = anim.points[i + 1] || a;
      return {
        p: { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac },
        lift: Math.sin(frac * Math.PI) * 0.35, // little hop per cell
        scale: 1 + Math.sin(frac * Math.PI) * 0.06,
      };
    }
    if (anim.kind === 'fly') {
      const e = easeOut(k);
      const arc = Math.sin(k * Math.PI);
      return {
        p: {
          x: anim.from.x + (anim.to.x - anim.from.x) * e,
          y: anim.from.y + (anim.to.y - anim.from.y) * e,
        },
        lift: arc * 1.6,
        scale: 1 + arc * 0.35,
        spin: k * Math.PI * 2.5,
      };
    }
    // pop
    return { p: anim.at || rest, lift: 0, scale: 1 + Math.sin(k * Math.PI) * 0.5 };
  }

  /* ───────────────────────────────── drawing ─────────────────────────────── */

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} state
   * @param {object} layout
   * @param {object} theme
   * @param {object} [opts] { highlights:Set<string>, now:number, activeSeat:number }
   */
  function draw(ctx, state, layout, theme, opts = {}) {
    const cell = layout.cell;
    const highlights = opts.highlights || null;
    const now = opts.now || 0;

    // Group tokens per painted cell so stacks can be offset.
    const buckets = new Map();
    const items = [];

    for (const player of state.players) {
      for (let i = 0; i < player.tokens.length; i++) {
        const rel = player.tokens[i];
        const key = tokenKey(player.id, i);
        const pos = pointFor(layout, player, i, rel);
        const animating = anims.has(key);
        const bucketKey = animating
          ? 'anim:' + key
          : rel === BASE
            ? 'base:' + player.color + ':' + i
            : rel === FINISH
              ? 'home:' + player.color
              : onTrack(rel)
                ? 'abs:' + toAbs(player.color, rel)
                : 'col:' + player.color + ':' + rel;
        let bucket = buckets.get(bucketKey);
        if (!bucket) {
          bucket = [];
          buckets.set(bucketKey, bucket);
        }
        const item = {
          player,
          tokenIndex: i,
          rel,
          pos,
          key,
          animating,
          bucket,
          slot: bucket.length,
        };
        bucket.push(item);
        items.push(item);
      }
    }

    // Animating tokens paint last (on top).
    items.sort((a, b) => Number(a.animating) - Number(b.animating));

    for (const item of items) {
      const count = item.bucket.length;
      const base = item.rel === BASE;
      let radius = cell * (base ? 0.4 : 0.36);
      let { x, y } = item.pos.p;

      if (count > 1 && !item.animating) {
        // Offset + shrink a stack of same-colour tokens so all of them read.
        const spread = cell * (count > 2 ? 0.2 : 0.16);
        const angle = (Math.PI * 2 * item.slot) / count - Math.PI / 2;
        x += Math.cos(angle) * spread;
        y += Math.sin(angle) * spread;
        radius *= count > 3 ? 0.72 : count > 2 ? 0.8 : 0.86;
      }

      const lift = (item.pos.lift || 0) * cell * 0.5;
      const scale = item.pos.scale || 1;
      const highlighted = highlights && highlights.has(item.key);
      drawToken(ctx, {
        x,
        y: y - lift,
        r: radius * scale,
        cell,
        palette: playerPalette(theme, item.player.color),
        theme,
        highlighted,
        now,
        shadowLift: lift,
        finished: item.rel === FINISH,
      });
    }
  }

  function drawToken(ctx, o) {
    const { x, y, r, palette: p } = o;

    // shadow
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.82 + o.shadowLift * 0.35, r * 0.78, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.22 + Math.min(0.18, o.shadowLift / (o.cell * 2))) + ')';
    ctx.fill();

    // pulsing ring for a legal move
    if (o.highlighted) {
      const pulse = 0.5 + 0.5 * Math.sin(o.now / 190);
      ctx.beginPath();
      ctx.arc(x, y, r * (1.25 + pulse * 0.28), 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#ffffff', 0.35 + pulse * 0.45);
      ctx.lineWidth = Math.max(2, o.cell * 0.09);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * (1.25 + pulse * 0.28), 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(p.dark, 0.5);
      ctx.lineWidth = Math.max(1, o.cell * 0.035);
      ctx.stroke();
    }

    // body: pawn-ish dome
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.15, x, y, r * 1.15);
    g.addColorStop(0, p.light);
    g.addColorStop(0.55, p.main);
    g.addColorStop(1, p.dark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, o.cell * 0.055);
    ctx.strokeStyle = withAlpha('#000000', 0.35);
    ctx.stroke();

    // inner disc + glint
    ctx.beginPath();
    ctx.arc(x, y - r * 0.06, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha('#ffffff', o.finished ? 0.85 : 0.55);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.42, r * 0.26, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha('#ffffff', 0.75);
    ctx.fill();
  }

  /* ───────────────────────────────── hit test ───────────────────────────── */

  /**
   * Which of the current player's tokens was tapped?
   * Tolerant: a generous radius plus a fallback to "any legal move on this cell".
   * @returns {number|null} token index
   */
  function pick(layout, state, px, py, moves) {
    const player = state.players[state.turn];
    if (!player) return null;
    const cell = layout.cell;
    let best = null;
    let bestDist = Infinity;

    for (let i = 0; i < player.tokens.length; i++) {
      const rel = player.tokens[i];
      const p = positionPoint(layout, player.color, rel, i);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < cell * 0.72 && d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== null) return best;

    // Fallback: tapping the destination cell of a legal move also works.
    if (moves && moves.length) {
      for (const m of moves) {
        const p = positionPoint(layout, player.color, m.to, m.tokenIndex);
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < cell * 0.6 && d < bestDist) {
          bestDist = d;
          best = m.tokenIndex;
        }
      }
    }
    return best;
  }

  /** Pixel path a token walks for a move event (used by the animator). */
  function pathPoints(layout, color, ev) {
    const pts = [positionPoint(layout, color, ev.from, ev.tokenIndex)];
    for (const rel of ev.path) pts.push(positionPoint(layout, color, rel, ev.tokenIndex));
    return pts;
  }

  /** Base slot pixel for a captured token. */
  function baseSlotPoint(layout, color, tokenIndex) {
    const slot = BASE_SLOTS[color][tokenIndex % 4];
    return {
      x: layout.board.x + slot.x * layout.cell,
      y: layout.board.y + slot.y * layout.cell,
    };
  }

  return {
    draw,
    update,
    walk,
    fly,
    pop,
    clear,
    isAnimating,
    pick,
    pathPoints,
    baseSlotPoint,
    positionPoint: (layout, color, rel, i) => positionPoint(layout, color, rel, i),
    HOME_ENTRY,
  };
}
