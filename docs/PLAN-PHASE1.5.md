# Phase 1.5 — Social / meta game layer

Goal: everything the reference app (Comfun Ludo) shows on screen, built **offline,
code-drawn, zero dependencies**, on top of the Phase 1 engine — and more polished
than the reference. Phase 2 (Firebase) then only has to swap adapters.

## Non-negotiables carried over from Phase 1

| rule | why |
| --- | --- |
| `engine/` stays pure — no DOM, no storage, no imports outside `engine/` | Phase 2 sync |
| Zero runtime dependencies, no build step | offline + 2G India |
| Zero gameplay images — everything procedural (canvas / CSS / inline SVG) | payload |
| First load < 500 KB raw | performance budget |
| State JSON-serializable and versioned | cloud save in Phase 2 |

## Hard boundaries (deliberate, not missing work)

1. **No real money.** Coins and diamonds are virtual, cannot be bought and cannot
   be cashed out. The Shop renders packs and prices for layout parity, but
   `services/purchase.js` is a **disabled provider** that explains why and points
   at the free ways to earn. Real IAP + real-money contests need a payment
   provider, age-gating, KYC and (in India) state-by-state legal review. That is
   a Phase 2 business decision, not a client feature.
2. **No real ads.** `services/ads.js` is an `AdProvider` seam with a simulated
   rewarded video (a real 5 s countdown, skippable never, resolves `completed`).
   AdMob/Unity plugs in behind the same interface.
3. **No real users yet.** Friends, leaderboards, gold-room spectating and online
   opponents are **seeded simulations** driven by the same `SyncAdapter` interface
   Phase 2 will use, so the UI never learns whether the opponent is real.
4. **No celebrity photos.** Avatars are procedurally generated (seeded), not
   scraped images. Users may pick a generated avatar or (Phase 2) upload one.
5. **Voice chat** is out: the mic button becomes quick-chat + emoji. Recording
   needs permissions, storage and moderation.

## Screen-by-screen mapping (all 23 reference pages)

| reference screen | what we build | module |
| --- | --- | --- |
| Home top bar: avatar + frame, level ring, XP bar, VIP badge | procedural avatar, level ring, XP bar, VIP pill | `ui/home.js`, `render/avatar.js`, `meta/account.js` |
| Coins / diamonds with `+` | wallet chips, tap → Shop | `meta/wallet.js`, `ui/shop.js` |
| Gear | existing Settings + new language switch | `ui/screens.js`, `i18n/` |
| Icon rail: Task, 3× NEW events, Lucky Month, Remove Ads, Shop, Message | rail with badges | `ui/home.js`, `meta/tasks.js`, `meta/rewards.js` |
| ONLINE tile + live count | simulated presence counter (seeded, drifts) | `ui/home.js`, `sync/simulated.js` |
| BIG WIN / WIN GOLD (watch & chat) / TOURNAMENT / WITH FRIENDS / VS COMPUTER / PASS & PLAY / SNAKES & LADDER carousel with counts | scrollable tile carousel, each wired to a real mode | `ui/home.js`, `game/modes.js` |
| Bottom nav: Get Coins (ad badge), Friends, Ranking, Skin Shop, Spin + countdown | bottom nav | `ui/home.js`, `ui/spin.js` |
| Mascot | code-drawn animated mascot | `render/avatar.js` |
| Friends List: tabs, avatars, Play, Add Friends, Gift Invite | friends modal, playable friend bots | `meta/social.js`, `ui/friends.js` |
| Leaderboard: Charm Star / Gallantry Star / Coins / Lucky Month Star, podium 1-2-3 | 4 boards, podium + list, your rank | `ui/leaderboard.js`, `meta/social.js` |
| Skin: DICE / FRAME / THEME / TOKEN / CHATBOX grids, Equip / Equipped / Watch Video `0/35` / Event / Ranking locks | full cosmetics system, all previews drawn in code | `meta/catalog.js`, `render/skins.js`, `ui/skins.js` |
| Shop: PACKS / COINS / DIAMONDS, Super VIP subscription, start packs, Daily Value Deal | shop UI + disabled purchase provider + free-earn routes | `ui/shop.js`, `services/purchase.js` |
| Task: Daily / Growth, milestone bar with diamond rewards, Go buttons, XP chips | task engine auto-fed by the event bus | `meta/tasks.js`, `ui/tasks.js` |
| Gold Room: spectate list, VS cards, timers, heat, ×2 WIN, Entry, Play | simulated live tables, watch + join | `ui/online.js`, `sync/simulated.js` |
| Tournament + BLITZ ARENA (2 h a game) | two tournament formats | `game/tournament.js`, `ui/online.js` |
| Tournament board: ranking table, highest score, gifts, GAME END IN countdown, stake ±, lives (hearts + AD), best rank, Play 10 💎 | score tournament loop | `game/tournament.js`, `ui/online.js` |
| Online Multiplayer: Classic/Quick, 2P/4P, skin preview prices, stake ±, tier name, EXP, Play, Meet nearby | matchmaking modal + overlay | `ui/online.js` |
| Own profile: ID, badges, flags, gender, location, join month, coins/gifts/likes, Games Won %, Big Won, bio, photo slots, Own Frames, Edit | full profile card, editable | `ui/profile.js`, `meta/account.js` |
| Other profile: Send gifts, Report, Block, Say hi, Delete, frame collection, top gifters | social actions | `ui/profile.js`, `meta/social.js` |
| In-game: avatar panels + frames, dice tile, like counters, turn timer, crowns, emoji/tomato throw, chat feed, quick chat, gift, "X likes Y" | live table UI | `ui/chat.js`, `ui/hud.js`, `game/controller.js` |
| Snakes & Ladder tile | complete second game | `engine/snakes.js`, `render/snakeboard.js` |

## Module tree (additions only)

```
src/
  engine/snakes.js        PURE Snakes & Ladders (state, rules, bot)
  meta/                   offline meta-game, storage-backed, no DOM
    account.js            profile, level/XP curve, tier badges, VIP, likes
    wallet.js             coins, diamonds, ledger, stake tiers, settlement
    catalog.js            every cosmetic + unlock rule + ownership/equip
    tasks.js              daily + growth tasks, milestones, bus auto-tracking
    rewards.js            spin wheel, daily bonus, ad rewards, Lucky Month
    social.js             friends, requests, gifts, likes, blocks, leaderboards
  services/
    ads.js                AdProvider + LocalAdProvider (simulated rewarded)
    purchase.js           PurchaseProvider + DisabledProvider (Phase 2: IAP)
  sync/simulated.js       SimulatedOnlineAdapter (same SyncAdapter interface)
  game/tournament.js      score tournament + blitz session logic
  render/
    avatar.js             procedural avatars, frames, mascot, podiums
    skins.js              dice / token / board / chatbox skin painters
    snakeboard.js         Snakes & Ladders board
  ui/
    home.js               the lobby
    shop.js  skins.js  tasks.js  friends.js  leaderboard.js  profile.js
    online.js             matchmaking, gold room, tournament, blitz
    chat.js               in-game chat, emoji, throws, gifts, likes
    spin.js               canvas spin wheel
  i18n/index.js           t(), English + Hindi
  storage/save.js         one versioned save document (Phase 2 = one Firestore doc)
```

## Data model — the save document

One localStorage key, `ludoBattle.save.v1`, one JSON object. Phase 2 writes the
same object to `users/{uid}/save`.

```js
{
  v: 1, updatedAt,
  account: { id, name, avatar:{seed,style,tint}, gender, country, city, bio,
             photos:[], joinedAt, level, xp, likes, giftsIn, giftsOut,
             vip:{tier,until}, removeAds, lang },
  wallet:  { coins, diamonds, ledger:[{t,amount,reason,at}] },
  catalog: { owned:{dice:[],frame:[],theme:[],token:[],chatbox:[]},
             equipped:{dice,frame,theme,token,chatbox}, adProgress:{itemId:n} },
  tasks:   { day:'2026-07-27', daily:{id:count}, growth:{id:count},
             claimed:[], milestone:xp },
  rewards: { lastSpinAt, lastBonusAt, streak, luckyMonth:{stamps:[]} },
  social:  { friends:[id], requests:[id], blocked:[id], seed },
  records: { games, wins, bigWins, byMode:{...} }
}
```

## Wave order

1. **Foundations** — i18n, save store, account/level, wallet, ad + purchase seams
2. **Cosmetics** — catalog + procedural painters + equip wiring
3. **Lobby** — the home screen
4. **Shop / Skin shop / Spin / Get Coins / Remove Ads / VIP**
5. **Tasks + Rewards + Inbox**
6. **Social** — profile, friends, leaderboards, gifts, likes
7. **Simulated online** — matchmaking, gold room, tournaments, turn timer, chat
8. **Snakes & Ladders**
9. **Polish** — SW update prompt, maskable icon, payload trim, full verification

Each wave ends with: `node --test tests/` + `tools/boot-check.js` +
`tools/playthrough.js` + `tools/size.js` green, then one conventional commit per
feature.

## Size strategy (budget is a hard limit)

Everything is procedural, so cosmetics cost bytes-per-recipe, not bytes-per-asset:
a dice skin is ~15 lines of canvas code shared by a parameter table. Target after
wave 9: **< 420 KB raw / < 150 KB gzipped**. `tools/size.js` fails the build
otherwise, and it runs in CI.

## Phase 2 delta after this wave set

Still only adapters:

| seam | Phase 1.5 | Phase 2 |
| --- | --- | --- |
| `sync/adapter.js` | `LocalAdapter`, `SimulatedOnlineAdapter` | `FirebaseAdapter` |
| `services/ads.js` | `LocalAdProvider` | AdMob |
| `services/purchase.js` | `DisabledProvider` | Play Billing / Stripe |
| `storage/save.js` | localStorage | mirror to Firestore |
| `meta/social.js` | seeded simulation | real users, real chat |

`engine/` still needs zero changes.
