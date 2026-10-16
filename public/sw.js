/* Alyzyus PWA: เก็บเฉพาะไอคอนและหน้าแจ้งออฟไลน์สาธารณะ ไม่เก็บข้อมูลผู้ใช้ */
'use strict';
const CACHE_PREFIX = 'alyzyus-public-shell-';
const CACHE_NAME = `${CACHE_PREFIX}20261015-v2`;
const OFFLINE_URL = '/offline.html?v=20261015';
const PUBLIC_ASSETS = new Map([
  [OFFLINE_URL, 'text/html'],
  ['/static/icons/app-icon-192-v1.png', 'image/png'],
  ['/static/icons/app-icon-512-v1.png', 'image/png'],
  ['/static/icons/app-maskable-512-v1.png', 'image/png'],
  ['/static/icons/apple-touch-180-v1.png', 'image/png'],
]);
const PRIVATE_PATH = /^\/(?:api|account|admin|auth|cart|checkout|tracking|support|payment|payments)(?:\/|$)/;

function approvedResponse(response, key) {
  if (!response || response.status !== 200 || response.redirected) return false;
  const expected = PUBLIC_ASSETS.get(key);
  return !!expected && (response.headers.get('Content-Type') || '').toLowerCase().startsWith(expected);
}

self.addEventListener('install', event => {
  // credentials:omit ป้องกันการส่ง session ไปกับการเตรียมไฟล์สาธารณะ
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([...PUBLIC_ASSETS.keys()].map(async key => {
      const response = await fetch(new Request(key, {credentials: 'omit', cache: 'reload'}));
      if (!approvedResponse(response, key)) throw new Error('Public app asset is unavailable');
      await cache.put(key, response);
    }));
    // ไม่ skipWaiting อัตโนมัติ เพราะผู้ใช้อาจกำลังชำระเงินในอีกแท็บ
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  // เปลี่ยนรุ่นเมื่อผู้ใช้กดปุ่มเท่านั้น ไม่มีการ reload ระหว่าง checkout
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || PRIVATE_PATH.test(url.pathname)) return;
  const key = url.pathname + url.search;
  if (PUBLIC_ASSETS.has(key)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(key);
      if (cached) return cached;
      const response = await fetch(request);
      if (approvedResponse(response, key)) await cache.put(key, response.clone());
      return response;
    })());
    return;
  }
  if (request.mode === 'navigate') {
    // HTML สดจากเซิร์ฟเวอร์เสมอ แม้หน้าแรกมีข้อมูล session ก็ไม่ลง Cache Storage
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match(OFFLINE_URL);
      return fallback || new Response('Offline. Reconnect to open Alyzyus.', {
        status: 503,
        headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'},
      });
    }));
  }
});
