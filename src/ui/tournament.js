/**
 * ui/tournament.js — the Tournament screen: All Day and Blitz Arena.
 *
 * One entry fee opens a session with a countdown and a few lives; every table
 * you finish scores, and only your best score of the session is ranked. DOM
 * only: the arena rules live in meta/tournament.js.
 */

import { EVENTS } from '../game/events.js';
import { formatAmount } from '../meta/wallet.js';
import { itemById } from '../meta/catalog.js';
import { makeAvatarCanvas } from '../render/avatar.js';
import { h, mount } from './dom.js';
import { createOverlay } from './screens.js';

/** hh:mm:ss for anything over an hour, mm:ss below it. */
export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const hrs = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? hrs + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
}

/**
 * @param {object} o { el, bus, i18n, tournament, wallet, ads, audio, catalog, onPlay }
 */
export function createTournamentScreen(o) {
  const { el, bus, i18n, tournament, wallet, ads, audio, catalog } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const titleEl = el.querySelector('[data-modal="title"]');
  const tabsEl = el.querySelector('[data-modal="tabs"]');
  const bodyEl = el.querySelector('[data-modal="body"]');

  let arenaId = tournament.ARENAS[0].id;
  let ticker = 0;

  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  /** Pay out an expired session before drawing, so the screen never lies. */
  function settleIfOver() {
    for (const arena of tournament.ARENAS) {
      const state = tournament.state(arena.id);
      if (!state.expired) continue;
      const out = tournament.settle(arena.id);
      if (!out.closed) continue;
      if (out.prize > 0) {
        bus.emit(EVENTS.TOAST, {
          text: t('tour.prize', { amount: formatAmount(out.prize) }) + ' · ' + t('tour.myRank', { rank: out.rank }),
          kind: 'good',
          ms: 3200,
        });
      } else {
        bus.emit(EVENTS.TOAST, { text: t('tour.ended'), kind: 'info' });
      }
    }
  }

  function tabs() {
    return tournament.ARENAS.map((arena) =>
      h('button.modal-tab', {
        type: 'button',
        text: t(arena.titleKey),
        attrs: { role: 'tab' },
        dataset: { tab: arena.id },
        aria: { selected: arena.id === arenaId },
        onclick: () => {
          audio.sfx.tap();
          arenaId = arena.id;
          render();
        },
      })
    );
  }

  function head(state) {
    return h(
      'div.tour-head',
      null,
      h(
        'div.tour-clock',
        null,
        h('span.tour-clock-label', { text: t('tour.endsIn') }),
        h('b.tour-clock-value', {
          dataset: { tour: 'clock' },
          text: state.entered ? formatClock(state.msLeft) : '--:--',
        })
      ),
      h(
        'div.tour-score',
        null,
        h('span', { text: t('tour.best') }),
        h('b', { text: String(state.best) }),
        h('span.tour-games', { text: state.games + ' × ' + t('tour.score').toLowerCase() })
      )
    );
  }

  function lives(state) {
    const row = h('div.tour-lives', null, h('span.field-label', { text: t('tour.lives') }));
    const total = Math.max(state.arena.lives, state.lives);
    for (let i = 0; i < total; i++) {
      row.append(h('i.tour-life', { class: { 'is-spent': i >= state.lives } }));
    }
    return row;
  }

  function boardRow(row) {
    const frameArt = row.isMe && catalog ? catalog.equippedItem('frame').art : (itemById(row.frame) || {}).art;
    return h(
      'div.tour-row',
      { class: { 'is-me': row.isMe }, dataset: { lb: row.id } },
      h('b.tour-rank', { text: '#' + row.rank }),
      makeAvatarCanvas(34, { avatar: row.avatar, frame: frameArt, initial: row.name, level: row.level }),
      h('span.tour-name', { text: row.isMe ? t('rank.you') : row.name }),
      h('span.tour-points', { text: String(row.score) }),
      h(
        'span.tour-gift',
        null,
        row.prize > 0 ? h('i.cost-ico.cost-ico--coin') : null,
        row.prize > 0 ? formatAmount(row.prize) : '—'
      )
    );
  }

  function actions(state) {
    const arena = state.arena;
    if (!state.entered) {
      return h('button.btn.btn--primary.btn--wide', {
        type: 'button',
        text: t('tour.enter', { amount: formatAmount(arena.entry) }),
        disabled: wallet.coins < arena.entry,
        dataset: { tour: 'enter' },
        onclick: () => {
          audio.sfx.tap();
          if (!tournament.enter(arena.id)) return;
          render();
        },
      });
    }

    const out = [
      h('button.btn.btn--primary.btn--wide', {
        type: 'button',
        text: t('tour.play'),
        disabled: !state.canPlay,
        dataset: { tour: 'play' },
        onclick: () => {
          audio.sfx.tap();
          if (!tournament.useLife(arena.id)) return;
          overlay.close();
          if (o.onPlay) o.onPlay({ arenaId: arena.id, seats: arena.seats });
        },
      }),
    ];

    if (state.lives <= 0) {
      out.push(
        h('button.btn.btn--ghost.btn--wide', {
          type: 'button',
          text: t('tour.extraLife'),
          dataset: { tour: 'life' },
          onclick: async () => {
            audio.sfx.tap();
            const res = await ads.watch('extraLife');
            if (res && res.completed) {
              tournament.addLife(arena.id, 1);
              render();
            }
          },
        })
      );
    }
    return out;
  }

  function render() {
    settleIfOver();
    const state = tournament.state(arenaId);

    titleEl.textContent = t('tour.title');
    mount(tabsEl, ...tabs());

    const board = tournament.board(arenaId);
    // Show the top of the table, but always pin my own row: a leaderboard that
    // hides you is useless while you are still climbing it.
    const visible = board.slice(0, 20);
    const mine = board.find((r) => r.isMe);
    if (mine && !visible.includes(mine)) visible.push(mine);

    mount(
      bodyEl,
      head(state),
      lives(state),
      h(
        'div.tour-board',
        null,
        h(
          'div.tour-row.tour-row--head',
          null,
          h('b.tour-rank', { text: '#' }),
          h('span.tour-name', { text: t('tour.player') }),
          h('span.tour-points', { text: t('tour.highest') }),
          h('span.tour-gift', { text: t('tour.gift') })
        ),
        ...visible.map(boardRow)
      ),
      h('p.muted', { text: t('tour.myRank', { rank: tournament.myRank(arenaId) }) }),
      actions(state)
    );
  }

  /** Only the clock redraws every second — the list stays put. */
  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      const node = el.querySelector('[data-tour="clock"]');
      const state = tournament.state(arenaId);
      if (!node) return;
      if (state.expired) {
        render();
        return;
      }
      node.textContent = state.entered ? formatClock(state.msLeft) : '--:--';
    }, 1000);
    if (ticker && typeof ticker.unref === 'function') ticker.unref();
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = 0;
  }

  // Anything that changes the session changes this screen.
  for (const evt of ['tour:score', 'tour:lives', 'tour:entered', 'tour:closed']) {
    bus.on(evt, () => {
      if (overlay.isOpen) render();
    });
  }

  return {
    open(which) {
      if (which && tournament.ARENAS.some((a) => a.id === which)) arenaId = which;
      render();
      overlay.open({ onClose: stopTicker });
      startTicker();
    },
    close() {
      stopTicker();
      overlay.close();
    },
    render,
    get arena() {
      return arenaId;
    },
    get isOpen() {
      return overlay.isOpen;
    },
  };
}
