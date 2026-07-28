/**
 * ui/chat.js — in-game chat: feed, quick phrases, emoji, item throws and likes.
 *
 * DOM + the existing canvas effect layer. Never mutates game state.
 * Phase 2 replaces the local `send()` with a room write and feeds inbound
 * messages in through push(); the UI does not change.
 */

import { EVENTS } from '../game/events.js';
import { EV } from '../engine/rules.js';
import { chatboxStyle } from '../render/skins.js';
import { playerPalette } from '../render/board.js';
import { createOverlay } from './screens.js';

/** Quick phrases — short on purpose so they read on a phone. */
export const QUICK_KEYS = ['chat.q1', 'chat.q2', 'chat.q3', 'chat.q4', 'chat.q5', 'chat.q6'];

export const EMOJI = ['😀', '😂', '😮', '😢', '😡', '👍', '🙏', '🔥', '🎲', '👑'];

/** Things you can throw at another player. Cost is in coins. */
export const THROWABLE = Object.freeze([
  { id: 'tomato', icon: '🍅', cost: 200, colour: '#e8464f' },
  { id: 'rose', icon: '🌹', cost: 400, colour: '#ff6392' },
  { id: 'shoe', icon: '👟', cost: 600, colour: '#8b5cf6' },
  { id: 'crown', icon: '👑', cost: 2000, colour: '#ffd24a' },
]);

const MAX_FEED = 40;
const RATE_MS = 900;

/** Very small profanity screen for EN + HI. Blocks, does not "correct". */
const BLOCKED = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'rape',
  'madarchod', 'behanchod', 'bhosd', 'chutiya', 'gandu', 'randi', 'lodu', 'harami',
  'मादरचोद', 'भोसड', 'चूतिया', 'गांडू', 'रंडी', 'हरामी',
];

export function isClean(text) {
  const flat = String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return !BLOCKED.some((word) => flat.includes(word));
}

/**
 * @param {object} o { root, bus, i18n, audio, catalog, wallet, account, prefs, view }
 */
export function createChat(o) {
  const { root, bus, i18n, audio, catalog, wallet, account } = o;
  const t = (k, v) => i18n.t(k, v);

  const panel = root.querySelector('[data-chat="panel"]');
  const feed = root.querySelector('[data-chat="feed"]');
  const input = root.querySelector('[data-chat="input"]');
  const sendBtn = root.querySelector('[data-chat="send"]');
  const toggleBtn = root.querySelector('[data-chat="toggle"]');
  const quickRow = root.querySelector('[data-chat="quick"]');
  const emojiRow = root.querySelector('[data-chat="emoji"]');
  const throwRow = root.querySelector('[data-chat="throw"]');
  const badge = root.querySelector('[data-chat="badge"]');
  const throwSheet = o.throwEl ? createOverlay(o.throwEl) : null;

  let state = null;
  let open = false;
  let unseen = 0;
  let lastSend = 0;
  let pendingThrow = null;

  /* ─────────────────────────────── feed ──────────────────────────────── */

  function applySkin(el) {
    const item = catalog ? catalog.equippedItem('chatbox') : null;
    const style = chatboxStyle(item ? item.art : {});
    el.style.background = style['--bubble-bg'];
    el.style.borderColor = style['--bubble-border'];
    el.style.color = style['--bubble-text'];
    return style.ornament;
  }

  /**
   * Add a line to the feed.
   * @param {object} msg { name, text, mine, system, colour }
   */
  function push(msg) {
    const row = document.createElement('div');
    row.className = 'chat-row' + (msg.mine ? ' is-mine' : '') + (msg.system ? ' is-system' : '');

    if (msg.system) {
      row.textContent = msg.text;
    } else {
      const who = document.createElement('span');
      who.className = 'chat-who';
      who.textContent = msg.name;
      if (msg.colour) who.style.color = msg.colour;

      const bubble = document.createElement('span');
      bubble.className = 'chat-bubble';
      const ornament = applySkin(bubble);
      bubble.textContent = ornament ? ornament + ' ' + msg.text : msg.text;

      row.append(who, bubble);
    }

    feed.append(row);
    while (feed.children.length > MAX_FEED) feed.firstChild.remove();
    feed.scrollTop = feed.scrollHeight;

    if (!open && !msg.mine) {
      unseen += 1;
      if (badge) {
        badge.hidden = false;
        badge.textContent = String(unseen);
      }
    }
    return row;
  }

  function systemLine(text) {
    push({ text, system: true });
  }

  /* ────────────────────────────── sending ────────────────────────────── */

  function myName() {
    return account ? account.name : t('common.you');
  }

  function myColour() {
    if (!state) return null;
    const me = state.players[o.humanSeat ? o.humanSeat() : 0];
    return me ? playerPalette(o.theme ? o.theme() : { players: {} }, me.colour || me.color).main : null;
  }

  function send(text) {
    const clean = String(text || '').trim().slice(0, 120);
    if (!clean) return false;
    const now = Date.now();
    if (now - lastSend < RATE_MS) {
      bus.emit(EVENTS.TOAST, { key: 'chat.slow', kind: 'warn' });
      return false;
    }
    if (!isClean(clean)) {
      audio.sfx.deny();
      bus.emit(EVENTS.TOAST, { key: 'chat.blocked', kind: 'warn' });
      return false;
    }
    lastSend = now;
    audio.sfx.tap();
    push({ name: myName(), text: clean, mine: true, colour: myColour() });
    // Phase 2: write to rooms/{id}/chat here instead.
    bus.emit(EVENTS.CHAT_MESSAGE, { name: myName(), text: clean, mine: true, at: now });
    return true;
  }

  /* ───────────────────────────── throwing ────────────────────────────── */

  /** Pick an item, then pick a target seat. */
  function beginThrow(item) {
    pendingThrow = item;
    if (throwSheet) throwSheet.close();
    bus.emit(EVENTS.TOAST, { key: 'chat.pickTarget', kind: 'info' });
  }

  /**
   * Throw the pending item at a seat. Costs coins, animates on the canvas and
   * writes a line into the feed.
   */
  function throwAt(seat) {
    if (!pendingThrow || !state) return false;
    const item = pendingThrow;
    const target = state.players[seat];
    if (!target) return false;
    if (wallet && !wallet.spend('coins', item.cost, 'throw:' + item.id)) return false;
    pendingThrow = null;
    audio.sfx.capture();
    if (o.onThrow) o.onThrow({ item, seat });
    systemLine(t('chat.sent', { item: item.icon }) + ' → ' + target.name);
    bus.emit('chat:throw', { item: item.id, seat });
    return true;
  }

  /** Like an opponent: bumps their counter and their real profile likes. */
  function like(seat) {
    if (!state) return false;
    const target = state.players[seat];
    if (!target) return false;
    audio.sfx.six();
    systemLine(t('chat.likes', { a: myName(), b: target.name }));
    bus.emit('chat:like', { seat });
    return true;
  }

  /* ─────────────────────────────── build ─────────────────────────────── */

  function buildRows() {
    quickRow.textContent = '';
    for (const key of QUICK_KEYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-quick';
      b.dataset.quick = key;
      b.textContent = t(key);
      b.addEventListener('click', () => send(t(key)));
      quickRow.append(b);
    }

    emojiRow.textContent = '';
    for (const emoji of EMOJI) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-emoji';
      b.dataset.emoji = emoji;
      b.textContent = emoji;
      b.addEventListener('click', () => send(emoji));
      emojiRow.append(b);
    }

    if (throwRow) {
      throwRow.textContent = '';
      for (const item of THROWABLE) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-throw';
        b.dataset.throw = item.id;
        b.innerHTML = '<i>' + item.icon + '</i><span><i class="cost-ico cost-ico--coin"></i>' + item.cost + '</span>';
        b.addEventListener('click', () => {
          audio.sfx.tap();
          beginThrow(item);
        });
        throwRow.append(b);
      }
    }
  }

  function setOpen(next) {
    open = next;
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      unseen = 0;
      if (badge) badge.hidden = true;
      feed.scrollTop = feed.scrollHeight;
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      audio.sfx.tap();
      setOpen(!open);
    });
  }
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      if (send(input.value)) input.value = '';
    });
  }
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && send(input.value)) input.value = '';
    });
  }

  /* ───────────────────────── automatic table talk ────────────────────── */

  bus.on(EVENTS.GAME_STARTED, (p) => {
    state = p.state;
    feed.textContent = '';
    unseen = 0;
    if (badge) badge.hidden = true;
    buildRows();
  });
  bus.on(EVENTS.STATE_CHANGED, (p) => {
    state = p.state;
  });
  bus.on(EV.TOKEN_CAPTURED, (p) => {
    if (!state) return;
    const by = state.players[p.byPlayerId];
    const victim = state.players[p.playerId];
    if (by && victim) systemLine(t('game.sentHome', { name: victim.name }) + ' — ' + by.name);
  });
  bus.on(EV.PLAYER_FINISHED, (p) => {
    if (!state) return;
    const who = state.players[p.playerId];
    if (who) systemLine(t('game.finished', { name: who.name, rank: p.rank }));
  });

  return {
    push,
    send,
    systemLine,
    like,
    throwAt,
    beginThrow,
    buildRows,
    setOpen,
    get isOpen() {
      return open;
    },
    get pendingThrow() {
      return pendingThrow;
    },
    openThrowSheet() {
      if (throwSheet) throwSheet.open();
    },
    isClean,
    THROWABLE,
    EMOJI,
  };
}
