import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/static/js/demo.js', import.meta.url), 'utf8');
const { DemoSession, DEMO_STAGES } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const products = [
  {
    id: 'a',
    name: { th: 'ตัวอย่าง A', en: 'Fixture A', zh: '示例 A' },
    price: 100,
    stock: 3,
    images: [],
  },
  {
    id: 'b',
    name: { th: 'ตัวอย่าง B', en: 'Fixture B', zh: '示例 B' },
    price: 2500,
    stock: 2,
    images: [],
  },
];

test('demo cart and orders reserve only copied in-memory fixture stock', () => {
  const original = structuredClone(products);
  const demo = new DemoSession(products);
  assert.equal(demo.orders[0].number, 'DEMO-1001');
  assert.equal(demo.product('a').stock, 2);
  assert.deepEqual(products, original);
  assert.equal(demo.add('missing'), false);
  assert.equal(demo.add('a'), true);
  assert.equal(demo.add('a'), true);
  assert.equal(demo.add('a'), false);
  assert.deepEqual(demo.totals(), { subtotal: 200, shipping: 80, total: 280 });
  const order = demo.placeOrder();
  assert.equal(order.number, 'DEMO-1002');
  assert.equal(order.status, 'pending');
  assert.equal(demo.product('a').stock, 0);
  assert.equal(demo.cart.size, 0);
  assert.equal(demo.placeOrder(), null);
  assert.equal(demo.add('a'), false);
  assert.deepEqual(products, original);
});

test('demo totals, manual state transitions and reset follow the stated walkthrough', () => {
  const demo = new DemoSession(products);
  demo.add('b');
  assert.deepEqual(demo.totals(), { subtotal: 2500, shipping: 0, total: 2500 });
  const order = demo.placeOrder();
  for (const stage of DEMO_STAGES.slice(1)) {
    assert.equal(demo.advance(order.number), true);
    assert.equal(order.status, stage);
  }
  assert.equal(demo.advance(order.number), false);
  assert.equal(demo.advance('not-an-order'), false);
  assert.equal(demo.product('b').stock, 1);
  demo.question('Fictional demo question');
  demo.reset();
  assert.equal(demo.orders.length, 1);
  assert.equal(demo.orders[0].number, 'DEMO-1001');
  assert.equal(demo.product('b').stock, 2);
  assert.equal(demo.tickets.length, 0);
  assert.equal(demo.cart.size, 0);
});

test('demo questions are bounded text and browser module has no production mutation or storage access', () => {
  const demo = new DemoSession(products);
  assert.equal(demo.question('x'), null);
  assert.equal(demo.question('x'.repeat(301)), null);
  const malicious = '<img src=x onerror=alert(1)>';
  assert.equal(demo.question(malicious).text, malicious);
  for (let i = 0; i < 4; i++) assert.ok(demo.question('Fictional request ' + i));
  assert.equal(demo.question('sixth fictional request'), null);
  for (const forbidden of [
    'fetch(',
    'XMLHttpRequest',
    'localStorage.',
    'sessionStorage.',
    'indexedDB.',
    '.innerHTML',
    'document.cookie',
    '/api/',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.ok(source.includes('element.textContent = value'));
});

test('browse-only checkout refuses submit even when account and payment settings are live', async () => {
  const checkout = await readFile(
    new URL('../public/static/js/checkout.js', import.meta.url),
    'utf8'
  );
  const callback = checkout.match(
    /form\.addEventListener\('submit', (async \(event\) => \{[\s\S]*?)\n  \}\);/
  )?.[1];
  assert.ok(callback);
  const shop = { configured: false, cart: [{ product: { id: 'sample' }, quantity: 1 }] };
  let readForm = 0;
  const submit = vm.runInNewContext(`(${callback}\n})`, {
    S: shop,
    busy: false,
    user: { id: 'verified-fixture' },
    settings: { configured: true, payments: { cod: true } },
    method: 'cod',
    sessionEpoch: 0,
    form: {},
    FormData: class {
      constructor() {
        readForm++;
        throw new Error('form-data-boundary');
      }
    },
  });
  await submit({ preventDefault() {} });
  assert.equal(readForm, 0, 'fallback must stop before reading recipient/payment fields');
  shop.configured = true;
  await assert.rejects(submit({ preventDefault() {} }), /form-data-boundary/);
  assert.equal(readForm, 1, 'live checkout still reaches the normal form validation');
});
