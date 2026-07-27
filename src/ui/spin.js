/**
 * ui/spin.js — the Lucky Spin wheel. Canvas-drawn, weighted by the engine in
 * meta/rewards.js (the wheel only animates to the result it is given).
 */

import { EVENTS } from '../game/events.js';
import { SPIN_PRIZES, formatCountdown } from '../meta/rewards.js';
import { formatAmount } from '../meta/wallet.js';
import { withAlpha } from '../render/board.js';
import { createOverlay } from './screens.js';

const SEG = (Math.PI * 2) / SPIN_PRIZES.length;
const SPIN_MS = 2900;

/**
 * @param {object} o { el, bus, i18n, rewards, ads, audio }
 */
export function createSpinScreen(o) {
  const { el, bus, i18n, rewards, ads, audio } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const canvas = el.querySelector('[data-spin="wheel"]');
  const statusEl = el.querySelector('[data-spin="status"]');
  const goBtn = el.querySelector('[data-spin="go"]');
  const adBtn = el.querySelector('[data-spin="ad"]');
  const titleEl = el.querySelector('[data-spin="title"]');
  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  let angle = -SEG / 2;
  let spinning = false;
  let raf = 0;
  let tick = 0;

  /* ─────────────────────────────── drawing ───────────────────────────── */

  function size() {
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const css = 280;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    canvas.style.width = css + 'px';
    canvas.style.height = css + 'px';
    return { css, dpr };
  }

  function label(prize) {
    return prize.kind === 'coins' ? formatAmount(prize.amount) : prize.amount + '💎';
  }

  function draw() {
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width / dpr;
    const r = w / 2 - 12;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);

    ctx.save();
    ctx.translate(w / 2, w / 2);

    // outer rim
    ctx.beginPath();
    ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
    const rim = ctx.createLinearGradient(-r, -r, r, r);
    rim.addColorStop(0, '#ffe9a8');
    rim.addColorStop(0.5, '#b9821a');
    rim.addColorStop(1, '#ffe9a8');
    ctx.fillStyle = rim;
    ctx.fill();

    ctx.rotate(angle);
    SPIN_PRIZES.forEach((prize, i) => {
      const from = i * SEG;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, from, from + SEG);
      ctx.closePath();
      const g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
      g.addColorStop(0, withAlpha(prize.color, 0.75));
      g.addColorStop(1, prize.color);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.rotate(from + SEG / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '800 ' + (prize.jackpot ? 17 : 15) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(20,16,4,0.86)';
      ctx.fillText(label(prize), r - 14, 0);
      ctx.restore();
    });
    ctx.restore();

    // hub
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#12213a';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffd24a';
    ctx.stroke();
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText('SPIN', w / 2, w / 2 + 1);

    // pointer
    ctx.beginPath();
    ctx.moveTo(w / 2 - 13, 6);
    ctx.lineTo(w / 2 + 13, 6);
    ctx.lineTo(w / 2, 34);
    ctx.closePath();
    ctx.fillStyle = '#ff4d6d';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }

  /* ─────────────────────────────── spinning ──────────────────────────── */

  function easeOut(k) {
    return 1 - Math.pow(1 - k, 3);
  }

  function spin() {
    if (spinning) return;
    const result = rewards.spin();
    if (!result) {
      audio.sfx.deny();
      renderStatus();
      return;
    }
    spinning = true;
    audio.sfx.dice(SPIN_MS * 0.8);

    // land the winning segment under the pointer at the top
    const target = -(result.index * SEG + SEG / 2) - Math.PI / 2 + Math.PI * 2 * 5;
    const from = angle % (Math.PI * 2);
    const started = Date.now();

    const step = () => {
      const k = Math.min(1, (Date.now() - started) / SPIN_MS);
      angle = from + (target - from) * easeOut(k);
      draw();
      if (k < 1) {
        raf = requestAnimationFrame(step);
        return;
      }
      spinning = false;
      audio.sfx.win();
      const prize = result.prize;
      bus.emit(EVENTS.TOAST, {
        text: t('spin.won', {
          reward:
            prize.kind === 'coins'
              ? formatAmount(prize.amount) + ' ' + t('common.coins')
              : prize.amount + ' ' + t('common.diamonds'),
        }),
        kind: 'good',
      });
      renderStatus();
    };
    raf = requestAnimationFrame(step);
  }

  async function watchForSpin() {
    if (!ads.isAvailable('extraSpin')) {
      bus.emit(EVENTS.TOAST, { text: t('ads.limit'), kind: 'warn' });
      return;
    }
    const res = await ads.watch('extraSpin');
    if (!res.completed) return;
    rewards.addSpin(1);
    audio.sfx.six();
    renderStatus();
  }

  goBtn.addEventListener('click', () => {
    audio.unlock();
    spin();
  });
  adBtn.addEventListener('click', () => {
    audio.sfx.tap();
    watchForSpin();
  });

  function renderStatus() {
    titleEl.textContent = t('spin.title');
    goBtn.textContent = t('spin.button');
    adBtn.textContent = t('spin.extra');
    adBtn.hidden = !ads.isAvailable('extraSpin');
    const ready = rewards.canSpin();
    goBtn.disabled = !ready || spinning;
    statusEl.textContent = ready
      ? t('spin.free') + (rewards.bankedSpins > 1 ? ' ×' + rewards.bankedSpins : '')
      : t('spin.wait', { time: formatCountdown(rewards.spinCooldownLeft()) });
  }

  return {
    open() {
      size();
      draw();
      renderStatus();
      overlay.open();
      tick = setInterval(renderStatus, 1000);
      if (tick && typeof tick.unref === 'function') tick.unref();
    },
    close() {
      if (raf) cancelAnimationFrame(raf);
      if (tick) clearInterval(tick);
      tick = 0;
      overlay.close();
    },
    get isOpen() {
      return overlay.isOpen;
    },
    render: renderStatus,
  };
}
