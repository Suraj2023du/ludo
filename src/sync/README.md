# PHASE 2: implement `FirebaseAdapter` here. Do NOT touch `engine/`.

This folder is the **only** place networking may live.

```
sync/
  adapter.js   ← the contract (SyncAdapter) + action helpers. Read this first.
  local.js     ← LocalAdapter, the Phase 1 default (same-device play)
  firebase.js  ← ★ ADD THIS IN PHASE 2
```

## Why nothing in `engine/` needs to change

`engine/rules.js` is a set of pure functions:

```
(state, input) → (newState, events)
```

Given the same ordered list of actions, every device computes a byte-identical
state. `tests/sim.test.js` proves it ("identical seeds replay identically").
So online play is not a game-logic problem, it is a **transport** problem:
broadcast the actions, apply them in order.

## The contract

```js
export class FirebaseAdapter {
  async connect(room) {}                  // join room, resolve seats, start listeners
  async disconnect() {}                   // detach listeners, clear presence
  async sendMove(action) {}               // write action to the room's action log
  onRemoteMove(cb) { return unsubscribe } // cb(action) for actions from other devices
  onPlayersChanged(cb) { return unsub }   // cb(players[]) roster/presence changes
  presence() { return { status, seats, self } }
  isAuthoritative() {}                    // true only for the host (owns the dice)
  isLocalSeat(seat) {}                    // may this device act for that seat?
}
```

Validate it at construction time:

```js
import { assertAdapter } from './sync/adapter.js';
assertAdapter(new FirebaseAdapter(...));
```

### The wire format (already final)

```json
{ "t": "roll", "seat": 0, "value": 6,             "n": 12, "at": 1720000000000 }
{ "t": "move", "seat": 0, "tokenIndex": 2, "to": 8, "n": 13, "at": 1720000000001 }
```

`n` is a monotonic counter — use it to reject duplicates and to order writes.
Build actions with `rollAction()` / `moveAction()` from `adapter.js`; never
invent a new shape.

## Suggested Firestore / RTDB layout

```
rooms/{roomId}
  meta      { host: uid, mode, createdAt, status }
  seats/{0..3}  { uid, name, color, type, connected, lastSeen }
  actions/{n}   { t, seat, value|tokenIndex|to, at }      ← append-only log
  snapshot      { v:1, ... }   ← serialize(state) every ~20 actions (fast rejoin)
  chat/{msgId}  { uid, name, text, at }
```

`snapshot` is exactly `serialize(state)` from `engine/state.js` — the schema is
versioned (`v: 1`) and `deserialize()` has a `migrate()` hook, so future rule
changes will not orphan live games.

## Wiring it up

```js
import { createController } from '../game/controller.js';
import { FirebaseAdapter } from './firebase.js';

const adapter = new FirebaseAdapter({ roomId, uid });
const controller = createController({ state, bus, adapter });

// The controller already does all of this for you:
//  • local action  → adapter.sendMove(action)
//  • remote action → controller.applyRemoteAction(action)
//  • non-local seat → controller waits instead of rolling
//  • !isAuthoritative() → dice values come from the host, never generated locally
```

## Rules for Phase 2

1. **Never** import `firebase` from `engine/`, `render/`, or `ui/`.
2. **Never** mutate state outside the engine. Apply actions, then re-render.
3. Treat the action log as the source of truth; the snapshot is only a cache.
4. Anti-cheat: the host (or a Cloud Function) validates every inbound action with
   `legalMoves()` before accepting it. The engine already rejects illegal moves
   by throwing — catch it and drop the action.
5. Reconnect = load `snapshot` with `deserialize()`, then replay `actions` where
   `n > snapshot.n`.
