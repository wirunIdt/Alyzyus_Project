import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sources = Object.fromEntries(
  await Promise.all(
    ['admin', 'tracking'].map(async (name) => [
      name,
      await readFile(new URL(`../public/static/js/${name}.js`, import.meta.url), 'utf8'),
    ])
  )
);
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const order = {
  id: ORDER_ID,
  order_number: 'ALY-SERVICE-LINKED',
  status: 'pending',
  payment_status: 'pending',
  payment_method: 'cod',
  customer_name: 'Authorized customer',
  email: 'private@example.test',
  phone: '123456789',
  address: 'Private address',
  created_at: '2026-10-17T09:00:00Z',
  items: [],
  total: 100,
  subtotal: 100,
  shipping: 0,
  discount: 0,
};
const settle = async () => {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
};
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );

function harness(name, search = '') {
  const nodes = new Map(),
    calls = [];
  let lifecycle;
  function element(id) {
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        innerHTML: '',
        value: '',
        open: false,
        addEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => false,
        classList: { add() {}, remove() {}, toggle() {} },
        focus() {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
      });
    return nodes.get(id);
  }
  const shop = {
    locale: 'en',
    configured: true,
    products: [],
    escape,
    t: (value) => (typeof value === 'string' ? value : value?.en || ''),
    icon: () => '',
    money: (value) => String(value ?? 0),
    onChange() {},
    toast() {},
    api: (url, options) =>
      new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
    watchPrivateSession(callbacks) {
      lifecycle = callbacks;
    },
  };
  const document = {
    getElementById: element,
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  vm.runInNewContext(
    sources[name],
    {
      window: { Shop: shop },
      document,
      location: { search, origin: 'https://alyzyus.example' },
      URL,
      URLSearchParams,
      console,
    },
    { filename: name + '.js' }
  );
  return {
    calls,
    node: element,
    clear: () => lifecycle.clear('logout'),
    reload: () => lifecycle.reload(),
    get html() {
      return element(name === 'admin' ? 'admin-root' : 'tracking-list').innerHTML;
    },
    get modal() {
      return element('admin-dialog');
    },
  };
}

test('an admin order handoff waits for authorized data and opens only the matching loaded order', async () => {
  const h = harness('admin', '?order=' + ORDER_ID);
  assert.equal(h.modal.open, false);
  assert.doesNotMatch(h.modal.innerHTML, /ALY-SERVICE-LINKED|private@example/);
  h.calls[0].resolve({ orders: [order], products: [], configured: true });
  await settle();
  assert.equal(h.modal.open, true);
  assert.match(h.modal.innerHTML, /ALY-SERVICE-LINKED/);
  assert.match(h.modal.innerHTML, /private@example/);
  assert.equal(h.calls.length, 1, 'the handoff adds no broad or privileged order endpoint');
  h.clear();
  assert.equal(h.modal.open, false);
  assert.equal(h.modal.innerHTML, '');
  assert.doesNotMatch(h.html, /ALY-SERVICE-LINKED|private@example/);
});

test('an order outside the loaded admin scope gets a clear notice and never a made-up detail', async () => {
  const h = harness('admin', '?order=' + OTHER_ID);
  h.calls[0].resolve({ orders: [order], products: [], configured: true, totalOrderCount: 700 });
  await settle();
  assert.equal(h.modal.open, false);
  assert.equal(h.modal.innerHTML, '');
  assert.match(h.html, /linked order is not in the store/);
  assert.match(h.html, /href="\/admin\/support"/);
  const loading = h.reload();
  h.calls.at(-1).resolve({ orders: [{ ...order, id: OTHER_ID }], products: [], configured: true });
  await loading;
  assert.equal(h.modal.open, true);
  assert.doesNotMatch(h.html, /linked order is not in the store/);
});

test('logout invalidates an in-flight admin handoff before it can open private details', async () => {
  const h = harness('admin', '?order=' + ORDER_ID);
  h.clear();
  h.calls[0].resolve({ orders: [order], products: [], configured: true });
  await settle();
  assert.equal(h.modal.open, false);
  assert.equal(h.modal.innerHTML, '');
  assert.doesNotMatch(h.html, /ALY-SERVICE-LINKED|private@example/);
});

test('tracking opens the linked owned order and offers service and 3D links from verified data', async () => {
  const h = harness('tracking', '?order=' + ORDER_ID);
  h.calls.find((call) => call.url === '/api/auth/me').resolve({ user: { id: 'current-user' } });
  await settle();
  h.calls
    .find((call) => call.url === '/api/orders')
    .resolve({ orders: [{ ...order, id: OTHER_ID, order_number: 'ALY-OTHER' }, order] });
  await settle();
  assert.match(h.html, new RegExp(`href="/support\\?order=${ORDER_ID}"`));
  assert.match(h.html, new RegExp(`href="/simulation\\?mode=product&order=${ORDER_ID}"`));
  assert.doesNotMatch(h.html, new RegExp(`href="/support\\?order=${OTHER_ID}"`));
  h.clear();
  assert.doesNotMatch(
    h.node('tracking-content').innerHTML,
    /ALY-SERVICE-LINKED|private@example|\/support\?order=/
  );
  assert.match(h.node('tracking-content').innerHTML, /Sign in/);
});

test('a foreign URL cannot invent an order or a customer-service handoff', async () => {
  const h = harness('tracking', '?order=' + OTHER_ID);
  h.calls.find((call) => call.url === '/api/auth/me').resolve({ user: { id: 'current-user' } });
  await settle();
  h.calls.find((call) => call.url === '/api/orders').resolve({ orders: [order] });
  await settle();
  assert.match(h.html, new RegExp(`href="/support\\?order=${ORDER_ID}"`));
  assert.doesNotMatch(h.html, new RegExp(`href="/support\\?order=${OTHER_ID}"`));
  assert.doesNotMatch(h.html, /localStorage|sessionStorage/);
});
