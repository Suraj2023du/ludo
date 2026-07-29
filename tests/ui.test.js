/**
 * tests/ui.test.js — boots the real index.html + src/main.js inside the Node DOM
 * shim (tools/dom-stub.js) and drives it with real clicks.
 *
 * This is what backs the claim "the game boots with zero console errors": the
 * whole module graph is loaded, every screen is wired, the canvas paints and the
 * dice actually rolls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { installDom, tapCanvas } from '../tools/dom-stub.js';
import { renderResult } from '../src/ui/screens.js';
import { createPrefs } from '../src/storage/prefs.js';
import { makeGame, setTokens } from './helpers.js';
import { FINISH } from '../src/engine/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const dom = installDom({ htmlPath: join(ROOT, 'index.html') });
await import(pathToFileURL(join(ROOT, 'src', 'main.js')).href);
const api = dom.window.LudoBattle;
const doc = dom.document;
const tick = dom.tick;

const INSTANT = {
  diceRoll: 0,
  step: 0,
  capture: 0,
  finish: 0,
  botThink: 0,
  botMove: 0,
  pass: 0,
  turnGap: 0,
};

test('ui: index.html boots and exposes the app', () => {
  assert.ok(api, 'window.LudoBattle must exist');
  assert.equal(doc.getElementById('app') !== null, true);
  assert.equal(doc.querySelectorAll('[data-screen]').length, 6, 'six screens in the shell');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: the lobby is fully built and navigates to setup', async () => {
  api.router.show('menu', { silent: true });
  assert.ok(doc.querySelectorAll('[data-tile]').length >= 8, 'mode tiles');
  assert.ok(doc.querySelectorAll('[data-rail]').length >= 6, 'event rail');
  assert.equal(doc.querySelectorAll('[data-nav]').length, 5, 'bottom nav');
  assert.match(doc.querySelector('[data-home="coinval"]').textContent, /[\d,.KLCr]/);
  assert.ok(Number(doc.querySelector('[data-home="onlineCount"]').textContent.replace(/[^\d]/g, '')) > 1000);

  doc.querySelector('[data-tile="vsComputer"]').click();
  await tick(20);
  assert.equal(api.router.current, 'setup');
  assert.equal(doc.querySelector('[data-setup="names"]').children.length, 4);

  // switching to 2 players re-renders the list
  const countChips = doc.querySelector('[data-setup="count"]').children;
  countChips[0].click(); // "2P"
  await tick(20);
  assert.equal(doc.querySelector('[data-setup="names"]').children.length, 2);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: starting a game paints the board and builds the HUD panels', async () => {
  const session = api.startGame({ mode: 'vsComputer', count: 4, humanColor: 'red', names: {} });
  session.controller.setTiming(INSTANT);
  await tick(80);

  assert.equal(api.router.current, 'game');
  assert.equal(session.controller.state.players.length, 4);
  assert.equal(doc.querySelector('[data-hud="panels"]').children.length, 4);

  const canvas = doc.querySelector('[data-game="canvas"]');
  assert.ok(canvas.getContext('2d').calls > 50, 'the canvas painted');
  assert.match(doc.querySelector('[data-hud="banner"]').textContent, /turn/i);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: tapping the dice rolls it and the turn advances', async () => {
  const session = api.session;
  const canvas = doc.querySelector('[data-game="canvas"]');
  const layout = api.view.layout;
  const before = session.controller.state.rollCount;

  assert.equal(session.controller.canRoll(), true, 'the human seat is waiting for a roll');
  tapCanvas(canvas, layout.dice.x + layout.dice.size / 2, layout.dice.y + layout.dice.size / 2);
  await tick(700);

  assert.ok(session.controller.state.rollCount > before, 'the dice was rolled');
  assert.ok(session.controller.state.rollCount >= 1);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: pause and resume are wired to the controller', async () => {
  const session = api.session;
  doc.querySelector('[data-game="pause"]').click();
  await tick(20);
  assert.equal(session.controller.paused, true);
  assert.equal(doc.querySelector('[data-overlay="pause"]').classList.contains('is-open'), true);

  doc.querySelector('[data-pause="resume"]').click();
  await tick(20);
  assert.equal(session.controller.paused, false);
  assert.equal(doc.querySelector('[data-overlay="pause"]').classList.contains('is-open'), false);
});

test('ui: pass & play shows the "pass the phone" privacy screen', async () => {
  const session = api.startGame({
    mode: 'passPlay',
    count: 2,
    humanColor: 'red',
    names: { red: 'Asha', yellow: 'Ravi' },
  });
  session.controller.setTiming(INSTANT);
  await tick(40);

  const overlay = doc.querySelector('[data-overlay="pass"]');
  assert.equal(overlay.classList.contains('is-open'), true, 'the gate blocks the first turn');
  assert.equal(doc.querySelector('[data-pass="name"]').textContent, 'Asha');
  assert.equal(session.controller.canRoll(), false, 'nobody may roll behind the privacy screen');

  doc.querySelector('[data-pass="ok"]').click();
  await tick(40);
  assert.equal(overlay.classList.contains('is-open'), false);
  assert.equal(session.controller.canRoll(), true, 'the seat can play once it confirms');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: settings toggles persist and themes apply', async () => {
  api.router.show('settings', { silent: true });
  const soundBtn = doc.querySelector('[data-set="sound"]');
  const before = api.prefs.get('sound');
  soundBtn.click();
  assert.equal(api.prefs.get('sound'), !before);
  assert.equal(soundBtn.getAttribute('aria-pressed'), String(!before));
  soundBtn.click();
  assert.equal(api.prefs.get('sound'), before);

  for (const id of ['midnight', 'royal', 'candy', 'classic']) {
    api.prefs.set('theme', id);
    await tick(10);
    assert.equal(api.prefs.get('theme'), id);
  }
  // a fresh prefs instance reads the same localStorage
  assert.equal(createPrefs().get('theme'), 'classic');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: a mid-game snapshot is saved and can be described', () => {
  const summary = api.resume.describe();
  assert.ok(summary, 'a resume snapshot exists while a game is running');
  assert.equal(summary.players, 2);
  assert.ok(summary.mode);
});

test('ui: the result overlay renders full rankings', () => {
  const state = makeGame();
  setTokens(state, 'green', [FINISH, FINISH, FINISH, FINISH]);
  state.players[1].rank = 1;
  state.players[0].rank = 2;
  state.players[2].rank = 3;
  state.players[3].rank = 4;
  state.ranks = [1, 0, 2, 3];
  state.turnCount = 88;

  const el = doc.querySelector('[data-overlay="result"]');
  const out = renderResult({ el, state, prefs: api.prefs, humanId: 0 });
  assert.equal(out.winner.color, 'green');
  assert.equal(el.querySelector('[data-result="list"]').children.length, 4);
  assert.match(el.querySelector('[data-result="headline"]').textContent, /2nd/);
  assert.match(el.querySelector('[data-result="sub"]').textContent, /88 turns/);
});

test('ui: exit to menu tears the session down cleanly', async () => {
  api.exitToMenu();
  await tick(30);
  assert.equal(api.router.current, 'menu');
  assert.equal(api.session, null);
  assert.equal(api.resume.has(), false, 'the snapshot is cleared on exit');
  assert.deepEqual(dom.console.errors, []);
});

/* ─────────────────── Wave 4: skin shop, shop, spin, ads ──────────────── */

test('ui: the skin shop opens with five tabs and a full grid', async () => {
  api.skinShop.open('dice');
  await tick(20);
  const el = doc.querySelector('[data-overlay="skins"]');
  assert.equal(el.classList.contains('is-open'), true);
  assert.equal(el.querySelectorAll('[data-tab]').length, 5);
  assert.ok(el.querySelectorAll('[data-skin]').length >= 9, 'dice grid');

  // every tab renders something
  for (const kind of ['frame', 'theme', 'token', 'chatbox']) {
    el.querySelector('[data-tab="' + kind + '"]').click();
    await tick(10);
    assert.ok(el.querySelectorAll('[data-skin]').length >= 9, kind + ' grid');
  }
  assert.deepEqual(dom.console.errors, []);
});

test('ui: buying a skin with coins equips it and updates the board', async () => {
  api.wallet._set(999999, 999);
  api.skinShop.open('dice');
  await tick(20);
  const el = doc.querySelector('[data-overlay="skins"]');
  const card = el.querySelector('[data-skin="dice.cricket"]');
  const before = api.wallet.coins;
  card.querySelector('.skin-action').click();
  await tick(20);

  assert.equal(api.catalog.owned('dice.cricket'), true);
  assert.ok(api.wallet.coins < before, 'coins were spent');
  assert.equal(api.catalog.equippedId('dice'), 'dice.cricket');

  // equipping a theme also repaints the board
  api.skinShop.open('theme');
  await tick(10);
  el.querySelector('[data-skin="theme.midnight"] .skin-action').click();
  await tick(20);
  assert.equal(api.prefs.get('theme'), 'midnight');
  api.skinShop.close();
});

test('ui: an ad-unlock skin shows progress and unlocks after enough videos', async () => {
  api.skinShop.open('dice');
  await tick(20);
  const el = doc.querySelector('[data-overlay="skins"]');
  const card = el.querySelector('[data-skin="dice.frost"]');
  assert.match(card.textContent, /0\/20/, 'progress is shown');
  assert.match(card.querySelector('.skin-action').textContent, /Watch/i);

  // fast-forward the ad and the counter
  const need = api.catalog.progress('dice.frost').need;
  api.catalog.addAdProgress('dice.frost', need);
  api.skinShop.render();
  await tick(10);
  assert.equal(api.catalog.owned('dice.frost'), true);
  api.skinShop.close();
});

test('ui: the shop refuses purchases and offers the free route instead', async () => {
  api.shopScreen.open('packs');
  await tick(20);
  const el = doc.querySelector('[data-overlay="shop"]');
  assert.equal(el.classList.contains('is-open'), true);
  assert.equal(el.querySelectorAll('[data-tab]').length, 3);
  assert.ok(el.querySelectorAll('[data-product]').length >= 4);
  assert.match(el.querySelector('.shop-notice').textContent, /not enabled/i);

  const refusals = [];
  api.bus.on('shop:refused', (e) => refusals.push(e));
  const before = api.wallet.coins;
  el.querySelector('[data-product="pack.start.coins"] .pack-buy').click();
  await tick(40);
  assert.equal(refusals.length, 1);
  assert.equal(api.wallet.coins >= before, true, 'a refused purchase never grants coins');
  api.shopScreen.close();
});

test('ui: a rewarded video runs a real countdown and pays out', async () => {
  const before = api.wallet.coins;
  const adEl = doc.querySelector('[data-overlay="ad"]');
  const watching = api.ads.watch('getCoins');
  await tick(30);
  assert.equal(adEl.classList.contains('is-open'), true, 'the ad overlay is showing');
  const res = await watching;
  assert.equal(res.completed, true);
  assert.equal(adEl.classList.contains('is-open'), false);
  assert.ok(api.wallet.coins > before, 'the reward landed');
});

test('ui: cancelling a rewarded video pays nothing', async () => {
  const before = api.wallet.coins;
  const adEl = doc.querySelector('[data-overlay="ad"]');
  const watching = api.ads.watch('freeDiamond');
  await tick(30);
  adEl.querySelector('[data-ad="skip"]').click();
  const res = await watching;
  assert.equal(res.completed, false);
  assert.equal(api.wallet.coins, before);
});

test('ui: the spin wheel spins, pays out and then shows the cooldown', async () => {
  const el = doc.querySelector('[data-overlay="spin"]');
  api.spinScreen.open();
  await tick(20);
  assert.equal(el.classList.contains('is-open'), true);

  const go = el.querySelector('[data-spin="go"]');
  if (go.disabled) {
    assert.match(el.querySelector('[data-spin="status"]').textContent, /spin/i);
  } else {
    const before = api.wallet.coins + api.wallet.diamonds;
    let paid = null;
    api.bus.on('rewards:spin', (e) => {
      paid = e;
    });
    go.click();
    await tick(3200);
    assert.ok(paid, 'a prize was awarded');
    assert.ok(api.wallet.coins + api.wallet.diamonds > before);
    assert.equal(go.disabled, true, 'the wheel goes on cooldown');
  }
  api.spinScreen.close();
  assert.deepEqual(dom.console.errors, []);
});

test('ui: the task modal shows daily, growth and lucky month', async () => {
  api.taskScreen.open('daily');
  await tick(20);
  const el = doc.querySelector('[data-overlay="tasks"]');
  assert.equal(el.classList.contains('is-open'), true);
  assert.equal(el.querySelectorAll('[data-tab]').length, 3);
  assert.ok(el.querySelectorAll('[data-task]').length >= 7, 'daily rows');
  assert.ok(el.querySelectorAll('[data-milestone]').length === 5, 'milestone pins');

  el.querySelector('[data-tab="growth"]').click();
  await tick(10);
  assert.ok(el.querySelectorAll('[data-task]').length >= 7, 'growth rows');

  el.querySelector('[data-tab="lucky"]').click();
  await tick(10);
  assert.ok(el.querySelectorAll('.lucky-day').length >= 28, 'stamp calendar');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: completing a task lets you claim it from the modal', async () => {
  api.tasks.track('win1', 5);
  api.taskScreen.open('daily');
  await tick(20);
  const el = doc.querySelector('[data-overlay="tasks"]');
  const row = el.querySelector('[data-task="win1"]');
  const before = api.wallet.coins;
  row.querySelector('.task-go').click();
  await tick(20);
  assert.ok(api.wallet.coins > before, 'the reward was paid');
  assert.equal(api.tasks.claimed('win1'), true);
  api.taskScreen.close();
});

test('ui: table chat opens, sends, filters and rate limits', async () => {
  const session = api.startGame({ mode: 'vsComputer', count: 4, humanColor: 'red', names: {} });
  session.controller.setTiming(INSTANT);
  await tick(60);

  const panel = doc.querySelector('[data-chat="panel"]');
  const feed = doc.querySelector('[data-chat="feed"]');
  assert.ok(doc.querySelectorAll('[data-quick]').length >= 6, 'quick phrases built');
  assert.ok(doc.querySelectorAll('[data-emoji]').length >= 8, 'emoji row built');

  doc.querySelector('[data-chat="toggle"]').click();
  await tick(10);
  assert.equal(panel.classList.contains('is-open'), true);

  const before = feed.children.length;
  assert.equal(api.chat.send('Good luck!'), true);
  assert.equal(feed.children.length, before + 1, 'the message is in the feed');

  assert.equal(api.chat.send('you bastard'), false, 'profanity is blocked');
  await tick(20);
  assert.equal(api.chat.send('again'), false, 'rate limited right after a send');
  assert.deepEqual(dom.console.errors, []);
});

test('ui: tapping an opponent panel likes them, or throws the pending item', async () => {
  const panels = doc.querySelectorAll('[data-hud="panels"] .panel');
  assert.equal(panels.length, 4);
  const feed = doc.querySelector('[data-chat="feed"]');

  // a plain tap on an opponent is a like
  const before = feed.children.length;
  panels[1].click();
  await tick(20);
  assert.ok(feed.children.length > before, 'a like appears in the feed');

  // arm a throw, then tap: coins are spent and the projectile animates
  const coins = api.wallet.coins;
  const item = api.chat.THROWABLE[0];
  api.chat.beginThrow(item);
  assert.ok(api.chat.pendingThrow, 'an item is armed');
  panels[2].click();
  await tick(80);
  assert.equal(api.wallet.coins, coins - item.cost, 'the throw cost coins');
  assert.equal(api.chat.pendingThrow, null, 'the item was used');
  assert.deepEqual(dom.console.errors, []);
  api.exitToMenu();
  await tick(20);
});

test('ui: the friends modal lists people, requests, nearby and the inbox', async () => {
  api.friendsModal.open('nearby');
  await tick(20);
  const el = doc.querySelector('[data-overlay="friends"]');
  assert.equal(el.classList.contains('is-open'), true);
  assert.equal(el.querySelectorAll('[data-tab]').length, 4);
  const cards = el.querySelectorAll('[data-friend]');
  assert.ok(cards.length >= 5, 'nearby people are listed');

  const before = api.social.friendCount();
  cards[0].querySelector('.friend-action').click();
  await tick(20);
  assert.equal(api.social.friendCount(), before + 1, 'adding a friend works');

  el.querySelector('[data-tab="friends"]').click();
  await tick(10);
  assert.ok(el.querySelectorAll('[data-friend]').length >= 1);

  el.querySelector('[data-tab="requests"]').click();
  await tick(10);
  el.querySelector('[data-tab="inbox"]').click();
  await tick(10);
  assert.equal(api.social.unread(), 0, 'opening the inbox marks it read');
  api.friendsModal.close();
  assert.deepEqual(dom.console.errors, []);
});

test('ui: the leaderboard shows a podium and my own row', async () => {
  api.leaderboard.open('charm');
  await tick(20);
  const el = doc.querySelector('[data-overlay="rank"]');
  assert.equal(el.querySelectorAll('[data-tab]').length, 4);
  assert.equal(el.querySelectorAll('[data-podium]').length, 3, 'top three on the podium');
  assert.ok(el.querySelectorAll('[data-lb]').length >= 10, 'the rest as a list');
  assert.match(el.querySelector('.shop-notice').textContent, /\d/, 'my rank is shown');

  for (const kind of ['gallantry', 'coins', 'lucky']) {
    el.querySelector('[data-tab="' + kind + '"]').click();
    await tick(10);
    assert.equal(el.querySelectorAll('[data-podium]').length, 3);
  }
  api.leaderboard.close();
  assert.deepEqual(dom.console.errors, []);
});

test('ui: my profile is editable and another player offers gifts and blocking', async () => {
  api.profileCard.open();
  await tick(20);
  const el = doc.querySelector('[data-overlay="profile"]');
  assert.equal(el.classList.contains('is-open'), true);
  const inputs = el.querySelectorAll('input');
  assert.ok(inputs.length >= 2, 'name and bio are editable');
  inputs[0].value = 'Suraj';
  inputs[1].value = 'Ludo is life';
  el.querySelectorAll('.btn')[el.querySelectorAll('.btn').length - 1].click();
  await tick(20);
  assert.equal(api.account.name, 'Suraj');
  assert.equal(api.account.snapshot().bio, 'Ludo is life');
  assert.ok(el.querySelectorAll('.pstat').length === 4);

  const other = api.social.pool()[5];
  api.profileCard.open(other.id);
  await tick(20);
  assert.equal(el.querySelectorAll('[data-gift]').length, 5, 'five gifts');
  api.wallet._set(50000, 500);
  const charmBefore = other.charm;
  el.querySelector('[data-gift="rose"]').click();
  await tick(20);
  assert.ok(other.charm > charmBefore, 'the gift landed');
  api.profileCard.close();
  assert.deepEqual(dom.console.errors, []);
});

test('ui: switching to Hindi translates the whole shell, not just labels', async () => {
  const howto = doc.querySelector('[data-screen="howto"]');
  const beforeRule = howto.querySelector('[data-i18n="howto.r1"]').textContent;
  const settingsEl = doc.querySelector('[data-screen="settings"]');

  api.router.show('settings', { silent: true });
  api.settingsScreen.render(api.stats);
  await tick(20);
  const langRow = settingsEl.querySelector('[data-set="lang"]');
  assert.equal(langRow.children.length, 2, 'both languages are offered');

  langRow.querySelector('[data-value="hi"]').click();
  await tick(30);

  assert.equal(api.i18n.lang, 'hi');
  assert.equal(doc.documentElement.getAttribute('lang'), 'hi');
  const afterRule = howto.querySelector('[data-i18n="howto.r1"]').textContent;
  assert.notEqual(afterRule, beforeRule, 'static markup was retranslated');
  assert.match(afterRule, /[\u0900-\u097F]/, 'the rule text is Devanagari now');
  assert.match(settingsEl.querySelector('[data-i18n="set.sound"]').textContent, /[\u0900-\u097F]/);
  assert.equal(api.prefs.get('lang'), 'hi', 'the choice is persisted');

  // in-game banner too
  const session = api.startGame({ mode: 'vsComputer', count: 2, humanColor: 'red', names: {} });
  session.controller.setTiming(INSTANT);
  await tick(40);
  assert.match(doc.querySelector('[data-hud="banner"]').textContent, /[\u0900-\u097F]/);

  langRow.querySelector('[data-value="en"]').click();
  await tick(20);
  assert.equal(api.i18n.lang, 'en');
  api.exitToMenu();
  await tick(20);
  assert.deepEqual(dom.console.errors, []);
});

/* ──────────────── Wave 7: online tables, matchmaking, gold room ───────── */

test('ui: the ONLINE tile opens a working stake picker', async () => {
  api.wallet._set(2000000, 500);
  api.router.show('menu', { silent: true });
  doc.querySelector('[data-home="online"]').click();
  await tick(20);

  const el = doc.querySelector('[data-overlay="online"]');
  assert.equal(el.classList.contains('is-open'), true);
  assert.ok(el.querySelectorAll('[data-chip]').length >= 4, 'format and seat chips');
  assert.equal(el.querySelectorAll('[data-equipped]').length, 3, 'dice / theme / frame strip');

  const tierEl = el.querySelector('.stake-tier');
  const first = tierEl.textContent;
  el.querySelector('[data-stake="down"]').click();
  await tick(10);
  const cheaper = el.querySelector('.stake-tier').textContent;
  assert.notEqual(cheaper, first, 'the stepper changes the tier');

  el.querySelector('[data-stake="up"]').click();
  await tick(10);
  assert.equal(el.querySelector('.stake-tier').textContent, first, 'and steps back');

  // 4 players
  el.querySelector('[data-chip="4"]').click();
  await tick(10);
  assert.equal(el.querySelector('[data-chip="4"]').getAttribute('aria-pressed'), 'true');
  assert.equal(el.querySelector('[data-online="play"]').disabled, false, 'affordable table is playable');

  el.querySelector('[data-online="close"]').click();
  await tick(10);
  assert.equal(el.classList.contains('is-open'), false);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: BIG WIN opens the same picker at the highest stake', async () => {
  doc.querySelector('[data-tile="bigWin"]').click();
  await tick(20);
  const el = doc.querySelector('[data-overlay="online"]');
  assert.equal(el.classList.contains('is-open'), true);
  assert.equal(el.querySelector('.stake-tier').textContent, 'DIAMOND');
  api.onlineModal.close();
  await tick(10);
});

test('ui: matchmaking fills every seat, then a staked table starts', async () => {
  api.wallet._set(2000000, 500);
  const before = api.wallet.coins;
  const entry = api.wallet.tierById('bronze').entry;

  const starting = api.playOnline({ format: 'classic', seats: 4, tierId: 'bronze' });
  await tick(60);
  const match = doc.querySelector('[data-overlay="match"]');
  assert.equal(match.classList.contains('is-open'), true, 'the search overlay is up');
  assert.equal(match.querySelectorAll('[data-slot]').length, 4, 'four seats to fill');
  assert.equal(api.wallet.coins, before, 'nothing is charged while searching');

  const session = await starting;
  assert.ok(session, 'the table started');
  assert.equal(match.classList.contains('is-open'), false, 'the search overlay closed');
  assert.equal(api.wallet.coins, before - entry, 'exactly one entry fee was taken');
  assert.equal(session.mode, 'online');
  assert.equal(session.online.tierId, 'bronze');
  assert.equal(session.spectator, false);
  assert.equal(session.controller.state.players.length, 4);

  // only our seat is ours to play; the rest arrive over the wire
  const local = session.controller.state.players.filter((p) => session.adapter.isLocalSeat(p.id));
  assert.equal(local.length, 1);
  assert.equal(local[0].id, session.humanId);
  assert.deepEqual(dom.console.errors, []);
  api.exitToMenu();
  await tick(30);
});

test('ui: cancelling the search costs nothing and starts no game', async () => {
  const before = api.wallet.coins;
  const starting = api.playOnline({ seats: 2, tierId: 'silver' });
  await tick(40);
  doc.querySelector('[data-match="cancel"]').click();
  const session = await starting;
  assert.equal(session, null, 'no table was created');
  assert.equal(api.wallet.coins, before, 'no entry fee was taken');
  assert.equal(api.session, null);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: a table you cannot afford sends you to the shop instead', async () => {
  api.wallet._set(10, 0);
  const session = await api.playOnline({ seats: 2, tierId: 'diamond' });
  assert.equal(session, null);
  assert.equal(api.wallet.coins, 10, 'the balance is untouched');
  assert.equal(doc.querySelector('[data-overlay="shop"]').classList.contains('is-open'), true);
  api.shopScreen.close();
  await tick(10);
  api.wallet._set(2000000, 500);
});

test('ui: the Gold Room lists live tables and lets you watch one', async () => {
  doc.querySelector('[data-tile="goldRoom"]').click();
  await tick(30);
  const el = doc.querySelector('[data-overlay="gold"]');
  assert.equal(el.classList.contains('is-open'), true);
  assert.ok(el.querySelectorAll('[data-tab]').length >= 3, 'a tab per watchable tier');
  const rows = el.querySelectorAll('[data-table]');
  assert.ok(rows.length >= 4, 'live tables are listed');
  assert.match(el.querySelector('.gold-clock').textContent, /^\d\d:\d\d$/);

  el.querySelectorAll('[data-tab]')[2].click();
  await tick(20);
  assert.ok(el.querySelectorAll('[data-table]').length >= 4, 'switching tier re-lists');

  el.querySelectorAll('[data-table]')[0].click();
  await tick(40);
  assert.equal(el.classList.contains('is-open'), false);
  assert.equal(api.router.current, 'game');
  assert.equal(api.session.spectator, true, 'watching, not playing');
  assert.equal(api.session.controller.canRoll(), false, 'a watcher cannot roll');
  assert.equal(api.resume.has(), false, 'a watched table is never offered as "resume"');
  assert.deepEqual(dom.console.errors, []);
  api.exitToMenu();
  await tick(30);
});

test('ui: winning a staked table pays the prize and counts as an online game', async () => {
  api.wallet._set(1000000, 500);
  const tier = api.wallet.tierById('newbie');
  const gamesBefore = (api.stats.all().modes.online || { games: 0 }).games;

  const session = api.startGame({
    mode: 'online',
    count: 2,
    humanColor: 'red',
    names: { yellow: 'Aarav' },
    online: { tierId: 'newbie', seats: 2, format: 'classic' },
  });
  session.controller.setTiming(INSTANT);
  session.adapter.latency = { min: 0, max: 0 };
  api.wallet.stake('newbie');
  const afterStake = api.wallet.coins;
  await tick(40);

  // Three tokens home and the last one on the home-entry square: our seat is a
  // few rolls from winning while the opponent is still stuck in its base.
  const mine = session.controller.state.players[session.humanId];
  mine.tokens = [FINISH, FINISH, FINISH, 50];
  mine.finished = 3;

  let settled = null;
  api.bus.on('wallet:settled', (e) => {
    settled = e;
  });
  const drive = setInterval(() => {
    const c = session.controller;
    if (c.canRoll()) c.roll();
    else if (c.canMove()) c.selectMove(c.currentMoves()[0]);
  }, 1);
  await new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('the staked table never finished')), 20000);
    const poll = setInterval(() => {
      if (!settled) return;
      clearInterval(poll);
      clearTimeout(guard);
      resolve();
    }, 5);
  });
  clearInterval(drive);

  assert.equal(settled.rank, 1, 'we came first');
  assert.equal(settled.prize, tier.winner);
  assert.equal(api.wallet.coins, afterStake + tier.winner, 'the advertised prize was paid');
  assert.equal((api.stats.all().modes.online || {}).games, gamesBefore + 1, 'it counts as an online game');
  assert.equal(api.resume.has(), false, 'a staked table is never offered as "resume"');

  api.exitToMenu();
  await tick(30);
  assert.equal(api.session, null);
  assert.deepEqual(dom.console.errors, []);
});

test('ui: teardown — the DOM shim is removed from the process', () => {
  dom.restore();
  assert.equal(typeof globalThis.document, 'undefined');
});
