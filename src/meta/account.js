/**
 * meta/account.js — the player: identity, level, XP, tier badge, VIP, likes.
 * No DOM. Everything lives in the save document.
 */

const TIERS = Object.freeze([
  { id: 'bronze', label: 'Bronze', min: 1, color: '#c07a3e' },
  { id: 'silver', label: 'Silver', min: 6, color: '#b9c3cf' },
  { id: 'gold', label: 'Gold', min: 14, color: '#f0b429' },
  { id: 'platinum', label: 'Platinum', min: 25, color: '#7fe0c8' },
  { id: 'diamond', label: 'Diamond', min: 40, color: '#7cc6ff' },
  { id: 'master', label: 'Master', min: 60, color: '#e879f9' },
]);

export const AVATAR_STYLES = Object.freeze(['bloom', 'beam', 'ring', 'wave', 'spark', 'grid']);
export const COUNTRIES = Object.freeze(['IN', 'PK', 'BD', 'NP', 'LK', 'US', 'GB', 'AE', 'ID', 'BR']);

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level) {
  return 80 + Math.round(Math.pow(Math.max(1, level), 1.32) * 34);
}

export function tierForLevel(level) {
  let out = TIERS[0];
  for (const t of TIERS) if (level >= t.min) out = t;
  return out;
}

export const TIER_LIST = TIERS;

function randomId(rng) {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(rng() * 10);
  return s;
}

/**
 * @param {object} opts { save, bus, rng, name }
 */
export function createAccount({ save, bus = null, rng = Math.random, name } = {}) {
  const data = save.get('account');

  if (!data.id) {
    data.id = randomId(rng);
    data.name = name || 'Player' + data.id.slice(0, 4);
    data.avatar = {
      seed: Math.floor(rng() * 1e9),
      style: AVATAR_STYLES[Math.floor(rng() * AVATAR_STYLES.length)],
      tint: Math.floor(rng() * 360),
    };
    data.gender = 'unset';
    data.country = 'IN';
    data.city = '';
    data.bio = '';
    data.photos = [];
    data.joinedAt = Date.now();
    data.level = 1;
    data.xp = 0;
    data.likes = 0;
    data.giftsIn = 0;
    data.giftsOut = 0;
    data.vip = { tier: 0, until: 0 };
    data.removeAds = false;
    save.touch('account');
  }

  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  const api = {
    get id() {
      return data.id;
    },
    get name() {
      return data.name;
    },
    get level() {
      return data.level;
    },
    get xp() {
      return data.xp;
    },
    get avatar() {
      return { ...data.avatar };
    },
    get likes() {
      return data.likes;
    },
    get removeAds() {
      return !!data.removeAds || api.isVip;
    },
    get isVip() {
      return !!(data.vip && data.vip.until > Date.now());
    },
    get vip() {
      return { ...(data.vip || { tier: 0, until: 0 }) };
    },

    /** Everything the UI needs in one shot. */
    snapshot() {
      const need = xpForLevel(data.level);
      return {
        id: data.id,
        name: data.name,
        avatar: { ...data.avatar },
        gender: data.gender,
        country: data.country,
        city: data.city,
        bio: data.bio,
        photos: (data.photos || []).slice(),
        joinedAt: data.joinedAt,
        level: data.level,
        xp: data.xp,
        xpNeeded: need,
        xpRatio: Math.min(1, data.xp / need),
        tier: tierForLevel(data.level),
        likes: data.likes,
        giftsIn: data.giftsIn,
        giftsOut: data.giftsOut,
        vip: api.vip,
        isVip: api.isVip,
        removeAds: api.removeAds,
      };
    },

    setName(next) {
      const clean = String(next || '').trim().slice(0, 14);
      if (!clean || clean === data.name) return data.name;
      data.name = clean;
      save.touch('account');
      emit('account:changed', api.snapshot());
      return data.name;
    },

    setAvatar(patch) {
      data.avatar = { ...data.avatar, ...patch };
      save.touch('account');
      emit('account:changed', api.snapshot());
      return { ...data.avatar };
    },

    setProfile(patch) {
      for (const key of ['gender', 'country', 'city', 'bio']) {
        if (patch[key] !== undefined) {
          data[key] = key === 'bio' ? String(patch[key]).slice(0, 90) : patch[key];
        }
      }
      save.touch('account');
      emit('account:changed', api.snapshot());
      return api.snapshot();
    },

    /** Award XP; handles (multiple) level-ups. @returns {{levels:number, level:number}} */
    addXp(amount, reason = 'play') {
      const add = Math.max(0, Math.round(amount || 0));
      if (!add) return { levels: 0, level: data.level };
      data.xp += add;
      let levels = 0;
      while (data.xp >= xpForLevel(data.level)) {
        data.xp -= xpForLevel(data.level);
        data.level += 1;
        levels += 1;
      }
      save.touch('account');
      emit('account:xp', { amount: add, reason, level: data.level, xp: data.xp });
      if (levels) emit('account:levelUp', { level: data.level, levels, tier: tierForLevel(data.level) });
      emit('account:changed', api.snapshot());
      return { levels, level: data.level };
    },

    addLike(n = 1) {
      data.likes += n;
      save.touch('account');
      emit('account:changed', api.snapshot());
      return data.likes;
    },

    giftReceived(n = 1) {
      data.giftsIn += n;
      save.touch('account');
      emit('account:changed', api.snapshot());
      return data.giftsIn;
    },

    giftSent(n = 1) {
      data.giftsOut += n;
      save.touch('account');
      return data.giftsOut;
    },

    /** Grant VIP for `days`. tier 1 = VIP, 2 = Super VIP. */
    grantVip(days = 30, tier = 1) {
      const base = Math.max(Date.now(), (data.vip && data.vip.until) || 0);
      data.vip = { tier, until: base + days * 86400000 };
      data.removeAds = true;
      save.touch('account');
      emit('account:changed', api.snapshot());
      return api.vip;
    },

    setRemoveAds(on) {
      data.removeAds = !!on;
      save.touch('account');
      emit('account:changed', api.snapshot());
      return data.removeAds;
    },

    addPhoto(dataUrl) {
      data.photos = (data.photos || []).slice(0, 3);
      data.photos.push(dataUrl);
      save.touch('account');
      emit('account:changed', api.snapshot());
      return data.photos.length;
    },
  };

  return api;
}
