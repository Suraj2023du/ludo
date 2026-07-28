/**
 * ui/social.js — Friends list, the profile card (yours and other players') and
 * the four leaderboards. All avatars and podiums are drawn in code.
 */

import { EVENTS } from '../game/events.js';
import { formatAmount } from '../meta/wallet.js';
import { itemById } from '../meta/catalog.js';
import { makeAvatarCanvas } from '../render/avatar.js';
import { createOverlay } from './screens.js';

const FLAG = { IN: '🇮🇳', PK: '🇵🇰', BD: '🇧🇩', NP: '🇳🇵', LK: '🇱🇰', US: '🇺🇸', GB: '🇬🇧', AE: '🇦🇪', ID: '🇮🇩', BR: '🇧🇷' };

function frameArtOf(id) {
  const item = id ? itemById(id) : null;
  return item ? item.art : null;
}

function avatarFor(player, size, catalog) {
  const frame = player.isMe && catalog ? catalog.equippedItem('frame') : null;
  return makeAvatarCanvas(size, {
    avatar: player.avatar,
    frame: frame ? frame.art : frameArtOf(player.frame),
    initial: player.name,
    level: player.level,
  });
}

/* ──────────────────────────── friends modal ──────────────────────────── */

/**
 * @param {object} o { el, bus, i18n, social, audio, catalog, onPlay, onProfile }
 */
export function createFriendsModal(o) {
  const { el, bus, i18n, social, audio, catalog } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const titleEl = el.querySelector('[data-modal="title"]');
  const tabsEl = el.querySelector('[data-modal="tabs"]');
  const bodyEl = el.querySelector('[data-modal="body"]');
  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  let tab = 'friends';
  const TABS = [
    { id: 'friends', labelKey: 'friends.list' },
    { id: 'requests', labelKey: 'friends.requests' },
    { id: 'nearby', labelKey: 'friends.contacts' },
    { id: 'inbox', labelKey: 'friends.messages' },
  ];
  const toast = (text, kind) => bus.emit(EVENTS.TOAST, { text, kind: kind || 'info' });

  function row(player, mode) {
    const wrap = document.createElement('div');
    wrap.className = 'friend';
    wrap.dataset.friend = player.id;

    const pic = document.createElement('button');
    pic.type = 'button';
    pic.className = 'friend-pic';
    pic.append(avatarFor(player, 44, catalog));
    pic.addEventListener('click', () => {
      audio.sfx.tap();
      overlay.close();
      if (o.onProfile) o.onProfile(player.id);
    });

    const meta = document.createElement('div');
    meta.className = 'friend-meta';
    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = player.name;
    const sub = document.createElement('span');
    sub.className = 'friend-sub';
    sub.textContent =
      (FLAG[player.country] || '') + ' ' + t('profile.level', { level: player.level }) +
      ' · ' + t(player.online ? 'friends.online' : 'friends.offline');
    meta.append(name, sub);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'friend-action';
    if (mode === 'requests') {
      action.textContent = t('friends.accept');
      action.addEventListener('click', () => {
        const res = social.addFriend(player.id);
        audio.sfx[res.ok ? 'six' : 'deny']();
        if (res.ok) toast(t('friends.added', { name: player.name }), 'good');
        render();
      });
    } else if (mode === 'nearby') {
      action.textContent = t('friends.add');
      action.addEventListener('click', () => {
        const res = social.addFriend(player.id);
        audio.sfx[res.ok ? 'six' : 'deny']();
        if (res.ok) toast(t('friends.added', { name: player.name }), 'good');
        render();
      });
    } else {
      action.textContent = t('friends.play');
      action.classList.add('is-play');
      action.addEventListener('click', () => {
        audio.sfx.tap();
        overlay.close();
        if (o.onPlay) o.onPlay(player);
      });
    }

    wrap.append(pic, meta, action);
    return wrap;
  }

  function inboxRow(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'inbox-row' + (msg.read ? '' : ' is-new');
    const text = document.createElement('span');
    text.className = 'inbox-text';
    const base = msg.key ? t(msg.key, msg.vars || {}) : msg.text || '';
    text.textContent = msg.extra ? base + ' — ' + msg.extra : base;
    const when = document.createElement('span');
    when.className = 'inbox-when';
    when.textContent = new Date(msg.at).toLocaleDateString();
    wrap.append(text, when);
    return wrap;
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
      let label = t(item.labelKey);
      if (item.id === 'requests' && social.requests().length) label += ' (' + social.requests().length + ')';
      if (item.id === 'inbox' && social.unread()) label += ' (' + social.unread() + ')';
      b.textContent = label;
      b.addEventListener('click', () => {
        audio.sfx.tap();
        tab = item.id;
        if (tab === 'inbox') social.markAllRead();
        render();
      });
      tabsEl.append(b);
    }
  }

  function render() {
    titleEl.textContent = t('friends.title') + ' ' + t('friends.count', { count: social.friendCount() });
    buildTabs();
    bodyEl.textContent = '';

    if (tab === 'inbox') {
      const list = social.inbox();
      if (!list.length) bodyEl.append(empty(t('friends.inboxEmpty')));
      else for (const msg of list) bodyEl.append(inboxRow(msg));
      return;
    }

    const people = tab === 'friends' ? social.friends() : tab === 'requests' ? social.requests() : social.nearby();
    if (!people.length) {
      bodyEl.append(empty(t('friends.empty')));
      return;
    }
    for (const player of people) bodyEl.append(row(player, tab));
  }

  function empty(text) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    return p;
  }

  bus.on('social:friends', () => {
    if (overlay.isOpen) render();
  });

  return {
    open(startTab) {
      if (startTab) tab = startTab;
      if (tab === 'inbox') social.markAllRead();
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

/* ──────────────────────────── profile card ───────────────────────────── */

/**
 * @param {object} o { el, bus, i18n, social, account, wallet, catalog, stats, audio, onPlay }
 */
export function createProfileCard(o) {
  const { el, bus, i18n, social, account, catalog, stats, audio } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const bodyEl = el.querySelector('[data-profile="body"]');
  const titleEl = el.querySelector('[data-profile="title"]');
  el.querySelector('[data-profile="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  const toast = (text, kind) => bus.emit(EVENTS.TOAST, { text, kind: kind || 'info' });
  let current = null;

  function statBlock(label, value) {
    const b = document.createElement('div');
    b.className = 'pstat';
    b.innerHTML = '<b>' + value + '</b><span>' + label + '</span>';
    return b;
  }

  function renderSelf() {
    const me = account.snapshot();
    const total = stats ? stats.all().total : { games: 0, wins: 0 };
    titleEl.textContent = t('profile.title') + ' · ID ' + me.id;

    const head = document.createElement('div');
    head.className = 'phead';
    const pic = document.createElement('span');
    pic.className = 'ppic';
    pic.append(
      makeAvatarCanvas(96, {
        avatar: me.avatar,
        frame: catalog ? catalog.equippedItem('frame').art : null,
        initial: me.name,
        level: me.level,
        xpRatio: me.xpRatio,
        levelColor: me.tier.color,
      })
    );
    const badge = document.createElement('span');
    badge.className = 'ptier';
    badge.style.setProperty('--c', me.tier.color);
    badge.textContent = me.tier.label + (me.isVip ? ' · VIP' : '');
    head.append(pic, badge);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'name-input pinput';
    nameInput.maxLength = 14;
    nameInput.value = me.name;
    nameInput.placeholder = t('profile.namePh');
    nameInput.setAttribute('aria-label', t('profile.namePh'));

    const bioInput = document.createElement('input');
    bioInput.type = 'text';
    bioInput.className = 'name-input pinput';
    bioInput.maxLength = 90;
    bioInput.value = me.bio;
    bioInput.placeholder = t('profile.bioPh');
    bioInput.setAttribute('aria-label', t('profile.bioPh'));

    const grid = document.createElement('div');
    grid.className = 'pstats';
    grid.append(
      statBlock(t('common.coins'), formatAmount(o.wallet ? o.wallet.coins : 0)),
      statBlock(t('profile.likes'), formatAmount(me.likes)),
      statBlock(t('profile.gifts'), formatAmount(me.giftsIn)),
      statBlock(t('profile.charm'), formatAmount(social.me().charm))
    );

    const record = document.createElement('div');
    record.className = 'prow';
    record.innerHTML =
      '<span>' + t('profile.gamesWon') + '</span><b>' +
      t('profile.winRate', {
        won: total.wins,
        played: total.games,
        pct: total.games ? Math.round((total.wins / total.games) * 100) : 0,
      }) +
      '</b>';

    const frames = document.createElement('div');
    frames.className = 'pframes';
    for (const id of catalog ? catalog.ownedOf('frame') : []) {
      const item = itemById(id);
      if (!item) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pframe' + (catalog.isEquipped(id) ? ' is-on' : '');
      b.dataset.frame = id;
      b.append(makeAvatarCanvas(52, { avatar: me.avatar, frame: item.art, initial: me.name }));
      b.addEventListener('click', () => {
        catalog.equip(id);
        audio.sfx.six();
        renderSelf();
      });
      frames.append(b);
    }

    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'btn btn--wide';
    reroll.textContent = t('profile.reroll');
    reroll.addEventListener('click', () => {
      audio.sfx.tap();
      account.setAvatar({ seed: Math.floor(Math.random() * 1e9), tint: Math.floor(Math.random() * 360) });
      renderSelf();
    });

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary btn--wide';
    save.textContent = t('profile.edit');
    save.addEventListener('click', () => {
      account.setName(nameInput.value);
      account.setProfile({ bio: bioInput.value });
      audio.sfx.finish();
      toast(t('profile.saved'), 'good');
      renderSelf();
    });

    bodyEl.textContent = '';
    const framesLabel = document.createElement('span');
    framesLabel.className = 'field-label';
    framesLabel.textContent = t('profile.frames');
    bodyEl.append(head, nameInput, bioInput, grid, record, framesLabel, frames, reroll, save);
  }

  function renderOther(id) {
    const p = social.player(id);
    if (!p) return;
    titleEl.textContent = p.name + ' · ID ' + p.id.slice(1);

    const head = document.createElement('div');
    head.className = 'phead';
    const pic = document.createElement('span');
    pic.className = 'ppic';
    pic.append(avatarFor(p, 96, null));
    const badge = document.createElement('span');
    badge.className = 'ptier';
    badge.textContent = (FLAG[p.country] || '') + ' ' + t('profile.level', { level: p.level });
    head.append(pic, badge);

    const bio = document.createElement('p');
    bio.className = 'muted';
    bio.textContent = p.bio;

    const grid = document.createElement('div');
    grid.className = 'pstats';
    grid.append(
      statBlock(t('common.coins'), formatAmount(p.coins)),
      statBlock(t('profile.likes'), formatAmount(p.likes)),
      statBlock(t('profile.charm'), formatAmount(p.charm)),
      statBlock(t('profile.gallantry'), formatAmount(p.gallantry))
    );

    const record = document.createElement('div');
    record.className = 'prow';
    record.innerHTML =
      '<span>' + t('profile.gamesWon') + '</span><b>' +
      t('profile.winRate', {
        won: p.gamesWon,
        played: p.gamesPlayed,
        pct: Math.round((p.gamesWon / Math.max(1, p.gamesPlayed)) * 100),
      }) +
      '</b>';

    // gifts
    const giftLabel = document.createElement('span');
    giftLabel.className = 'field-label';
    giftLabel.textContent = t('friends.gift');
    const gifts = document.createElement('div');
    gifts.className = 'gifts';
    for (const gift of social.GIFTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gift';
      b.dataset.gift = gift.id;
      b.innerHTML = '<i>' + gift.icon + '</i><b>' + gift.name + '</b><span><i class="cost-ico cost-ico--gem"></i>' + gift.cost + '</span>';
      b.addEventListener('click', () => {
        const res = social.sendGift(p.id, gift.id);
        if (res.ok) {
          audio.sfx.finish();
          toast(t('friends.giftSent') + ' ' + gift.name, 'good');
        } else {
          audio.sfx.deny();
        }
        renderOther(p.id);
      });
      gifts.append(b);
    }

    const actions = document.createElement('div');
    actions.className = 'pactions';

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn btn--primary';
    play.textContent = t('friends.play');
    play.addEventListener('click', () => {
      audio.sfx.tap();
      overlay.close();
      if (o.onPlay) o.onPlay(p);
    });

    const hi = document.createElement('button');
    hi.type = 'button';
    hi.className = 'btn';
    hi.textContent = t('friends.sayHi');
    hi.addEventListener('click', () => {
      social.like(p.id);
      audio.sfx.six();
      toast(t('friends.liked', { name: p.name }), 'good');
      renderOther(p.id);
    });

    const friendBtn = document.createElement('button');
    friendBtn.type = 'button';
    friendBtn.className = 'btn';
    const isFriend = social.isFriend(p.id);
    friendBtn.textContent = isFriend ? t('friends.delete') : t('friends.add');
    friendBtn.addEventListener('click', () => {
      if (isFriend) {
        social.removeFriend(p.id);
        toast(t('friends.removed', { name: p.name }), 'info');
      } else {
        social.addFriend(p.id);
        toast(t('friends.added', { name: p.name }), 'good');
      }
      audio.sfx.tap();
      renderOther(p.id);
    });

    const blockBtn = document.createElement('button');
    blockBtn.type = 'button';
    blockBtn.className = 'btn btn--ghost';
    blockBtn.textContent = t('friends.block');
    blockBtn.addEventListener('click', () => {
      social.block(p.id);
      audio.sfx.deny();
      toast(t('friends.blocked', { name: p.name }), 'warn');
      overlay.close();
    });

    const reportBtn = document.createElement('button');
    reportBtn.type = 'button';
    reportBtn.className = 'btn btn--ghost';
    reportBtn.textContent = t('friends.report');
    reportBtn.addEventListener('click', () => {
      social.report(p.id);
      audio.sfx.deny();
      toast(t('friends.reported'), 'warn');
      overlay.close();
    });

    actions.append(play, hi, friendBtn, blockBtn, reportBtn);

    bodyEl.textContent = '';
    bodyEl.append(head, bio, grid, record, giftLabel, gifts, actions);
  }

  return {
    open(id) {
      current = id || null;
      if (current) renderOther(current);
      else renderSelf();
      overlay.open();
    },
    close: overlay.close,
    render() {
      if (overlay.isOpen) {
        if (current) renderOther(current);
        else renderSelf();
      }
    },
    get isOpen() {
      return overlay.isOpen;
    },
  };
}

/* ──────────────────────────── leaderboards ───────────────────────────── */

/**
 * @param {object} o { el, bus, i18n, social, audio, catalog, onProfile }
 */
export function createLeaderboard(o) {
  const { el, bus, i18n, social, audio, catalog } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const titleEl = el.querySelector('[data-modal="title"]');
  const tabsEl = el.querySelector('[data-modal="tabs"]');
  const bodyEl = el.querySelector('[data-modal="body"]');
  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  let kind = 'charm';

  function buildTabs() {
    tabsEl.textContent = '';
    for (const board of social.BOARDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-tab';
      b.setAttribute('role', 'tab');
      b.dataset.tab = board.id;
      b.setAttribute('aria-selected', String(board.id === kind));
      b.textContent = t(board.labelKey);
      b.addEventListener('click', () => {
        audio.sfx.tap();
        kind = board.id;
        render();
      });
      tabsEl.append(b);
    }
  }

  function podium(rows) {
    const wrap = document.createElement('div');
    wrap.className = 'podium';
    const order = [1, 0, 2]; // 2nd, 1st, 3rd
    for (const idx of order) {
      const row = rows[idx];
      if (!row) continue;
      const col = document.createElement('button');
      col.type = 'button';
      col.className = 'podium-col podium-col--' + (idx + 1);
      col.dataset.podium = String(idx + 1);
      col.append(avatarFor(row, idx === 0 ? 62 : 50, row.isMe ? catalog : null));
      const name = document.createElement('span');
      name.className = 'podium-name';
      name.textContent = row.name;
      const value = document.createElement('span');
      value.className = 'podium-value';
      value.textContent = formatAmount(row.value);
      const step = document.createElement('span');
      step.className = 'podium-step';
      step.textContent = String(idx + 1);
      col.append(name, value, step);
      col.addEventListener('click', () => {
        audio.sfx.tap();
        if (!row.isMe && o.onProfile) {
          overlay.close();
          o.onProfile(row.id);
        }
      });
      wrap.append(col);
    }
    return wrap;
  }

  function render() {
    const out = social.leaderboard(kind, 20);
    titleEl.textContent = t('rank.title');
    buildTabs();
    bodyEl.textContent = '';
    bodyEl.append(podium(out.rows));

    if (out.me) {
      const mine = document.createElement('p');
      mine.className = 'shop-notice';
      mine.textContent = t('rank.yourPlace', { rank: out.me.rank }) + ' · ' + formatAmount(out.me.value);
      bodyEl.append(mine);
    }

    for (const row of out.rows.slice(3)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lb-row' + (row.isMe ? ' is-me' : '');
      item.dataset.lb = String(row.rank);
      const pos = document.createElement('span');
      pos.className = 'lb-pos';
      pos.textContent = String(row.rank);
      const pic = document.createElement('span');
      pic.className = 'lb-pic';
      pic.append(avatarFor(row, 34, row.isMe ? catalog : null));
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = row.isMe ? t('rank.you') : row.name;
      const value = document.createElement('span');
      value.className = 'lb-value';
      value.textContent = formatAmount(row.value);
      item.append(pos, pic, name, value);
      item.addEventListener('click', () => {
        audio.sfx.tap();
        if (!row.isMe && o.onProfile) {
          overlay.close();
          o.onProfile(row.id);
        }
      });
      bodyEl.append(item);
    }
  }

  bus.on('social:gift', () => {
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
