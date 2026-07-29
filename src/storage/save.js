/**
 * storage/save.js — ONE versioned save document for the whole meta game.
 *
 * Phase 2 writes this exact object to `users/{uid}/save` — that is why every
 * meta module reads and writes through here instead of touching localStorage.
 * Writes are debounced so a burst of coin/XP updates costs one JSON write.
 */

import { createStore } from './prefs.js';

export const SAVE_KEY = 'ludoBattle.save.v1';
export const SAVE_VERSION = 1;

/** Empty document. Every section is optional in storage and defaulted here. */
export function emptySave() {
  return {
    v: SAVE_VERSION,
    updatedAt: 0,
    account: {},
    wallet: {},
    catalog: {},
    tasks: {},
    rewards: {},
    social: {},
    tournament: {},
    records: {},
  };
}

const SECTIONS = Object.keys(emptySave()).filter((k) => k !== 'v' && k !== 'updatedAt');

export function createSave({ debounceMs = 220, now = () => Date.now(), key = SAVE_KEY } = {}) {
  const store = createStore(key);
  let doc = migrate(store.read());
  let timer = null;
  const listeners = new Set();

  function migrate(raw) {
    const base = emptySave();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.v > SAVE_VERSION) return base; // newer build wrote it: start clean
    const out = { ...base, ...raw, v: SAVE_VERSION };
    for (const key of SECTIONS) {
      out[key] = raw[key] && typeof raw[key] === 'object' ? { ...raw[key] } : {};
    }
    return out;
  }

  function schedule() {
    doc.updatedAt = now();
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      store.write(doc);
    }, debounceMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function notify(section) {
    for (const fn of [...listeners]) {
      try {
        fn(section, doc[section]);
      } catch (err) {
        /* a broken listener must not break persistence */
      }
    }
  }

  return {
    /** Read a section (live reference — treat as read-only). */
    get(section) {
      if (!doc[section]) doc[section] = {};
      return doc[section];
    },

    /** Shallow-merge a patch into a section. */
    patch(section, values) {
      doc[section] = { ...(doc[section] || {}), ...values };
      schedule();
      notify(section);
      return doc[section];
    },

    /** Replace a whole section. */
    put(section, value) {
      doc[section] = value;
      schedule();
      notify(section);
      return value;
    },

    /** Mark a section dirty after mutating the live reference in place. */
    touch(section) {
      schedule();
      notify(section);
    },

    /** The whole document (a copy). */
    all() {
      return JSON.parse(JSON.stringify(doc));
    },

    /** Force an immediate write (call before unload). */
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      doc.updatedAt = now();
      return store.write(doc);
    },

    /** Load a document from elsewhere (Phase 2: cloud → device). */
    load(next) {
      doc = migrate(next);
      this.flush();
      for (const s of SECTIONS) notify(s);
      return doc;
    },

    reset() {
      doc = emptySave();
      this.flush();
      for (const s of SECTIONS) notify(s);
      return doc;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    get persistent() {
      return store.ok;
    },

    SECTIONS,
  };
}
