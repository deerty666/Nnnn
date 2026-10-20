const CACHE_NAME = 'deerty-cashier-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './555.jpg'
];


// 📦 تثبيت الخدمة وتخزين الملفات الثابتة مؤقتاً
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 🧹 تنشيط الخدمة وحذف النسخ القديمة للذاكرة المؤقتة
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 🌐 استراتيجية الجلب: البحث في الذاكرة المؤقتة أولاً ثم الشبكة
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request);
    })
  );
});
