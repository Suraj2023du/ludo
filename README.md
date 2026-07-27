# Ludo Battle

A complete, mobile-first Ludo game in the browser — the full Ludo King ruleset,
smart bots, pass-and-play, and 100% offline play after the first visit.

- **HTML5 Canvas + vanilla ES modules.** No React, no Phaser, no build step.
- **Zero runtime dependencies.** Nothing to `npm install` to play or to test.
- **Zero gameplay images.** The board, tokens, dice, particles and confetti are
  all drawn in code; every sound is synthesized with WebAudio.
- **~221 KB first load (≈80 KB gzipped)**, then 0 bytes — the service worker
  precaches everything.

---

## Play it

Any static server works. A tiny one ships with the repo:

```bash
npm run serve          # → http://localhost:8080
npm run serve -- 5173  # custom port
```

Then open it on your phone (same Wi-Fi) or in a mobile emulator. Add it to your
home screen and it installs as a PWA.

> Use a server, not `file://` — service workers and ES modules both need a real
> `http(s)` origin.

## Test it

```bash
npm test                 # node --test tests/    (94 tests)
npm run test:rules       # ruleset unit tests only
npm run test:sim         # 200 simulated full games
npm run boot             # boots index.html in Node, fails on any console error
npm run size             # first-load payload report vs the 500 KB budget
npm run icons            # regenerate the two PWA icons (no image tools needed)
```

| suite                 | what it proves                                                        |
| --------------------- | --------------------------------------------------------------------- |
| `rules.test.js`       | 47 unit tests: every rule, both directions (does happen / must not)   |
| `ai.test.js`          | the bot honours its priority order and beats random players           |
| `controller.test.js`  | the async turn loop, pass-and-play gate, remote-replay determinism    |
| `sim.test.js`         | 200 complete games, state audited after every roll and move            |
| `ui.test.js`          | index.html boots, screens wire up, the canvas paints, the dice rolls  |

---

## Features

**Modes**

- **Vs Computer** — you plus 1-3 bots (2/3/4 players, pick your colour).
- **Pass & Play** — 2-4 humans on one phone, with a "pass the phone to NAME"
  privacy screen between seats.
- **Quick Match** — a fast 1 v 1 against a bot.

**The bot** picks moves by strict priority — *finish a token > capture >
land on a safe square > advance the furthest token > open a new token on a 6* —
then refines inside each tier with threat awareness (it avoids stepping in front
of an opponent and runs exposed tokens away). Near-equal options are chosen at
random so it does not feel like a machine. Three difficulty levels.

**Game feel**

- Dice spins through random faces, lands on the result, then the engine reveals
  what happened. `navigator.vibrate()` haptics on every roll.
- Every legal token pulses with a ring; the destination cell shows a target mark.
- Tokens hop cell by cell (~110 ms each, eased), captured tokens fly back to base
  on an arc, finished tokens sparkle.
- Extra turn on a six flashes the banner and plays a rising arpeggio.
- Slow / normal / fast animation speed, 4 board themes, sound and vibration
  toggles — all persisted.

**Persistence** — settings, per-mode stats (games, wins, current and best
streak, captures) and a "Resume last game?" snapshot, all in `localStorage`.

**PWA** — installable, portrait-locked, and fully playable with the network off.

## The ruleset (exactly Ludo King)

- 15×15 board, 4 tokens per player, a 52-cell shared ring, a private 6-step home
  column per colour, and the centre finish.
- A token leaves the base **only on a 6**, landing on its own start square.
- **A 6 grants an extra turn. Three 6s in a row forfeits the whole turn.**
- Landing on an opponent on a **non-safe** square captures it → back to base.
  Capturing also grants an extra turn.
- **8 safe squares**: the 4 coloured start squares + 4 stars. No captures there.
- Same-colour tokens may stack freely (drawn side by side, slightly smaller).
- The home column is colour-private; an **exact** roll is needed to finish, and
  an overshoot means that token simply cannot move.
- Finishing a token does **not** by itself grant an extra turn.
- The first player home wins; play continues so everyone else gets 2nd / 3rd /
  4th.
- No legal move → the turn passes automatically with a toast.

Every one of those lines has a test in `tests/rules.test.js`.

---

## Architecture

```
                          ┌──────────────────────────────┐
                          │        game/events.js        │
   everything flows ────► │      the single event bus    │ ◄──── Phase 2 chat,
   through here           └───────────────┬──────────────┘       presence,
                                          │                      analytics
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌───────────────┐              ┌────────────────────┐             ┌──────────────────┐
│    engine/    │              │  game/controller   │             │   ui/  render/   │
│  PURE LOGIC   │◄─ reads ─────│   the turn loop    │──emits──►   │  DOM + Canvas    │
│               │   only       │  (owns the state)  │             │  react to events │
│  rules.js     │              └─────────┬──────────┘             │  never mutate    │
│  state.js     │                        │                        └──────────────────┘
│  ai.js        │                        │ sends / receives
│               │                        ▼
│ no DOM        │              ┌────────────────────┐
│ no canvas     │              │  sync/adapter.js   │   Phase 1: LocalAdapter
│ no imports    │              │   SyncAdapter      │   Phase 2: FirebaseAdapter
│ outside       │              └────────────────────┘   (drop-in, same interface)
│ engine/       │
└───────────────┘
```

```
src/
  engine/          PURE, platform-agnostic, JSON-serializable. Zero DOM.
    rules.js       legalMoves(state, dice) · applyRoll(state, value) · applyMove(state, move)
                   every one returns { state, events } and never mutates the input
    state.js       createInitialState(config) · serialize/deserialize (versioned { v: 1 })
                   board topology (positions are plain integers) · auditState()
    ai.js          chooseMove(state, dice, playerId) — priority tiers + threat model
  render/          Canvas drawing only, no game logic
    board.js       geometry, themes, the cached static board
    tokens.js      token painting + walk/fly/pop animations (promise-based)
    dice.js        dice faces, spin, settle
    effects.js     particles, rings, confetti
  game/
    events.js      the event bus (single source of event names)
    controller.js  turn loop, animation gating, pause, remote actions
    modes.js       vs-computer / pass-and-play / quick-match orchestration
  sync/
    adapter.js     the SyncAdapter contract + action helpers
    local.js       LocalAdapter (Phase 1 default: same device)
    README.md      Phase 2 instructions
  ui/              DOM screens, HUD, canvas view, styles
  audio/synth.js   every sound, generated in code
  storage/         prefs.js · stats.js · resume.js
  main.js          the wiring
tools/             dev only, never shipped: serve, size, icons, boot-check, dom-stub
tests/
```

**Three rules keep this honest**

1. `engine/` is pure: `(state, input) → (newState, events)`. No DOM, no canvas,
   no imports from outside `engine/`.
2. Rendering and UI never mutate game state. They read it and react to events.
3. State is always JSON-safe — no functions, no cycles — so it can be stored in
   a database as-is.

### Position model

A token position is one integer:

| value    | meaning                                                        |
| -------- | -------------------------------------------------------------- |
| `-1`     | in the base                                                    |
| `0..50`  | on the shared ring, relative to that colour's start square      |
| `51..55` | inside the private home column                                  |
| `56`     | home (centre)                                                   |

`abs = (START_ABS[colour] + rel) % 52` maps to the shared ring for collisions and
captures. Start-to-home is 56 steps.

---

## Phase 2 Integration Guide

Phase 2 adds Google Sign-In, online multiplayer and chat **without touching
`engine/`**. Read `src/sync/README.md` first — it has the schema and the
Firestore layout. The short version:

### 1. Implement one file: `src/sync/firebase.js`

```js
import { assertAdapter, rollAction, moveAction } from './adapter.js';

export class FirebaseAdapter {
  async connect(room) {}                   // join room, map uid → seat, attach listeners
  async disconnect() {}
  async sendMove(action) {}                // append to the room's action log
  onRemoteMove(cb) { return unsubscribe }  // cb(action) from other devices
  onPlayersChanged(cb) { return unsub }    // cb(players[]) roster / presence
  presence() { return { status, seats, self } }
  isAuthoritative() {}                     // host owns the dice
  isLocalSeat(seat) {}                     // may this device act for that seat?
}
```

Then hand it to the controller — that is the whole integration:

```js
const controller = createController({ state, bus, adapter: new FirebaseAdapter(...) });
```

The controller already:

- broadcasts every local roll and move via `adapter.sendMove(action)`,
- applies inbound actions through `controller.applyRemoteAction(action)`,
- **waits instead of playing** when `adapter.isLocalSeat(seat)` is false.

### 2. Why no game code changes

The engine is pure, so replaying the same ordered actions produces a
byte-identical state on every device. Two tests already prove it:

- `controller.test.js → "remote action replay reproduces the state byte-for-byte"`
  replays one device's action log into a second controller whose seats are all
  remote, and compares serialized states.
- `sim.test.js → "identical seeds replay identically"`.

The wire format is final:

```json
{ "t": "roll", "seat": 0, "value": 6,              "n": 12, "at": 1720000000000 }
{ "t": "move", "seat": 0, "tokenIndex": 2, "to": 8, "n": 13, "at": 1720000000001 }
```

Store `serialize(state)` as a snapshot every ~20 actions for fast rejoin; the
schema is versioned (`v: 1`) and `deserialize()` has a `migrate()` hook.

### 3. Subscribe, don't reach in

Everything Phase 2 needs is already on the bus (`src/game/events.js`), including
reserved names for the new features:

```js
bus.on('token:captured', (e) => sendChatSticker(e));      // engine events
bus.on('game:over', (e) => writeLeaderboard(e.ranks));
bus.on('chat:message', renderChatBubble);                 // reserved for Phase 2
bus.on('sync:status', renderConnectionPill);               // reserved for Phase 2
bus.onAny((type, payload) => analytics.log(type, payload)); // firehose
```

### 4. Files Phase 2 touches

| file                              | change                                        |
| --------------------------------- | --------------------------------------------- |
| `src/sync/firebase.js`            | **new** — the only networking code            |
| `src/ui/auth.js` (+ markup)       | **new** — Google Sign-In, profile, room lobby |
| `src/ui/chat.js` (+ markup)       | **new** — subscribes to `chat:message`        |
| `src/main.js`                     | pick the adapter, mount the new screens       |
| `src/game/events.js`              | add any extra `chat:` / `sync:` event names   |
| `sw.js`                           | add the new files to `PRECACHE`               |
| `src/engine/*`                    | **nothing. Do not modify.**                   |

### 5. Anti-cheat

The engine rejects illegal moves by throwing. Validate inbound actions with
`legalMoves()` on the host (or in a Cloud Function) and drop anything that
throws. Never trust a client-sent dice value unless that client is the host.

---

## Performance budget

| item                     | budget          | actual                     |
| ------------------------ | --------------- | -------------------------- |
| first-load payload       | < 500 KB        | **221 KB** (80 KB gzipped) |
| repeat visits            | —               | **0 bytes** (precached)    |
| runtime dependencies     | 0               | **0**                      |
| frame loop               | 60 fps          | rAF + delta time, DPR ≤ 2  |
| layout thrash            | none            | canvas only; DOM updates on events, never per frame |

The frame loop idles when nothing is animating, the static board is painted once
into an offscreen canvas and blitted, and the HUD is plain DOM that only changes
when an event says so.

Run `npm run size` for the live per-file breakdown.

## Accessibility

Real `<button>` elements, labelled inputs, `aria-pressed` on toggles,
`role="dialog"` + `aria-modal` overlays, live-region turn banner and toasts,
visible focus rings, 48 px touch targets, keyboard play (`Space`/`Enter` to roll,
`1`-`4` to pick a token, `Esc` to pause), and `prefers-reduced-motion` /
`prefers-contrast` support. Full WCAG conformance needs manual testing with
assistive technology — this is a solid baseline, not a certification.

## Deployment

Push to `main` and `.github/workflows/deploy.yml` runs the tests, the boot check
and the size budget, then publishes the repo root to GitHub Pages. There is no
build step — what you see is what ships.

## License

MIT.
