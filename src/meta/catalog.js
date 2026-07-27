/**
 * meta/catalog.js — every cosmetic in the game: dice, tokens, board themes,
 * avatar frames and chat boxes.
 *
 * No DOM, no canvas. Each item carries a small `art` recipe; the painters in
 * render/skins.js turn that recipe into pixels, so a skin costs a few hundred
 * bytes instead of a PNG.
 *
 * Unlock kinds:
 *   free      owned from the start
 *   coins     buy with coins
 *   diamonds  buy with diamonds
 *   ad        watch N rewarded videos (progress is stored, e.g. 3/50)
 *   event     festival unlock (Phase 2 turns these on by date/server flag)
 *   rank      leaderboard reward
 */

export const KINDS = Object.freeze(['dice', 'token', 'theme', 'frame', 'chatbox']);

export const UNLOCK = Object.freeze({
  FREE: 'free',
  COINS: 'coins',
  DIAMONDS: 'diamonds',
  AD: 'ad',
  EVENT: 'event',
  RANK: 'rank',
});

const free = () => ({ type: UNLOCK.FREE });
const coins = (cost) => ({ type: UNLOCK.COINS, cost });
const gems = (cost) => ({ type: UNLOCK.DIAMONDS, cost });
const ad = (need) => ({ type: UNLOCK.AD, need });
const event = (label) => ({ type: UNLOCK.EVENT, label });
const rank = (label) => ({ type: UNLOCK.RANK, label });

/**
 * ITEMS — the whole shop.
 * art.dice     { body:[a,b], pip, style:'dots'|'numeral'|'gem'|'wood'|'metal', glow }
 * art.token    { shape:'pawn'|'crown'|'diya'|'ball'|'bird'|'kite'|'wicket'|'gulal', accent }
 * art.frame    { ring:[a,b], ornament:'none'|'lotus'|'bell'|'bat'|'star'|'crown'|'diya'|'kite'|'wave', width }
 * art.chatbox  { bg, border, text, ornament }
 * theme items point at a palette id in render/board.js (no art of their own).
 */
export const ITEMS = Object.freeze([
  /* ───────────── dice ───────────── */
  { id: 'dice.default', kind: 'dice', name: 'Default', unlock: free(), art: { body: ['#ffffff', '#d8dbe2'], pip: '#1b2436', style: 'dots' } },
  { id: 'dice.ivory', kind: 'dice', name: 'Ivory', unlock: free(), art: { body: ['#fffdf5', '#e6dcc3'], pip: '#7a6a45', style: 'dots' } },
  { id: 'dice.cricket', kind: 'dice', name: 'Cricket', unlock: coins(5000), art: { body: ['#e8464f', '#8d1620'], pip: '#fff3f3', style: 'numeral', seam: true } },
  { id: 'dice.wood', kind: 'dice', name: 'Wood', unlock: coins(8000), art: { body: ['#d9a862', '#8a5a25'], pip: '#4a2f11', style: 'wood' } },
  { id: 'dice.india', kind: 'dice', name: 'India', unlock: coins(20000), art: { body: ['#1c1c1c', '#050505'], pip: '#ffd24a', style: 'numeral', glow: '#ffb300' } },
  { id: 'dice.neon', kind: 'dice', name: 'Cyber', unlock: gems(15), art: { body: ['#5a2bd8', '#160a3a'], pip: '#8ef7ff', style: 'numeral', glow: '#00e5ff' } },
  { id: 'dice.king', kind: 'dice', name: 'King', unlock: gems(30), art: { body: ['#ffdf7a', '#b9821a'], pip: '#5a3a00', style: 'gem', glow: '#ffe9a8' } },
  { id: 'dice.frost', kind: 'dice', name: 'Frost', unlock: ad(20), art: { body: ['#eaf7ff', '#a9d6ef'], pip: '#2d6b8f', style: 'dots', glow: '#d6f2ff' } },
  { id: 'dice.galaxy', kind: 'dice', name: 'Galaxy', unlock: ad(35), art: { body: ['#2b1b57', '#080417'], pip: '#ffffff', style: 'metal', glow: '#9d7bff' } },
  { id: 'dice.diya', kind: 'dice', name: 'Diwali', unlock: event('Diwali'), art: { body: ['#ff9f43', '#b03a00'], pip: '#fff6d8', style: 'gem', glow: '#ffc75f' } },

  /* ───────────── tokens ───────────── */
  { id: 'token.default', kind: 'token', name: 'Default', unlock: free(), art: { shape: 'pawn' } },
  { id: 'token.ball', kind: 'token', name: 'Marble', unlock: free(), art: { shape: 'ball' } },
  { id: 'token.crown', kind: 'token', name: 'Crown', unlock: coins(12000), art: { shape: 'crown', accent: '#ffd24a' } },
  { id: 'token.holi', kind: 'token', name: 'Holi', unlock: coins(15000), art: { shape: 'gulal', accent: '#ffffff' } },
  { id: 'token.diya', kind: 'token', name: 'Diya', unlock: coins(25000), art: { shape: 'diya', accent: '#ffb300' } },
  { id: 'token.cricket', kind: 'token', name: 'Cricket', unlock: gems(12), art: { shape: 'wicket', accent: '#f5f0e6' } },
  { id: 'token.bird', kind: 'token', name: 'Chirpy', unlock: gems(20), art: { shape: 'bird', accent: '#ffb703' } },
  { id: 'token.rakhi', kind: 'token', name: 'Rakhi', unlock: ad(25), art: { shape: 'ball', accent: '#ff5d8f', thread: true } },
  { id: 'token.kite', kind: 'token', name: 'Patang', unlock: ad(40), art: { shape: 'kite', accent: '#ffffff' } },
  { id: 'token.champion', kind: 'token', name: 'Champion', unlock: rank('Top 3'), art: { shape: 'crown', accent: '#8ef7ff', glow: true } },

  /* ───────────── board themes (palette lives in render/board.js) ───────────── */
  { id: 'theme.classic', kind: 'theme', name: 'Classic', unlock: free(), theme: 'classic' },
  { id: 'theme.midnight', kind: 'theme', name: 'Midnight', unlock: free(), theme: 'midnight' },
  { id: 'theme.candy', kind: 'theme', name: 'Candy', unlock: coins(9000), theme: 'candy' },
  { id: 'theme.royal', kind: 'theme', name: 'Royal', unlock: coins(15000), theme: 'royal' },
  { id: 'theme.wood', kind: 'theme', name: 'Wood', unlock: coins(22000), theme: 'wood' },
  { id: 'theme.taj', kind: 'theme', name: 'Taj Mahal', unlock: coins(40000), theme: 'taj' },
  { id: 'theme.cricket', kind: 'theme', name: 'Cricket', unlock: gems(15), theme: 'cricket' },
  { id: 'theme.space', kind: 'theme', name: 'Future War', unlock: gems(25), theme: 'space' },
  { id: 'theme.monsoon', kind: 'theme', name: 'Monsoon', unlock: ad(35), theme: 'monsoon' },
  { id: 'theme.diwali', kind: 'theme', name: 'Diwali', unlock: event('Diwali'), theme: 'diwali' },

  /* ───────────── avatar frames ───────────── */
  { id: 'frame.default', kind: 'frame', name: 'Default', unlock: free(), art: { ring: ['#ffffff', '#c8d2e4'], ornament: 'none', width: 0.1 } },
  { id: 'frame.thread', kind: 'frame', name: 'Thread', unlock: free(), art: { ring: ['#ff8fa3', '#c9184a'], ornament: 'none', width: 0.13 } },
  { id: 'frame.lotus', kind: 'frame', name: 'Lotus', unlock: coins(6000), art: { ring: ['#ffd0e0', '#ff5d8f'], ornament: 'lotus', width: 0.12 } },
  { id: 'frame.bell', kind: 'frame', name: 'Jingle', unlock: coins(10000), art: { ring: ['#2a9d4a', '#14602c'], ornament: 'bell', width: 0.13 } },
  { id: 'frame.cricket', kind: 'frame', name: 'Cricket', unlock: coins(18000), art: { ring: ['#ff9f1c', '#2a9d4a'], ornament: 'bat', width: 0.12 } },
  { id: 'frame.space', kind: 'frame', name: 'Space', unlock: gems(18), art: { ring: ['#8ef7ff', '#4361ee'], ornament: 'star', width: 0.12, glow: true } },
  { id: 'frame.crown', kind: 'frame', name: 'Crown', unlock: gems(35), art: { ring: ['#ffe9a8', '#b9821a'], ornament: 'crown', width: 0.14, glow: true } },
  { id: 'frame.summer', kind: 'frame', name: 'Summer', unlock: ad(30), art: { ring: ['#a8e6ff', '#0096c7'], ornament: 'wave', width: 0.12 } },
  { id: 'frame.india', kind: 'frame', name: 'India', unlock: ad(45), art: { ring: ['#ff9933', '#138808'], ornament: 'lotus', width: 0.14 } },
  { id: 'frame.diya', kind: 'frame', name: 'Diwali', unlock: event('Diwali'), art: { ring: ['#ffc75f', '#c1121f'], ornament: 'diya', width: 0.14, glow: true } },
  { id: 'frame.charm', kind: 'frame', name: 'Charm King', unlock: rank('Charm #1'), art: { ring: ['#ff9ff3', '#8338ec'], ornament: 'crown', width: 0.15, glow: true } },

  /* ───────────── chat boxes ───────────── */
  { id: 'chat.default', kind: 'chatbox', name: 'Default', unlock: free(), art: { bg: '#f3f5fa', border: '#c9d3e6', text: '#16233a', ornament: '' } },
  { id: 'chat.crown', kind: 'chatbox', name: 'Crown', unlock: coins(5000), art: { bg: '#fff8dd', border: '#e0b83a', text: '#5a3a00', ornament: '♛' } },
  { id: 'chat.diwali', kind: 'chatbox', name: 'Diwali', unlock: coins(12000), art: { bg: '#ffe6f2', border: '#ff6392', text: '#5c0b2a', ornament: '✦' } },
  { id: 'chat.holi', kind: 'chatbox', name: 'Holi', unlock: coins(12000), art: { bg: '#e8fff2', border: '#43c59e', text: '#08402a', ornament: '❉' } },
  { id: 'chat.moon', kind: 'chatbox', name: 'Moonlight', unlock: gems(12), art: { bg: '#101a3a', border: '#5a7cff', text: '#dfe8ff', ornament: '☾' } },
  { id: 'chat.rakhi', kind: 'chatbox', name: 'Rakhi', unlock: ad(20), art: { bg: '#fff1e6', border: '#ff8fa3', text: '#6a2b2b', ornament: '❤' } },
  { id: 'chat.ganesh', kind: 'chatbox', name: 'Ganesh', unlock: event('Ganesh Chaturthi'), art: { bg: '#fff3d6', border: '#ff9f1c', text: '#5a3a00', ornament: '卐' } },
  { id: 'chat.valentine', kind: 'chatbox', name: "Valentine's", unlock: event("Valentine's Day"), art: { bg: '#f3e8ff', border: '#c77dff', text: '#3d0b5c', ornament: '♥' } },
  { id: 'chat.champion', kind: 'chatbox', name: 'Champion', unlock: rank('Top 3'), art: { bg: '#e6fbff', border: '#00b4d8', text: '#023047', ornament: '★' } },
]);

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function itemById(id) {
  return BY_ID.get(id) || null;
}

export function itemsOfKind(kind) {
  return ITEMS.filter((i) => i.kind === kind);
}

export const DEFAULT_EQUIP = Object.freeze({
  dice: 'dice.default',
  token: 'token.default',
  theme: 'theme.classic',
  frame: 'frame.default',
  chatbox: 'chat.default',
});

/**
 * @param {object} opts { save, bus, wallet }
 */
export function createCatalog({ save, bus = null, wallet = null } = {}) {
  const data = save.get('catalog');
  if (!data.owned) {
    data.owned = ITEMS.filter((i) => i.unlock.type === UNLOCK.FREE).map((i) => i.id);
    data.equipped = { ...DEFAULT_EQUIP };
    data.adProgress = {};
    save.touch('catalog');
  }
  if (!data.adProgress) data.adProgress = {};
  if (!data.equipped) data.equipped = { ...DEFAULT_EQUIP };

  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  const api = {
    kinds: KINDS,
    items: itemsOfKind,
    item: itemById,
    all: () => ITEMS,

    owned(id) {
      return data.owned.indexOf(id) !== -1;
    },

    ownedOf(kind) {
      return data.owned.filter((id) => {
        const item = itemById(id);
        return item && item.kind === kind;
      });
    },

    equippedId(kind) {
      return data.equipped[kind] || DEFAULT_EQUIP[kind];
    },

    equippedItem(kind) {
      return itemById(api.equippedId(kind)) || itemById(DEFAULT_EQUIP[kind]);
    },

    /** All five equipped items at once — what the renderers ask for. */
    equipment() {
      const out = {};
      for (const kind of KINDS) out[kind] = api.equippedItem(kind);
      return out;
    },

    isEquipped(id) {
      const item = itemById(id);
      return !!item && api.equippedId(item.kind) === id;
    },

    /** @returns {boolean} true when the skin is now equipped */
    equip(id) {
      const item = itemById(id);
      if (!item || !api.owned(id)) return false;
      if (data.equipped[item.kind] === id) return true;
      data.equipped[item.kind] = id;
      save.touch('catalog');
      emit('catalog:equipped', { id, kind: item.kind, item });
      return true;
    },

    /** Ad-unlock progress for an item. */
    progress(id) {
      const item = itemById(id);
      const need = item && item.unlock.type === UNLOCK.AD ? item.unlock.need : 0;
      return { have: data.adProgress[id] || 0, need };
    },

    /**
     * Count one watched ad towards an item.
     * @returns {{have:number, need:number, unlocked:boolean}}
     */
    addAdProgress(id, n = 1) {
      const item = itemById(id);
      if (!item || item.unlock.type !== UNLOCK.AD) return { have: 0, need: 0, unlocked: api.owned(id) };
      const have = Math.min(item.unlock.need, (data.adProgress[id] || 0) + n);
      data.adProgress[id] = have;
      save.touch('catalog');
      emit('catalog:progress', { id, have, need: item.unlock.need });
      if (have >= item.unlock.need && !api.owned(id)) {
        api.grant(id, 'ad');
        return { have, need: item.unlock.need, unlocked: true };
      }
      return { have, need: item.unlock.need, unlocked: false };
    },

    /** Add an item to the collection without any cost (rewards, VIP, promos). */
    grant(id, source = 'grant') {
      if (!itemById(id) || api.owned(id)) return false;
      data.owned.push(id);
      save.touch('catalog');
      emit('catalog:unlocked', { id, source, item: itemById(id) });
      return true;
    },

    /**
     * Buy an item with the wallet.
     * @returns {{ok:boolean, reason?:string}}
     */
    purchase(id) {
      const item = itemById(id);
      if (!item) return { ok: false, reason: 'unknown' };
      if (api.owned(id)) return { ok: true, reason: 'owned' };
      const u = item.unlock;
      if (u.type === UNLOCK.COINS || u.type === UNLOCK.DIAMONDS) {
        if (!wallet) return { ok: false, reason: 'no-wallet' };
        const kind = u.type === UNLOCK.COINS ? 'coins' : 'diamonds';
        if (!wallet.spend(kind, u.cost, 'skin:' + id)) return { ok: false, reason: 'insufficient' };
        api.grant(id, 'purchase');
        return { ok: true };
      }
      if (u.type === UNLOCK.AD) return { ok: false, reason: 'watch-ads' };
      if (u.type === UNLOCK.EVENT) return { ok: false, reason: 'event' };
      if (u.type === UNLOCK.RANK) return { ok: false, reason: 'ranking' };
      return { ok: false, reason: 'locked' };
    },

    /** How a locked item should be presented. */
    status(id) {
      const item = itemById(id);
      if (!item) return { state: 'unknown' };
      if (api.owned(id)) return { state: api.isEquipped(id) ? 'equipped' : 'owned' };
      const u = item.unlock;
      if (u.type === UNLOCK.AD) {
        const p = api.progress(id);
        return { state: 'ad', have: p.have, need: p.need };
      }
      if (u.type === UNLOCK.COINS) return { state: 'coins', cost: u.cost };
      if (u.type === UNLOCK.DIAMONDS) return { state: 'diamonds', cost: u.cost };
      if (u.type === UNLOCK.EVENT) return { state: 'event', label: u.label };
      if (u.type === UNLOCK.RANK) return { state: 'rank', label: u.label };
      return { state: 'locked' };
    },

    /** Collection completion, for the profile card. */
    stats() {
      const total = ITEMS.length;
      return { owned: data.owned.length, total, ratio: data.owned.length / total };
    },
  };

  return api;
}
