/**
 * storage/prefs.js — settings, persisted in localStorage.
 *
 * Every read is defensive: private-browsing Safari throws on localStorage, so we
 * silently fall back to an in-memory store and the game keeps working.
 */

const KEY = 'ludoBattle.prefs.v1';

export const DEFAULT_PREFS = Object.freeze({
  sound: true,
  vibration: true,
  theme: 'classic', // classic | midnight | royal | candy
  speed: 'normal', // slow | normal | fast
  botLevel: 'hard', // easy | normal | hard
  playerName: 'You',
  playerColor: 'red',
  lastMode: 'vsComputer',
  seenHowTo: false,
  lang: 'en', // en | hi
});

/** Tiny safe wrapper around localStorage. */
export function createStore(key) {
  let memory = null;

  function available() {
    try {
      if (typeof localStorage === 'undefined') return false;
      const probe = '__lb__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  }

  const ok = available();

  return {
    ok,
    read() {
      if (!ok) return memory;
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    },
    write(value) {
      if (!ok) {
        memory = value;
        return false;
      }
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        memory = value;
        return false;
      }
    },
    remove() {
      memory = null;
      if (!ok) return;
      try {
        localStorage.removeItem(key);
      } catch (err) {
        /* ignore */
      }
    },
  };
}

export function createPrefs() {
  const store = createStore(KEY);
  let prefs = { ...DEFAULT_PREFS, ...(store.read() || {}) };
  const listeners = new Set();

  function emit(changed) {
    for (const fn of [...listeners]) {
      try {
        fn(prefs, changed);
      } catch (err) {
        /* a broken listener must not break settings */
      }
    }
  }

  return {
    all() {
      return { ...prefs };
    },
    get(key) {
      return prefs[key];
    },
    set(key, value) {
      if (prefs[key] === value) return prefs[key];
      prefs = { ...prefs, [key]: value };
      store.write(prefs);
      emit({ [key]: value });
      return value;
    },
    merge(patch) {
      prefs = { ...prefs, ...patch };
      store.write(prefs);
      emit(patch);
      return { ...prefs };
    },
    toggle(key) {
      return this.set(key, !prefs[key]);
    },
    reset() {
      prefs = { ...DEFAULT_PREFS };
      store.write(prefs);
      emit(prefs);
      return { ...prefs };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get persistent() {
      return store.ok;
    },
  };
}
