// Minimal offline-shell service worker. Never touches cross-origin requests
// (Supabase realtime/REST and Mapbox tiles stay fully live).
const CACHE = 'supra-shell-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(SHELL)
      // precache the hashed entry assets referenced by the shell HTML, so
      // offline works from the very first visit (lazy chunks land in the
      // runtime cache once used)
      try {
        const res = await fetch('/')
        const html = await res.clone().text()
        await cache.put('/', res)
        const assets = [...new Set([...html.matchAll(/\/assets\/[A-Za-z0-9._-]+/g)].map((m) => m[0]))]
        await cache.addAll(assets)
      } catch {
        /* offline install — runtime caching will fill in */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== location.origin) return

  // content-hashed build assets: cache-first (immutable by construction)
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        // ignoreVary: servers may send `Vary: Origin`, which would defeat
        // matching for crossorigin module requests
        const hit = await cache.match(request, { ignoreVary: true })
        if (hit) return hit
        const res = await fetch(request)
        if (res.ok) cache.put(request, res.clone())
        return res
      }),
    )
    return
  }

  // navigations: network-first, offline falls back to the cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy))
          return res
        })
        .catch(() => caches.match('/', { ignoreVary: true })),
    )
  }
})
