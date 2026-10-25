/* ================================================================
   Aura AI — Service Worker (sw.js)
   Provides offline support, background sync, push notifications,
   and intelligent caching for PWA/APK installation
   ================================================================ */

const APP_NAME    = 'aura-ai';
const CACHE_VER   = 'v1.5.0';
const STATIC_CACHE = `${APP_NAME}-static-${CACHE_VER}`;
const DATA_CACHE   = `${APP_NAME}-data-${CACHE_VER}`;
const IMG_CACHE    = `${APP_NAME}-images-${CACHE_VER}`;

// ── Files to pre-cache on install ────────────────────────────────
const STATIC_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html',
];

// ── CDN resources to cache on first use ──────────────────────────
const CDN_PATTERNS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── Install event ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[SW] Installing ${CACHE_VER}…`);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching static files');
        return cache.addAll(STATIC_FILES.map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache failed (some files may be missing):', err))
  );
});

// ── Activate event — clear old caches ────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[SW] Activating ${CACHE_VER}…`);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(APP_NAME) && ![STATIC_CACHE, DATA_CACHE, IMG_CACHE].includes(key))
          .map(key => { console.log('[SW] Deleting old cache:', key); return caches.delete(key); })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch event — intelligent routing ─────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // OpenAI API — network only, no cache
  if (url.hostname === 'api.openai.com') {
    event.respondWith(networkOnly(request));
    return;
  }

  // Images — cache first
  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, IMG_CACHE));
    return;
  }

  // CDN fonts/scripts — stale-while-revalidate
  if (CDN_PATTERNS.some(p => url.hostname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // HTML pages — network first with offline fallback
  if (request.destination === 'document') {
    event.respondWith(networkFirstWithFallback(request, '/offline.html'));
    return;
  }

  // Static assets (JS, CSS) — stale-while-revalidate
  if (['script', 'style'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Everything else — network first
  event.respondWith(networkFirst(request, DATA_CACHE));
});

// ── Caching strategies ────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline', cached: false }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });
  }
}

async function networkFirstWithFallback(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match(fallbackUrl);
    return fallback || new Response('<h1>Offline</h1><p>Aura AI is offline. Please reconnect.</p>', {
      headers: { 'Content-Type': 'text/html' },
      status: 503,
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'Network unavailable' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Background Sync ───────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-conversations') {
    event.waitUntil(syncConversations());
  }
});

async function syncConversations() {
  console.log('[SW] Background sync: conversations');
  // In production: sync local IndexedDB conversations to cloud backend
}

// ── Push Notifications ────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const options = {
    body:   data.body    || 'Aura AI has a new message for you',
    icon:   data.icon    || '/icon-192.png',
    badge:  data.badge   || '/icon-96.png',
    image:  data.image,
    data:   data.data    || { url: '/' },
    actions: [
      { action: 'open',    title: 'Open Chat' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
    tag: 'aura-ai-notification',
    renotify: true,
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Aura AI', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        const existing = clientList.find(c => c.url.includes(self.registration.scope));
        if (existing) return existing.focus();
        return clients.openWindow(url);
      })
  );
});

// ── Periodic Background Sync ──────────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-updates') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
  console.log('[SW] Periodic sync: checking for updates');
  try {
    const response = await fetch('/version.json');
    const { version } = await response.json();
    if (version !== CACHE_VER) {
      const allClients = await clients.matchAll();
      allClients.forEach(client => client.postMessage({ type: 'UPDATE_AVAILABLE', version }));
    }
  } catch {}
}

// ── Message handling from main thread ────────────────────────────
self.addEventListener('message', event => {
  const { type, data } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (type === 'GET_CACHE_SIZE') {
    getCacheSize().then(size => {
      event.ports[0]?.postMessage({ type: 'CACHE_SIZE', size });
    });
  }

  if (type === 'CLEAR_CACHE') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => event.ports[0]?.postMessage({ type: 'CACHE_CLEARED' }));
  }
});

async function getCacheSize() {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const { usage } = await navigator.storage.estimate();
    return usage;
  }
  return 0;
}

console.log(`[SW] Aura AI Service Worker ${CACHE_VER} loaded`);
