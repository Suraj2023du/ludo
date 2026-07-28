/**
 * ui/hud.js — the in-game HUD: turn banner and player panels.
 *
 * Pure DOM, updated only when an event says something changed (never per frame),
 * so the canvas keeps the whole frame budget.
 */

import { PLAYER_TYPE, TOKENS_PER_PLAYER } from '../engine/state.js';
import { EV } from '../engine/rules.js';
import { EVENTS } from '../game/events.js';
import { getTheme, playerPalette } from '../render/board.js';

export function createHud({ root, bus, prefs, i18n }) {
  const t = i18n ? (k, v) => i18n.t(k, v) : (k) => k;
  const banner = root.querySelector('[data-hud="banner"]');
  const panels = root.querySelector('[data-hud="panels"]');
  const diceValue = root.querySelector('[data-hud="dice"]');
  let theme = getTheme(prefs.get('theme'));
  let state = null;
  let cards = new Map();
  let flashTimer = 0;

  function setTheme(id) {
    theme = getTheme(id);
    if (state) build(state);
  }

  function build(next) {
    state = next;
    panels.textContent = '';
    cards = new Map();
    panels.dataset.count = String(state.players.length);

    for (const player of state.players) {
      const pal = playerPalette(theme, player.color);
      const card = document.createElement('div');
      card.className = 'panel';
      card.dataset.color = player.color;
      card.style.setProperty('--c', pal.main);
      card.style.setProperty('--c-dark', pal.dark);
      card.style.setProperty('--c-light', pal.light);

      const dot = document.createElement('span');
      dot.className = 'panel-dot';
      dot.setAttribute('aria-hidden', 'true');

      const meta = document.createElement('div');
      meta.className = 'panel-meta';

      const name = document.createElement('span');
      name.className = 'panel-name';
      name.textContent = player.name;

      const sub = document.createElement('span');
      sub.className = 'panel-sub';

      meta.append(name, sub);

      const home = document.createElement('span');
      home.className = 'panel-home';

      const timer = document.createElement('span');
      timer.className = 'panel-timer';

      card.append(dot, meta, timer, home);
      panels.append(card);
      cards.set(player.id, { card, sub, home, name, timer });
    }
    update(state);
  }

  function update(next) {
    if (next) state = next;
    if (!state) return;
    for (const player of state.players) {
      const c = cards.get(player.id);
      if (!c) continue;
      const active = state.turn === player.id && state.phase !== 'gameOver';
      c.card.classList.toggle('is-active', active);
      c.card.classList.toggle('is-done', player.rank > 0);
      c.home.textContent = player.finished + '/' + TOKENS_PER_PLAYER;
      c.name.textContent = player.name;
      const bits = [];
      if (player.type === PLAYER_TYPE.BOT) bits.push(t('common.bot'));
      if (player.rank === 1) bits.push(t('common.winner').toUpperCase());
      else if (player.rank > 1) bits.push(ordinal(player.rank));
      else if (active) bits.push(t('common.play').toUpperCase());
      c.sub.textContent = bits.join(' · ');
    }
    if (diceValue) diceValue.textContent = state.dice ? String(state.dice) : '–';
  }

  /**
   * Turn countdown, drawn as a conic ring on the active panel.
   * Updated from the timer's tick (4x a second), never per animation frame.
   */
  function onTick(p) {
    for (const [id, card] of cards) {
      const on = p.running && p.seat === id;
      card.card.classList.toggle('is-timing', on);
      if (on) {
        card.card.style.setProperty('--t', String(Math.round(p.ratio * 100)));
        card.card.classList.toggle('is-urgent', p.left <= 5);
        if (card.timer) card.timer.textContent = t('game.timeLeft', { secs: Math.ceil(p.left) });
      } else if (card.timer) {
        card.timer.textContent = '';
        card.card.classList.remove('is-urgent');
      }
    }
  }

  function say(text, tone) {
    banner.textContent = text;
    banner.dataset.tone = tone || 'normal';
    banner.classList.remove('is-pop');
    // restart the CSS pop animation
    void banner.offsetWidth;
    banner.classList.add('is-pop');
  }

  function turnText(player) {
    if (!player) return t('game.over');
    const key = player.type === PLAYER_TYPE.BOT ? 'game.thinking' : 'game.yourTurn';
    return t(key, { name: player.name });
  }

  function setAccent(color) {
    const pal = playerPalette(theme, color);
    root.style.setProperty('--turn-color', pal.main);
    root.style.setProperty('--turn-color-dark', pal.dark);
  }

  /* ─────────────────────────── subscriptions ─────────────────────────── */

  bus.on(EVENTS.GAME_STARTED, (p) => {
    build(p.state);
    const player = p.state.players[p.state.turn];
    setAccent(player.color);
    say(turnText(player));
  });

  bus.on(EVENTS.STATE_CHANGED, (p) => update(p.state));

  bus.on(EVENTS.TURN_BEGIN, (p) => {
    setAccent(p.player.color);
    say(turnText(p.player));
    update(state);
  });

  const nameOf = (playerId) => {
    const player = state && state.players[playerId];
    return player ? player.name : '';
  };

  bus.on(EV.SIX, () => say(t('game.six'), 'good'));

  bus.on(EV.EXTRA_TURN, (p) => {
    say(t(p.reason === 'capture' ? 'game.captured' : 'game.extra'), 'good');
  });

  bus.on(EV.TOKEN_CAPTURED, (p) => say(t('game.sentHome', { name: nameOf(p.playerId) }), 'warn'));
  bus.on(EV.THREE_SIXES, () => say(t('game.threeSix'), 'warn'));
  bus.on(EV.NO_MOVES, (p) => say(t('game.noMoves', { name: nameOf(p.playerId) }), 'muted'));
  bus.on(EV.TOKEN_FINISHED, (p) => say(t('game.tokenHome', { name: nameOf(p.playerId) }), 'good'));
  bus.on(EV.PLAYER_FINISHED, (p) =>
    say(t('game.finished', { name: nameOf(p.playerId), rank: ordinal(p.rank) }), 'good')
  );
  bus.on(EV.GAME_OVER, () => say(t('game.over'), 'normal'));
  bus.on('timer:tick', onTick);

  return { build, update, say, setTheme, setAccent, onTick };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
