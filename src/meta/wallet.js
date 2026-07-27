/**
 * meta/wallet.js — virtual currencies: coins and diamonds.
 *
 * IMPORTANT: these are virtual only. They cannot be purchased and cannot be
 * cashed out. Every table below is a game-balance table, not a price list.
 */

export const COIN = 'coins';
export const DIAMOND = 'diamonds';

export const START_BALANCE = Object.freeze({ coins: 25000, diamonds: 40 });

/**
 * Table tiers, mirroring the reference app's ladder.
 * `winner` is what the winner takes home, `entry` is each seat's stake,
 * `exp` is the XP the winner earns.
 */
export const STAKE_TIERS = Object.freeze([
  { id: 'newbie', label: 'NEWBIE', entry: 500, winner: 950, exp: 40 },
  { id: 'bronze', label: 'BRONZE', entry: 2000, winner: 3800, exp: 60 },
  { id: 'silver', label: 'SILVER', entry: 10000, winner: 19000, exp: 90 },
  { id: 'gold', label: 'GOLD', entry: 50000, winner: 95000, exp: 140 },
  { id: 'platinum', label: 'PLATINUM', entry: 200000, winner: 380000, exp: 220 },
  { id: 'diamond', label: 'DIAMOND', entry: 1000000, winner: 1900000, exp: 340 },
  { id: 'bigwin', label: 'BIG WIN', entry: 5000000, winner: 9500000, exp: 500 },
]);

/** Indian short form: 1,234 · 12.5K · 3L · 1.51Cr — exactly like the reference. */
export function formatAmount(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 10000000) return trim(v / 10000000) + 'Cr';
  if (v >= 100000) return trim(v / 100000) + 'L';
  if (v >= 10000) return trim(v / 1000) + 'K';
  return v.toLocaleString('en-IN');
}

function trim(x) {
  const s = x.toFixed(x < 10 ? 2 : 1);
  return s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

export function tierById(id) {
  return STAKE_TIERS.find((t) => t.id === id) || STAKE_TIERS[0];
}

/** Highest tier the player can afford (for sensible defaults). */
export function affordableTier(coins) {
  let out = STAKE_TIERS[0];
  for (const t of STAKE_TIERS) if (coins >= t.entry) out = t;
  return out;
}

/**
 * @param {object} opts { save, bus }
 */
export function createWallet({ save, bus = null } = {}) {
  const data = save.get('wallet');
  if (typeof data.coins !== 'number') {
    data.coins = START_BALANCE.coins;
    data.diamonds = START_BALANCE.diamonds;
    data.ledger = [];
    data.earnedTotal = 0;
    data.spentTotal = 0;
    save.touch('wallet');
  }
  if (!Array.isArray(data.ledger)) data.ledger = [];

  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  function log(kind, amount, reason) {
    data.ledger.unshift({ k: kind === DIAMOND ? 'd' : 'c', a: amount, r: reason, at: Date.now() });
    if (data.ledger.length > 40) data.ledger.length = 40;
  }

  function balances() {
    return { coins: data.coins, diamonds: data.diamonds };
  }

  const api = {
    get coins() {
      return data.coins;
    },
    get diamonds() {
      return data.diamonds;
    },
    balances,

    has(kind, amount) {
      return (kind === DIAMOND ? data.diamonds : data.coins) >= Math.max(0, amount || 0);
    },

    /** Add currency. Always succeeds. */
    earn(kind, amount, reason = 'reward') {
      const add = Math.max(0, Math.round(amount || 0));
      if (!add) return balances();
      if (kind === DIAMOND) data.diamonds += add;
      else data.coins += add;
      data.earnedTotal = (data.earnedTotal || 0) + (kind === DIAMOND ? 0 : add);
      log(kind, add, reason);
      save.touch('wallet');
      emit('wallet:changed', { ...balances(), delta: { kind, amount: add }, reason });
      emit('wallet:earned', { kind, amount: add, reason });
      return balances();
    },

    /** Remove currency. @returns {boolean} false when the player cannot afford it. */
    spend(kind, amount, reason = 'spend') {
      const cost = Math.max(0, Math.round(amount || 0));
      if (!api.has(kind, cost)) {
        emit('wallet:insufficient', { kind, amount: cost, reason, ...balances() });
        return false;
      }
      if (kind === DIAMOND) data.diamonds -= cost;
      else data.coins -= cost;
      data.spentTotal = (data.spentTotal || 0) + (kind === DIAMOND ? 0 : cost);
      log(kind, -cost, reason);
      save.touch('wallet');
      emit('wallet:changed', { ...balances(), delta: { kind, amount: -cost }, reason });
      emit('wallet:spent', { kind, amount: cost, reason });
      return true;
    },

    /**
     * Take the entry fee for a staked table.
     * @returns {boolean} false when the player cannot cover it
     */
    stake(tierId, reason = 'table-entry') {
      const tier = tierById(tierId);
      return api.spend(COIN, tier.entry, reason + ':' + tier.id);
    },

    /**
     * Pay out a finished staked table.
     * @param {string} tierId
     * @param {number} rank 1 = winner
     * @param {number} players
     */
    settle(tierId, rank, players = 4) {
      const tier = tierById(tierId);
      let prize = 0;
      if (rank === 1) prize = tier.winner;
      else if (players >= 4 && rank === 2) prize = Math.round(tier.entry * 0.6);
      if (prize > 0) api.earn(COIN, prize, 'table-prize:' + tier.id);
      emit('wallet:settled', { tier: tier.id, rank, prize, players });
      return prize;
    },

    ledger() {
      return data.ledger.slice();
    },

    format: formatAmount,
    tiers: STAKE_TIERS,
    tierById,
    affordableTier: () => affordableTier(data.coins),

    /** Debug / tests only. */
    _set(coins, diamonds) {
      data.coins = coins;
      if (typeof diamonds === 'number') data.diamonds = diamonds;
      save.touch('wallet');
      emit('wallet:changed', balances());
    },
  };

  return api;
}
