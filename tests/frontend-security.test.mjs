import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

const sourceFile = (name) => new URL(`../${name}`, import.meta.url);
const appSource = await readFile(sourceFile('public/static/js/app.js'), 'utf8');
const adminSource = await readFile(sourceFile('public/static/js/admin.js'), 'utf8');
const checkoutSource = await readFile(sourceFile('public/static/js/checkout.js'), 'utf8');
const simulation = await readFile(sourceFile('public/static/queue3d.html'), 'utf8');

test('checkout follows only HTTPS Stripe-hosted payment URLs without credentials or custom ports', () => {
  const validator = checkoutSource.match(/function safePaymentURL\(value\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(validator, 'Payment redirect validation must be explicit');
  const safePaymentURL = vm.runInNewContext(`(${validator})`, {
    URL,
    location: { origin: 'https://alyzyus.example' },
  });
  const approved = 'https://checkout.stripe.com/c/pay/cs_test_123#fidkdWxOYHwnPyd1blpxYHZxWjA0';
  assert.equal(safePaymentURL(approved), approved);
  assert.equal(
    safePaymentURL('https://checkout.stripe.com:443/c/pay/cs_test_123'),
    'https://checkout.stripe.com/c/pay/cs_test_123'
  );
  for (const value of [
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'http://checkout.stripe.com/c/pay/cs_test_123',
    'https://checkout.stripe.com.attacker.example/c/pay/cs_test_123',
    'https://checkout.stripe.com@attacker.example/c/pay/cs_test_123',
    'https://attacker.example@checkout.stripe.com/c/pay/cs_test_123',
    'https://checkout.stripe.com:8443/c/pay/cs_test_123',
    'https://attacker.example/pay',
    '/api/auth/logout',
    '',
    null,
  ]) {
    assert.equal(safePaymentURL(value), '', `unsafe checkout redirect: ${String(value)}`);
  }
});

test('cart renders hostile product text as text rather than new HTML attributes or elements', () => {
  const product = {
    id: 'safe-product',
    slug: 'normal-product',
    name: { en: '\"><img src=x onerror="alert(document.cookie)">' },
    images: ['\" onerror="alert(document.cookie)'],
    price: 100,
    stock: 1,
  };
  const cart = { innerHTML: '' };
  const window = {
    __SHOP__: { products: [product], configured: true },
    addEventListener() {},
  };
  vm.runInNewContext(appSource, {
    window,
    document: {
      documentElement: { dataset: {} },
      body: { style: {} },
      getElementById: (id) => (id === 'cart-content' ? cart : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage: {
      getItem: (key) =>
        key === 'alyzyus-locale'
          ? 'en'
          : key === 'alyzyus-cart'
            ? JSON.stringify([{ id: product.id, quantity: 1 }])
            : null,
      setItem() {},
    },
    setTimeout,
    clearTimeout,
  });
  assert.match(cart.innerHTML, /&lt;img src=x onerror=&quot;alert\(document.cookie\)&quot;&gt;/);
  assert.doesNotMatch(cart.innerHTML, /<img src=x|\sonerror="/);
  assert.match(cart.innerHTML, /href="\/product\/normal-product"/);
});

test('CSV export neutralizes spreadsheet formulas even after leading whitespace', () => {
  const expression = adminSource.match(/const safeCell = \(value\) =>([\s\S]*?),\s*rows = \[/)?.[1];
  assert.ok(expression, 'CSV export must keep its escaping helper auditable');
  const safeCell = vm.runInNewContext(`(value) => ${expression}`);
  for (const payload of ['=1+1', '+SUM(1,2)', '-2+3', '@SUM(1,2)', '\t =1+1', '\r\n@SUM(1,2)']) {
    assert.ok(
      safeCell(payload).startsWith('"\''),
      `formula must be inert: ${JSON.stringify(payload)}`
    );
  }
  assert.equal(safeCell('Customer "A"'), '"Customer ""A"""');
  assert.equal(safeCell(null), '""');
});

test('the standalone 3D library is pinned by integrity and sends no page referrer to the CDN', () => {
  const source = simulation.match(/<script(?:\s[^>]*)?>([\s\S]+)<\/script>/)?.[1];
  assert.ok(source);
  class Element {
    constructor() {
      this.style = {};
      this.classList = { toggle() {}, add() {}, remove() {} };
      this.children = [];
    }
    addEventListener() {}
    setAttribute() {}
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    querySelector() {
      return new Element();
    }
  }
  const nodes = new Map();
  let library;
  vm.runInNewContext(source, {
    window: { addEventListener() {} },
    document: {
      documentElement: new Element(),
      body: new Element(),
      head: { append: (node) => (library = node) },
      getElementById: (id) => {
        if (!nodes.has(id)) nodes.set(id, new Element());
        return nodes.get(id);
      },
      querySelectorAll: () => [],
      createElement: () => new Element(),
      createTextNode: (text) => ({ textContent: text }),
    },
    location: { search: '', protocol: 'file:' },
    localStorage: { getItem: () => null },
    URLSearchParams,
    performance: { now: () => 0 },
  });
  assert.equal(library.src, 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js');
  assert.equal(
    library.integrity,
    'sha512-vnmn/Qqn6aG0POAc9mIGzjq0IybrvxJXYDafNvp9JSnDGxeF3pbkSqLvf+YGd5ku63pT7sa/jxHn7/d0mU8+tA=='
  );
  assert.equal(library.crossOrigin, 'anonymous');
  assert.equal(library.referrerPolicy, 'no-referrer');
});

test('page markup has no inline event handlers that require weakening script CSP', async () => {
  const templates = await readdir(sourceFile('templates/'));
  const files = [
    ...templates.filter((file) => file.endsWith('.html')).map((file) => `templates/${file}`),
    'public/static/queue3d.html',
    'public/offline.html',
  ];
  for (const file of files) {
    const html = await readFile(sourceFile(file), 'utf8');
    assert.doesNotMatch(html, /<[^>]*\son[a-z]+\s*=/i, file);
  }
});
