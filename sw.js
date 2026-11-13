/* Rally Directo · service worker mínimo.
   Red siempre: no se guarda HTML/JS, ni /data, ni /archive, ni version.json.
   Así no se sirve código ni datos viejos y el auto-reload por version.json sigue funcionando. */
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
