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

const seeded = (n) => {
  let i = 0;
  return () => {
    i += 1;
    return ((i * 9301 + n * 49297) % 233280) / 233280;
  };
};

/* ──────────────────────────── save document ──────────────────────────── */

test('save: starts empty, patches sections and survives a flush + load', () => {
  const save = createSave({ debounceMs: 0 });
  assert.equal(save.get('account').id, undefined);
  save.patch('account', { id: '123', name: 'Asha' });
  assert.equal(save.get('account').name, 'Asha');
  save.flush();

  const copy = save.all();
  assert.equal(copy.v, SAVE_VERSION);
  assert.equal(copy.account.id, '123');

  const other = createSave({ debounceMs: 0 });
  other.load(copy);
  assert.equal(other.get('account').name, 'Asha');
});

test('save: touch() notifies subscribers and reset() clears everything', () => {
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
  save.load({ v: 99, account: { name: 'future' } });
  assert.equal(save.get('account').name, undefined);
});

/* ─────────────────────────────── account ─────────────────────────────── */

test('account: creates an identity once and keeps it', () => {
  const save = createSave({ debounceMs: 0 });
  const a = createAccount({ save, rng: seeded(7) });
  const id = a.id;
  assert.match(id, /^\d{8}$/);
  assert.equal(a.level, 1);
  assert.equal(a.snapshot().country, 'IN');

  const again = createAccount({ save, rng: seeded(9) });
  assert.equal(again.id, id, 'a second instance reuses the stored identity');
});

test('account: XP curve levels up and reports progress', () => {
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
  const a = createAccount({ save, rng: seeded(5) });
  a.setName('   Ravi The Great Warrior   ');
  assert.equal(a.name.length <= 14, true);
  a.setProfile({ city: 'Patna', bio: 'x'.repeat(200), gender: 'male' });
  assert.equal(a.snapshot().city, 'Patna');
  assert.equal(a.snapshot().bio.length, 90);
});

test('account: VIP grants remove-ads and expires', () => {
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
  const w = createWallet({ save });
  for (let i = 0; i < 60; i++) w.earn(COIN, 1, 'loop');
  const ledger = w.ledger();
  assert.equal(ledger.length, 40);
  assert.equal(ledger[0].r, 'loop');
});

/* ──────────────────────────────── ads ────────────────────────────────── */

test('ads: a watched ad pays its placement reward', async () => {
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
  const account = createAccount({ save, rng: seeded(2) });
  const ads = createAdService({ provider: new LocalAdProvider(), save, account });
  assert.equal(ads.suppressed, false);
  account.grantVip(7);
  assert.equal(ads.suppressed, true);
});

/* ────────────────────────────── purchases ────────────────────────────── */

test('purchase: nothing can be bought in this build', async () => {
  const save = createSave({ debounceMs: 0 });
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
  const save = createSave({ debounceMs: 0 });
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
