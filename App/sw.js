const APP_CACHE = 'ssi-app-v1';
const TILE_CACHE = 'ssi-tiles-v1';
const MAX_TILES = 8000;

const APP_ASSETS = [
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/auth.js',
  './js/sync.js',
  './js/map.js',
  './js/polygon.js',
  './js/search.js',
  './js/app.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Turf.js/6.5.0/turf.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE).then(cache => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isTile = /tile|arcgis|basemap\.nationalmap|opentopomap|tile\.openstreetmap/i.test(url.hostname);

  if (isTile) {
    e.respondWith(tileStrategy(e.request));
  } else {
    e.respondWith(appStrategy(e.request));
  }
});

async function tileStrategy(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const response = await fetch(req);
    if (response.ok) {
      await pruneTileCache(cache);
      cache.put(req, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function appStrategy(req) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(req);
  try {
    const response = await fetch(req);
    if (response.ok) cache.put(req, response.clone());
    return response;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function pruneTileCache(cache) {
  const keys = await cache.keys();
  if (keys.length >= MAX_TILES) {
    const toDelete = keys.slice(0, keys.length - MAX_TILES + 200);
    await Promise.all(toDelete.map(k => cache.delete(k)));
  }
}

// Message handler for manual tile caching
self.addEventListener('message', async e => {
  if (e.data.type === 'CACHE_TILES') {
    const { urls } = e.data;
    const cache = await caches.open(TILE_CACHE);
    let cached = 0;
    for (const url of urls) {
      if (!(await cache.match(url))) {
        try {
          const r = await fetch(url);
          if (r.ok) { cache.put(url, r); cached++; }
        } catch {}
      }
    }
    e.source.postMessage({ type: 'CACHE_DONE', cached, total: urls.length });
  }
});
