/**
 * services/ads.js — rewarded-video seam.
 *
 * PHASE 1: LocalAdProvider plays a *simulated* rewarded video — a real 5 second
 * countdown rendered by whatever presenter the UI supplies — and resolves with
 * `completed: true`. No network, no tracking, no third-party SDK.
 *
 * PHASE 2: implement the same three methods over AdMob / Unity Ads and pass it
 * to createAdService(). Nothing else in the app changes.
 *
 *   { isAvailable(placement) : boolean
 *     show(placement)        : Promise<{completed:boolean}>
 *     preload(placement)     : void }
 */

/** Placements + their daily caps and rewards. */
export const PLACEMENTS = Object.freeze({
  getCoins: { id: 'getCoins', cap: 8, cooldownMs: 60000, reward: { kind: 'coins', amount: 4300 } },
  freeDiamond: { id: 'freeDiamond', cap: 5, cooldownMs: 120000, reward: { kind: 'diamonds', amount: 3 } },
  skinUnlock: { id: 'skinUnlock', cap: 30, cooldownMs: 0, reward: null },
  extraLife: { id: 'extraLife', cap: 3, cooldownMs: 0, reward: null },
  doubleReward: { id: 'doubleReward', cap: 10, cooldownMs: 0, reward: null },
  extraSpin: { id: 'extraSpin', cap: 4, cooldownMs: 0, reward: null },
});

export const AD_LENGTH_MS = 5000;

/** The Phase 1 provider: a fake ad the presenter draws. */
export class LocalAdProvider {
  constructor({ lengthMs = AD_LENGTH_MS } = {}) {
    this.lengthMs = lengthMs;
    this.presenter = null;
    this.shown = 0;
  }

  /** The UI hands us a function that shows the countdown and resolves. */
  setPresenter(fn) {
    this.presenter = fn;
  }

  isAvailable() {
    return true;
  }

  preload() { }

  async show(placement) {
    this.shown += 1;
    if (typeof this.presenter === 'function') {
      const out = await this.presenter({ placement, lengthMs: this.lengthMs });
      return { completed: out !== false, simulated: true };
    }
    await new Promise((r) => {
      const t = setTimeout(r, this.lengthMs);
      if (t && typeof t.unref === 'function') t.unref();
    });
    return { completed: true, simulated: true };
  }
}

/**
 * Ad service: caps, cooldowns, rewards, events. Keeps the provider dumb.
 * @param {object} opts { provider, save, bus, wallet, account, now }
 */
export function createAdService({ provider, save, bus = null, wallet = null, account = null, now = () => Date.now() }) {
  const data = save.get('rewards');
  if (!data.ads) {
    data.ads = { day: '', counts: {}, last: {} };
    save.touch('rewards');
  }

  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  function today() {
    return new Date(now()).toISOString().slice(0, 10);
  }

  function rollDay() {
    const d = today();
    if (data.ads.day !== d) {
      data.ads.day = d;
      data.ads.counts = {};
      save.touch('rewards');
    }
  }

  function place(id) {
    return PLACEMENTS[id] || { id, cap: 5, cooldownMs: 0, reward: null };
  }

  const api = {
    /** Ads are pointless for a VIP / remove-ads player except for rewards. */
    get suppressed() {
      return !!(account && account.removeAds);
    },

    remaining(id) {
      rollDay();
      const p = place(id);
      return Math.max(0, p.cap - (data.ads.counts[id] || 0));
    },

    cooldownLeft(id) {
      const p = place(id);
      if (!p.cooldownMs) return 0;
      const last = data.ads.last[id];
      if (!last) return 0; // never watched → no cooldown
      return Math.max(0, p.cooldownMs - (now() - last));
    },

    isAvailable(id) {
      if (!provider || !provider.isAvailable(id)) return false;
      return api.remaining(id) > 0 && api.cooldownLeft(id) === 0;
    },

    /**
     * Watch an ad and collect the placement reward (if any).
     * @returns {Promise<{completed:boolean, reward?:object, reason?:string}>}
     */
    async watch(id, opts = {}) {
      rollDay();
      if (!api.isAvailable(id)) {
        emit('ads:unavailable', { placement: id, remaining: api.remaining(id) });
        return { completed: false, reason: 'unavailable' };
      }
      emit('ads:start', { placement: id });
      const res = await provider.show(id);
      if (!res || res.completed === false) {
        emit('ads:cancelled', { placement: id });
        return { completed: false, reason: 'cancelled' };
      }
      data.ads.counts[id] = (data.ads.counts[id] || 0) + 1;
      data.ads.last[id] = now();
      save.touch('rewards');

      const p = place(id);
      const reward = opts.reward || p.reward;
      if (reward && wallet) wallet.earn(reward.kind, reward.amount, 'ad:' + id);
      emit('ads:reward', { placement: id, reward });
      return { completed: true, reward };
    },

    placements: PLACEMENTS,
    get provider() {
      return provider;
    },
  };

  return api;
}
