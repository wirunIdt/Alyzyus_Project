import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const origin = 'https://alyzyus.example';
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

function workerHarness() {
  const listeners = new Map();
  const entries = new Map();
  const writes = [];
  let unavailable = false;
  let invalidAsset = false;
  let skipped = 0;
  const cache = {
    async put(key, response) {
      writes.push(key);
      entries.set(key, response.clone());
    },
    async match(key) {
      return entries.get(key)?.clone();
    },
  };
  class WorkerRequest extends Request {
    constructor(input, options) {
      super(typeof input === 'string' ? new URL(input, origin) : input, options);
    }
  }
  const context = {
    URL,
    Request: WorkerRequest,
    Response,
    Error,
    Map,
    Promise,
    caches: {
      open: async () => cache,
      keys: async () => ['unrelated-cache', 'alyzyus-public-shell-old'],
      delete: async () => true,
    },
    fetch: async (request) => {
      if (unavailable) throw new Error('offline');
      const path = new URL(typeof request === 'string' ? request : request.url, origin).pathname;
      const icon = path.endsWith('.png');
      return new Response(
        icon && !invalidAsset ? 'png-bytes' : '<html>private session must never be cached</html>',
        {
          headers: {
            'Content-Type': icon && !invalidAsset ? 'image/png' : 'text/html; charset=utf-8',
          },
        }
      );
    },
    self: {
      location: { origin },
      clients: { claim: async () => {} },
      skipWaiting: () => {
        skipped++;
      },
      addEventListener: (name, callback) => listeners.set(name, callback),
    },
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  return {
    writes,
    entries,
    setOffline(value) {
      unavailable = value;
    },
    setInvalidAsset(value) {
      invalidAsset = value;
    },
    get skipped() {
      return skipped;
    },
    async lifecycle(name) {
      let promise;
      listeners.get(name)({
        waitUntil: (value) => {
          promise = value;
        },
      });
      await promise;
    },
    message(data) {
      listeners.get('message')({ data });
    },
    async request(path, options = {}) {
      let response;
      listeners.get('fetch')({
        request: {
          method: options.method || 'GET',
          url: new URL(path, origin).href,
          mode: options.mode || 'navigate',
        },
        respondWith: (promise) => {
          response = promise;
        },
      });
      return response ? await response : undefined;
    },
  };
}

test('manifest has same-origin install scope and real correctly-sized app icons', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')
  );
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(new URL(manifest.start_url, origin).origin, origin);
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.equal(new URL(icon.src, origin).origin, origin);
    const bytes = await readFile(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
});

test('service worker leaves API, authentication, checkout and private navigation entirely to network', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  const initial = worker.writes.length;
  for (const path of [
    '/api/products',
    '/support',
    '/api/admin/logs?token=never-cache',
    '/account',
    '/admin/orders',
    '/checkout',
    '/tracking?order=123',
    '/auth/callback?code=secret',
    '/cart',
    '/payments/callback',
    'https://third-party.example/file.png',
  ]) {
    assert.equal(await worker.request(path), undefined, path);
  }
  assert.equal(await worker.request('/shop', { method: 'POST' }), undefined);
  assert.equal(worker.writes.length, initial);
  assert.equal(worker.skipped, 0, 'install must not activate over an open checkout');
});

test('online public HTML remains uncached and offline navigation gets only generic fallback', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  const initial = worker.writes.length;
  const response = await worker.request('/shop?customer=never-persist');
  assert.equal(response.status, 200);
  assert.equal(worker.writes.length, initial);
  assert.ok(
    [...worker.entries.keys()].every(
      (key) => key.includes('/static/icons/') || key === '/offline.html?v=20261015'
    )
  );
  worker.setOffline(true);
  const fallback = await worker.request('/shop');
  assert.equal(fallback.status, 200);
  assert.equal(worker.writes.length, initial);
  assert.equal(
    await worker.request('/account'),
    undefined,
    'private route must not be intercepted offline'
  );
});

test('arbitrary assets, cache-busting query strings and HTML masquerading as icons never enter cache', async () => {
  const worker = workerHarness();
  const response = await worker.request('/static/icons/app-icon-192-v1.png', { mode: 'no-cors' });
  assert.equal(response.status, 200);
  assert.equal(worker.writes.length, 1);
  assert.equal(
    await worker.request('/static/icons/app-icon-192-v1.png?account=private', { mode: 'no-cors' }),
    undefined
  );
  assert.equal(await worker.request('/static/js/app.js', { mode: 'no-cors' }), undefined);
  assert.equal(await worker.request('/product-images/private.png', { mode: 'no-cors' }), undefined);
  worker.entries.clear();
  worker.setInvalidAsset(true);
  await worker.request('/static/icons/app-icon-512-v1.png', { mode: 'no-cors' });
  assert.equal(worker.writes.length, 1, 'invalid content type must never be cached');
});

test('worker update requires an explicit activation message', () => {
  const worker = workerHarness();
  worker.message({ type: 'unexpected' });
  assert.equal(worker.skipped, 0);
  worker.message({ type: 'ACTIVATE_UPDATE' });
  assert.equal(worker.skipped, 1);
});
