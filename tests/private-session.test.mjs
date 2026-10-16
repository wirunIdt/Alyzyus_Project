import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const appSource = await readFile(new URL('../public/static/js/app.js', import.meta.url), 'utf8');
const sources = Object.fromEntries(
  await Promise.all(
    ['tracking', 'logs', 'account', 'admin', 'checkout'].map(async (name) => [
      name,
      await readFile(new URL(`../public/static/js/${name}.js`, import.meta.url), 'utf8'),
    ])
  )
);
const settle = async () => {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
};
const customer = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'private@example.test',
  name: 'Private customer',
  role: 'customer',
  emailVerified: true,
};
const order = {
  id: '22222222-2222-4222-8222-222222222222',
  order_number: 'ALY-PRIVATE-ORDER',
  status: 'pending',
  payment_status: 'pending',
  payment_method: 'cod',
  customer_name: 'Private customer',
  email: customer.email,
  phone: '123456789',
  address: 'Private address',
  created_at: '2026-10-16T09:00:00Z',
  items: [],
  total: 100,
  subtotal: 100,
  shipping: 0,
  discount: 0,
};
const product = {
  id: 'p1',
  slug: 'test-product',
  name: { en: 'Test product' },
  description: { en: 'Example' },
  images: ['/static/example.webp'],
  category: 'everyday',
  price: 100,
  stock: 4,
};
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

function eventSurface() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      const rows = listeners.get(name) || [];
      rows.push(callback);
      listeners.set(name, rows);
    },
    removeEventListener(name, callback) {
      listeners.set(
        name,
        (listeners.get(name) || []).filter((item) => item !== callback)
      );
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((callback) => callback(event));
    },
  };
}
function appHarness(cart = []) {
  const timers = new Map();
  let nextTimer = 0;
  const window = { ...eventSurface(), __SHOP__: { products: [product], configured: true } };
  const document = {
    ...eventSurface(),
    documentElement: { dataset: {} },
    body: { style: {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    hidden: false,
  };
  const values = new Map([['alyzyus-cart', JSON.stringify(cart)]]);
  const context = {
    window,
    document,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    setTimeout: (callback) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(appSource, context, { filename: 'app.js' });
  return {
    shop: window.Shop,
    event: (type, properties = {}) => window.dispatchEvent({ type, ...properties }),
    visible: (hidden) => {
      document.hidden = hidden;
      document.dispatchEvent({ type: 'visibilitychange' });
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    get timers() {
      return timers.size;
    },
  };
}

test('a malformed saved cart does not stop storefront startup or duplicate valid lines', () => {
  const h = appHarness([
    null,
    42,
    'invalid',
    {},
    { id: 'p1', quantity: 99 },
    { id: 'p1', quantity: 2 },
    { id: 'missing', quantity: 1 },
    { id: 'p1', quantity: -1 },
  ]);
  assert.equal(h.shop.cart.length, 1);
  assert.equal(h.shop.cart[0].quantity, 4);
});

test('private session lifecycle clears immediately on logout and discards queued restoration', () => {
  const h = appHarness(),
    cleared = [];
  let reloads = 0;
  const dispose = h.shop.watchPrivateSession({
    clear: (reason) => cleared.push(reason),
    reload: () => reloads++,
  });
  h.event('storage', { key: 'alyzyus-auth-sync', newValue: 'logout:1' });
  assert.deepEqual(cleared, ['storage']);
  assert.equal(h.timers, 0);
  h.event('pageshow', { persisted: true });
  assert.equal(h.timers, 1);
  h.event('pagehide');
  h.runTimers();
  assert.equal(reloads, 0);
  h.event('storage', { key: 'alyzyus-auth-sync', newValue: 'login:2' });
  h.visible(false);
  h.visible(false);
  h.runTimers();
  assert.equal(reloads, 1);
  h.visible(true);
  assert.equal(h.timers, 0);
  dispose();
  h.event('pagehide');
  assert.equal(cleared.length, 4);
});

test('account lifecycle preserves its own sign-up result while still clearing an expired session', () => {
  const h = appHarness(),
    cleared = [];
  h.shop.watchPrivateSession({
    clear: (reason) => cleared.push(reason),
    reload: () => {},
    ignoreLocalSignIn: true,
  });
  h.event('alyzyus:auth', { detail: { authenticated: false, reason: 'signup' } });
  h.event('alyzyus:auth', { detail: { authenticated: true, reason: 'login' } });
  assert.deepEqual(cleared, []);
  h.event('alyzyus:auth', { detail: { authenticated: false, reason: 'expired' } });
  assert.deepEqual(cleared, ['expired']);
});

function pageHarness(name) {
  const nodes = new Map(),
    calls = [];
  let lifecycle,
    clearedCart = 0;
  function element(id) {
    if (!nodes.has(id))
      nodes.set(id, {
        ...eventSurface(),
        id,
        innerHTML: '',
        value: '',
        hidden: false,
        disabled: false,
        open: false,
        dataset: {},
        style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => false,
        focus() {},
        close() {
          this.open = false;
        },
        reset() {
          for (const key of [
            'checkout-email',
            'checkout-name',
            'checkout-phone',
            'checkout-address',
            'checkout-coupon',
          ])
            element(key).value = '';
        },
      });
    return nodes.get(id);
  }
  const rootIds = {
    tracking: 'tracking-content',
    logs: 'activity-log',
    account: 'account-panel',
    admin: 'admin-root',
    checkout: 'checkout-form',
  };
  const shop = {
    locale: 'en',
    theme: 'light',
    configured: true,
    products: [product],
    cart: [{ product, quantity: 1 }],
    escape,
    t: (value) => (typeof value === 'string' ? value : value?.en || ''),
    icon: () => '',
    money: (value) => String(value ?? 0),
    shippingFor: () => 0,
    translate() {},
    toast() {},
    onChange() {},
    clearCart() {
      clearedCart++;
      shop.cart = [];
    },
    api: (url, options) =>
      new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
    watchPrivateSession: (callbacks) => {
      lifecycle = callbacks;
    },
  };
  const window = { Shop: shop, ...eventSurface() };
  const document = {
    ...eventSurface(),
    getElementById: element,
    activeElement: null,
    createElement: () => element('created'),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  class FormFields {
    get(key) {
      return element('checkout-' + key).value;
    }
  }
  vm.runInNewContext(
    sources[name],
    {
      window,
      document,
      location: {
        search: '',
        origin: 'https://alyzyus.example',
        href: 'https://alyzyus.example/' + name,
        assign() {},
      },
      history: { replaceState() {} },
      URL,
      URLSearchParams,
      FormData: FormFields,
      crypto: webcrypto,
      Blob,
      setTimeout,
      clearTimeout,
    },
    { filename: name + '.js' }
  );
  return {
    calls,
    shop,
    node: element,
    get html() {
      return element(rootIds[name]).innerHTML;
    },
    get clearedCart() {
      return clearedCart;
    },
    clear() {
      lifecycle.clear('logout');
    },
    reload() {
      return lifecycle.reload();
    },
    submit() {
      element(rootIds[name]).dispatchEvent({ type: 'submit', preventDefault() {} });
    },
  };
}

test('tracking discards an in-flight order response after logout', async () => {
  const h = pageHarness('tracking');
  h.calls.find((call) => call.url === '/api/auth/me').resolve({ user: customer });
  await settle();
  const pending = h.calls.find((call) => call.url === '/api/orders');
  h.clear();
  pending.resolve({ orders: [order] });
  await settle();
  assert.doesNotMatch(h.html, /ALY-PRIVATE-ORDER|private@example/);
  assert.match(h.html, /Sign in/);
});

test('activity logs clear existing rows, reject stale responses, and recover after admin signs in', async () => {
  const h = pageHarness('logs');
  const row = {
    id: '9007199254740993',
    action: 'private-audit-marker',
    category: 'order',
    actor_id: customer.id,
    source: 'database',
    details: {},
    created_at: order.created_at,
  };
  h.calls[0].resolve({ logs: [row] });
  await settle();
  assert.match(h.html, /private-audit-marker/);
  const loading = h.reload(),
    pending = h.calls.at(-1);
  h.clear();
  pending.reject(new Error('late network failure'));
  await loading;
  assert.doesNotMatch(h.html, /private-audit-marker/);
  assert.match(h.html, /Sign in as an admin/);
  const restored = h.reload();
  h.calls.at(-1).resolve({ logs: [row] });
  await restored;
  assert.match(h.html, /private-audit-marker/);
  assert.doesNotMatch(h.html, /Sign in as an admin/);
});

test('account never restores an old identity from a response received after logout', async () => {
  const h = pageHarness('account');
  h.clear();
  h.calls[0].resolve({ user: customer, configured: true });
  await settle();
  assert.doesNotMatch(h.html, /private@example/);
  assert.match(h.html, /Sign in/);
  const restored = h.reload();
  h.calls.at(-1).resolve({ user: customer, configured: true });
  await restored;
  assert.match(h.html, /private@example/);
  h.clear();
  assert.doesNotMatch(h.html, /private@example/);
});

test('admin cannot restore an earlier authorized dashboard after logout', async () => {
  const h = pageHarness('admin');
  h.clear();
  h.calls[0].resolve({ orders: [order], products: [product], configured: true });
  await settle();
  assert.doesNotMatch(h.html, /ALY-PRIVATE-ORDER|Private customer/);
  assert.match(h.html, /authorized administrator/);
  assert.equal(h.node('admin-dialog').innerHTML, '');
});

test('checkout clears recipient details and ignores an order response received after logout', async () => {
  const h = pageHarness('checkout');
  h.calls.find((call) => call.url === '/api/auth/me').resolve({ user: customer });
  h.calls
    .find((call) => call.url === '/api/settings')
    .resolve({ configured: true, payments: { cod: true } });
  await settle();
  h.node('checkout-address').value = 'Private address';
  h.submit();
  const pending = h.calls.find((call) => call.url === '/api/checkout');
  assert.ok(pending);
  h.clear();
  pending.resolve({ order });
  await settle();
  assert.equal(h.clearedCart, 0, 'a stale checkout must not clear the current bag');
  assert.equal(h.node('checkout-email').value, '');
  assert.equal(h.node('checkout-address').value, '');
  assert.equal(h.node('checkout-receipt').innerHTML, '');
  assert.equal(h.node('checkout-receipt').hidden, true);
});
