/**
 * audio/synth.js — every sound in the game, generated in code with WebAudio.
 * ZERO audio files. Total cost: this one file.
 *
 * The AudioContext is created lazily on the first user gesture (mobile browsers
 * refuse to start it any earlier) and every sound is a short synth voice, so
 * there is nothing to download and nothing to decode.
 */

const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };

export function createAudio({ enabled = true, vibration = true } = {}) {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let on = enabled;
  let haptics = vibration;
  let unlocked = false;

  function ensure() {
    if (!on) return null;
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
    } catch (err) {
      ctx = null;
    }
    return ctx;
  }

  /** Call from a click/touch handler once, so mobile lets us make noise. */
  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (!unlocked) {
      unlocked = true;
      // a 1-sample silent blip satisfies iOS
      const b = c.createBuffer(1, 1, c.sampleRate);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(master);
      s.start(0);
    }
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function getNoise() {
    if (noiseBuffer || !ctx) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 0.4);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  /**
   * One synth voice.
   * @param {object} o { type, freq, to, at, dur, gain, sweep, q }
   */
  function tone(o) {
    const c = ensure();
    if (!c) return;
    const t0 = now() + (o.at || 0);
    const dur = o.dur || 0.16;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to && o.to !== o.freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
    const peak = (o.gain === undefined ? 0.22 : o.gain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered noise grain — rattles, thuds, whooshes. */
  function noise(o = {}) {
    const c = ensure();
    if (!c) return;
    const buf = getNoise();
    if (!buf) return;
    const t0 = now() + (o.at || 0);
    const dur = o.dur || 0.12;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = o.filter || 'bandpass';
    filter.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + dur);
    filter.Q.value = o.q === undefined ? 1.1 : o.q;
    const gain = c.createGain();
    const peak = o.gain === undefined ? 0.18 : o.gain;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.015, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function buzz(pattern) {
    if (!haptics) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
    } catch (err) {
      /* vibration is a nice-to-have */
    }
  }

  /* ───────────────────────────── the sound board ─────────────────────────── */

  const sfx = {
    /** UI button tap. */
    tap() {
      tone({ type: 'square', freq: 420, to: 620, dur: 0.07, gain: 0.1 });
      buzz(8);
    },

    /** Menu open / screen change. */
    swipe() {
      noise({ freq: 900, to: 2400, dur: 0.16, gain: 0.08, filter: 'highpass' });
    },

    /** Dice rattling in the hand, then landing. */
    dice(ms = 560) {
      const grains = Math.max(3, Math.round(ms / 90));
      for (let i = 0; i < grains; i++) {
        noise({
          at: (i * ms) / grains / 1000,
          dur: 0.05,
          freq: 1500 + Math.random() * 1800,
          gain: 0.13,
          q: 2.4,
        });
      }
      noise({ at: (ms * 0.8) / 1000, dur: 0.14, freq: 420, to: 160, gain: 0.2, filter: 'lowpass', q: 0.7 });
      tone({ at: (ms * 0.82) / 1000, type: 'triangle', freq: 180, to: 90, dur: 0.13, gain: 0.14 });
      buzz([14, 40, 14, 40, 22]);
    },

    /** One board step. */
    step(pitch = 0) {
      tone({ type: 'sine', freq: 620 + pitch * 40, to: 780 + pitch * 40, dur: 0.06, gain: 0.13 });
    },

    /** Token settles at the end of a move. */
    land() {
      tone({ type: 'triangle', freq: 300, to: 190, dur: 0.1, gain: 0.16 });
      noise({ dur: 0.07, freq: 700, gain: 0.07, filter: 'lowpass' });
      buzz(10);
    },

    /** You sent someone home. */
    capture() {
      tone({ type: 'sawtooth', freq: 720, to: 120, dur: 0.3, gain: 0.2 });
      noise({ dur: 0.26, freq: 1800, to: 220, gain: 0.16, filter: 'bandpass', q: 0.9 });
      tone({ at: 0.06, type: 'square', freq: 180, to: 70, dur: 0.22, gain: 0.12 });
      buzz([26, 40, 60]);
    },

    /** Your token got sent home. */
    captured() {
      tone({ type: 'sawtooth', freq: 300, to: 80, dur: 0.34, gain: 0.18 });
      buzz([40, 60, 40]);
    },

    /** Rolled a six — extra turn! */
    six() {
      tone({ type: 'triangle', freq: NOTE.G4, dur: 0.12, gain: 0.17 });
      tone({ at: 0.09, type: 'triangle', freq: NOTE.C5, dur: 0.13, gain: 0.17 });
      tone({ at: 0.18, type: 'triangle', freq: NOTE.E5, dur: 0.2, gain: 0.16 });
      buzz([18, 30, 18]);
    },

    /** A token reached the centre. */
    finish() {
      tone({ type: 'sine', freq: NOTE.C5, dur: 0.12, gain: 0.16 });
      tone({ at: 0.08, type: 'sine', freq: NOTE.E5, dur: 0.14, gain: 0.16 });
      tone({ at: 0.16, type: 'sine', freq: NOTE.G5, dur: 0.24, gain: 0.15 });
      buzz([12, 26, 12, 26, 30]);
    },

    /** Turn handed to the next player. */
    turn() {
      tone({ type: 'sine', freq: 480, to: 640, dur: 0.09, gain: 0.1 });
    },

    /** Nothing to do with this roll. */
    noMoves() {
      tone({ type: 'triangle', freq: 300, to: 210, dur: 0.16, gain: 0.12 });
      tone({ at: 0.14, type: 'triangle', freq: 220, to: 160, dur: 0.18, gain: 0.11 });
    },

    /** Illegal tap. */
    deny() {
      tone({ type: 'square', freq: 160, to: 110, dur: 0.13, gain: 0.12 });
      buzz(30);
    },

    /** Three sixes — turn lost. */
    penalty() {
      tone({ type: 'sawtooth', freq: 420, to: 90, dur: 0.42, gain: 0.16 });
      buzz([50, 60, 50, 60, 50]);
    },

    /** Winner fanfare. */
    win() {
      const seq = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
      seq.forEach((f, i) => {
        tone({ at: i * 0.11, type: 'triangle', freq: f, dur: 0.26, gain: 0.16 });
        tone({ at: i * 0.11, type: 'sine', freq: f * 2, dur: 0.2, gain: 0.06 });
      });
      tone({ at: 0.85, type: 'triangle', freq: NOTE.C5, dur: 0.7, gain: 0.15 });
      tone({ at: 0.85, type: 'sine', freq: NOTE.G5, dur: 0.7, gain: 0.1 });
      buzz([40, 60, 40, 60, 120]);
    },

    /** Losing the game (still a nice sound — nobody likes being punished). */
    lose() {
      [NOTE.G4, NOTE.E4, NOTE.C4].forEach((f, i) => {
        tone({ at: i * 0.16, type: 'triangle', freq: f, dur: 0.3, gain: 0.13 });
      });
    },
  };

  return {
    sfx,
    unlock,
    get enabled() {
      return on;
    },
    setEnabled(v) {
      on = !!v;
      if (!on && ctx) {
        try {
          master.gain.value = 0;
        } catch (err) {
          /* ignore */
        }
      } else if (on && master) {
        master.gain.value = 0.85;
      }
      if (on) ensure();
    },
    get vibration() {
      return haptics;
    },
    setVibration(v) {
      haptics = !!v;
    },
    buzz,
    /** Exposed for tests / debugging. */
    get context() {
      return ctx;
    },
  };
}
