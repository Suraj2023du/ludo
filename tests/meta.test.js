/**
 * tests/meta.test.js — Wave 1 foundations: save document, account, wallet,
 * ad service and the (deliberately disabled) purchase service, plus i18n.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSave, emptySave, SAVE_VERSION } from '../src/storage/save.js';
import { createAccount, xpForLevel, tierForLevel } from '../src/meta/account.js';
import {
  COIN,
  DIAMOND,
  START_BALANCE,
  STAKE_TIERS,
  affordableTier,
  createWallet,
  formatAmount,
  tierById,
} from '../src/meta/wallet.js';
import { LocalAdProvider, createAdService, PLACEMENTS } from '../src/services/ads.js';
import {
  DISABLED_REASON,
  DisabledPurchaseProvider,
  PRODUCTS,
  createPurchaseService,
} from '../src/services/purchase.js';
import { createI18n, LANGS } from '../src/i18n/index.js';
import { createEventBus } from '../src/game/events.js';
import { createRng } from '../src/engine/state.js';

/**
 * Every test gets its own storage key. tests/ui.test.js boots the real app at
 * import time (top-level await), so the default save key is already populated
 * by the time these tests run — an isolated key keeps them independent.
 */
let keyCounter = 0;
const freshSave = () => createSave({ debounceMs: 0, key: 'ludoBattle.test.' + ++keyCounter });

const seeded = (n) => {
  let i = 0;
  return () => {
    i += 1;
    return ((i * 9301 + n * 49297) % 233280) / 233280;
  };
};

/* ──────────────────────────── save document ──────────────────────────── */

test('save: starts empty, patches sections and survives a flush + load', () => {
  const save = freshSave();
  assert.equal(save.get('account').id, undefined);
  save.patch('account', { id: '123', name: 'Asha' });
  assert.equal(save.get('account').name, 'Asha');
  save.flush();

  const copy = save.all();
  assert.equal(copy.v, SAVE_VERSION);
  assert.equal(copy.account.id, '123');

  const other = freshSave();
  other.load(copy);
  assert.equal(other.get('account').name, 'Asha');
});

test('save: touch() notifies subscribers and reset() clears everything', () => {
  const save = freshSave();
  const seen = [];
  save.subscribe((section) => seen.push(section));
  const wallet = save.get('wallet');
  wallet.coins = 10;
  save.touch('wallet');
  assert.deepEqual(seen, ['wallet']);
  save.reset();
  assert.equal(save.get('wallet').coins, undefined);
  assert.deepEqual(Object.keys(emptySave().account), []);
});

test('save: a document from a newer build is discarded, not crashed on', () => {
  const save = freshSave();
  save.load({ v: 99, account: { name: 'future' } });
  assert.equal(save.get('account').name, undefined);
});

/* ─────────────────────────────── account ─────────────────────────────── */

test('account: creates an identity once and keeps it', () => {
  const save = freshSave();
  const a = createAccount({ save, rng: seeded(7) });
  const id = a.id;
  assert.match(id, /^\d{8}$/);
  assert.equal(a.level, 1);
  assert.equal(a.snapshot().country, 'IN');

  const again = createAccount({ save, rng: seeded(9) });
  assert.equal(again.id, id, 'a second instance reuses the stored identity');
});

test('account: XP curve levels up and reports progress', () => {
  const save = freshSave();
  const bus = createEventBus();
  const ups = [];
  bus.on('account:levelUp', (e) => ups.push(e.level));
  const a = createAccount({ save, bus, rng: seeded(3) });

  assert.ok(xpForLevel(1) < xpForLevel(9), 'later levels cost more');
  const need = xpForLevel(1);
  a.addXp(need - 1);
  assert.equal(a.level, 1);
  assert.ok(a.snapshot().xpRatio > 0.9);
  a.addXp(1);
  assert.equal(a.level, 2);
  assert.deepEqual(ups, [2]);

  a.addXp(100000);
  assert.ok(a.level > 10, 'a big award can jump several levels');
  assert.ok(a.xp < xpForLevel(a.level), 'leftover XP stays below the next threshold');
});

test('account: tiers follow the level', () => {
  assert.equal(tierForLevel(1).id, 'bronze');
  assert.equal(tierForLevel(6).id, 'silver');
  assert.equal(tierForLevel(25).id, 'platinum');
  assert.equal(tierForLevel(999).id, 'master');
});

test('account: name is trimmed and clamped, profile fields persist', () => {
  const save = freshSave();
  const a = createAccount({ save, rng: seeded(5) });
  a.setName('   Ravi The Great Warrior   ');
  assert.equal(a.name.length <= 14, true);
  a.setProfile({ city: 'Patna', bio: 'x'.repeat(200), gender: 'male' });
  assert.equal(a.snapshot().city, 'Patna');
  assert.equal(a.snapshot().bio.length, 90);
});

test('account: VIP grants remove-ads and expires', () => {
  const save = freshSave();
  const a = createAccount({ save, rng: seeded(11) });
  assert.equal(a.isVip, false);
  assert.equal(a.removeAds, false);
  a.grantVip(30, 2);
  assert.equal(a.isVip, true);
  assert.equal(a.removeAds, true);
  assert.equal(a.vip.tier, 2);
  save.get('account').vip.until = Date.now() - 1000;
  assert.equal(a.isVip, false);
});

/* ──────────────────────────────── wallet ─────────────────────────────── */

test('wallet: starts with a playable balance and tracks earn/spend', () => {
  const save = freshSave();
  const bus = createEventBus();
  const changes = [];
  bus.on('wallet:changed', (e) => changes.push(e));
  const w = createWallet({ save, bus });

  assert.equal(w.coins, START_BALANCE.coins);
  assert.equal(w.diamonds, START_BALANCE.diamonds);

  w.earn(COIN, 1000, 'test');
  assert.equal(w.coins, START_BALANCE.coins + 1000);
  assert.equal(w.spend(COIN, 500, 'test'), true);
  assert.equal(w.coins, START_BALANCE.coins + 500);
  assert.equal(changes.length, 2);
});

test('wallet: spending more than you have fails and emits insufficient', () => {
  const save = freshSave();
  const bus = createEventBus();
  let short = null;
  bus.on('wallet:insufficient', (e) => {
    short = e;
  });
  const w = createWallet({ save, bus });
  assert.equal(w.spend(DIAMOND, 99999, 'skin'), false);
  assert.equal(w.diamonds, START_BALANCE.diamonds);
  assert.equal(short.kind, DIAMOND);
});

test('wallet: stake and settle move coins the right way', () => {
  const save = freshSave();
  const w = createWallet({ save });
  const before = w.coins;
  const tier = tierById('newbie');

  assert.equal(w.stake('newbie'), true);
  assert.equal(w.coins, before - tier.entry);

  const prize = w.settle('newbie', 1, 4);
  assert.equal(prize, tier.winner);
  assert.equal(w.coins, before - tier.entry + tier.winner);

  assert.equal(w.settle('newbie', 4, 4), 0, 'last place wins nothing');
  assert.ok(w.settle('newbie', 2, 4) > 0, '2nd place gets something back in a 4P game');
  assert.equal(w.settle('newbie', 2, 2), 0, 'in 1v1 only the winner is paid');
});

test('wallet: a too-expensive table cannot be entered', () => {
  const save = freshSave();
  const w = createWallet({ save });
  assert.equal(w.stake('bigwin'), false);
  assert.equal(w.coins, START_BALANCE.coins);
});

test('wallet: Indian short-form formatting', () => {
  assert.equal(formatAmount(0), '0');
  assert.equal(formatAmount(950), '950');
  assert.equal(formatAmount(9999), '9,999');
  assert.equal(formatAmount(12500), '12.5K');
  assert.equal(formatAmount(300000), '3L');
  assert.equal(formatAmount(1900000), '19L');
  assert.equal(formatAmount(15100000), '1.51Cr');
});

test('wallet: tier ladder is ordered and affordability picks the best one', () => {
  for (let i = 1; i < STAKE_TIERS.length; i++) {
    assert.ok(STAKE_TIERS[i].entry > STAKE_TIERS[i - 1].entry, 'entries increase');
    assert.ok(STAKE_TIERS[i].winner > STAKE_TIERS[i].entry, 'winning beats the stake');
  }
  assert.equal(affordableTier(600).id, 'newbie');
  assert.equal(affordableTier(60000).id, 'gold');
  assert.equal(affordableTier(0).id, 'newbie', 'never leaves the player with no table');
});

test('wallet: ledger keeps the recent history bounded', () => {
  const save = freshSave();
  const w = createWallet({ save });
  for (let i = 0; i < 60; i++) w.earn(COIN, 1, 'loop');
  const ledger = w.ledger();
  assert.equal(ledger.length, 40);
  assert.equal(ledger[0].r, 'loop');
});

/* ──────────────────────────────── ads ────────────────────────────────── */

test('ads: a watched ad pays its placement reward', async () => {
  const save = freshSave();
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const provider = new LocalAdProvider({ lengthMs: 1 });
  const ads = createAdService({ provider, save, bus, wallet });

  const before = wallet.coins;
  const res = await ads.watch('getCoins');
  assert.equal(res.completed, true);
  assert.equal(wallet.coins, before + PLACEMENTS.getCoins.reward.amount);
});

test('ads: daily caps and cooldowns are enforced', async () => {
  const save = freshSave();
  let clock = 1000;
  const provider = new LocalAdProvider({ lengthMs: 1 });
  const ads = createAdService({ provider, save, now: () => clock });

  assert.equal(ads.isAvailable('freeDiamond'), true);
  await ads.watch('freeDiamond');
  assert.equal(ads.isAvailable('freeDiamond'), false, 'cooldown blocks the next one');
  clock += PLACEMENTS.freeDiamond.cooldownMs + 1;
  assert.equal(ads.isAvailable('freeDiamond'), true);

  for (let i = 0; i < 10; i++) {
    clock += PLACEMENTS.freeDiamond.cooldownMs + 1;
    await ads.watch('freeDiamond');
  }
  assert.equal(ads.remaining('freeDiamond'), 0);
  const blocked = await ads.watch('freeDiamond');
  assert.equal(blocked.completed, false);
  assert.equal(blocked.reason, 'unavailable');
});

test('ads: a cancelled ad pays nothing', async () => {
  const save = freshSave();
  const wallet = createWallet({ save });
  const provider = new LocalAdProvider({ lengthMs: 1 });
  provider.setPresenter(async () => false); // user backed out
  const ads = createAdService({ provider, save, wallet });
  const before = wallet.coins;
  const res = await ads.watch('getCoins');
  assert.equal(res.completed, false);
  assert.equal(wallet.coins, before);
});

test('ads: VIP players are flagged as ad-suppressed', () => {
  const save = freshSave();
  const account = createAccount({ save, rng: seeded(2) });
  const ads = createAdService({ provider: new LocalAdProvider(), save, account });
  assert.equal(ads.suppressed, false);
  account.grantVip(7);
  assert.equal(ads.suppressed, true);
});

/* ────────────────────────────── purchases ────────────────────────────── */

test('purchase: nothing can be bought in this build', async () => {
  const save = freshSave();
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const shop = createPurchaseService({ provider: new DisabledPurchaseProvider(), bus, wallet });

  assert.equal(shop.available, false);
  const before = wallet.coins;
  const res = await shop.buy('pack.start.coins');
  assert.equal(res.ok, false);
  assert.equal(res.reason, DISABLED_REASON);
  assert.equal(wallet.coins, before, 'a refused purchase grants nothing');
});

test('purchase: the catalogue is complete and groupable', () => {
  const shop = createPurchaseService({ provider: new DisabledPurchaseProvider() });
  assert.equal(shop.products().length, PRODUCTS.length);
  assert.ok(shop.products('coins').length >= 4);
  assert.ok(shop.products('diamonds').length >= 3);
  assert.ok(shop.products('packs').some((p) => p.id === 'vip.super'));
  for (const p of PRODUCTS) {
    assert.ok(p.id && p.title && p.price, 'every product renders: ' + p.id);
    assert.ok(p.grant && Object.keys(p.grant).length > 0, 'every product grants something: ' + p.id);
  }
});

test('purchase: grantFree applies a product without any payment', () => {
  const save = freshSave();
  const wallet = createWallet({ save });
  const account = createAccount({ save, rng: seeded(4) });
  const shop = createPurchaseService({ provider: new DisabledPurchaseProvider(), wallet, account });

  const before = wallet.diamonds;
  assert.equal(shop.grantFree('pack.start.diamonds', 'reward'), true);
  assert.equal(wallet.diamonds, before + 600);

  shop.grantFree('vip.super', 'promo');
  assert.equal(account.isVip, true);
  assert.equal(account.removeAds, true);
});

/* ──────────────────────────────── i18n ──────────────────────────────── */

test('i18n: interpolates, falls back to English and switches language', () => {
  const i18n = createI18n({ lang: 'en' });
  assert.equal(i18n.t('game.yourTurn', { name: 'Asha' }), "Asha's turn");
  assert.equal(i18n.t('does.not.exist'), 'does.not.exist');

  i18n.setLang('hi');
  assert.equal(i18n.t('common.play'), 'खेलें');
  assert.equal(i18n.t('game.yourTurn', { name: 'आशा' }), 'आशा की बारी');
  assert.equal(i18n.t('app.name'), 'Ludo Battle', 'untranslated keys fall back');
});

test('i18n: Hindi covers the whole player-facing surface', () => {
  const i18n = createI18n({});
  const missing = i18n.missing('hi');
  // A few brand/tech strings stay English on purpose.
  const allowed = new Set(['app.name', 'common.level', 'common.free', 'online.2p', 'online.4p', 'task.progress', 'game.timeLeft', 'skins.dice']);
  const unexpected = missing.filter((k) => !allowed.has(k));
  assert.deepEqual(unexpected, [], 'untranslated keys: ' + unexpected.join(', '));
  assert.equal(LANGS.length, 2);
});

test('i18n: subscribers hear language changes', () => {
  const i18n = createI18n({});
  const seen = [];
  i18n.subscribe((l) => seen.push(l));
  i18n.setLang('hi');
  i18n.setLang('hi');
  i18n.setLang('en');
  assert.deepEqual(seen, ['hi', 'en'], 'no duplicate notifications');
});

/* ────────────────────────────── cosmetics ────────────────────────────── */

test('catalog: free items are owned and equipped by default', async () => {
  const { createCatalog, DEFAULT_EQUIP, KINDS, ITEMS, UNLOCK } = await import('../src/meta/catalog.js');
  const save = freshSave();
  const c = createCatalog({ save });

  for (const kind of KINDS) {
    assert.ok(c.equippedItem(kind), 'something is equipped for ' + kind);
    assert.equal(c.equippedId(kind), DEFAULT_EQUIP[kind]);
    assert.ok(c.items(kind).length >= 9, kind + ' has a full grid');
  }
  const freeCount = ITEMS.filter((i) => i.unlock.type === UNLOCK.FREE).length;
  assert.equal(c.stats().owned, freeCount);
  assert.equal(c.stats().total, ITEMS.length);
  assert.ok(ITEMS.length >= 45, 'catalogue is as rich as the reference: ' + ITEMS.length);
});

test('catalog: buying with coins and diamonds works, and only then can you equip', async () => {
  const { createCatalog } = await import('../src/meta/catalog.js');
  const save = freshSave();
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const c = createCatalog({ save, bus, wallet });

  assert.equal(c.equip('dice.cricket'), false, 'cannot equip what you do not own');
  const before = wallet.coins;
  assert.deepEqual(c.purchase('dice.cricket'), { ok: true });
  assert.equal(wallet.coins, before - 5000);
  assert.equal(c.owned('dice.cricket'), true);
  assert.equal(c.equip('dice.cricket'), true);
  assert.equal(c.equippedId('dice'), 'dice.cricket');
  assert.equal(c.isEquipped('dice.cricket'), true);

  wallet._set(0, 0);
  assert.equal(c.purchase('dice.king').reason, 'insufficient');
  assert.equal(c.owned('dice.king'), false);
});

test('catalog: ad-unlock items track progress and unlock at the threshold', async () => {
  const { createCatalog, itemById } = await import('../src/meta/catalog.js');
  const save = freshSave();
  const c = createCatalog({ save, wallet: createWallet({ save }) });
  const id = 'dice.frost';
  const need = itemById(id).unlock.need;

  assert.equal(c.purchase(id).reason, 'watch-ads');
  assert.deepEqual(c.progress(id), { have: 0, need });
  for (let i = 0; i < need - 1; i++) c.addAdProgress(id);
  assert.equal(c.owned(id), false);
  assert.equal(c.status(id).have, need - 1);
  const last = c.addAdProgress(id);
  assert.equal(last.unlocked, true);
  assert.equal(c.owned(id), true);
});

test('catalog: event and ranking items stay locked and say why', async () => {
  const { createCatalog } = await import('../src/meta/catalog.js');
  const save = freshSave();
  const c = createCatalog({ save, wallet: createWallet({ save }) });
  assert.equal(c.purchase('chat.ganesh').reason, 'event');
  assert.equal(c.status('chat.ganesh').state, 'event');
  assert.equal(c.purchase('token.champion').reason, 'ranking');
  assert.equal(c.status('token.champion').state, 'rank');
  assert.equal(c.grant('token.champion', 'reward'), true, 'a reward can still grant it');
  assert.equal(c.status('token.champion').state, 'owned');
});

test('catalog: every theme item maps to a real palette and every art recipe is complete', async () => {
  const { ITEMS } = await import('../src/meta/catalog.js');
  const { THEMES } = await import('../src/render/board.js');
  for (const item of ITEMS) {
    assert.ok(item.name && item.unlock && item.unlock.type, 'item is describable: ' + item.id);
    if (item.kind === 'theme') {
      assert.ok(THEMES[item.theme], 'missing palette for ' + item.id);
    } else {
      assert.ok(item.art, 'missing art recipe for ' + item.id);
    }
  }
  for (const key of Object.keys(THEMES)) {
    const t = THEMES[key];
    for (const field of ['page', 'board', 'track', 'center', 'line', 'frame', 'text', 'star']) {
      assert.match(t[field], /^#[0-9a-f]{3,8}$/i, key + '.' + field + ' must be a colour');
    }
    for (const colour of ['red', 'green', 'yellow', 'blue']) {
      for (const shade of ['main', 'dark', 'light']) {
        assert.match(t.players[colour][shade], /^#[0-9a-f]{6}$/i, key + '.' + colour + '.' + shade);
      }
    }
  }
});

test('catalog: skin painters run for every item without throwing', async () => {
  const { ITEMS } = await import('../src/meta/catalog.js');
  const { THEMES } = await import('../src/render/board.js');
  const skins = await import('../src/render/skins.js');
  const avatar = await import('../src/render/avatar.js');
  const { installDom } = await import('../tools/dom-stub.js');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  const dom = installDom({ htmlPath: join(root, 'index.html') });
  const canvas = dom.document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const theme = THEMES.classic;

  for (const item of ITEMS) {
    if (item.kind === 'dice') {
      for (let v = 1; v <= 6; v++) skins.drawDiceFace(ctx, 40, v, item.art);
    } else if (item.kind === 'token') {
      skins.drawTokenShape(ctx, 20, 20, 8, theme.players.red, item.art);
      skins.drawTokenPreview(ctx, 64, theme, item.art);
    } else if (item.kind === 'frame') {
      skins.drawFrameRing(ctx, 20, 20, 14, item.art, 1000);
    } else if (item.kind === 'chatbox') {
      const style = skins.chatboxStyle(item.art);
      assert.ok(style['--bubble-bg']);
    } else {
      skins.drawMiniBoard(ctx, 64, THEMES[item.theme]);
    }
  }
  avatar.drawAvatarBlock(ctx, 24, 24, 20, {
    avatar: { seed: 12345, style: 'bloom', tint: 40 },
    frame: { ring: ['#fff', '#000'], ornament: 'crown' },
    initial: 'A',
    level: 12,
    xpRatio: 0.4,
  });
  avatar.drawMascot(ctx, 40, 40, 60, 1200);
  avatar.drawPodium(ctx, 0, 0, 30, 40, 1);
  for (const style of ['bloom', 'beam', 'ring', 'wave', 'spark', 'grid']) {
    avatar.drawAvatar(ctx, 20, 20, 18, { seed: 7, style, tint: 120 }, 'Z');
  }
  assert.ok(ctx.calls > 500, 'painters actually drew something: ' + ctx.calls);
  dom.restore();
});

/* ─────────────────────────────── rewards ─────────────────────────────── */

test('rewards: a new player has one spin waiting, then a 4h cooldown', async () => {
  const { createRewards, SPIN_COOLDOWN_MS } = await import('../src/meta/rewards.js');
  const save = freshSave();
  let clock = 1e12;
  const wallet = createWallet({ save });
  const r = createRewards({ save, wallet, now: () => clock });

  assert.equal(r.canSpin(), true);
  const first = r.spin(() => 0.99);
  assert.ok(first && first.prize);
  assert.equal(r.canSpin(), false);
  assert.ok(r.spinCooldownLeft() > 0);

  clock += SPIN_COOLDOWN_MS + 1;
  assert.equal(r.canSpin(), true);
  assert.equal(r.spin(() => 0.5) !== null, true);

  r.addSpin(2);
  assert.equal(r.canSpin(), true);
  assert.equal(r.bankedSpins, 2);
});

test('rewards: spinning pays the prize and reports the segment', async () => {
  const { createRewards, SPIN_PRIZES } = await import('../src/meta/rewards.js');
  const save = freshSave();
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const r = createRewards({ save, bus, wallet });

  const seen = [];
  bus.on('rewards:spin', (e) => seen.push(e));
  const coinsBefore = wallet.coins;
  const gemsBefore = wallet.diamonds;

  const res = r.spin(() => 0);
  assert.equal(res.index, 0);
  assert.equal(seen.length, 1);
  const prize = SPIN_PRIZES[0];
  if (prize.kind === 'coins') assert.equal(wallet.coins, coinsBefore + prize.amount);
  else assert.equal(wallet.diamonds, gemsBefore + prize.amount);
});

test('rewards: the wheel is weighted so the jackpot stays rare', async () => {
  const { createRewards, SPIN_PRIZES } = await import('../src/meta/rewards.js');
  const save = freshSave();
  let clock = 1e12;
  const r = createRewards({ save, wallet: createWallet({ save }), now: () => clock });
  const rng = createRng(4242);
  const counts = new Array(SPIN_PRIZES.length).fill(0);

  for (let i = 0; i < 2000; i++) {
    r.addSpin(1);
    const out = r.spin(rng);
    counts[out.index]++;
  }
  const jackpot = SPIN_PRIZES.findIndex((p) => p.jackpot);
  assert.ok(counts[jackpot] > 0, 'the jackpot is reachable');
  assert.ok(counts[jackpot] / 2000 < 0.02, 'jackpot rate stays low: ' + counts[jackpot] / 2000);
  assert.ok(counts.every((c) => c > 0), 'every segment can be hit');
});

test('rewards: the daily ladder advances, breaks and cannot be double-claimed', async () => {
  const { createRewards, DAILY_LADDER } = await import('../src/meta/rewards.js');
  const save = freshSave();
  let clock = Date.parse('2026-03-01T10:00:00Z');
  const wallet = createWallet({ save });
  const r = createRewards({ save, wallet, now: () => clock });

  assert.equal(r.canClaimDaily(), true);
  const d1 = r.claimDaily();
  assert.equal(d1.day, 1);
  assert.equal(r.canClaimDaily(), false);
  assert.equal(r.claimDaily(), null);

  clock += 86400000; // next day
  const d2 = r.claimDaily();
  assert.equal(d2.day, 2);
  assert.equal(r.streak, 2);

  clock += 86400000 * 3; // missed days
  const d3 = r.claimDaily();
  assert.equal(d3.day, 1, 'the ladder restarts after a miss');
  assert.equal(r.streak, 1);
  assert.equal(DAILY_LADDER.length, 7);
});

test('rewards: lucky-month stamps pay a bonus every seventh day', async () => {
  const { createRewards } = await import('../src/meta/rewards.js');
  const save = freshSave();
  let clock = Date.parse('2026-05-01T08:00:00Z');
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const r = createRewards({ save, bus, wallet, now: () => clock });

  let bonuses = 0;
  bus.on('rewards:lucky', () => bonuses++);
  for (let i = 0; i < 14; i++) {
    r.stampLucky();
    r.stampLucky(); // same day twice → one stamp
    clock += 86400000;
  }
  assert.equal(r.luckyMonth().count, 14);
  assert.equal(bonuses, 2);
});

test('rewards: countdown formatting', async () => {
  const { formatCountdown } = await import('../src/meta/rewards.js');
  assert.equal(formatCountdown(0), '0s');
  assert.equal(formatCountdown(45000), '45s');
  assert.equal(formatCountdown(125000), '2m 5s');
  assert.equal(formatCountdown(3 * 3600000 + 720000), '3h 12m');
});

/* ──────────────────────────────── tasks ──────────────────────────────── */

test('tasks: progress, claiming, points and milestones', async () => {
  const { createTasks, DAILY_TASKS, MILESTONES } = await import('../src/meta/tasks.js');
  const save = freshSave();
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const tasks = createTasks({ save, bus, wallet });

  assert.equal(tasks.daily().length, DAILY_TASKS.length);
  assert.equal(tasks.growth().length > 0, true);

  assert.equal(tasks.claim('capture5').reason, 'incomplete');
  tasks.track('capture5', 3);
  assert.equal(tasks.have('capture5'), 3);
  tasks.track('capture5', 9);
  assert.equal(tasks.have('capture5'), 5, 'progress is capped at the target');

  const coins = wallet.coins;
  const res = tasks.claim('capture5');
  assert.equal(res.ok, true);
  assert.equal(wallet.coins, coins + res.reward.amount);
  assert.equal(tasks.claim('capture5').reason, 'claimed');
  assert.equal(tasks.points, 15);

  // milestone gating
  assert.equal(tasks.claimMilestone(MILESTONES[0].pts).reason, 'locked');
  for (const id of ['win1', 'play3', 'quick3', 'spin3', 'six10']) {
    const def = tasks.daily().find((x) => x.id === id);
    tasks.track(id, def.target);
    tasks.claim(id);
  }
  assert.ok(tasks.points >= MILESTONES[0].pts);
  const gems = wallet.diamonds;
  const ms = tasks.claimMilestone(MILESTONES[0].pts);
  assert.equal(ms.ok, true);
  assert.equal(wallet.diamonds, gems + MILESTONES[0].reward.amount);
  assert.equal(tasks.claimMilestone(MILESTONES[0].pts).reason, 'claimed');
});

test('tasks: the bus feeds progress automatically for my own seat only', async () => {
  const { createTasks } = await import('../src/meta/tasks.js');
  const save = freshSave();
  const bus = createEventBus();
  const tasks = createTasks({ save, bus, wallet: createWallet({ save }), isMe: (id) => id === 0 });

  bus.emit('dice:rolled', { playerId: 0, value: 6 });
  bus.emit('dice:rolled', { playerId: 1, value: 6 });
  bus.emit('dice:rolled', { playerId: 0, value: 3 });
  assert.equal(tasks.have('six10'), 1, 'only my sixes count');

  bus.emit('token:captured', { byPlayerId: 0, playerId: 2 });
  bus.emit('token:captured', { byPlayerId: 3, playerId: 0 });
  assert.equal(tasks.have('capture5'), 1);

  bus.emit('token:finished', { playerId: 0 });
  assert.equal(tasks.have('home4'), 1);

  bus.emit('game:over', { winner: 0, mode: 'quickMatch' });
  assert.equal(tasks.have('play3'), 1);
  assert.equal(tasks.have('win1'), 1);
  assert.equal(tasks.have('quick3'), 1);
});

test('tasks: daily tasks reset at midnight, growth tasks do not', async () => {
  const { createTasks } = await import('../src/meta/tasks.js');
  const save = freshSave();
  let clock = Date.parse('2026-06-10T12:00:00Z');
  const tasks = createTasks({ save, wallet: createWallet({ save }), now: () => clock });

  tasks.track('capture5', 4);
  tasks.track('captures100', 40);
  assert.equal(tasks.have('capture5'), 4);

  clock += 86400000;
  assert.equal(tasks.have('capture5'), 0, 'daily reset');
  assert.equal(tasks.have('captures100'), 40, 'growth kept');
});

test('tasks: sync() mirrors level, collection and lifetime records', async () => {
  const { createTasks } = await import('../src/meta/tasks.js');
  const { createCatalog } = await import('../src/meta/catalog.js');
  const save = freshSave();
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const account = createAccount({ save, bus, rng: seeded(21) });
  const catalog = createCatalog({ save, bus, wallet });
  const tasks = createTasks({ save, bus, wallet, account, catalog });

  account.addXp(9000);
  tasks.sync({ wins: 37, captures: 210, spins: 12 });
  assert.equal(tasks.have('level15'), Math.min(15, account.level));
  assert.equal(tasks.have('win120'), 37);
  assert.equal(tasks.have('captures100'), 100, 'capped at the target');
  assert.equal(tasks.have('spin50'), 12);
  assert.ok(tasks.have('skins10') > 0);

  // sync() twice must be a no-op (this is what caused a badge feedback loop)
  let emits = 0;
  bus.on('tasks:progress', () => emits++);
  tasks.sync({ wins: 37, captures: 210, spins: 12 });
  assert.equal(emits, 0);
});

test('tasks: claimable() counts what is waiting', async () => {
  const { createTasks } = await import('../src/meta/tasks.js');
  const save = freshSave();
  const tasks = createTasks({ save, wallet: createWallet({ save }) });
  assert.equal(tasks.claimable(), 0);
  tasks.track('win1', 1);
  assert.equal(tasks.claimable(), 1);
  tasks.claim('win1');
  assert.equal(tasks.claimable(), 0);
});

/* ─────────────────────────────── social ──────────────────────────────── */

async function socialFixture() {
  const { createSocial } = await import('../src/meta/social.js');
  const save = freshSave();
  const bus = createEventBus();
  const wallet = createWallet({ save, bus });
  const account = createAccount({ save, bus, rng: seeded(31) });
  const social = createSocial({ save, bus, account, wallet, rng: () => 0.42 });
  return { save, bus, wallet, account, social };
}

test('social: the simulated pool is stable across instances', async () => {
  const { createSocial } = await import('../src/meta/social.js');
  const save = freshSave();
  const a = createSocial({ save, rng: () => 0.7 });
  const first = a.pool().map((p) => p.id + p.name);
  const b = createSocial({ save });
  assert.deepEqual(b.pool().map((p) => p.id + p.name), first, 'same people every launch');
  assert.equal(a.pool().length, 40);
  for (const p of a.pool()) {
    assert.ok(p.name.length > 0 && p.name.length <= 14);
    assert.ok(p.level >= 2 && p.gamesWon <= p.gamesPlayed);
  }
});

test('social: add, accept, remove, block and report', async () => {
  const { social } = await socialFixture();
  assert.equal(social.requests().length, 2, 'seeded friend requests');

  const someone = social.nearby()[0];
  assert.deepEqual(social.addFriend(someone.id), { ok: true });
  assert.equal(social.isFriend(someone.id), true);
  assert.equal(social.addFriend(someone.id).reason, 'already');
  assert.equal(social.friendCount(), 1);

  const request = social.requests()[0];
  social.addFriend(request.id);
  assert.equal(social.requests().length, 1, 'accepting clears the request');

  assert.equal(social.removeFriend(someone.id), true);
  assert.equal(social.isFriend(someone.id), false);

  const target = social.nearby()[1];
  assert.equal(social.block(target.id), true);
  assert.equal(social.isBlocked(target.id), true);
  assert.equal(social.addFriend(target.id).reason, 'blocked');
  assert.equal(social.nearby().some((p) => p.id === target.id), false, 'blocked people disappear');

  const bad = social.nearby()[2];
  social.report(bad.id);
  assert.equal(social.isBlocked(bad.id), true, 'reporting also blocks');
});

test('social: gifts cost diamonds, add charm and are refused when broke', async () => {
  const { social, wallet, account } = await socialFixture();
  const target = social.pool()[0];
  const charmBefore = target.charm;
  const gems = wallet.diamonds;
  const gift = social.GIFTS[0];

  const res = social.sendGift(target.id, gift.id);
  assert.equal(res.ok, true);
  assert.equal(wallet.diamonds, gems - gift.cost);
  assert.equal(target.charm, charmBefore + gift.charm);
  assert.equal(account.snapshot().giftsOut, 1);

  wallet._set(0, 0);
  assert.equal(social.sendGift(target.id, 'rocket').reason, 'insufficient');
});

test('social: leaderboards rank everyone and always place me', async () => {
  const { social, wallet } = await socialFixture();
  for (const board of social.BOARDS) {
    const out = social.leaderboard(board.id, 20);
    assert.equal(out.rows.length, 20);
    for (let i = 1; i < out.rows.length; i++) {
      assert.ok(out.rows[i - 1].value >= out.rows[i].value, board.id + ' is sorted');
      assert.equal(out.rows[i].rank, i + 1);
    }
    assert.ok(social.myRank(board.id) > 0, 'I have a rank on ' + board.id);
  }
  // becoming rich moves me up the coins board
  const before = social.myRank('coins');
  wallet._set(999999999, 0);
  assert.ok(social.myRank('coins') <= before);
  assert.equal(social.leaderboard('coins').me.rank, social.myRank('coins'));
});

test('social: the inbox collects events and unread clears', async () => {
  const { social, bus, account } = await socialFixture();
  assert.equal(social.unread(), 0);
  account.addXp(100000); // triggers level-ups → inbox messages
  assert.ok(social.unread() > 0);
  assert.ok(social.inbox().length <= 30);
  social.markAllRead();
  assert.equal(social.unread(), 0);
  void bus;
});
