import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../public/static/js/support.js', import.meta.url), 'utf8');
const settle = async () => {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
};
const customer = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'customer',
  emailVerified: true,
};
const ticket = {
  id: '9007199254740993',
  ticket_number: 'ALY-CS-9007199254740993',
  subject: '<img src=x onerror=alert(1)>',
  category: 'order',
  status: 'open',
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
};

function harness(admin = false, search = '') {
  const rootEvents = new Map(),
    windowEvents = new Map(),
    calls = [],
    timers = new Map();
  let timerId = 0;
  const root = {
    dataset: { adminMode: String(admin) },
    innerHTML: '',
    setAttribute() {},
    addEventListener: (name, callback) => rootEvents.set(name, callback),
    querySelector: () => null,
  };
  const window = {
    Shop: {
      locale: 'en',
      escape: (value) =>
        String(value ?? '').replace(
          /[&<>"']/g,
          (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
        ),
      t: (value) => value.en,
      icon: () => '<svg></svg>',
      api: (url, options) =>
        new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
      onChange() {},
    },
    addEventListener: (name, callback) => windowEvents.set(name, callback),
  };
  const context = {
    window,
    document: {
      getElementById: (id) => (id === 'support-app' ? root : null),
      addEventListener() {},
      hidden: false,
    },
    location: {
      search,
      href: `https://alyzyus.example/${admin ? 'admin/support' : 'support'}${search}`,
    },
    history: { replaceState() {} },
    crypto: webcrypto,
    URL,
    URLSearchParams,
    Intl,
    Date,
    BigInt,
    setTimeout: (callback) => {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(source, context, { filename: 'support.js' });
  return {
    calls,
    get html() {
      return root.innerHTML;
    },
    event(name, value) {
      windowEvents.get(name)?.(value);
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    click(attribute, value = '') {
      const target = {
        disabled: false,
        dataset: {
          [attribute
            .replace(/^data-/, '')
            .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]: value,
        },
        hasAttribute: (key) => key === attribute,
      };
      return rootEvents.get('click')({ target: { closest: () => target } });
    },
    input(name, value, form = 'support-create-form') {
      rootEvents.get('input')({
        target: { name, value, id: name === 'reply' ? 'support-reply' : '', form: { id: form } },
      });
    },
    submit(id) {
      rootEvents.get('submit')({ target: { id }, preventDefault() {} });
    },
  };
}
async function signIn(h, user = customer) {
  h.calls[0].resolve({ user });
  await settle();
  if (user?.emailVerified && (user.role !== 'admin' || h.calls.at(-1).url === '/api/orders')) {
    if (h.calls.at(-1).url === '/api/orders') {
      h.calls.at(-1).resolve({ orders: [] });
      await settle();
    }
  }
  const list = h.calls.find(
    (call) =>
      call.url.startsWith('/api/support/tickets?') ||
      call.url.startsWith('/api/admin/support/tickets?')
  );
  if (list) {
    list.resolve({ tickets: [ticket], nextCursor: null });
    await settle();
  }
}

test('guests see explicit sign-in and registration links without loading private tickets', async () => {
  const h = harness();
  h.calls[0].resolve({ user: null });
  await settle();
  assert.match(h.html, /Create an account/);
  assert.match(h.html, /next=\/support/);
  assert.equal(h.calls.length, 1);
});

test('customer text is escaped and bigint ticket IDs keep their exact value', async () => {
  const h = harness();
  await signIn(h);
  assert.match(h.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(h.html, /<img src=x/);
  const opened = h.click('data-support-ticket', ticket.id);
  assert.match(h.calls.at(-1).url, /9007199254740993\?limit=40/);
  h.calls.at(-1).resolve({
    ticket,
    messages: [
      {
        id: '9007199254740996',
        author_role: 'staff',
        body: '<script>private</script>',
        created_at: ticket.created_at,
      },
    ],
    nextCursor: null,
  });
  await opened;
  assert.match(h.html, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.match(h.html, /Alyzyus store team/);
});

test('failed submissions preserve drafts and reuse the same idempotency key on retry', async () => {
  const h = harness();
  await signIn(h);
  await h.click('data-support-new');
  h.input('subject', 'Please help with my order');
  h.input('message', 'The order has not arrived yet.');
  h.submit('support-create-form');
  const initial = h.calls.at(-1);
  h.submit('support-create-form');
  assert.equal(h.calls.at(-1), initial, 'double submit must not make another request');
  initial.reject(new Error('offline'));
  await settle();
  assert.match(h.html, /Please help with my order/);
  assert.match(h.html, /The order has not arrived yet/);
  h.submit('support-create-form');
  const retry = h.calls.at(-1);
  assert.equal(retry.options.body.idempotencyKey, initial.options.body.idempotencyKey);
  assert.equal(retry.options.body.orderId, null);
  retry.reject(new Error('offline'));
  await settle();
});

test('edited create conflict requires review and explicit new ID before a separate request can succeed', async () => {
  const h = harness();
  await signIn(h);
  await h.click('data-support-new');
  h.input('subject', 'Please help with my order');
  h.input('message', 'The original request may already be saved.');
  h.submit('support-create-form');
  const original = h.calls.at(-1);
  original.reject(new Error('response lost'));
  await settle();
  h.input('subject', 'A separate question about my order');
  h.input('message', 'This edited request needs a separate answer.');
  h.submit('support-create-form');
  const conflict = h.calls.at(-1);
  assert.equal(conflict.options.body.idempotencyKey, original.options.body.idempotencyKey);
  conflict.reject(
    Object.assign(new Error('already used'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  );
  await settle();
  assert.match(h.html, /Prepare a separate request/);
  let count = h.calls.length;
  await h.click('data-support-renew', 'create');
  h.submit('support-create-form');
  assert.equal(
    h.calls.length,
    count,
    'no new UUID or submission before reviewing existing requests'
  );
  const checked = h.click('data-support-check-conflict', 'create');
  assert.match(h.calls.at(-1).url, /status=all/);
  h.calls.at(-1).resolve({ tickets: [ticket], nextCursor: null });
  await checked;
  count = h.calls.length;
  await h.click('data-support-renew', 'create');
  assert.equal(h.calls.length, count, 'preparing a new ID must not submit automatically');
  assert.match(h.html, /Nothing has been sent/);
  assert.match(h.html, /This edited request needs a separate answer/);
  h.submit('support-create-form');
  const separated = h.calls.at(-1);
  assert.notEqual(separated.options.body.idempotencyKey, original.options.body.idempotencyKey);
  assert.equal(separated.options.body.message, 'This edited request needs a separate answer.');
  const created = {
    ...ticket,
    id: '9007199254740994',
    ticket_number: 'ALY-CS-NEW',
    subject: 'A separate question about my order',
  };
  separated.resolve({ ticket: created });
  await settle();
  h.calls.at(-1).resolve({ tickets: [created, ticket], nextCursor: null });
  await settle();
  h.calls.at(-1).resolve({
    ticket: created,
    messages: [
      {
        id: '9007199254741000',
        author_role: 'customer',
        body: separated.options.body.message,
        created_at: ticket.created_at,
      },
    ],
  });
  await settle();
  assert.match(h.html, /ALY-CS-NEW/);
  assert.match(h.html, /Saved\./);
});

test('edited reply conflict preserves draft and needs review plus explicit new message ID', async () => {
  const h = harness();
  await signIn(h);
  const opened = h.click('data-support-ticket', ticket.id);
  h.calls.at(-1).resolve({ ticket, messages: [], nextCursor: null });
  await opened;
  h.input('reply', 'My first reply may already be saved.', 'support-reply-form');
  h.submit('support-reply-form');
  const original = h.calls.at(-1);
  original.reject(new Error('response lost'));
  await settle();
  h.input('reply', 'This edited reply is a separate clarification.', 'support-reply-form');
  h.submit('support-reply-form');
  const conflict = h.calls.at(-1);
  assert.equal(conflict.options.body.idempotencyKey, original.options.body.idempotencyKey);
  conflict.reject(
    Object.assign(new Error('already used'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  );
  await settle();
  assert.match(h.html, /Prepare a separate message/);
  let count = h.calls.length;
  await h.click('data-support-renew', 'reply');
  h.submit('support-reply-form');
  assert.equal(h.calls.length, count);
  const checked = h.click('data-support-check-conflict', 'reply');
  h.calls.at(-1).resolve({ tickets: [ticket], nextCursor: null });
  await settle();
  h.calls.at(-1).resolve({
    ticket,
    messages: [
      {
        id: '1',
        author_role: 'customer',
        body: 'My first reply may already be saved.',
        created_at: ticket.created_at,
      },
    ],
  });
  await checked;
  assert.match(h.html, /This edited reply is a separate clarification/);
  count = h.calls.length;
  await h.click('data-support-renew', 'reply');
  assert.equal(h.calls.length, count);
  h.submit('support-reply-form');
  const separated = h.calls.at(-1);
  assert.notEqual(separated.options.body.idempotencyKey, original.options.body.idempotencyKey);
  assert.equal(separated.options.body.message, 'This edited reply is a separate clarification.');
  separated.resolve({ ticket, message: { id: '2' } });
  await settle();
  h.calls.at(-1).resolve({ tickets: [ticket], nextCursor: null });
  await settle();
  h.calls.at(-1).resolve({
    ticket,
    messages: [
      {
        id: '2',
        author_role: 'customer',
        body: separated.options.body.message,
        created_at: ticket.created_at,
      },
    ],
  });
  await settle();
  assert.match(h.html, /Saved\./);
});

test('cross-tab logout clears private data immediately and ignores in-flight responses', async () => {
  const h = harness();
  await signIn(h);
  const opened = h.click('data-support-ticket', ticket.id),
    detail = h.calls.at(-1),
    count = h.calls.length;
  h.event('storage', { key: 'alyzyus-auth-sync', newValue: 'logout:nonce' });
  assert.match(h.html, /Create an account/);
  assert.doesNotMatch(h.html, /ALY-CS-/);
  h.runTimers();
  assert.equal(h.calls.length, count, 'must not race cookies still being removed');
  detail.resolve({
    ticket,
    messages: [
      {
        id: '1',
        author_role: 'customer',
        body: 'private customer message',
        created_at: ticket.created_at,
      },
    ],
  });
  await opened;
  assert.doesNotMatch(h.html, /private customer message|ALY-CS-/);
});

test('admin pages deny customer roles without requesting the admin inbox', async () => {
  const h = harness(true);
  h.calls[0].resolve({ user: customer });
  await settle();
  assert.match(h.html, /This space is for store admins/);
  assert.equal(h.calls.length, 1);
});

test('back-forward cache snapshots are cleared before parking private conversations', async () => {
  const h = harness();
  await signIn(h);
  h.event('pagehide', { persisted: true });
  assert.doesNotMatch(h.html, /ALY-CS-/);
  h.event('pageshow', { persisted: true });
  h.runTimers();
  assert.equal(h.calls.at(-1).url, '/api/auth/me');
  h.calls.at(-1).resolve({ user: null });
  await settle();
  assert.match(h.html, /Create an account/);
});
