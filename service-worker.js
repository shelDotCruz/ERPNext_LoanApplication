// =====================================================================
// SERVICE WORKER - Offline Caching
// =====================================================================

const CACHE_NAME = 'asenso-signature-v1';
const ASSETS_TO_CACHE = [
    './',
    './signature-app.html',
    './app.js',
    './manifest.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    console.log('⚙️ Service Worker: Installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Service Worker: Caching assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('✅ Service Worker: Installed successfully');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('❌ Service Worker: Installation failed', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('⚙️ Service Worker: Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('🗑️ Service Worker: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('✅ Service Worker: Activated successfully');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Skip Google Apps Script API calls - always use network
    if (event.request.url.includes('script.google.com') || 
        event.request.url.includes('script.googleusercontent.com')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                // Return cached response if found
                if (cachedResponse) {
                    console.log('📦 Serving from cache:', event.request.url);
                    return cachedResponse;
                }
                
                // Otherwise fetch from network
                console.log('🌐 Fetching from network:', event.request.url);
                return fetch(event.request)
                    .then((response) => {
                        // Cache successful responses
                        if (response.status === 200) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseClone);
                                });
                        }
                        return response;
                    })
                    .catch((error) => {
                        console.error('❌ Fetch failed:', error);
                        
                        // Return offline page if available
                        return caches.match('./signature-app.html');
                    });
            })
    );
});

// Background sync event (for future enhancement)
self.addEventListener('sync', (event) => {
    console.log('🔄 Background sync triggered:', event.tag);
    
    if (event.tag === 'sync-signatures') {
        event.waitUntil(
            // Notify the app to sync
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({
                        type: 'BACKGROUND_SYNC',
                        action: 'syncSignatures'
                    });
                });
            })
        );
    }
});

// Push notification event (for future enhancement)
self.addEventListener('push', (event) => {
    console.log('🔔 Push notification received');
    
    const options = {
        body: event.data ? event.data.text() : 'New notification',
        icon: 'icon-192.png',
        badge: 'badge-72.png',
        vibrate: [200, 100, 200]
    };
    
    event.waitUntil(
        self.registration.showNotification('Asenso Signature App', options)
    );
});

// Message event - handle messages from app
self.addEventListener('message', (event) => {
    console.log('📨 Message received:', event.data);
    
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.delete(CACHE_NAME).then(() => {
                console.log('🗑️ Cache cleared');
            })
        );
    }
});

console.log('✅ Service Worker script loaded');
