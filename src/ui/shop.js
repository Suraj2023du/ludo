/**
 * ui/shop.js — the Shop (packs / coins / diamonds), the VIP card, "Remove Ads",
 * and the rewarded-video ad overlay used by every free-coins flow.
 *
 * Payments are intentionally disabled (see services/purchase.js). Every refusal
 * explains itself and offers the free route instead — that is the honest version
 * of this screen.
 */

import { EVENTS } from '../game/events.js';
import { formatAmount } from '../meta/wallet.js';
import { PLACEMENTS } from '../services/ads.js';
import { createOverlay } from './screens.js';

const TABS = [
  { id: 'packs', labelKey: 'shop.packs' },
  { id: 'coins', labelKey: 'shop.coins' },
  { id: 'diamonds', labelKey: 'shop.diamonds' },
];

/* ───────────────────────────── ad overlay ────────────────────────────── */

/**
 * Builds the presenter that LocalAdProvider calls. Shows a real countdown with
 * a cancel button, so "watch an ad" is an honest interaction, not a fake wait.
 * @returns {(o:{placement:string, lengthMs:number}) => Promise<boolean>}
 */
export function createAdPresenter({ el, i18n, audio }) {
  const overlay = createOverlay(el);
  const note = el.querySelector('[data-ad="note"]');
  const bar = el.querySelector('[data-ad="bar"]');
  const art = el.querySelector('[data-ad="art"]');
  const skip = el.querySelector('[data-ad="skip"]');
  let cancel = null;

  skip.addEventListener('click', () => {
    audio.sfx.tap();
    if (cancel) cancel();
  });

  return function present({ lengthMs = 5000 } = {}) {
    return new Promise((resolve) => {
      const started = Date.now();
      art.dataset.frame = String(Math.floor(Math.random() * 4));
      note.textContent = i18n.t('ads.watching');
      bar.style.width = '0%';
      overlay.open();

      let raf = 0;
      const finish = (ok) => {
        cancel = null;
        if (raf) cancelAnimationFrame(raf);
        overlay.close();
        resolve(ok);
      };
      cancel = () => finish(false);

      const step = () => {
        const k = Math.min(1, (Date.now() - started) / lengthMs);
        bar.style.width = Math.round(k * 100) + '%';
        const left = Math.ceil((lengthMs - (Date.now() - started)) / 1000);
        note.textContent = left > 0 ? i18n.t('ads.skipIn', { secs: left }) : i18n.t('ads.reward');
        if (k >= 1) {
          finish(true);
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
  };
}

/* ─────────────────────────────── the shop ────────────────────────────── */

/**
 * @param {object} o { el, bus, i18n, shop, wallet, account, ads, audio }
 */
export function createShopScreen(o) {
  const { el, bus, i18n, shop, wallet, account, ads, audio } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const titleEl = el.querySelector('[data-modal="title"]');
  const tabsEl = el.querySelector('[data-modal="tabs"]');
  const bodyEl = el.querySelector('[data-modal="body"]');
  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  let tab = 'packs';

  const toast = (text, kind) => bus.emit(EVENTS.TOAST, { text, kind: kind || 'info' });

  async function watchForCoins(placement = 'getCoins') {
    if (!ads.isAvailable(placement)) {
      toast(t('ads.limit'), 'warn');
      return;
    }
    const res = await ads.watch(placement);
    if (res.completed && res.reward) {
      audio.sfx.win();
      toast('+' + formatAmount(res.reward.amount) + ' ' + (res.reward.kind === 'coins' ? t('common.coins') : t('common.diamonds')), 'good');
      render();
    }
  }

  async function attempt(product) {
    const res = await shop.buy(product.id);
    if (res.ok) {
      audio.sfx.win();
      toast(product.title, 'good');
      render();
      return;
    }
    audio.sfx.deny();
    toast(t('shop.disabled'), 'warn', 3200);
    // Immediately offer the free path so the tap is never a dead end.
    watchForCoins(product.kind === 'diamonds' ? 'freeDiamond' : 'getCoins');
  }

  function freeStrip() {
    const wrap = document.createElement('div');
    wrap.className = 'free-strip';

    const coinBtn = document.createElement('button');
    coinBtn.type = 'button';
    coinBtn.className = 'free-btn';
    coinBtn.innerHTML =
      '<i class="cost-ico cost-ico--coin"></i><b>+' + formatAmount(PLACEMENTS.getCoins.reward.amount) + '</b>' +
      '<span>' + t('common.watchVideo') + ' · ' + ads.remaining('getCoins') + ' left</span>';
    coinBtn.disabled = !ads.isAvailable('getCoins');
    coinBtn.addEventListener('click', () => watchForCoins('getCoins'));

    const gemBtn = document.createElement('button');
    gemBtn.type = 'button';
    gemBtn.className = 'free-btn';
    gemBtn.innerHTML =
      '<i class="cost-ico cost-ico--gem"></i><b>+' + PLACEMENTS.freeDiamond.reward.amount + '</b>' +
      '<span>' + t('common.watchVideo') + ' · ' + ads.remaining('freeDiamond') + ' left</span>';
    gemBtn.disabled = !ads.isAvailable('freeDiamond');
    gemBtn.addEventListener('click', () => watchForCoins('freeDiamond'));

    wrap.append(coinBtn, gemBtn);
    return wrap;
  }

  function productCard(product) {
    const card = document.createElement('div');
    card.className = 'pack' + (product.featured ? ' pack--vip' : '');
    card.dataset.product = product.id;

    const art = document.createElement('span');
    art.className = 'pack-art pack-art--' + product.kind;

    const meta = document.createElement('div');
    meta.className = 'pack-meta';
    const title = document.createElement('span');
    title.className = 'pack-title';
    title.textContent = product.title;
    const sub = document.createElement('span');
    sub.className = 'pack-sub';
    sub.textContent = product.sub || '';
    meta.append(title, sub);

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'pack-buy';
    buy.textContent = product.featured ? t('shop.subscribe') : product.price;
    buy.addEventListener('click', () => attempt(product));

    if (product.bonus) {
      const badge = document.createElement('span');
      badge.className = 'pack-bonus';
      badge.textContent = product.bonus;
      card.append(badge);
    }

    card.append(art, meta, buy);
    return card;
  }

  function buildTabs() {
    tabsEl.textContent = '';
    for (const item of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-tab';
      b.setAttribute('role', 'tab');
      b.dataset.tab = item.id;
      b.setAttribute('aria-selected', String(item.id === tab));
      b.textContent = t(item.labelKey);
      b.addEventListener('click', () => {
        audio.sfx.tap();
        tab = item.id;
        render();
      });
      tabsEl.append(b);
    }
  }

  function render() {
    titleEl.textContent = t('shop.title');
    buildTabs();
    bodyEl.textContent = '';

    const notice = document.createElement('p');
    notice.className = 'shop-notice';
    notice.textContent = t('shop.disabled');
    bodyEl.append(notice);

    bodyEl.append(freeStrip());

    const me = account.snapshot();
    if (me.isVip) {
      const vip = document.createElement('p');
      vip.className = 'shop-notice shop-notice--good';
      vip.textContent = 'VIP ' + (me.vip.tier === 2 ? 'Super' : '') + ' · ' + new Date(me.vip.until).toLocaleDateString();
      bodyEl.append(vip);
    }

    for (const product of shop.products(tab)) bodyEl.append(productCard(product));

    const balance = document.createElement('p');
    balance.className = 'shop-balance';
    balance.innerHTML =
      '<i class="cost-ico cost-ico--coin"></i>' + formatAmount(wallet.coins) +
      '<i class="cost-ico cost-ico--gem"></i>' + formatAmount(wallet.diamonds);
    bodyEl.append(balance);
  }

  bus.on('wallet:changed', () => {
    if (overlay.isOpen) render();
  });

  return {
    open(startTab) {
      if (startTab && TABS.some((x) => x.id === startTab)) tab = startTab;
      render();
      overlay.open();
    },
    close: overlay.close,
    render,
    watchForCoins,
    get isOpen() {
      return overlay.isOpen;
    },
  };
}
