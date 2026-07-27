/**
 * sw.js — service worker: precache everything, then run fully offline.
 *
 * Strategy
 *   install   → precache the whole app shell (every file the game needs)
 *   activate  → drop old caches, take control immediately
 *   fetch     → cache-first for app files (0 bytes on a second launch),
 *               navigations fall back to the cached index.html,
 *               anything unexpected falls back to the network then the cache
 *
 * Bump CACHE when you ship: the old cache is deleted on activate.
 */

const CACHE = 'ludo-battle-v1';

/** Every file in the app. Relative paths resolve against the SW scope. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './src/main.js',
  './src/ui/styles.css',
  './src/ui/game.js',
  './src/ui/hud.js',
  './src/ui/home.js',
  './src/ui/screens.js',
  './src/engine/state.js',
  './src/engine/rules.js',
  './src/engine/ai.js',
  './src/i18n/index.js',
  './src/meta/account.js',
  './src/meta/wallet.js',
  './src/services/ads.js',
  './src/services/purchase.js',
  './src/storage/save.js',
  './src/game/events.js',
  './src/game/controller.js',
  './src/game/modes.js',
  './src/render/board.js',
  './src/render/tokens.js',
  './src/render/dice.js',
  './src/render/effects.js',
  './src/render/skins.js',
  './src/render/avatar.js',
  './src/meta/catalog.js',
  './src/audio/synth.js',
  './src/storage/prefs.js',
  './src/storage/stats.js',
  './src/storage/resume.js',
  './src/sync/adapter.js',
  './src/sync/local.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll is atomic-ish: one bad URL fails the whole install, so add
      // individually and keep going. A missing file must not brick the app.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            /* keep installing */
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third parties

  // Navigations: serve the shell so a deep link works offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = (await cache.match('./index.html')) || (await cache.match('./'));
        if (cached) {
          // Refresh in the background so updates land on the next launch.
          fetch(req)
            .then((res) => res && res.ok && cache.put('./index.html', res.clone()))
            .catch(() => { });
          return cached;
        }
        try {
          return await fetch(req);
        } catch (err) {
          return new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        const shell = await cache.match('./index.html');
        if (shell && req.destination === 'document') return shell;
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })()
  );
});
