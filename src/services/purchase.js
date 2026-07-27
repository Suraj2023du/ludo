/**
 * services/purchase.js — in-app purchase seam.
 *
 * ⚠️ PHASE 1 DELIBERATELY SELLS NOTHING.
 *
 * The Shop renders these products so the layout matches the reference app, but
 * `DisabledPurchaseProvider` refuses every purchase and the UI shows how to earn
 * the same rewards for free instead. Turning this on for real needs a billing
 * provider, receipt validation, age-gating and (for anything resembling
 * real-money play in India) legal review — a Phase 2 business decision.
 *
 * PHASE 2: implement { products(), buy(id), restore() } over Play Billing /
 * Stripe and pass it to createPurchaseService(). Nothing else changes.
 */

export const PRODUCT_KIND = Object.freeze({ COINS: 'coins', DIAMONDS: 'diamonds', VIP: 'vip', ADS: 'ads' });

/** Display catalogue. `price` is display-only text — nothing is charged. */
export const PRODUCTS = Object.freeze([
  {
    id: 'vip.super',
    kind: PRODUCT_KIND.VIP,
    group: 'packs',
    title: 'SUPER VIP',
    sub: 'Frames, gold dice, no ads, 2× daily bonus',
    price: '₹199 / month',
    bonus: null,
    grant: { vipDays: 30, vipTier: 2, coins: 500000, diamonds: 120 },
    featured: true,
  },
  {
    id: 'pack.start.coins',
    kind: PRODUCT_KIND.COINS,
    group: 'packs',
    title: 'START COIN PACK',
    sub: '3L coins',
    price: '₹85.00',
    bonus: '+750%',
    grant: { coins: 300000 },
  },
  {
    id: 'pack.start.diamonds',
    kind: PRODUCT_KIND.DIAMONDS,
    group: 'packs',
    title: 'START DIAMOND PACK',
    sub: '600 diamonds',
    price: '₹59.02',
    bonus: '+300%',
    grant: { diamonds: 600 },
  },
  {
    id: 'pack.daily',
    kind: PRODUCT_KIND.COINS,
    group: 'packs',
    title: 'Daily Value Deal',
    sub: 'Today (1/3)',
    price: '₹35.00',
    bonus: '+200%',
    grant: { coins: 120000, diamonds: 20 },
  },
  { id: 'coins.1', kind: PRODUCT_KIND.COINS, group: 'coins', title: '50K coins', price: '₹19', grant: { coins: 50000 } },
  { id: 'coins.2', kind: PRODUCT_KIND.COINS, group: 'coins', title: '3L coins', price: '₹85', bonus: '+15%', grant: { coins: 300000 } },
  { id: 'coins.3', kind: PRODUCT_KIND.COINS, group: 'coins', title: '20L coins', price: '₹449', bonus: '+40%', grant: { coins: 2000000 } },
  { id: 'coins.4', kind: PRODUCT_KIND.COINS, group: 'coins', title: '1.2Cr coins', price: '₹1,999', bonus: '+80%', grant: { coins: 12000000 } },
  { id: 'gem.1', kind: PRODUCT_KIND.DIAMONDS, group: 'diamonds', title: '60 diamonds', price: '₹19', grant: { diamonds: 60 } },
  { id: 'gem.2', kind: PRODUCT_KIND.DIAMONDS, group: 'diamonds', title: '300 diamonds', price: '₹85', bonus: '+10%', grant: { diamonds: 300 } },
  { id: 'gem.3', kind: PRODUCT_KIND.DIAMONDS, group: 'diamonds', title: '1,600 diamonds', price: '₹449', bonus: '+30%', grant: { diamonds: 1600 } },
  { id: 'ads.remove', kind: PRODUCT_KIND.ADS, group: 'packs', title: 'Remove Ads', sub: 'One-time, forever', price: '₹129', grant: { removeAds: true } },
]);

export const DISABLED_REASON = 'purchases-disabled';

/** The Phase 1 provider: refuses politely and explains. */
export class DisabledPurchaseProvider {
  products() {
    return PRODUCTS;
  }

  async buy(id) {
    return { ok: false, reason: DISABLED_REASON, productId: id };
  }

  async restore() {
    return { ok: false, reason: DISABLED_REASON };
  }

  get available() {
    return false;
  }
}

/**
 * Purchase service. Applies grants when (and only when) a provider says a real
 * purchase succeeded, so the Phase 2 swap needs no UI changes.
 * @param {object} opts { provider, bus, wallet, account }
 */
export function createPurchaseService({ provider, bus = null, wallet = null, account = null }) {
  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  function grant(product, source) {
    const g = product.grant || {};
    if (g.coins && wallet) wallet.earn('coins', g.coins, source);
    if (g.diamonds && wallet) wallet.earn('diamonds', g.diamonds, source);
    if (g.vipDays && account) account.grantVip(g.vipDays, g.vipTier || 1);
    if (g.removeAds && account) account.setRemoveAds(true);
  }

  return {
    get available() {
      return !!(provider && provider.available);
    },

    products(group) {
      const list = provider ? provider.products() : PRODUCTS;
      return group ? list.filter((p) => p.group === group) : list;
    },

    product(id) {
      return this.products().find((p) => p.id === id) || null;
    },

    /** @returns {Promise<{ok:boolean, reason?:string}>} */
    async buy(id) {
      const product = this.product(id);
      if (!product) return { ok: false, reason: 'unknown-product' };
      const res = await provider.buy(id);
      if (!res || !res.ok) {
        emit('shop:refused', { productId: id, reason: (res && res.reason) || DISABLED_REASON });
        return res || { ok: false, reason: DISABLED_REASON };
      }
      grant(product, 'purchase:' + id);
      emit('shop:purchased', { productId: id, product });
      return { ok: true, product };
    },

    /** Used by rewarded flows: grant a product's contents without a payment. */
    grantFree(id, source = 'promo') {
      const product = this.product(id);
      if (!product) return false;
      grant(product, source + ':' + id);
      emit('shop:granted', { productId: id, source });
      return true;
    },

    DISABLED_REASON,
  };
}
