/**
 * ui/online.js — Online Multiplayer setup, the matchmaking overlay and the
 * Gold Room (watch a live table).
 *
 * Phase 1 plays these against SimulatedOnlineAdapter, so the screens already
 * drive the real online code path (actions arriving over a "wire", ordered by
 * `n`, applied through controller.applyRemoteAction). Phase 2 swaps the adapter
 * for FirebaseAdapter and none of this file changes.
 *
 * DOM only. No game logic, no state ownership.
 */

import { STAKE_TIERS, formatAmount, tierById } from '../meta/wallet.js';
import { itemById } from '../meta/catalog.js';
import { makeAvatarCanvas } from '../render/avatar.js';
import { h, mount } from './dom.js';
import { createOverlay } from './screens.js';

export const FORMATS = Object.freeze([
  { id: 'classic', labelKey: 'online.classic' },
  { id: 'quick', labelKey: 'online.quick' },
]);

export const SEAT_COUNTS = Object.freeze([2, 4]);

/** Avatar for a social-pool player (or me, who wears the equipped frame). */
function avatarFor(player, size, catalog) {
  const own = player.isMe && catalog ? catalog.equippedItem('frame') : null;
  const art = own ? own.art : player.frame ? (itemById(player.frame) || {}).art : null;
  return makeAvatarCanvas(size, {
    avatar: player.avatar,
    frame: art,
    initial: player.name || '?',
    level: player.level,
  });
}

/* ───────────────────────── online multiplayer modal ──────────────────── */

/**
 * The stake / format / seats picker.
 * @param {object} o { el, bus, i18n, wallet, account, catalog, audio, onPlay }
 */
export function createOnlineModal(o) {
  const { el, bus, i18n, wallet, account, catalog, audio } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const bodyEl = el.querySelector('[data-online="body"]');

  el.querySelector('[data-online="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  let format = 'classic';
  let seats = 2;
  let tierIndex = 0;
  let nearby = false;

  /** Default to the biggest table the player can actually pay for. */
  function affordableIndex() {
    let idx = 0;
    STAKE_TIERS.forEach((tier, i) => {
      if (wallet.coins >= tier.entry) idx = i;
    });
    return idx;
  }

  function chips(label, items, current, pick) {
    return h(
      'div.field',
      null,
      label ? h('span.field-label', { text: label }) : null,
      h(
        'div.chip-row',
        null,
        items.map((item) =>
          h('button.chip', {
            type: 'button',
            text: item.label,
            dataset: { chip: item.value },
            aria: { pressed: item.value === current },
            class: { 'is-on': item.value === current },
            onclick: () => {
              audio.sfx.tap();
              pick(item.value);
            },
          })
        )
      )
    );
  }

  /** Winner / entry card with − and + steppers, like the reference app. */
  function stakePicker() {
    const tier = STAKE_TIERS[tierIndex];
    const step = (dir, dis, next) =>
      h('button.stake-step', {
        type: 'button',
        text: dir,
        disabled: dis,
        dataset: { stake: dir === '+' ? 'up' : 'down' },
        onclick: () => {
          audio.sfx.tap();
          tierIndex = next;
          render();
        },
      });

    return h(
      'div.stake',
      null,
      step('−', tierIndex === 0, Math.max(0, tierIndex - 1)),
      h(
        'div.stake-card',
        null,
        h('span.stake-win', null, h('i.cost-ico.cost-ico--coin'), formatAmount(tier.winner)),
        h('b.stake-tier', { text: tier.label }),
        h('span.stake-entry', { text: t('common.entry') + ': ' + formatAmount(tier.entry) })
      ),
      step('+', tierIndex >= STAKE_TIERS.length - 1, Math.min(STAKE_TIERS.length - 1, tierIndex + 1))
    );
  }

  /** The three cosmetics you carry into the match. */
  function skinStrip() {
    return h(
      'div.skin-strip',
      null,
      ['dice', 'theme', 'frame'].map((kind) => {
        const item = catalog.equippedItem(kind);
        return h(
          'div.skin-strip-cell',
          { dataset: { equipped: kind } },
          h('b', { text: item.name }),
          h('span', { text: t('skins.' + kind) })
        );
      })
    );
  }

  function render() {
    const tier = STAKE_TIERS[tierIndex];
    const me = account.snapshot();

    mount(
      bodyEl,
      chips(
        t('online.title'),
        FORMATS.map((f) => ({ value: f.id, label: t(f.labelKey) })),
        format,
        (v) => {
          format = v;
          render();
        }
      ),
      chips(
        t('common.players'),
        SEAT_COUNTS.map((n) => ({ value: n, label: t('online.' + n + 'p') })),
        seats,
        (v) => {
          seats = v;
          render();
        }
      ),
      skinStrip(),
      stakePicker(),
      h('p.online-exp', { text: 'EXP +' + tier.exp + ' · ' + t('common.level') + ' ' + me.level }),
      h('p.shop-notice', { text: t('online.simulated') }),
      h('button.btn.btn--primary.btn--wide', {
        type: 'button',
        text: t('common.play'),
        disabled: wallet.coins < tier.entry,
        dataset: { online: 'play' },
        onclick: () => {
          audio.sfx.tap();
          overlay.close();
          if (o.onPlay) o.onPlay({ format, seats, tierId: tier.id, nearby });
        },
      }),
      h(
        'label.nearby',
        null,
        h('input', {
          type: 'checkbox',
          checked: nearby,
          onchange: (e) => {
            nearby = !!e.target.checked;
          },
        }),
        h('span', { text: t('online.meetNearby') })
      )
    );
  }

  bus.on('wallet:changed', () => {
    if (overlay.isOpen) render();
  });

  return {
    open(opts = {}) {
      const found = opts.tierId ? STAKE_TIERS.findIndex((x) => x.id === opts.tierId) : -1;
      tierIndex = found >= 0 ? found : affordableIndex();
      if (opts.seats) seats = opts.seats;
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

/* ─────────────────────────── matchmaking overlay ─────────────────────── */

/**
 * Fills the seats one by one, then resolves with the opponents that joined.
 * Cancelling rejects with an Error('cancelled').
 * @param {object} o { el, i18n, audio, social, catalog, rng }
 */
export function createMatchmaking(o) {
  const { el, i18n, audio, social, catalog } = o;
  const t = (k, v) => i18n.t(k, v);
  const rng = o.rng || Math.random;
  const overlay = createOverlay(el);
  const slotsEl = el.querySelector('[data-match="slots"]');
  const statusEl = el.querySelector('[data-match="status"]');
  const timers = new Set();
  let cancelled = false;
  /** Set while a search is running, so cancelling settles the promise at once. */
  let abort = null;

  function stopTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  /** Stop searching and settle the pending promise — never leave it dangling. */
  function cancel() {
    cancelled = true;
    stopTimers();
    overlay.close();
    if (abort) {
      const reject = abort;
      abort = null;
      reject(new Error('cancelled'));
    }
  }

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    if (id && typeof id.unref === 'function') id.unref();
    return id;
  }

  el.querySelector('[data-match="cancel"]').addEventListener('click', () => {
    audio.sfx.tap();
    cancel();
  });

  function slot(player) {
    if (!player) return h('div.match-slot', { dataset: { slot: 'empty' } }, h('span.match-spinner'));
    return h(
      'div.match-slot.is-filled',
      { dataset: { slot: player.id || 'me' } },
      avatarFor(player, 54, catalog),
      h('span.match-name', { text: player.name })
    );
  }

  /**
   * @param {number} seats how many players the table needs
   * @returns {Promise<object[]>} the opponents (excluding me), in join order
   */
  function find(seats) {
    cancelled = false;
    stopTimers();

    const me = { ...social.me(), isMe: true };
    const pool = social.pool().filter((p) => !social.isBlocked(p.id));
    const opponents = [];
    for (let i = 0; i < seats - 1 && pool.length; i++) {
      const pick = pool[Math.floor(rng() * pool.length)];
      opponents.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }

    const joined = [me];
    const paint = () => {
      mount(slotsEl, ...Array.from({ length: seats }, (_, i) => slot(joined[i])));
      statusEl.textContent =
        joined.length >= seats ? t('online.found') : t('online.searching') + ' ' + joined.length + '/' + seats;
    };

    paint();
    overlay.open();
    audio.sfx.swipe();

    return new Promise((resolve, reject) => {
      abort = reject;
      let step = 0;
      const next = () => {
        if (cancelled) return; // cancel() already rejected
        if (joined.length >= seats) {
          audio.sfx.six();
          paint();
          later(() => {
            abort = null;
            overlay.close();
            resolve(opponents);
          }, 620);
          return;
        }
        joined.push(opponents[step++]);
        paint();
        later(next, 420 + rng() * 520);
      };
      later(next, 480);
    });
  }

  return {
    find,
    close: cancel,
    get isOpen() {
      return overlay.isOpen;
    },
  };
}

/* ────────────────────────────── gold room ───────────────────────────── */

/**
 * Live tables you can watch, plus a "play this tier" button. Rows come from the
 * social pool so the list looks and behaves like a real lobby.
 * @param {object} o { el, i18n, audio, social, catalog, wallet, onWatch, onPlay }
 */
export function createGoldRoom(o) {
  const { el, i18n, audio, social, catalog, wallet } = o;
  const t = (k, v) => i18n.t(k, v);
  const rng = o.rng || Math.random;
  const overlay = createOverlay(el);
  const titleEl = el.querySelector('[data-modal="title"]');
  const tabsEl = el.querySelector('[data-modal="tabs"]');
  const bodyEl = el.querySelector('[data-modal="body"]');

  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  /** Tiers worth spectating start at silver. */
  const TIERS = STAKE_TIERS.slice(2);
  let tierId = TIERS[1] ? TIERS[1].id : TIERS[0].id;

  /** Deterministic-ish fake tables for the current tier. */
  function tables(count = 6) {
    const pool = social.pool();
    const tier = tierById(tierId);
    const out = [];
    for (let i = 0; i < count && pool.length > 1; i++) {
      const a = pool[(i * 3 + 1) % pool.length];
      const b = pool[(i * 5 + 4) % pool.length];
      if (a.id === b.id) continue;
      out.push({
        id: tierId + '-' + i,
        tierId,
        a,
        b,
        heat: tier.entry * (2 + Math.floor(rng() * 4)),
        left: 40 + Math.floor(rng() * 900),
        double: i % 4 === 0,
      });
    }
    return out;
  }

  function clock(secs) {
    const m = Math.floor(secs / 60);
    return String(m).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
  }

  function tableRow(table) {
    return h(
      'button.gold-row',
      {
        type: 'button',
        dataset: { table: table.id },
        onclick: () => {
          audio.sfx.tap();
          overlay.close();
          if (o.onWatch) o.onWatch(table);
        },
      },
      table.double ? h('span.gold-x2', { text: 'x2' }) : null,
      h('span.gold-side', null, avatarFor(table.a, 44, catalog), h('b', { text: table.a.name })),
      h(
        'span.gold-mid',
        null,
        h('span.gold-clock', { text: clock(table.left) }),
        h('span.gold-vs', { text: 'VS' }),
        h('span.gold-heat', null, h('i.cost-ico.cost-ico--coin'), formatAmount(table.heat))
      ),
      h('span.gold-side', null, avatarFor(table.b, 44, catalog), h('b', { text: table.b.name }))
    );
  }

  function render() {
    titleEl.textContent = t('gold.title');

    mount(
      tabsEl,
      ...TIERS.map((tier) =>
        h('button.modal-tab', {
          type: 'button',
          text: tier.label,
          attrs: { role: 'tab' },
          dataset: { tab: tier.id },
          aria: { selected: tier.id === tierId },
          onclick: () => {
            audio.sfx.tap();
            tierId = tier.id;
            render();
          },
        })
      )
    );

    const tier = tierById(tierId);
    mount(
      bodyEl,
      h('p.muted', { text: t('gold.watch') }),
      ...tables().map(tableRow),
      h('button.btn.btn--primary.btn--wide', {
        type: 'button',
        text: t('common.play') + ' · ' + t('common.entry') + ' ' + formatAmount(tier.entry),
        disabled: wallet.coins < tier.entry,
        dataset: { gold: 'play' },
        onclick: () => {
          audio.sfx.tap();
          overlay.close();
          if (o.onPlay) o.onPlay({ format: 'classic', seats: 2, tierId });
        },
      })
    );
  }

  return {
    open(startTier) {
      if (startTier && TIERS.some((x) => x.id === startTier)) tierId = startTier;
      render();
      overlay.open();
    },
    close: overlay.close,
    render,
    tables,
    get isOpen() {
      return overlay.isOpen;
    },
  };
}
