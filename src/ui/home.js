/**
 * ui/home.js — the lobby: top bar (avatar, level, XP, VIP, coins, diamonds),
 * the event rail, the ONLINE tile, the mode carousel, the mascot and the bottom
 * navigation.
 *
 * Reacts to events only; it never mutates game state. Every button reports back
 * through the `actions` object so main.js decides what a tap means.
 */

import { EVENTS } from '../game/events.js';
import { formatAmount } from '../meta/wallet.js';
import { makeAvatarCanvas, drawMascot } from '../render/avatar.js';
import { getTheme } from '../render/board.js';

/** Compact inline SVG icons (themable via currentColor). */
const ICON = {
  task: '<path d="M6 3h9l4 4v14H6z" fill="#fff" opacity=".9"/><path d="M9 12l2.4 2.4L16 10" stroke="#2a9d4a" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  shop: '<path d="M4 8h16l-1.4 12H5.4z" fill="#ffd8a8"/><path d="M4 8l2-4h12l2 4z" fill="#e8464f"/><rect x="9" y="12" width="6" height="8" fill="#fff" opacity=".7"/>',
  mail: '<rect x="3" y="6" width="18" height="12" rx="2" fill="#fff" opacity=".92"/><path d="M4 7l8 6 8-6" stroke="#2f74d0" stroke-width="2" fill="none"/>',
  ads: '<circle cx="12" cy="12" r="9" fill="#e8464f"/><path d="M7 12h10" stroke="#fff" stroke-width="2.6"/><text x="12" y="10" font-size="7" fill="#fff" text-anchor="middle">AD</text>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="2" fill="#e8464f"/><rect x="10" y="9" width="4" height="12" fill="#ffd24a"/><path d="M12 9c-3-4-8-1-4 0m4 0c3-4 8-1 4 0" fill="#ffd24a"/>',
  cake: '<rect x="4" y="12" width="16" height="9" rx="2" fill="#ff9ff3"/><rect x="4" y="12" width="16" height="3" fill="#fff" opacity=".7"/><path d="M12 5v6" stroke="#ffd24a" stroke-width="2"/>',
  lucky: '<circle cx="12" cy="12" r="9" fill="#7b5cff"/><path d="M12 5l2 5 5 .5-3.8 3.4 1.1 5-4.3-2.6L7.7 19l1.1-5L5 10.5 10 10z" fill="#ffd24a"/>',
  coin: '<circle cx="12" cy="12" r="9" fill="#f4b93c" stroke="#b8842a" stroke-width="2"/><path d="M12 6l1.6 3.6 3.9.4-2.9 2.6.8 3.9L12 14.6 8.6 16.5l.8-3.9L6.5 10l3.9-.4z" fill="#fff6d8"/>',
  gem: '<path d="M12 3l7 6-7 12-7-12z" fill="#e879f9" stroke="#a021b0" stroke-width="1.6"/><path d="M5 9h14M12 3v18" stroke="#fff" stroke-width="1" opacity=".55"/>',
  friends: '<circle cx="9" cy="8" r="3.4" fill="#7ce095"/><circle cx="16" cy="9" r="2.8" fill="#43c59e"/><path d="M3 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6z" fill="#2a9d4a"/><path d="M14 20c0-2.6 2-4.4 4.4-4.4S22 17.4 22 20z" fill="#1b998b"/>',
  ranking: '<rect x="9" y="6" width="6" height="15" fill="#ffd24a"/><rect x="3" y="11" width="6" height="10" fill="#c8d2e4"/><rect x="15" y="9" width="6" height="12" fill="#e8a33c"/>',
  skins: '<rect x="3" y="3" width="8" height="8" rx="2" fill="#e8464f"/><rect x="13" y="3" width="8" height="8" rx="2" fill="#2a9d4a"/><rect x="3" y="13" width="8" height="8" rx="2" fill="#2f74d0"/><rect x="13" y="13" width="8" height="8" rx="2" fill="#f4b93c"/>',
  spin: '<circle cx="12" cy="12" r="9" fill="#5a2bd8"/><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="#ffd24a"/><path d="M12 21a9 9 0 0 1-9-9h9z" fill="#43c59e"/><circle cx="12" cy="12" r="2.4" fill="#fff"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="#2f74d0"/><path d="M3 12h18M12 3c3 3.6 3 14.4 0 18M12 3c-3 3.6-3 14.4 0 18" stroke="#bfe0ff" stroke-width="1.4" fill="none"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="#ffd24a"/><path d="M10 14h4v4h-4z" fill="#e8a33c"/><rect x="7" y="18" width="10" height="2.6" rx="1" fill="#b8842a"/>',
  vs: '<rect x="3" y="5" width="18" height="12" rx="2" fill="#1b2436"/><text x="12" y="14" font-size="8" fill="#7ce095" text-anchor="middle" font-weight="700">VS</text>',
  phone: '<rect x="5" y="3" width="6" height="18" rx="1.6" fill="#8fd6ff"/><rect x="13" y="3" width="6" height="18" rx="1.6" fill="#c8f0ff"/>',
  snake: '<path d="M5 18c6 0 4-6 9-6" stroke="#43c59e" stroke-width="3.4" fill="none" stroke-linecap="round"/><circle cx="15" cy="12" r="2.4" fill="#2a9d4a"/><path d="M6 5h9M6 9h9" stroke="#f4b93c" stroke-width="2"/>',
  bolt: '<path d="M13 2L5 14h5l-1 8 8-12h-5z" fill="#ffd24a"/>',
};

function svg(name, size = 24) {
  return (
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    (ICON[name] || '') +
    '</svg>'
  );
}

/** Mode / feature tiles, in reference order. */
const TILES = [
  { id: 'vsComputer', icon: 'vs', titleKey: 'home.computer', cls: 'green', base: 34000 },
  { id: 'quickMatch', icon: 'bolt', titleKey: 'home.quick', cls: 'teal', base: 30000 },
  { id: 'passPlay', icon: 'phone', titleKey: 'home.passPlay', cls: 'yellow', base: 28000 },
  { id: 'bigWin', icon: 'trophy', titleKey: 'home.bigWin', subKey: 'home.bigWinSub', cls: 'gold', base: 41000 },
  { id: 'goldRoom', icon: 'coin', titleKey: 'home.goldRoom', cls: 'amber', base: 18000 },
  { id: 'tournament', icon: 'lucky', titleKey: 'home.tournament', cls: 'crimson', base: 95000, soon: true },
  { id: 'friends', icon: 'friends', titleKey: 'home.friends', cls: 'cyan', base: 12000, soon: true },
  { id: 'snakes', icon: 'snake', titleKey: 'home.snakes', cls: 'violet', base: 24000, soon: true },
];

/** Left rail entries. */
const RAIL = [
  { id: 'tasks', icon: 'task', labelKey: 'rail.task' },
  { id: 'spinEvent', icon: 'gift', labelKey: 'rail.event', tag: 'NEW' },
  { id: 'vip', icon: 'cake', labelKey: 'rail.lucky', tag: 'NEW' },
  { id: 'removeAds', icon: 'ads', labelKey: 'rail.removeAds' },
  { id: 'shop', icon: 'shop', labelKey: 'rail.shop' },
  { id: 'messages', icon: 'mail', labelKey: 'rail.message' },
];

/** Bottom navigation. */
const NAV = [
  { id: 'getCoins', icon: 'coin', labelKey: 'nav.getCoins' },
  { id: 'friends', icon: 'friends', labelKey: 'nav.friends' },
  { id: 'ranking', icon: 'ranking', labelKey: 'nav.ranking' },
  { id: 'skins', icon: 'skins', labelKey: 'nav.skins' },
  { id: 'spin', icon: 'spin', labelKey: 'nav.spin' },
];

/**
 * @param {object} o { el, bus, i18n, account, wallet, catalog, ads, prefs, audio, actions }
 */
export function createHome(o) {
  const { el, bus, i18n, account, wallet, catalog, prefs, audio } = o;
  const actions = o.actions || {};
  const t = (k, v) => i18n.t(k, v);

  const $ = (name) => el.querySelector('[data-home="' + name + '"]');
  const avatarSlot = $('avatar');
  const nameEl = $('name');
  const xpFill = $('xpfill');
  const vipEl = $('vip');
  const coinVal = $('coinval');
  const gemVal = $('gemval');
  const onlineCount = $('onlineCount');
  const railEl = $('rail');
  const tilesEl = $('tiles');
  const navEl = $('nav');
  const mascotCanvas = $('mascot');

  let visible = false;
  let raf = 0;
  let counts = {};
  let countTimer = 0;

  /* ─────────────────────────── simulated presence ─────────────────────── */

  function drift(base) {
    const wave = Math.sin(Date.now() / 90000 + base) * 0.08;
    const jitter = (Math.random() - 0.5) * 0.02;
    return Math.max(120, Math.round(base * (1 + wave + jitter)));
  }

  function refreshCounts() {
    counts.online = drift(69000);
    if (onlineCount) onlineCount.textContent = counts.online.toLocaleString('en-IN');
    for (const tile of TILES) {
      counts[tile.id] = drift(tile.base);
      const node = tilesEl.querySelector('[data-count="' + tile.id + '"]');
      if (node) node.textContent = counts[tile.id].toLocaleString('en-IN');
    }
  }

  /* ──────────────────────────────── build ────────────────────────────── */

  function tap(fn, arg) {
    return () => {
      audio.unlock();
      audio.sfx.tap();
      if (typeof fn === 'function') fn(arg);
      else if (actions.onMissing) actions.onMissing(arg);
    };
  }

  function buildRail() {
    railEl.textContent = '';
    for (const item of RAIL) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rail-btn';
      b.dataset.rail = item.id;
      b.innerHTML =
        '<span class="rail-ico">' + svg(item.icon, 26) + '</span>' +
        '<span class="rail-label">' + t(item.labelKey) + '</span>' +
        (item.tag ? '<span class="rail-tag">' + item.tag + '</span>' : '') +
        '<span class="rail-badge" hidden></span>';
      b.addEventListener('click', tap(actions.onRail, item.id));
      railEl.append(b);
    }
  }

  function buildTiles() {
    tilesEl.textContent = '';
    for (const tile of TILES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile tile--' + tile.cls + (tile.soon ? ' is-soon' : '');
      b.setAttribute('role', 'listitem');
      b.dataset.tile = tile.id;
      b.innerHTML =
        (tile.soon ? '<span class="tile-soon">SOON</span>' : '') +
        (tile.badge || tile.badgeKey ? '<span class="tile-badge">' + (tile.badge || t(tile.badgeKey)) + '</span>' : '') +
        '<span class="tile-art">' + svg(tile.icon, 40) + '</span>' +
        '<span class="tile-title">' + t(tile.titleKey) + '</span>' +
        '<span class="tile-count"><i class="tile-people"></i><b data-count="' + tile.id + '">0</b></span>';
      b.addEventListener('click', tap(actions.onTile, tile.id));
      tilesEl.append(b);
    }
  }

  function buildNav() {
    navEl.textContent = '';
    for (const item of NAV) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-btn';
      b.dataset.nav = item.id;
      b.innerHTML =
        '<span class="nav-ico">' + svg(item.icon, 30) + '</span>' +
        '<span class="nav-label">' + t(item.labelKey) + '</span>' +
        '<span class="nav-badge" hidden></span>';
      b.addEventListener('click', tap(actions.onNav, item.id));
      navEl.append(b);
    }
  }

  /* ──────────────────────────────── update ───────────────────────────── */

  function renderMoney() {
    if (coinVal) coinVal.textContent = formatAmount(wallet.coins);
    if (gemVal) gemVal.textContent = formatAmount(wallet.diamonds);
  }

  function renderAccount() {
    const me = account.snapshot();
    if (nameEl) nameEl.textContent = me.name;
    if (xpFill) xpFill.style.setProperty('width', Math.round(me.xpRatio * 100) + '%');
    if (vipEl) vipEl.hidden = !me.isVip;
    if (avatarSlot) {
      avatarSlot.textContent = '';
      const frame = catalog ? catalog.equippedItem('frame') : null;
      avatarSlot.append(
        makeAvatarCanvas(46, {
          avatar: me.avatar,
          frame: frame ? frame.art : null,
          initial: me.name,
          level: me.level,
          xpRatio: me.xpRatio,
          levelColor: me.tier.color,
        })
      );
    }
  }

  /** Show a badge (e.g. claimable rewards) on a rail or nav button. */
  function setBadge(where, id, value) {
    const root = where === 'nav' ? navEl : railEl;
    const btn = root.querySelector('[data-' + (where === 'nav' ? 'nav' : 'rail') + '="' + id + '"]');
    if (!btn) return;
    const badge = btn.querySelector(where === 'nav' ? '.nav-badge' : '.rail-badge');
    if (!badge) return;
    if (!value) {
      badge.hidden = true;
      badge.textContent = '';
    } else {
      badge.hidden = false;
      badge.textContent = String(value);
    }
  }

  function renderAll() {
    renderMoney();
    renderAccount();
    refreshCounts();
  }

  /* ──────────────────────────────── mascot ───────────────────────────── */

  function sizeMascot() {
    if (!mascotCanvas) return;
    const rect = mascotCanvas.getBoundingClientRect();
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const w = Math.max(60, Math.round(rect.width || 120));
    const h = Math.max(60, Math.round(rect.height || 120));
    mascotCanvas.width = Math.round(w * dpr);
    mascotCanvas.height = Math.round(h * dpr);
    return { w, h, dpr };
  }

  function loop(ts) {
    if (!visible || !mascotCanvas) return;
    const ctx = mascotCanvas.getContext('2d');
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const w = mascotCanvas.width / dpr;
    const h = mascotCanvas.height / dpr;
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawMascot(ctx, w / 2, h / 2, Math.min(w, h) * 0.7, ts);
    }
    raf = requestAnimationFrame(loop);
  }

  /* ───────────────────────────── subscriptions ───────────────────────── */

  bus.on('wallet:changed', renderMoney);
  bus.on('account:changed', renderAccount);
  bus.on('catalog:equipped', (p) => {
    if (p.kind === 'frame') renderAccount();
  });
  bus.on('account:levelUp', (p) => {
    renderAccount();
    bus.emit(EVENTS.TOAST, { text: t('level.up', { level: p.level }), kind: 'good' });
  });
  if (i18n.subscribe) {
    i18n.subscribe(() => {
      buildRail();
      buildTiles();
      buildNav();
      renderAll();
    });
  }

  el.querySelector('[data-home="profile"]').addEventListener('click', tap(actions.onProfile));
  el.querySelector('[data-home="coins"]').addEventListener('click', tap(actions.onShop, 'coins'));
  el.querySelector('[data-home="gems"]').addEventListener('click', tap(actions.onShop, 'diamonds'));
  el.querySelector('[data-home="settings"]').addEventListener('click', tap(actions.onSettings));
  el.querySelector('[data-home="online"]').addEventListener('click', tap(actions.onTile, 'online'));

  buildRail();
  buildTiles();
  buildNav();
  renderAll();

  return {
    render: renderAll,
    setBadge,
    /** Theme the lobby art to the current board theme. */
    applyTheme(id) {
      const theme = getTheme(id);
      el.style.setProperty('--lobby-accent', theme.players.yellow.main);
    },
    start() {
      if (visible) return;
      visible = true;
      sizeMascot();
      renderAll();
      raf = requestAnimationFrame(loop);
      countTimer = setInterval(refreshCounts, 4000);
      if (countTimer && typeof countTimer.unref === 'function') countTimer.unref();
    },
    stop() {
      visible = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (countTimer) clearInterval(countTimer);
      countTimer = 0;
    },
    counts: () => ({ ...counts }),
    TILES,
    RAIL,
    NAV,
    prefs,
  };
}
