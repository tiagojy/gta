const SHELL_CACHE = 'gta-cv-shell-v3';
const ASSETS_CACHE = 'gta-cv-assets-v5';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  const allowed = new Set([SHELL_CACHE, ASSETS_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => (allowed.has(key) ? null : caches.delete(key))),
      ),
    ).then(() => self.clients.claim()),
  );
});

function isStoryRequest(url) {
  return url.pathname.includes('/story/');
}

async function handleStoryHead(request) {
  if (request.cache === 'reload' || request.cache === 'no-store') {
    return fetch(request);
  }
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request.url);
  if (cached) {
    return new Response(null, {
      status: 200,
      statusText: 'OK',
      headers: cached.headers,
    });
  }
  return fetch(request);
}

async function handleNetworkRefresh(request, cacheName) {
  const cache = await caches.open(cacheName);
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function handleCacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function handleStaleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }
  const networkResponse = await networkPromise;
  if (networkResponse) {
    return networkResponse;
  }
  return new Response('', { status: 504, statusText: 'Offline' });
}

async function handleNetworkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'HEAD' && isStoryRequest(url)) {
    event.respondWith(handleStoryHead(request));
    return;
  }

  if (request.method !== 'GET') return;

  if (
    isStoryRequest(url) &&
    url.pathname.toLowerCase().endsWith('.md') &&
    (request.mode === 'navigate' || request.destination === 'document' || request.destination === 'iframe')
  ) {
    const appEntryUrl = new URL('./index.html', self.location.href).href;
    event.respondWith(Response.redirect(appEntryUrl, 302));
    return;
  }

  const forceNetwork = request.cache === 'reload' || request.cache === 'no-store';

  if (isStoryRequest(url)) {
    if (forceNetwork) {
      event.respondWith(handleNetworkRefresh(request, ASSETS_CACHE));
      return;
    }
    if (IMAGE_EXT_RE.test(url.pathname)) {
      event.respondWith(handleCacheFirst(request, ASSETS_CACHE));
      return;
    }
    if (url.pathname.endsWith('.md')) {
      event.respondWith(handleNetworkFirst(request, ASSETS_CACHE));
      return;
    }
  }

  if (forceNetwork) {
    event.respondWith(handleNetworkRefresh(request, SHELL_CACHE));
    return;
  }

  event.respondWith(handleNetworkFirst(request, SHELL_CACHE));
});
