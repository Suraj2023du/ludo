/**
 * meta/social.js — friends, gifts, likes, leaderboards and the inbox.
 *
 * PHASE 1: the other players are a *seeded simulation*. The pool is generated
 * once from a stored seed, so the same people are there every launch, their
 * numbers drift slowly, and every UI in the app works exactly as it will with
 * real users. PHASE 2 replaces `pool()` with Firestore queries — the API stays.
 *
 * No DOM, no canvas.
 */

const FIRST = [
  'Asha', 'Ravi', 'Neha', 'Arjun', 'Priya', 'Rohit', 'Kiran', 'Sunil', 'Meera', 'Vikram',
  'Anjali', 'Karan', 'Pooja', 'Amit', 'Divya', 'Rahul', 'Sneha', 'Manish', 'Nisha', 'Deepak',
  'Farah', 'Imran', 'Sara', 'Zoya', 'Bilal', 'Nadia', 'Aarav', 'Isha', 'Kabir', 'Tanya',
  'Dev', 'Riya', 'Om', 'Simran', 'Yash', 'Alia', 'Naveen', 'Jaya', 'Sahil', 'Mitali',
];
const TAG = ['', ' 007', ' king', ' ji', ' 99', ' bhai', ' star', '_x', ' 21', ' pro'];
const BIOS = [
  'Ludo is life',
  'Only sixes please',
  'One more game?',
  'Never gives up',
  'Cutting your token since 2019',
  'Play fair, win big',
  'Team red forever',
  'Dice ka baap',
  'Chill and roll',
  '',
];
const COUNTRIES = ['IN', 'IN', 'IN', 'IN', 'PK', 'BD', 'NP', 'AE', 'US', 'GB'];
const STYLES = ['bloom', 'beam', 'ring', 'wave', 'spark', 'grid'];
const FRAMES = ['frame.default', 'frame.lotus', 'frame.bell', 'frame.cricket', 'frame.space', 'frame.crown', 'frame.thread'];

/** Gifts you can send. Charm goes to the receiver, gallantry to the sender. */
export const GIFTS = Object.freeze([
  { id: 'rose', name: 'Rose', icon: '❀', cost: 2, charm: 2 },
  { id: 'sweet', name: 'Laddu', icon: '●', cost: 5, charm: 6 },
  { id: 'diya', name: 'Diya', icon: '✦', cost: 12, charm: 15 },
  { id: 'crown', name: 'Crown', icon: '♛', cost: 40, charm: 55 },
  { id: 'rocket', name: 'Rocket', icon: '▲', cost: 120, charm: 180 },
]);

export const BOARDS = Object.freeze([
  { id: 'charm', labelKey: 'rank.charm', field: 'charm' },
  { id: 'gallantry', labelKey: 'rank.gallantry', field: 'gallantry' },
  { id: 'coins', labelKey: 'rank.coins', field: 'coins' },
  { id: 'lucky', labelKey: 'rank.lucky', field: 'lucky' },
]);

export const POOL_SIZE = 40;
export const FRIEND_LIMIT = 50;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} o { save, bus, account, wallet, rewards, rng, now }
 */
export function createSocial(o = {}) {
  const { save, bus = null, account = null, wallet = null, rewards = null } = o;
  const now = o.now || (() => Date.now());
  const rngSeed = o.rng || Math.random;

  const data = save.get('social');
  if (!data.init) {
    data.init = true;
    data.seed = Math.floor(rngSeed() * 1e9) || 12345;
    data.friends = [];
    data.requests = [];
    data.blocked = [];
    data.likedBy = 0;
    data.inbox = [];
    save.touch('social');
  }
  for (const key of ['friends', 'requests', 'blocked', 'inbox']) {
    if (!Array.isArray(data[key])) data[key] = [];
  }

  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  /* ───────────────────────── the simulated pool ────────────────────────── */

  let cache = null;

  function pool() {
    if (cache) return cache;
    const rnd = mulberry(data.seed);
    cache = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const first = FIRST[Math.floor(rnd() * FIRST.length)];
      const name = (first + TAG[Math.floor(rnd() * TAG.length)]).slice(0, 14);
      const level = 2 + Math.floor(rnd() * 58);
      const played = 40 + Math.floor(rnd() * 16000);
      cache.push({
        id: 'p' + (10000000 + Math.floor(rnd() * 89999999)),
        name,
        avatar: { seed: Math.floor(rnd() * 1e9), style: STYLES[Math.floor(rnd() * STYLES.length)], tint: Math.floor(rnd() * 360) },
        frame: FRAMES[Math.floor(rnd() * FRAMES.length)],
        level,
        country: COUNTRIES[Math.floor(rnd() * COUNTRIES.length)],
        bio: BIOS[Math.floor(rnd() * BIOS.length)],
        joinedAt: now() - Math.floor(rnd() * 900) * 86400000,
        charm: Math.floor(rnd() * 90000),
        gallantry: Math.floor(rnd() * 60000),
        coins: Math.floor(rnd() * 40000000),
        lucky: Math.floor(rnd() * 28),
        likes: Math.floor(rnd() * 20000),
        gamesPlayed: played,
        gamesWon: Math.floor(played * (0.3 + rnd() * 0.4)),
        bigWon: Math.floor(rnd() * 12),
        online: rnd() > 0.45,
        bot: true,
      });
    }
    // a couple of pending requests make the Requests tab real
    if (!data.requestsSeeded) {
      data.requestsSeeded = true;
      data.requests = [cache[3].id, cache[11].id];
      save.touch('social');
    }
    return cache;
  }

  const byId = (id) => pool().find((p) => p.id === id) || null;

  /** Me, in the same shape as a pool player, for leaderboards and profiles. */
  function me() {
    const snap = account ? account.snapshot() : {};
    return {
      id: snap.id || 'me',
      name: snap.name || 'You',
      avatar: snap.avatar || { seed: 1, style: 'bloom', tint: 200 },
      frame: null,
      level: snap.level || 1,
      country: snap.country || 'IN',
      bio: snap.bio || '',
      joinedAt: snap.joinedAt || now(),
      charm: (snap.giftsIn || 0) * 8,
      gallantry: (snap.giftsOut || 0) * 8,
      coins: wallet ? wallet.coins : 0,
      lucky: rewards ? rewards.luckyMonth().count : 0,
      likes: snap.likes || 0,
      gamesPlayed: 0,
      gamesWon: 0,
      bigWon: 0,
      online: true,
      isMe: true,
    };
  }

  /* ─────────────────────────────── inbox ───────────────────────────────── */

  function notify(entry) {
    data.inbox.unshift({ id: 'm' + now() + Math.floor(Math.random() * 1000), at: now(), read: false, ...entry });
    if (data.inbox.length > 30) data.inbox.length = 30;
    save.touch('social');
    emit('social:inbox', { unread: unread() });
  }

  function unread() {
    return data.inbox.filter((m) => !m.read).length;
  }

  if (bus) {
    bus.on('account:levelUp', (e) => notify({ key: 'level.up', vars: { level: e.level } }));
    bus.on('catalog:unlocked', (e) => notify({ key: 'skins.owned', vars: {}, extra: e.item ? e.item.name : '' }));
  }

  /* ────────────────────────────── friends ──────────────────────────────── */

  const api = {
    pool,
    player: byId,
    me,
    GIFTS,
    BOARDS,

    friends() {
      return data.friends.map(byId).filter(Boolean);
    },

    friendCount() {
      return data.friends.length;
    },

    requests() {
      return data.requests.map(byId).filter(Boolean);
    },

    blockedList() {
      return data.blocked.map(byId).filter(Boolean);
    },

    /** People you could add: online-ish strangers, minus friends and blocks. */
    nearby(limit = 12) {
      return pool()
        .filter((p) => !api.isFriend(p.id) && !api.isBlocked(p.id) && data.requests.indexOf(p.id) === -1)
        .slice(0, limit);
    },

    isFriend(id) {
      return data.friends.indexOf(id) !== -1;
    },

    isBlocked(id) {
      return data.blocked.indexOf(id) !== -1;
    },

    /** @returns {{ok:boolean, reason?:string}} */
    addFriend(id) {
      if (!byId(id)) return { ok: false, reason: 'unknown' };
      if (api.isFriend(id)) return { ok: false, reason: 'already' };
      if (api.isBlocked(id)) return { ok: false, reason: 'blocked' };
      if (data.friends.length >= FRIEND_LIMIT) return { ok: false, reason: 'full' };
      data.friends.push(id);
      data.requests = data.requests.filter((x) => x !== id);
      save.touch('social');
      emit('social:friends', { count: data.friends.length, added: id });
      return { ok: true };
    },

    removeFriend(id) {
      const before = data.friends.length;
      data.friends = data.friends.filter((x) => x !== id);
      if (data.friends.length === before) return false;
      save.touch('social');
      emit('social:friends', { count: data.friends.length, removed: id });
      return true;
    },

    block(id) {
      if (!byId(id) || api.isBlocked(id)) return false;
      data.blocked.push(id);
      data.friends = data.friends.filter((x) => x !== id);
      data.requests = data.requests.filter((x) => x !== id);
      save.touch('social');
      emit('social:friends', { count: data.friends.length, blocked: id });
      return true;
    },

    unblock(id) {
      data.blocked = data.blocked.filter((x) => x !== id);
      save.touch('social');
      return true;
    },

    /** A local "report" is a mute plus a receipt — real moderation is Phase 2. */
    report(id, reason = 'other') {
      api.block(id);
      notify({ key: 'friends.reported', vars: {}, extra: (byId(id) || {}).name || '' });
      emit('social:reported', { id, reason });
      return true;
    },

    /**
     * Send a gift. Costs diamonds, adds charm to them and gallantry to you.
     * @returns {{ok:boolean, reason?:string, gift?:object}}
     */
    sendGift(id, giftId) {
      const target = byId(id);
      const gift = GIFTS.find((g) => g.id === giftId);
      if (!target || !gift) return { ok: false, reason: 'unknown' };
      if (!wallet) return { ok: false, reason: 'no-wallet' };
      if (!wallet.spend('diamonds', gift.cost, 'gift:' + gift.id)) return { ok: false, reason: 'insufficient' };
      target.charm += gift.charm;
      if (account) account.giftSent(1);
      notify({ key: 'friends.giftSent', vars: {}, extra: gift.name + ' → ' + target.name });
      emit('social:gift', { id, gift: gift.id });
      return { ok: true, gift };
    },

    /** Like someone; they like you back now and then, which feeds Charm Star. */
    like(id) {
      const target = byId(id);
      if (!target) return false;
      target.likes += 1;
      if (account && Math.random() > 0.5) account.addLike(1);
      emit('social:like', { id });
      return true;
    },

    /* ─────────────────────────── leaderboards ──────────────────────────── */

    /**
     * One board, sorted, with `me` inserted in the right place.
     * @param {string} kind charm | gallantry | coins | lucky
     */
    leaderboard(kind = 'charm', limit = 20) {
      const board = BOARDS.find((b) => b.id === kind) || BOARDS[0];
      const rows = [...pool(), me()]
        .filter((p) => !api.isBlocked(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          frame: p.frame,
          level: p.level,
          isMe: !!p.isMe,
          value: p[board.field] || 0,
        }))
        .sort((a, b) => b.value - a.value)
        .map((row, i) => ({ ...row, rank: i + 1 }));
      const mine = rows.find((r) => r.isMe) || null;
      return { board, rows: rows.slice(0, limit), me: mine };
    },

    myRank(kind) {
      const out = api.leaderboard(kind, POOL_SIZE + 1);
      return out.me ? out.me.rank : null;
    },

    /* ──────────────────────────────── inbox ────────────────────────────── */

    inbox() {
      return data.inbox.slice();
    },
    unread,
    notify,
    markAllRead() {
      let changed = false;
      for (const m of data.inbox) {
        if (!m.read) {
          m.read = true;
          changed = true;
        }
      }
      if (changed) {
        save.touch('social');
        emit('social:inbox', { unread: 0 });
      }
    },
  };

  // Build the roster now: the seeded friend requests live inside pool(), and
  // callers such as requests() read the stored id list directly.
  pool();

  return api;
}
