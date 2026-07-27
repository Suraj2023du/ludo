/**
 * ui/skins.js — the Skin Shop: five tabs (dice, frame, theme, token, chatbox),
 * every preview drawn in code, every unlock path wired.
 *
 * Reacts to the catalog; never mutates it directly except through its API.
 */

import { EVENTS } from '../game/events.js';
import { formatAmount } from '../meta/wallet.js';
import { getTheme } from '../render/board.js';
import { chatboxStyle, drawDiceFace, drawMiniBoard, drawTokenPreview } from '../render/skins.js';
import { drawAvatarBlock } from '../render/avatar.js';
import { createOverlay } from './screens.js';

const TABS = [
  { kind: 'dice', labelKey: 'skins.dice' },
  { kind: 'frame', labelKey: 'skins.frame' },
  { kind: 'theme', labelKey: 'skins.theme' },
  { kind: 'token', labelKey: 'skins.token' },
  { kind: 'chatbox', labelKey: 'skins.chatbox' },
];

const PREVIEW = 74;

/**
 * @param {object} o { el, bus, i18n, catalog, wallet, ads, audio, prefs, account, onNeedCoins, onThemeEquip }
 */
export function createSkinShop(o) {
  const { el, bus, i18n, catalog, wallet, ads, audio, prefs } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const titleEl = el.querySelector('[data-modal="title"]');
  const tabsEl = el.querySelector('[data-modal="tabs"]');
  const bodyEl = el.querySelector('[data-modal="body"]');
  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  let kind = 'dice';

  /* ─────────────────────────────── previews ──────────────────────────── */

  function previewNode(item) {
    if (item.kind === 'chatbox') {
      const bubble = document.createElement('span');
      bubble.className = 'bubble-preview';
      const style = chatboxStyle(item.art);
      bubble.style.background = style['--bubble-bg'];
      bubble.style.borderColor = style['--bubble-border'];
      bubble.style.color = style['--bubble-text'];
      bubble.textContent = style.ornament ? style.ornament + ' GG' : 'GG';
      return bubble;
    }

    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PREVIEW * dpr);
    canvas.height = Math.round(PREVIEW * dpr);
    canvas.style.width = PREVIEW + 'px';
    canvas.style.height = PREVIEW + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = getTheme(prefs.get('theme'));

    if (item.kind === 'dice') {
      ctx.save();
      ctx.translate(PREVIEW / 2, PREVIEW / 2);
      drawDiceFace(ctx, PREVIEW * 0.66, 6, item.art);
      ctx.restore();
    } else if (item.kind === 'token') {
      drawTokenPreview(ctx, PREVIEW, theme, item.art);
    } else if (item.kind === 'theme') {
      drawMiniBoard(ctx, PREVIEW, getTheme(item.theme));
    } else {
      const me = o.account ? o.account.snapshot() : { avatar: { seed: 7, style: 'bloom', tint: 200 }, name: 'A' };
      drawAvatarBlock(ctx, PREVIEW / 2, PREVIEW / 2, PREVIEW * 0.38, {
        avatar: me.avatar,
        frame: item.art,
        initial: me.name,
        t: Date.now(),
      });
    }
    return canvas;
  }

  /* ─────────────────────────────── actions ───────────────────────────── */

  function toast(text, tone) {
    bus.emit(EVENTS.TOAST, { text, kind: tone || 'info' });
  }

  function equip(item) {
    if (!catalog.equip(item.id)) return;
    audio.sfx.six();
    if (item.kind === 'theme' && item.theme) {
      prefs.set('theme', item.theme);
      if (o.onThemeEquip) o.onThemeEquip(item.theme);
    }
    toast(item.name + ' ' + t('common.equipped'), 'good');
    render();
  }

  function buy(item) {
    const res = catalog.purchase(item.id);
    if (res.ok) {
      audio.sfx.finish();
      equip(item);
      return;
    }
    if (res.reason === 'insufficient') {
      const u = item.unlock;
      audio.sfx.deny();
      toast(t('wallet.notEnough', { kind: u.type === 'coins' ? t('common.coins') : t('common.diamonds') }), 'warn');
      if (o.onNeedCoins) o.onNeedCoins(u.type === 'coins' ? 'coins' : 'diamonds');
      return;
    }
    audio.sfx.deny();
    toast(t('common.locked'), 'warn');
  }

  async function watchFor(item) {
    if (!ads.isAvailable('skinUnlock')) {
      toast(t('ads.limit'), 'warn');
      return;
    }
    const res = await ads.watch('skinUnlock');
    if (!res.completed) return;
    const p = catalog.addAdProgress(item.id);
    if (p.unlocked) {
      audio.sfx.win();
      toast(item.name + ' ' + t('skins.owned'), 'good');
    } else {
      toast(p.have + '/' + p.need, 'info');
    }
    render();
  }

  /* ──────────────────────────────── render ───────────────────────────── */

  function buildTabs() {
    tabsEl.textContent = '';
    for (const tab of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-tab';
      b.setAttribute('role', 'tab');
      b.dataset.tab = tab.kind;
      b.setAttribute('aria-selected', String(tab.kind === kind));
      b.textContent = t(tab.labelKey);
      b.addEventListener('click', () => {
        audio.sfx.tap();
        kind = tab.kind;
        render();
      });
      tabsEl.append(b);
    }
  }

  function actionButton(item, status) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skin-action';

    if (status.state === 'equipped') {
      btn.classList.add('is-on');
      btn.textContent = t('common.equipped');
      btn.disabled = true;
    } else if (status.state === 'owned') {
      btn.textContent = t('common.equip');
      btn.addEventListener('click', () => {
        audio.sfx.tap();
        equip(item);
      });
    } else if (status.state === 'coins' || status.state === 'diamonds') {
      btn.classList.add('is-buy');
      btn.innerHTML =
        '<i class="cost-ico cost-ico--' + (status.state === 'coins' ? 'coin' : 'gem') + '"></i>' +
        formatAmount(status.cost);
      btn.addEventListener('click', () => buy(item));
    } else if (status.state === 'ad') {
      btn.classList.add('is-ad');
      btn.textContent = t('common.watchVideo');
      btn.addEventListener('click', () => watchFor(item));
    } else {
      btn.classList.add('is-locked');
      btn.textContent = status.state === 'event' ? t('skins.event') : t('skins.ranking');
      btn.disabled = true;
      btn.title = status.label || '';
    }
    return btn;
  }

  function render() {
    titleEl.textContent = t('skins.title');
    buildTabs();
    bodyEl.textContent = '';

    for (const item of catalog.items(kind)) {
      const status = catalog.status(item.id);
      const card = document.createElement('div');
      card.className = 'skin-card';
      card.dataset.skin = item.id;
      if (status.state === 'equipped') card.classList.add('is-equipped');

      const name = document.createElement('span');
      name.className = 'skin-name';
      name.textContent = item.name;

      const art = document.createElement('span');
      art.className = 'skin-art';
      art.append(previewNode(item));

      card.append(name, art);

      if (status.state === 'ad') {
        const bar = document.createElement('span');
        bar.className = 'skin-progress';
        bar.innerHTML = '<i style="width:' + Math.round((status.have / status.need) * 100) + '%"></i>';
        const label = document.createElement('span');
        label.className = 'skin-progress-label';
        label.textContent = status.have + '/' + status.need;
        card.append(bar, label);
      }

      card.append(actionButton(item, status));
      bodyEl.append(card);
    }
  }

  bus.on('catalog:unlocked', () => {
    if (overlay.isOpen) render();
  });
  bus.on('wallet:changed', () => {
    if (overlay.isOpen) render();
  });

  return {
    open(startKind) {
      if (startKind) kind = startKind;
      render();
      overlay.open();
    },
    close: overlay.close,
    render,
    get isOpen() {
      return overlay.isOpen;
    },
  };
}
