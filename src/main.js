/**
 * main.js — the wiring. Everything is created here and connected through the bus.
 *
 * Import order matters only for readability: no module touches the DOM at import
 * time, which is what lets tools/boot-check.js import the whole graph in Node to
 * prove the app has no load-time errors.
 */

import { MODE, PLAYER_TYPE, currentPlayer } from './engine/state.js';
import { EV } from './engine/rules.js';
import { createEventBus, EVENTS } from './game/events.js';
import { createGame, MODE_META } from './game/modes.js';
import { LocalAdapter } from './sync/local.js';
import { getTheme, playerPalette } from './render/board.js';
import { createAudio } from './audio/synth.js';
import { createPrefs } from './storage/prefs.js';
import { createStats } from './storage/stats.js';
import { createResume } from './storage/resume.js';
import { createSave } from './storage/save.js';
import { createAccount } from './meta/account.js';
import { createWallet } from './meta/wallet.js';
import { createCatalog } from './meta/catalog.js';
import { LocalAdProvider, createAdService } from './services/ads.js';
import { DisabledPurchaseProvider, createPurchaseService } from './services/purchase.js';
import { createI18n } from './i18n/index.js';
import { createGameView } from './ui/game.js';
import { createHud } from './ui/hud.js';
import { createHome } from './ui/home.js';
import { createSkinShop } from './ui/skins.js';
import { createAdPresenter, createShopScreen } from './ui/shop.js';
import { createSpinScreen } from './ui/spin.js';
import { createRewards } from './meta/rewards.js';
import { createTasks } from './meta/tasks.js';
import { createTaskScreen } from './ui/tasks.js';
import {
  createOverlay,
  createPassScreen,
  createRouter,
  createSettingsScreen,
  createSetupScreen,
  createToaster,
  renderResult,
  renderResumePrompt,
  translateDom,
} from './ui/screens.js';

export function boot() {
  const app = document.getElementById('app');
  const prefs = createPrefs();
  const stats = createStats();
  const resume = createResume();
  const audio = createAudio({ enabled: prefs.get('sound'), vibration: prefs.get('vibration') });
  const bus = createEventBus();

  // ── meta game (Phase 1.5): one save document, wallet, collection, services ──
  const save = createSave();
  const account = createAccount({ save, bus, name: prefs.get('playerName') });
  const wallet = createWallet({ save, bus });
  const catalog = createCatalog({ save, bus, wallet });
  const adProvider = new LocalAdProvider();
  const ads = createAdService({ provider: adProvider, save, bus, wallet, account });
  const shop = createPurchaseService({ provider: new DisabledPurchaseProvider(), bus, wallet, account });
  const rewards = createRewards({ save, bus, wallet, account });
  /** Which seat is "me" in the live game — used to credit tasks correctly. */
  const isMe = (playerId) => !!session && playerId === session.humanId;
  const tasks = createTasks({ save, bus, wallet, account, catalog, isMe });
  const i18n = createI18n({ lang: prefs.get('lang') || 'en', onChange: (l) => prefs.set('lang', l) });

  const router = createRouter({ root: app, audio });
  const toaster = createToaster({ host: document.getElementById('toasts'), bus, i18n });
  const gameScreen = router.el('game');
  const canvas = gameScreen.querySelector('[data-game="canvas"]');
  const view = createGameView({ canvas, bus, audio, prefs, catalog, i18n });
  const hud = createHud({ root: gameScreen, bus, prefs, i18n });

  const overlays = {
    pause: createOverlay(document.querySelector('[data-overlay="pause"]')),
    result: createOverlay(document.querySelector('[data-overlay="result"]')),
    resumePrompt: createOverlay(document.querySelector('[data-overlay="resume"]')),
    pass: createPassScreen({ el: document.querySelector('[data-overlay="pass"]'), bus, audio, prefs, i18n }),
  };

  /** @type {{controller:object, mode:string, humanId:number|null, setup:object}|null} */
  let session = null;

  /* ────────────────────────────── theming ─────────────────────────────── */

  function applyTheme(id) {
    const t = getTheme(id);
    const css = document.documentElement.style;
    css.setProperty('--page', t.page);
    css.setProperty('--page-alt', t.pageAlt);
    css.setProperty('--card-solid', t.pageAlt);
    css.setProperty('--red', t.players.red.main);
    css.setProperty('--green', t.players.green.main);
    css.setProperty('--yellow', t.players.yellow.main);
    css.setProperty('--blue', t.players.blue.main);
    css.setProperty('--accent', t.players.yellow.main);
    css.setProperty('--turn-color-dark', t.players.yellow.dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.page);
    view.setTheme(id);
    hud.setTheme(id);
    if (home) home.applyTheme(id);
  }

  /* ──────────────────────────── screens setup ─────────────────────────── */

  const setupScreen = createSetupScreen({
    el: router.el('setup'),
    prefs,
    audio,
    i18n,
    onStart: (setup) => startGame(setup),
    onBack: () => router.show('menu'),
  });

  const settingsScreen = createSettingsScreen({
    el: router.el('settings'),
    prefs,
    audio,
    i18n,
    onLangChange: () => retranslate(),
    // only board themes the player actually owns are offered here
    themeIds: () =>
      catalog
        .ownedOf('theme')
        .map((id) => (catalog.item(id) || {}).theme)
        .filter(Boolean),
    onThemeChange: (id) => applyTheme(id),
    onSpeedChange: (speed) => {
      if (session) session.controller.setSpeed(speed);
    },
    onReset: () => {
      stats.reset();
      settingsScreen.renderStats(stats);
      toaster.toast(i18n.t('stats.cleared'), 'info');
    },
  });

  /** Re-render every piece of chrome after a language switch. */
  function retranslate() {
    translateDom(document, (k, v) => i18n.t(k, v));
    settingsScreen.render(stats);
    setupScreen.render();
    if (session) hud.update();
    view.resize();
  }

  /* ───────────────────── store, skins, spin, rewarded ads ─────────────── */

  const adPresenter = createAdPresenter({
    el: document.querySelector('[data-overlay="ad"]'),
    i18n,
    audio,
  });
  adProvider.setPresenter(adPresenter);

  const shopScreen = createShopScreen({
    el: document.querySelector('[data-overlay="shop"]'),
    bus,
    i18n,
    shop,
    wallet,
    account,
    ads,
    audio,
  });

  const skinShop = createSkinShop({
    el: document.querySelector('[data-overlay="skins"]'),
    bus,
    i18n,
    catalog,
    wallet,
    ads,
    audio,
    prefs,
    account,
    onNeedCoins: (kind) => shopScreen.open(kind === 'diamonds' ? 'diamonds' : 'coins'),
    onThemeEquip: (id) => applyTheme(id),
  });

  const taskScreen = createTaskScreen({
    el: document.querySelector('[data-overlay="tasks"]'),
    bus,
    i18n,
    tasks,
    rewards,
    wallet,
    audio,
    onGo: (id) => {
      // "Go" jumps straight to whatever the task needs.
      if (id === 'spin3' || id === 'spin50') spinScreen.open();
      else if (id === 'skins10') skinShop.open('dice');
      else if (id === 'quick3') {
        setupScreen.open(MODE.QUICK_MATCH);
        router.show('setup');
      } else {
        setupScreen.open(MODE.VS_COMPUTER);
        router.show('setup');
      }
    },
  });

  const spinScreen = createSpinScreen({
    el: document.querySelector('[data-overlay="spin"]'),
    bus,
    i18n,
    rewards,
    ads,
    audio,
  });

  /* ─────────────────────────────── the lobby ──────────────────────────── */

  const PLAYABLE = { vsComputer: 1, passPlay: 1, quickMatch: 1 };

  function openSettings() {
    settingsScreen.render(stats);
    router.show('settings');
  }

  function comingSoon(what) {
    toaster.toast(what + ' — ' + i18n.t('common.soon'), 'info');
  }

  const home = createHome({
    el: router.el('menu'),
    bus,
    i18n,
    account,
    wallet,
    catalog,
    ads,
    prefs,
    audio,
    actions: {
      onTile: (id) => {
        if (PLAYABLE[id]) {
          setupScreen.open(id);
          router.show('setup');
          return;
        }
        comingSoon(id);
      },
      onRail: (id) => {
        if (id === 'tasks') taskScreen.open('daily');
        else if (id === 'vip') taskScreen.open('lucky');
        else if (id === 'shop') shopScreen.open('packs');
        else if (id === 'removeAds') shopScreen.open('packs');
        else if (id === 'spinEvent') spinScreen.open();
        else comingSoon(id);
      },
      onNav: (id) => {
        if (id === 'skins') skinShop.open('dice');
        else if (id === 'spin') spinScreen.open();
        else if (id === 'getCoins') shopScreen.watchForCoins('getCoins');
        else comingSoon(id);
      },
      onProfile: () => comingSoon('profile'),
      onShop: (tab) => shopScreen.open(tab === 'diamonds' ? 'diamonds' : 'coins'),
      onSettings: openSettings,
      onMissing: (id) => comingSoon(String(id || 'that')),
    },
  });

  /** Badges on the rail and the bottom nav (claimable rewards, free ads left). */
  let badgesBusy = false;
  function refreshBadges() {
    if (badgesBusy) return; // sync() emits events that land back here
    badgesBusy = true;
    const s = rewards.summary();
    tasks.sync({
      wins: stats.all().total.wins,
      captures: stats.all().total.captures,
    });
    home.setBadge('nav', 'spin', s.canSpin ? '!' : 0);
    home.setBadge('nav', 'getCoins', ads.remaining('getCoins') || 0);
    home.setBadge('rail', 'tasks', tasks.claimable() || 0);
    home.setBadge('rail', 'vip', s.canClaimDaily ? '1' : 0);
    home.setBadge('rail', 'spinEvent', s.canSpin ? '1' : 0);
    badgesBusy = false;
  }

  // Global money/ad feedback, so no individual screen has to explain a failure.
  bus.on('wallet:insufficient', (p) => {
    toaster.toast(
      i18n.t('wallet.notEnough', {
        kind: p.kind === 'diamonds' ? i18n.t('common.diamonds') : i18n.t('common.coins'),
      }),
      'warn'
    );
  });
  bus.on('ads:unavailable', () => toaster.toast(i18n.t('ads.limit'), 'info'));

  for (const evt of [
    'rewards:spin',
    'rewards:spins',
    'rewards:daily',
    'ads:reward',
    'tasks:progress',
    'tasks:claimed',
    'tasks:milestone',
    'account:levelUp',
    'catalog:unlocked',
  ]) {
    bus.on(evt, refreshBadges);
  }

  // Any remaining legacy [data-go] buttons (how-to shortcuts) still work.
  for (const btn of app.querySelectorAll('[data-go]')) {
    btn.addEventListener('click', () => {
      audio.unlock();
      audio.sfx.tap();
      const target = btn.dataset.go;
      if (target === 'settings') openSettings();
      else if (target === 'howto') router.show('howto');
      else {
        setupScreen.open(target);
        router.show('setup');
      }
    });
  }

  router.el('howto').querySelector('[data-howto="back"]').addEventListener('click', () => {
    audio.sfx.tap();
    router.show('menu');
  });

  router.el('settings').querySelector('[data-settings="back"]').addEventListener('click', () => {
    audio.sfx.tap();
    router.show(session ? 'game' : 'menu');
    if (session && overlays.pause.isOpen === false && session.controller.paused) {
      overlays.pause.open();
    }
  });

  /* ───────────────────────────── game session ─────────────────────────── */

  function humanSeatOf(state) {
    const humans = state.players.filter((p) => p.type === PLAYER_TYPE.HUMAN);
    if (humans.length === 1) return humans[0].id;
    const preferred = humans.find((p) => p.color === prefs.get('playerColor'));
    return (preferred || humans[0] || state.players[0]).id;
  }

  function endSession() {
    if (!session) return;
    session.controller.destroy();
    view.detach();
    session = null;
  }

  function startGame(setup, resumeState) {
    endSession();
    overlays.result.close();
    overlays.pause.close();

    const adapter = new LocalAdapter();
    adapter.connect();

    const game = createGame({
      setup,
      bus,
      adapter,
      speed: prefs.get('speed'),
      state: resumeState,
    });

    session = {
      controller: game.controller,
      mode: game.mode,
      setup,
      humanId: humanSeatOf(game.state),
      adapter,
    };

    prefs.set('lastMode', game.mode);
    view.attach(game.controller);
    router.show('game');
    view.start();
    view.resize();
    // start() emits GAME_STARTED synchronously; the HUD and view are already subscribed
    game.controller.start();
    return session;
  }

  function exitToMenu() {
    endSession();
    view.stop();
    resume.clear();
    router.show('menu');
    refreshMenu();
  }

  /* ──────────────────────────── pause overlay ─────────────────────────── */

  gameScreen.querySelector('[data-game="pause"]').addEventListener('click', () => {
    if (!session) return;
    audio.sfx.tap();
    session.controller.pause();
    overlays.pause.open();
  });

  const pauseEl = overlays.pause.el;
  pauseEl.querySelector('[data-pause="resume"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlays.pause.close();
    if (session) session.controller.resume();
  });
  pauseEl.querySelector('[data-pause="settings"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlays.pause.close();
    settingsScreen.render(stats);
    router.show('settings');
  });
  pauseEl.querySelector('[data-pause="exit"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlays.pause.close();
    exitToMenu();
  });

  /* ─────────────────────────── result overlay ─────────────────────────── */

  const resultEl = overlays.result.el;
  resultEl.querySelector('[data-result="again"]').addEventListener('click', () => {
    audio.sfx.tap();
    const setup = session ? session.setup : { mode: prefs.get('lastMode') };
    overlays.result.close();
    startGame(setup);
  });
  resultEl.querySelector('[data-result="menu"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlays.result.close();
    exitToMenu();
  });

  /* ─────────────────────────── resume prompt ──────────────────────────── */

  const resumeEl = overlays.resumePrompt.el;
  resumeEl.querySelector('[data-resume="yes"]').addEventListener('click', () => {
    audio.unlock();
    audio.sfx.tap();
    const saved = resume.load();
    overlays.resumePrompt.close();
    if (!saved) {
      toaster.toast('That game could not be restored', 'warn');
      return;
    }
    const setup = saved.meta.setup || { mode: saved.state.mode };
    startGame(setup, saved.state);
  });
  resumeEl.querySelector('[data-resume="no"]').addEventListener('click', () => {
    audio.unlock();
    audio.sfx.tap();
    resume.clear();
    overlays.resumePrompt.close();
    refreshMenu();
  });

  /* ───────────────────────── persistence + results ────────────────────── */

  // Snapshot on start and after every transition, so "Resume last game?" always
  // points at the game that is actually on screen.
  const saveSnapshot = (p) => {
    if (!session) return;
    resume.save(p.state, { setup: session.setup, mode: session.mode });
  };
  bus.on(EVENTS.GAME_STARTED, saveSnapshot);
  bus.on(EVENTS.STATE_CHANGED, saveSnapshot);

  bus.on(EV.GAME_OVER, (p) => {
    if (!session) return;
    const state = session.controller.state;
    const humanId = session.humanId;
    const me = state.players[humanId];
    const modeKey = (MODE_META[session.mode] || {}).statsKey || session.mode;

    stats.record(modeKey, {
      won: !!me && me.rank === 1,
      rank: me ? me.rank : 0,
      players: state.players.length,
      captures: me ? me.captures : 0,
      losses: me ? me.losses : 0,
    });
    resume.clear();
    if (session.mode === MODE.QUICK_MATCH) tasks.track('quick3', 1);
    account.addXp(me && me.rank === 1 ? 60 : 25, 'game');
    rewards.stampLucky();
    refreshBadges();

    const summary = renderResult({ el: resultEl, state, prefs, humanId, i18n });
    const theme = getTheme(prefs.get('theme'));
    view.celebrate([
      playerPalette(theme, summary.winner.color).main,
      playerPalette(theme, summary.winner.color).light,
      theme.players.yellow.main,
      '#ffffff',
    ]);
    if (summary.human && summary.human.rank === 1) audio.sfx.win();
    else audio.sfx.lose();

    setTimeout(() => overlays.result.open(), 900);
  });

  /* ──────────────────────────── settings sync ─────────────────────────── */

  prefs.subscribe((all, changed) => {
    if ('sound' in changed) audio.setEnabled(all.sound);
    if ('vibration' in changed) audio.setVibration(all.vibration);
    if ('theme' in changed) applyTheme(all.theme);
    if ('speed' in changed && session) session.controller.setSpeed(all.speed);
  });

  /* ──────────────────────── window / input plumbing ───────────────────── */

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => view.resize(), 90);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  window.addEventListener('pagehide', () => save.flush());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      save.flush();
      if (session && !session.controller.paused && router.current === 'game') {
        session.controller.pause();
        overlays.pause.open();
      }
    } else if (router.current === 'game') {
      view.start();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (router.current !== 'game' || !session) return;
    const c = session.controller;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (c.canRoll()) {
        e.preventDefault();
        audio.unlock();
        c.roll();
      }
    } else if (e.code === 'Escape') {
      if (!c.paused) {
        c.pause();
        overlays.pause.open();
      }
    } else if (/^Digit[1-4]$/.test(e.code)) {
      if (c.canMove()) c.selectToken(Number(e.code.slice(5)) - 1);
    }
  });

  router.onShow((name) => {
    if (name === 'game') view.start();
    else view.stop();
    if (name === 'menu') home.start();
    else home.stop();
  });

  /* ──────────────────────────── menu refresh ──────────────────────────── */

  function refreshMenu() {
    home.render();
  }

  /* ─────────────────────────────── service worker ─────────────────────── */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    const bar = document.querySelector('[data-update="bar"]');
    const reload = bar && bar.querySelector('[data-update="reload"]');
    let waiting = null;

    function offerUpdate(worker) {
      waiting = worker;
      if (!bar) return;
      bar.querySelector('[data-update="text"]').textContent = i18n.t('sw.update');
      if (reload) reload.textContent = i18n.t('sw.reload');
      bar.hidden = false;
    }

    if (reload) {
      reload.addEventListener('click', () => {
        audio.sfx.tap();
        save.flush();
        if (waiting) waiting.postMessage('skipWaiting');
        location.reload();
      });
    }

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          // A newer build is already waiting (user opened a fresh tab).
          if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const next = reg.installing;
            if (!next) return;
            next.addEventListener('statechange', () => {
              if (next.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(next);
            });
          });
        })
        .catch(() => {
          /* offline support is a bonus, never a blocker */
        });
    });
  }

  /* ─────────────────────────────── go ─────────────────────────────────── */

  applyTheme(prefs.get('theme'));
  translateDom(document, (k, v) => i18n.t(k, v));
  document.documentElement.setAttribute('lang', i18n.lang);
  i18n.subscribe((lang) => document.documentElement.setAttribute('lang', lang));
  refreshBadges();
  audio.setEnabled(prefs.get('sound'));
  audio.setVibration(prefs.get('vibration'));
  refreshMenu();
  registerServiceWorker();

  const splashMs = 900;
  setTimeout(() => {
    // Never steal the screen from a game that is already running (the splash
    // timer must not fight programmatic navigation).
    if (router.current !== 'splash') return;
    router.show('menu', { silent: true });
    const summary = resume.describe();
    if (summary) {
      renderResumePrompt({ el: resumeEl, summary });
      overlays.resumePrompt.open();
    }
  }, splashMs);

  // Handy for debugging in the field; also the Phase 2 entry point for
  // swapping in a FirebaseAdapter.
  const api = {
    bus,
    prefs,
    stats,
    resume,
    audio,
    router,
    view,
    home,
    settingsScreen,
    setupScreen,
    retranslate,
    save,
    account,
    wallet,
    catalog,
    ads,
    adProvider,
    shop,
    shopScreen,
    skinShop,
    spinScreen,
    taskScreen,
    tasks,
    rewards,
    i18n,
    startGame,
    exitToMenu,
    get session() {
      return session;
    },
    MODE,
    currentPlayer,
  };
  window.LudoBattle = api;
  return api;
}

// Auto-boot in the browser only, so Node can import this module safely.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  } else {
    boot();
  }
}
