/**
 * meta/tasks.js — Daily and Growth tasks, fed automatically by the event bus.
 * No DOM. Titles are i18n keys so the UI stays translatable.
 */

/** Daily tasks reset every calendar day. `pts` feeds the milestone bar. */
export const DAILY_TASKS = Object.freeze([
  { id: 'win1', key: 'task.win1', target: 1, pts: 10, reward: { kind: 'coins', amount: 2000 } },
  { id: 'play3', key: 'task.play3', target: 3, pts: 10, reward: { kind: 'coins', amount: 3000 } },
  { id: 'quick3', key: 'task.quick3', target: 3, pts: 20, reward: { kind: 'coins', amount: 3000 } },
  { id: 'spin3', key: 'task.spin3', target: 3, pts: 10, reward: { kind: 'coins', amount: 1500 } },
  { id: 'capture5', key: 'task.capture5', target: 5, pts: 15, reward: { kind: 'coins', amount: 2500 } },
  { id: 'six10', key: 'task.six10', target: 10, pts: 10, reward: { kind: 'coins', amount: 2000 } },
  { id: 'home4', key: 'task.home4', target: 4, pts: 15, reward: { kind: 'coins', amount: 2500 } },
]);

/** Milestones on the daily points bar (mirrors the reference ladder). */
export const MILESTONES = Object.freeze([
  { pts: 50, reward: { kind: 'diamonds', amount: 3 } },
  { pts: 80, reward: { kind: 'diamonds', amount: 5 } },
  { pts: 100, reward: { kind: 'diamonds', amount: 8 } },
  { pts: 120, reward: { kind: 'diamonds', amount: 10 } },
  { pts: 150, reward: { kind: 'diamonds', amount: 15 } },
]);

/** Growth tasks are lifetime goals. */
export const GROWTH_TASKS = Object.freeze([
  { id: 'friends10', key: 'task.friends10', target: 10, reward: { kind: 'diamonds', amount: 10 } },
  { id: 'level15', key: 'task.level15', target: 15, reward: { kind: 'coins', amount: 60000 } },
  { id: 'win120', key: 'task.win120', target: 120, reward: { kind: 'coins', amount: 600000 } },
  { id: 'skins10', key: 'task.skins10', target: 10, reward: { kind: 'diamonds', amount: 5 } },
  { id: 'captures100', key: 'task.captures100', target: 100, reward: { kind: 'coins', amount: 50000 } },
  { id: 'tourSilver', key: 'task.tourSilver', target: 1, reward: { kind: 'diamonds', amount: 4 } },
  { id: 'spin50', key: 'task.spin50', target: 50, reward: { kind: 'diamonds', amount: 5 } },
]);

const day = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * @param {object} o { save, bus, wallet, account, catalog, social, isMe, now }
 */
export function createTasks(o = {}) {
  const { save, bus = null, wallet = null, account = null, catalog = null, social = null } = o;
  const now = o.now || (() => Date.now());
  const isMe = o.isMe || (() => true);

  const data = save.get('tasks');
  if (!data.init) {
    data.init = true;
    data.day = day(now());
    data.daily = {};
    data.growth = {};
    data.claimed = [];
    data.milestones = [];
    data.pts = 0;
    save.touch('tasks');
  }

  const emit = (type, payload) => {
    if (bus) bus.emit(type, payload);
  };

  function rollDay() {
    const d = day(now());
    if (data.day === d) return;
    data.day = d;
    data.daily = {};
    data.claimed = (data.claimed || []).filter((id) => !DAILY_TASKS.some((tk) => tk.id === id));
    data.milestones = [];
    data.pts = 0;
    save.touch('tasks');
    emit('tasks:reset', { day: d });
  }

  function bucket(id) {
    return DAILY_TASKS.some((tk) => tk.id === id) ? data.daily : data.growth;
  }

  function def(id) {
    return DAILY_TASKS.find((tk) => tk.id === id) || GROWTH_TASKS.find((tk) => tk.id === id) || null;
  }

  function have(id) {
    rollDay();
    return bucket(id)[id] || 0;
  }

  function claimed(id) {
    return (data.claimed || []).indexOf(id) !== -1;
  }

  function done(id) {
    const d = def(id);
    return !!d && have(id) >= d.target;
  }

  /** Record progress. Growth counters that mirror a stat can also be *set*. */
  function track(id, n = 1, mode = 'add') {
    const d = def(id);
    if (!d) return 0;
    rollDay();
    const b = bucket(id);
    const before = b[id] || 0;
    const next = mode === 'set' ? Math.max(before, n) : before + n;
    b[id] = Math.min(d.target, next);
    // Only announce real changes — sync() runs often and a no-op emit would
    // bounce straight back through any listener that calls sync() again.
    if (b[id] === before) return b[id];
    save.touch('tasks');
    emit('tasks:progress', { id, have: b[id], target: d.target, done: b[id] >= d.target });
    return b[id];
  }

  /** Pull growth counters that live elsewhere (level, collection, friends). */
  function sync(records = {}) {
    if (account) track('level15', account.level, 'set');
    if (catalog) track('skins10', catalog.stats().owned, 'set');
    if (social && social.friendCount) track('friends10', social.friendCount(), 'set');
    if (records.wins) track('win120', records.wins, 'set');
    if (records.captures) track('captures100', records.captures, 'set');
    if (records.spins) track('spin50', records.spins, 'set');
  }

  function pay(reward, reason) {
    if (wallet && reward) wallet.earn(reward.kind, reward.amount, reason);
  }

  /** @returns {{ok:boolean, reward?:object, reason?:string}} */
  function claim(id) {
    const d = def(id);
    if (!d) return { ok: false, reason: 'unknown' };
    if (!done(id)) return { ok: false, reason: 'incomplete' };
    if (claimed(id)) return { ok: false, reason: 'claimed' };
    data.claimed.push(id);
    if (d.pts) {
      data.pts = (data.pts || 0) + d.pts;
      emit('tasks:points', { pts: data.pts });
    }
    save.touch('tasks');
    pay(d.reward, 'task:' + id);
    if (account) account.addXp(d.pts ? d.pts : 30, 'task');
    emit('tasks:claimed', { id, reward: d.reward, pts: data.pts });
    return { ok: true, reward: d.reward };
  }

  function claimMilestone(pts) {
    const m = MILESTONES.find((x) => x.pts === pts);
    if (!m) return { ok: false, reason: 'unknown' };
    if ((data.pts || 0) < pts) return { ok: false, reason: 'locked' };
    if ((data.milestones || []).indexOf(pts) !== -1) return { ok: false, reason: 'claimed' };
    data.milestones.push(pts);
    save.touch('tasks');
    pay(m.reward, 'milestone:' + pts);
    emit('tasks:milestone', { pts, reward: m.reward });
    return { ok: true, reward: m.reward };
  }

  function list(defs) {
    rollDay();
    return defs.map((d) => ({
      id: d.id,
      key: d.key,
      target: d.target,
      pts: d.pts || 0,
      reward: d.reward,
      have: have(d.id),
      done: done(d.id),
      claimed: claimed(d.id),
    }));
  }

  /* ─────────────────── automatic tracking from the bus ─────────────────── */

  if (bus) {
    bus.on('dice:rolled', (e) => {
      if (e.value === 6 && isMe(e.playerId)) track('six10', 1);
    });
    bus.on('token:captured', (e) => {
      if (isMe(e.byPlayerId)) track('capture5', 1);
    });
    bus.on('token:finished', (e) => {
      if (isMe(e.playerId)) track('home4', 1);
    });
    bus.on('rewards:spin', () => track('spin3', 1));
    bus.on('game:over', (e) => {
      track('play3', 1);
      if (e && e.mode === 'quickMatch') track('quick3', 1);
      if (e && isMe(e.winner)) track('win1', 1);
    });
  }

  return {
    daily: () => list(DAILY_TASKS),
    growth: () => list(GROWTH_TASKS),
    get points() {
      rollDay();
      return data.pts || 0;
    },
    milestones() {
      rollDay();
      return MILESTONES.map((m) => ({
        pts: m.pts,
        reward: m.reward,
        claimed: (data.milestones || []).indexOf(m.pts) !== -1,
        reached: (data.pts || 0) >= m.pts,
      }));
    },
    track,
    sync,
    claim,
    claimMilestone,
    have,
    done,
    claimed,
    /** How many rewards are waiting — drives the lobby badge. */
    claimable() {
      rollDay();
      const tasks = [...DAILY_TASKS, ...GROWTH_TASKS].filter((d) => done(d.id) && !claimed(d.id)).length;
      const ms = MILESTONES.filter((m) => (data.pts || 0) >= m.pts && (data.milestones || []).indexOf(m.pts) === -1).length;
      return tasks + ms;
    },
  };
}
