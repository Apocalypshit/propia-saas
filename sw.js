// sw.js — PropIA Service Worker
// Cache strategy: Network-first para API, Cache-first para assets estáticos

const CACHE_NAME    = 'propia-v1';
const CACHE_STATIC  = 'propia-static-v1';

// Páginas y assets que se cachean para uso offline
const PRECACHE = [
  '/app',
  '/dashboard',
  '/manifest.json'
];

// ── Install ─────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function(e) {
        console.warn('[SW] Precache partial fail:', e);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activate ────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) {
          return k !== CACHE_NAME && k !== CACHE_STATIC;
        }).map(function(k) {
          return caches.delete(k);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch ────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Skip non-GET and API calls — always go to network
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  // For HTML pages: network-first, fallback to cache
  if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Cache successful responses
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_STATIC).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function() {
          // Offline fallback
          return caches.match(event.request).then(function(cached) {
            if (cached) return cached;
            return caches.match('/app');
          });
        })
    );
    return;
  }

  // For fonts and static assets: cache-first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          var clone = response.clone();
          caches.open(CACHE_STATIC).then(function(cache) {
            cache.put(event.request, clone);
          });
          return response;
        });
      })
    );
    return;
  }
});
