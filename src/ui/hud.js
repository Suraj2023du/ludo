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

export function createHud({ root, bus, prefs }) {
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

      card.append(dot, meta, home);
      panels.append(card);
      cards.set(player.id, { card, sub, home, name });
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
      if (player.type === PLAYER_TYPE.BOT) bits.push('BOT');
      if (player.rank === 1) bits.push('WINNER');
      else if (player.rank > 1) bits.push(ordinal(player.rank));
      else if (active) bits.push('PLAYING');
      c.sub.textContent = bits.join(' · ');
    }
    if (diceValue) diceValue.textContent = state.dice ? String(state.dice) : '–';
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
    if (!player) return 'Game over';
    if (player.type === PLAYER_TYPE.BOT) return player.name + ' is thinking…';
    return player.name + "'s turn";
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

  bus.on(EV.SIX, (p) => {
    say('SIX! Roll again', 'good');
    void p;
  });

  bus.on(EV.EXTRA_TURN, (p) => {
    say(p.reason === 'capture' ? 'Captured! Roll again' : 'Extra turn!', 'good');
  });

  bus.on(EV.TOKEN_CAPTURED, (p) => {
    const victim = state && state.players[p.playerId];
    say((victim ? victim.name : 'A token') + ' sent home!', 'warn');
  });

  bus.on(EV.THREE_SIXES, () => say('Three sixes — turn lost', 'warn'));
  bus.on(EV.NO_MOVES, (p) => {
    const player = state && state.players[p.playerId];
    say('No moves for ' + (player ? player.name : 'player'), 'muted');
  });

  bus.on(EV.TOKEN_FINISHED, (p) => {
    const player = state && state.players[p.playerId];
    say((player ? player.name : 'Player') + ' brought a token home!', 'good');
  });

  bus.on(EV.PLAYER_FINISHED, (p) => {
    const player = state && state.players[p.playerId];
    say((player ? player.name : 'Player') + ' finished ' + ordinal(p.rank) + '!', 'good');
  });

  bus.on(EV.GAME_OVER, () => say('Game over', 'normal'));

  return { build, update, say, setTheme, setAccent };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
