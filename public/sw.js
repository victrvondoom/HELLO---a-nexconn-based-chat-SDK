/* global self, caches, fetch, URL, Response */
/*
 * HELLO offline care. Caches only the "I need a break" page of each event and the immutable static files it
 * needs, so it opens with no connection after one successful visit. Nothing else is cached: no other page,
 * no API response, no personal data beyond what that page shows (venue facilities and help points).
 */
const CACHE = 'hello-care-v2';
const CARE = /^\/events\/[^/]+\/care$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hello-care-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

/** Store a copy. The copy is taken before the response is handed on, while its body is still unread. */
function keep(event, key, response) {
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (CARE.test(url.pathname)) {
    // Network first, so the page is current when online; the cached copy when offline.
    event.respondWith(
      fetch(request)
        .then((response) => keep(event, url.pathname, response))
        .catch(() => caches.match(url.pathname).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    // Hashed file names never change: cache first.
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => keep(event, request, response))));
  }
});
