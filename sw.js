// ============================================================
//  ImmoToken — Service Worker
//  Cache-first pour offline, Network-first pour l'API
// ============================================================

const CACHE_NAME    = 'immotoken-v1.0.0';
const API_CACHE     = 'immotoken-api-v1';
const OFFLINE_URL   = '/offline.html';

// Ressources mises en cache lors de l'installation
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Installation ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Mise en cache des ressources statiques');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── Activation ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key !== CACHE_NAME && key !== API_CACHE)
        .map(key => {
          console.log('[SW] Suppression ancien cache:', key);
          return caches.delete(key);
        })
    )).then(() => self.clients.claim())
  );
});

// ── Stratégie de fetch ────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API Django → Network-first (avec fallback cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstAPI(event.request));
    return;
  }

  // 2. Assets statiques → Cache-first
  event.respondWith(cacheFirstStatic(event.request));
});

// Network-first pour l'API
async function networkFirstAPI(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      // Mettre en cache seulement les GET
      if (request.method === 'GET') {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch {
    // Offline : retourner le cache si disponible
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ detail: 'Pas de connexion. Réessayez.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Cache-first pour les assets
async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Page offline si navigation
    if (request.mode === 'navigate') {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
    return new Response('Hors ligne', { status: 503 });
  }
}

// ── Push Notifications ────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  const title   = data.title   ?? 'ImmoToken';
  const body    = data.body    ?? 'Vous avez une notification';
  const icon    = data.icon    ?? '/icons/icon-192.png';
  const badge   = data.badge   ?? '/icons/icon-96.png';
  const url     = data.url     ?? '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: { url },
      vibrate: [200, 100, 200],
      actions: [
        { action: 'open',    title: 'Ouvrir' },
        { action: 'dismiss', title: 'Ignorer' },
      ],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ── Background Sync (paiements en attente) ────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncPendingTransactions());
  }
});

async function syncPendingTransactions() {
  // Récupère les transactions stockées en IndexedDB et les resoumet
  console.log('[SW] Synchronisation des transactions en attente...');
  // À implémenter avec IndexedDB selon le besoin
}
