// Minimal offline shell. Versioned cache name — bump VERSION to invalidate.
const VERSION = 'crm-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for everything; fall back to cache for navigation requests
// only. API calls (anything to :8080 or path starting with /auth, /candidates,
// etc.) are NEVER cached — those must hit the network or fail.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode !== 'navigate') return;
  e.respondWith(
    fetch(req).catch(() => caches.match('/index.html').then((r) => r || new Response('Offline', { status: 503 })))
  );
});
