/**
 * ui/screens.js — DOM screens: router, toasts, overlays, setup, settings, result.
 *
 * Everything here reacts to events or user input and calls back into main.js.
 * No game state is ever mutated from this file.
 */

import { COLORS, MODE, PLAYER_TYPE } from '../engine/state.js';
import { EVENTS } from '../game/events.js';
import { MODE_META, DEFAULT_NAMES, pickColors } from '../game/modes.js';
import { THEME_IDS, getTheme, playerPalette } from '../render/board.js';
import { ordinal } from './hud.js';

/* ─────────────────────────────────── router ─────────────────────────────── */

export function createRouter({ root, audio }) {
  const screens = new Map();
  for (const el of root.querySelectorAll('[data-screen]')) {
    screens.set(el.dataset.screen, el);
  }
  let current = null;
  const listeners = new Set();

  function show(name, opts = {}) {
    const el = screens.get(name);
    if (!el) throw new Error('unknown screen: ' + name);
    if (current === name) return el;
    for (const [key, node] of screens) {
      const on = key === name;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    const previous = current;
    current = name;
    if (!opts.silent && audio) audio.sfx.swipe();
    for (const fn of listeners) fn(name, previous);
    // move focus for keyboard/screen-reader users
    const focusTarget = el.querySelector('[data-autofocus]') || el.querySelector('button, input');
    if (focusTarget && opts.focus !== false) {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (err) {
        /* ignore */
      }
    }
    return el;
  }

  return {
    show,
    get current() {
      return current;
    },
    onShow(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    el(name) {
      return screens.get(name);
    },
  };
}

/* ─────────────────────────────────── toasts ─────────────────────────────── */

export function createToaster({ host, bus }) {
  function toast(text, kind = 'info', ms = 1800) {
    const el = document.createElement('div');
    el.className = 'toast toast--' + kind;
    el.setAttribute('role', 'status');
    el.textContent = text;
    host.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 260);
    }, ms);
    // keep the stack short on tiny screens
    while (host.children.length > 3) host.firstChild.remove();
    return el;
  }

  if (bus) bus.on(EVENTS.TOAST, (p) => toast(p.text, p.kind || 'info', p.ms));
  return { toast };
}

/* ────────────────────────────────── overlays ────────────────────────────── */

export function createOverlay(el) {
  let onClose = null;
  function open(opts = {}) {
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    onClose = opts.onClose || null;
    const focusTarget = el.querySelector('[data-autofocus]') || el.querySelector('button');
    if (focusTarget) {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (err) {
        /* ignore */
      }
    }
  }
  function close() {
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    if (onClose) {
      const fn = onClose;
      onClose = null;
      fn();
    }
  }
  return {
    open,
    close,
    get isOpen() {
      return el.classList.contains('is-open');
    },
    el,
  };
}

/**
 * "Pass the phone to NAME" privacy screen. Resolves the controller's gate when
 * the next player taps.
 */
export function createPassScreen({ el, bus, audio }) {
  const overlay = createOverlay(el);
  const nameEl = el.querySelector('[data-pass="name"]');
  const dotEl = el.querySelector('[data-pass="dot"]');
  const button = el.querySelector('[data-pass="ok"]');
  let confirm = null;

  button.addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
    const fn = confirm;
    confirm = null;
    if (fn) fn();
  });

  bus.on(EVENTS.PASS_DEVICE, (p) => {
    confirm = p.confirm;
    nameEl.textContent = p.name;
    const pal = playerPalette(getTheme('classic'), p.color);
    dotEl.style.background = pal.main;
    el.style.setProperty('--pass-color', pal.main);
    overlay.open();
  });

  return overlay;
}

/* ─────────────────────────────── setup screen ───────────────────────────── */

/**
 * Player setup: mode title, 2/3/4 players, colour pick, editable names.
 */
export function createSetupScreen({ el, prefs, audio, onStart, onBack }) {
  const title = el.querySelector('[data-setup="title"]');
  const countRow = el.querySelector('[data-setup="count"]');
  const colorRow = el.querySelector('[data-setup="colors"]');
  const nameList = el.querySelector('[data-setup="names"]');
  const startBtn = el.querySelector('[data-setup="start"]');
  const backBtn = el.querySelector('[data-setup="back"]');
  const hint = el.querySelector('[data-setup="hint"]');

  let mode = MODE.VS_COMPUTER;
  let count = 4;
  let humanColor = prefs.get('playerColor') || 'red';
  const names = {};

  function meta() {
    return MODE_META[mode] || MODE_META[MODE.VS_COMPUTER];
  }

  function renderCounts() {
    countRow.textContent = '';
    const m = meta();
    for (let n = m.minPlayers; n <= m.maxPlayers; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = n + 'P';
      b.setAttribute('aria-pressed', String(n === count));
      b.addEventListener('click', () => {
        audio.sfx.tap();
        count = n;
        render();
      });
      countRow.append(b);
    }
    countRow.parentElement.hidden = m.minPlayers === m.maxPlayers;
  }

  function renderColors() {
    colorRow.textContent = '';
    const theme = getTheme(prefs.get('theme'));
    for (const color of COLORS) {
      const pal = playerPalette(theme, color);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', pal.main);
      b.style.setProperty('--c-dark', pal.dark);
      b.setAttribute('aria-label', 'Play as ' + color);
      b.setAttribute('aria-pressed', String(color === humanColor));
      b.addEventListener('click', () => {
        audio.sfx.tap();
        humanColor = color;
        prefs.set('playerColor', color);
        render();
      });
      colorRow.append(b);
    }
  }

  function renderNames() {
    nameList.textContent = '';
    const colors = pickColors(count, humanColor);
    const theme = getTheme(prefs.get('theme'));
    const everyoneHuman = mode === MODE.PASS_PLAY;

    for (const color of colors) {
      const isHuman = everyoneHuman || color === humanColor;
      const row = document.createElement('label');
      row.className = 'name-row';
      const pal = playerPalette(theme, color);
      row.style.setProperty('--c', pal.main);

      const dot = document.createElement('span');
      dot.className = 'name-dot';

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 12;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.className = 'name-input';
      const fallback = isHuman
        ? color === humanColor && prefs.get('playerName')
          ? prefs.get('playerName')
          : DEFAULT_NAMES[color]
        : DEFAULT_NAMES[color] + ' Bot';
      input.value = names[color] || fallback;
      input.setAttribute('aria-label', 'Name for ' + color);
      input.disabled = !isHuman;
      input.addEventListener('input', () => {
        names[color] = input.value;
        if (color === humanColor) prefs.set('playerName', input.value.trim() || 'You');
      });

      const tag = document.createElement('span');
      tag.className = 'name-tag';
      tag.textContent = isHuman ? 'YOU' : 'BOT';
      if (everyoneHuman) tag.textContent = 'P' + (colors.indexOf(color) + 1);

      row.append(dot, input, tag);
      nameList.append(row);
      names[color] = input.value;
    }
  }

  function render() {
    const m = meta();
    title.textContent = m.title;
    hint.textContent = m.blurb;
    count = Math.min(Math.max(count, m.minPlayers), m.maxPlayers);
    renderCounts();
    renderColors();
    renderNames();
  }

  startBtn.addEventListener('click', () => {
    audio.sfx.tap();
    onStart({
      mode,
      count,
      humanColor,
      names: { ...names },
      botLevel: prefs.get('botLevel'),
    });
  });
  backBtn.addEventListener('click', () => {
    audio.sfx.tap();
    onBack();
  });

  return {
    open(nextMode) {
      mode = nextMode;
      const m = meta();
      count = m.defaultPlayers;
      humanColor = prefs.get('playerColor') || 'red';
      render();
    },
    render,
  };
}

/* ───────────────────────────── settings screen ──────────────────────────── */

export function createSettingsScreen({ el, prefs, audio, onThemeChange, onSpeedChange, onReset }) {
  const soundBtn = el.querySelector('[data-set="sound"]');
  const vibeBtn = el.querySelector('[data-set="vibration"]');
  const themeRow = el.querySelector('[data-set="theme"]');
  const speedRow = el.querySelector('[data-set="speed"]');
  const botRow = el.querySelector('[data-set="bot"]');
  const statsBox = el.querySelector('[data-set="stats"]');
  const resetBtn = el.querySelector('[data-set="reset"]');

  function toggleLabel(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('[data-state]').textContent = on ? 'ON' : 'OFF';
  }

  soundBtn.addEventListener('click', () => {
    const on = prefs.toggle('sound');
    audio.setEnabled(on);
    if (on) {
      audio.unlock();
      audio.sfx.tap();
    }
    toggleLabel(soundBtn, on);
  });

  vibeBtn.addEventListener('click', () => {
    const on = prefs.toggle('vibration');
    audio.setVibration(on);
    audio.sfx.tap();
    if (on) audio.buzz(24);
    toggleLabel(vibeBtn, on);
  });

  function buildOptions(row, values, key, onPick, labelOf) {
    row.textContent = '';
    for (const value of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = labelOf ? labelOf(value) : value;
      b.dataset.value = value;
      b.setAttribute('aria-pressed', String(prefs.get(key) === value));
      b.addEventListener('click', () => {
        prefs.set(key, value);
        audio.sfx.tap();
        for (const sib of row.children) sib.setAttribute('aria-pressed', String(sib.dataset.value === value));
        if (onPick) onPick(value);
      });
      row.append(b);
    }
  }

  function renderStats(stats) {
    if (!statsBox) return;
    statsBox.textContent = '';
    const all = stats.all();
    const rows = [
      ['Vs Computer', all.modes.vsComputer],
      ['Pass & Play', all.modes.passPlay],
      ['Quick Match', all.modes.quickMatch],
    ];
    for (const [label, m] of rows) {
      const s = m || { games: 0, wins: 0, streak: 0, bestStreak: 0 };
      const row = document.createElement('div');
      row.className = 'stat-row';
      const name = document.createElement('span');
      name.textContent = label;
      const val = document.createElement('span');
      val.className = 'stat-val';
      val.textContent = s.games
        ? s.wins + '/' + s.games + ' won · streak ' + s.streak + ' (best ' + s.bestStreak + ')'
        : 'not played yet';
      row.append(name, val);
      statsBox.append(row);
    }
  }

  return {
    render(stats) {
      toggleLabel(soundBtn, prefs.get('sound'));
      toggleLabel(vibeBtn, prefs.get('vibration'));
      buildOptions(themeRow, THEME_IDS, 'theme', onThemeChange, (id) => getTheme(id).label);
      buildOptions(speedRow, ['slow', 'normal', 'fast'], 'speed', onSpeedChange, cap);
      buildOptions(botRow, ['easy', 'normal', 'hard'], 'botLevel', null, cap);
      if (stats) renderStats(stats);
      if (resetBtn && !resetBtn.dataset.bound) {
        resetBtn.dataset.bound = '1';
        resetBtn.addEventListener('click', () => {
          audio.sfx.tap();
          if (onReset) onReset();
        });
      }
    },
    renderStats,
  };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ────────────────────────────── result overlay ──────────────────────────── */

/**
 * Final standings. Rendered as an overlay so the canvas confetti keeps playing
 * behind it.
 */
export function renderResult({ el, state, prefs, humanId }) {
  const list = el.querySelector('[data-result="list"]');
  const headline = el.querySelector('[data-result="headline"]');
  const sub = el.querySelector('[data-result="sub"]');
  const theme = getTheme(prefs.get('theme'));

  const ordered = state.players.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const winner = ordered[0];
  const human = humanId === null || humanId === undefined ? null : state.players[humanId];

  if (human && human.rank === 1) headline.textContent = 'You win!';
  else if (human) headline.textContent = 'You finished ' + ordinal(human.rank);
  else headline.textContent = winner.name + ' wins!';

  sub.textContent = winner.name + ' brought all 4 tokens home in ' + state.turnCount + ' turns';

  list.textContent = '';
  for (const p of ordered) {
    const pal = playerPalette(theme, p.color);
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.style.setProperty('--c', pal.main);
    if (p.rank === 1) row.classList.add('is-winner');

    const pos = document.createElement('span');
    pos.className = 'rank-pos';
    pos.textContent = p.rank ? ordinal(p.rank) : '–';

    const dot = document.createElement('span');
    dot.className = 'rank-dot';

    const name = document.createElement('span');
    name.className = 'rank-name';
    name.textContent = p.name + (p.type === PLAYER_TYPE.BOT ? ' (bot)' : '');

    const stat = document.createElement('span');
    stat.className = 'rank-stat';
    stat.textContent = p.finished + '/4 home · ' + p.captures + ' captures';

    row.append(pos, dot, name, stat);
    list.append(row);
  }
  return { winner, human };
}

/* ───────────────────────────── resume prompt ───────────────────────────── */

export function renderResumePrompt({ el, summary }) {
  const text = el.querySelector('[data-resume="text"]');
  if (!summary) return;
  const modeName = (MODE_META[summary.mode] || {}).title || summary.mode;
  const when = timeAgo(summary.at);
  text.textContent =
    modeName + ' · ' + summary.players + ' players · ' + summary.finished + ' tokens home · ' + when;
}

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
