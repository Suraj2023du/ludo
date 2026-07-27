/**
 * meta/rewards.js — free-to-play reward loops: lucky spin, daily bonus ladder
 * and the monthly "Lucky Month" stamp card.
 *
 * No DOM. All timing goes through an injectable `now` so tests can travel.
 */

export const SPIN_COOLDOWN_MS = 4 * 60 * 60 * 1000; // one free spin every 4h

/** Wheel segments, drawn clockwise from the top. `w` is the relative weight. */
export const SPIN_PRIZES = Object.freeze([
  { id: 's1', kind: 'coins', amount: 1000, w: 22, color: '#f4b93c' },
  { id: 's2', kind: 'diamonds', amount: 2, w: 14, color: '#e879f9' },
  { id: 's3', kind: 'coins', amount: 2500, w: 18, color: '#43c59e' },
  { id: 's4', kind: 'coins', amount: 500, w: 24, color: '#5f8dff' },
  { id: 's5', kind: 'diamonds', amount: 5, w: 8, color: '#c77dff' },
  { id: 's6', kind: 'coins', amount: 5000, w: 9, color: '#ff8fa3' },
  { id: 's7', kind: 'coins', amount: 10000, w: 4, color: '#ffd24a' },
  { id: 's8', kind: 'coins', amount: 50000, w: 1, color: '#ff4d6d', jackpot: true },
]);

/** Seven-day login ladder. */
export const DAILY_LADDER = Object.freeze([
  { day: 1, kind: 'coins', amount: 2000 },
  { day: 2, kind: 'coins', amount: 4000 },
  { day: 3, kind: 'diamonds', amount: 3 },
  { day: 4, kind: 'coins', amount: 8000 },
  { day: 5, kind: 'coins', amount: 15000 },
  { day: 6, kind: 'diamonds', amount: 8 },
  { day: 7, kind: 'coins', amount: 50000 },
]);

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * @param {object} opts { save, bus, wallet, account, now }
 */
export function createRewards({ save, bus = null, wallet = null, account = null, now = () => Date.now() } = {}) {
  const data = save.get('rewards');
  if (!data.init) {
    data.init = true;
    data.lastSpinAt = 0;
    data.spinsBanked = 1; // one waiting for a brand-new player
    data.bonusDay = 0;
    data.bonusClaimedOn = '';
    data.streak = 0;
    data.lucky = { month: '', stamps: [] };
    save.touch('rewards');
  }
  if (!data.lucky) data.lucky = { month: '', stamps: [] };

  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  function pay(prize, reason) {
    if (wallet && prize) wallet.earn(prize.kind, prize.amount, reason);
    return prize;
  }

  const api = {
    /* ───────────────────────────── lucky spin ──────────────────────── */

    spinCooldownLeft() {
      if (data.spinsBanked > 0) return 0;
      const left = SPIN_COOLDOWN_MS - (now() - (data.lastSpinAt || 0));
      return Math.max(0, left);
    },

    canSpin() {
      return api.spinCooldownLeft() === 0;
    },

    get bankedSpins() {
      return data.spinsBanked || 0;
    },

    /** Give the player another spin (rewarded video, event, VIP…). */
    addSpin(n = 1) {
      data.spinsBanked = (data.spinsBanked || 0) + n;
      save.touch('rewards');
      emit('rewards:spins', { banked: data.spinsBanked });
      return data.spinsBanked;
    },

    /**
     * Spin the wheel. Weighted pick, so the jackpot stays rare.
     * @returns {{index:number, prize:object}|null} null when it is not ready
     */
    spin(rng = Math.random) {
      if (!api.canSpin()) return null;
      if (data.spinsBanked > 0) data.spinsBanked -= 1;
      data.lastSpinAt = now();

      const total = SPIN_PRIZES.reduce((n, p) => n + p.w, 0);
      let roll = rng() * total;
      let index = 0;
      for (let i = 0; i < SPIN_PRIZES.length; i++) {
        roll -= SPIN_PRIZES[i].w;
        if (roll <= 0) {
          index = i;
          break;
        }
      }
      const prize = SPIN_PRIZES[index];
      save.touch('rewards');
      pay(prize, 'spin');
      emit('rewards:spin', { index, prize });
      return { index, prize };
    },

    /* ───────────────────────────── daily bonus ─────────────────────── */

    canClaimDaily() {
      return data.bonusClaimedOn !== dayKey(now());
    },

    /** Which rung of the ladder is next (1..7). */
    dailyDay() {
      return Math.min(DAILY_LADDER.length, (data.bonusDay || 0) + 1);
    },

    dailyPreview() {
      return DAILY_LADDER[api.dailyDay() - 1];
    },

    /** @returns {{day:number, prize:object}|null} */
    claimDaily() {
      if (!api.canClaimDaily()) return null;
      const yesterday = dayKey(now() - 86400000);
      const continuing = data.bonusClaimedOn === yesterday;
      data.bonusDay = continuing ? Math.min(DAILY_LADDER.length, (data.bonusDay || 0) + 1) : 1;
      data.streak = continuing ? (data.streak || 0) + 1 : 1;
      data.bonusClaimedOn = dayKey(now());
      const prize = DAILY_LADDER[data.bonusDay - 1];
      save.touch('rewards');
      pay(prize, 'daily-bonus');
      if (account) account.addXp(20, 'daily-bonus');
      api.stampLucky();
      emit('rewards:daily', { day: data.bonusDay, streak: data.streak, prize });
      return { day: data.bonusDay, streak: data.streak, prize };
    },

    get streak() {
      return data.streak || 0;
    },

    /* ──────────────────────────── lucky month ──────────────────────── */

    /** One stamp per day played; a full week of stamps pays a bonus. */
    stampLucky() {
      const month = dayKey(now()).slice(0, 7);
      if (data.lucky.month !== month) data.lucky = { month, stamps: [] };
      const today = dayKey(now());
      if (data.lucky.stamps.indexOf(today) !== -1) return data.lucky.stamps.length;
      data.lucky.stamps.push(today);
      save.touch('rewards');
      const count = data.lucky.stamps.length;
      if (count % 7 === 0) {
        pay({ kind: 'diamonds', amount: 10 }, 'lucky-month');
        emit('rewards:lucky', { stamps: count, prize: { kind: 'diamonds', amount: 10 } });
      }
      return count;
    },

    luckyMonth() {
      const month = dayKey(now()).slice(0, 7);
      const stamps = data.lucky.month === month ? data.lucky.stamps.slice() : [];
      return { month, stamps, count: stamps.length, nextAt: 7 - (stamps.length % 7) };
    },

    /** Everything the lobby needs for badges. */
    summary() {
      return {
        canSpin: api.canSpin(),
        spinCooldownLeft: api.spinCooldownLeft(),
        bankedSpins: api.bankedSpins,
        canClaimDaily: api.canClaimDaily(),
        dailyDay: api.dailyDay(),
        streak: api.streak,
        lucky: api.luckyMonth(),
      };
    },
  };

  return api;
}

/** "3h 12m" style countdown text. */
export function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}
