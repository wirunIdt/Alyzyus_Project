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
    timers = new Map(),
    nodes = new Map(),
    attributes = new Map();
  let timerId = 0;
  const root = {
    dataset: { adminMode: String(admin) },
    innerHTML: '',
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener: (name, callback) => rootEvents.set(name, callback),
    contains: (node) => [...nodes.values()].includes(node),
    querySelector: (selector) => nodes.get(selector) || null,
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
      money: (value) => `THB ${Number(value).toFixed(2)}`,
      api: (url, options) =>
        new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
      onChange() {},
    },
    addEventListener: (name, callback) => windowEvents.set(name, callback),
  };
  const context = {
    window,
    document: {
      getElementById: (id) => (id === 'support-app' ? root : nodes.get(id) || null),
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
    get busy() {
      return attributes.get('aria-busy') === 'true';
    },
    event(name, value) {
      windowEvents.get(name)?.(value);
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    node(id, value) {
      nodes.set(id, value);
    },
    focus(node) {
      context.document.activeElement = node;
    },
    mobile() {
      window.matchMedia = () => ({ matches: true });
    },
    change(id, value) {
      return rootEvents.get('change')({ target: { id, value } });
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
async function signIn(h, user = customer, ownOrders = []) {
  h.calls[0].resolve({ user });
  await settle();
  if (user?.emailVerified && (user.role !== 'admin' || h.calls.at(-1).url === '/api/orders')) {
    if (h.calls.at(-1).url === '/api/orders') {
      h.calls.at(-1).resolve({ orders: ownOrders });
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

test('request search waits for submit, combines category filters, and passes opaque activity cursors unchanged', async () => {
  const h = harness();
  await signIn(h);
  assert.match(h.html, /latest activity first/);
  const before = h.calls.length;
  h.input('ticketSearch', ' aly-s-123 ', 'support-search-form');
  assert.equal(h.calls.length, before, 'typing must not fetch on each key');
  h.submit('support-search-form');
  let call = h.calls.at(-1);
  assert.equal(new URL(call.url, 'https://example.test').searchParams.get('q'), 'ALY-S-123');
  call.resolve({ tickets: [ticket], nextCursor: 'v1:activity+stamp/9007199254740993=' });
  await settle();
  const more = h.click('data-support-more');
  call = h.calls.at(-1);
  let params = new URL(call.url, 'https://example.test').searchParams;
  assert.equal(params.get('cursor'), 'v1:activity+stamp/9007199254740993=');
  assert.equal(params.get('q'), 'ALY-S-123');
  call.resolve({ tickets: [], nextCursor: null });
  await more;
  h.change('support-category-filter', 'payment');
  call = h.calls.at(-1);
  params = new URL(call.url, 'https://example.test').searchParams;
  assert.equal(params.get('category'), 'payment');
  assert.equal(params.get('q'), 'ALY-S-123');
  assert.equal(params.has('cursor'), false, 'changing filters starts a new page');
  call.resolve({ tickets: [], nextCursor: null });
  await settle();
  const cleared = h.click('data-support-clear-search');
  call = h.calls.at(-1);
  params = new URL(call.url, 'https://example.test').searchParams;
  assert.equal(params.has('q'), false);
  assert.equal(params.get('category'), 'payment');
  call.resolve({ tickets: [], nextCursor: null });
  await cleared;
});

test('invalid request searches stay local and numeric request numbers are accepted', async () => {
  const h = harness();
  await signIn(h);
  const before = h.calls.length;
  h.input('ticketSearch', '<private subject>', 'support-search-form');
  h.submit('support-search-form');
  assert.equal(h.calls.length, before);
  assert.match(h.html, /Use a request number/);
  assert.doesNotMatch(h.html, /<private subject>/);
  h.input('ticketSearch', '123', 'support-search-form');
  h.submit('support-search-form');
  assert.equal(new URL(h.calls.at(-1).url, 'https://example.test').searchParams.get('q'), '123');
  h.calls.at(-1).resolve({ tickets: [], nextCursor: null });
  await settle();
});

test('stale status changes preserve drafts and require a successful refresh before an explicit retry', async () => {
  const h = harness();
  await signIn(h);
  const opened = h.click('data-support-ticket', ticket.id);
  h.calls.at(-1).resolve({ ticket, messages: [], nextCursor: null });
  await opened;
  h.input('reply', 'Keep this private draft while checking newer messages.', 'support-reply-form');
  const changed = h.click('data-support-action', 'resolve');
  const stale = h.calls.at(-1);
  assert.equal(stale.options.body.expectedUpdatedAt, ticket.updated_at);
  stale.reject(Object.assign(new Error('stale'), { code: 'SUPPORT_STALE', status: 409 }));
  await changed;
  const count = h.calls.length;
  assert.match(h.html, /This conversation changed/);
  assert.match(h.html, /Keep this private draft/);
  await h.click('data-support-action', 'resolve');
  assert.equal(h.calls.length, count, 'never automatically repeat a stale action');
  const refreshed = h.click('data-support-refresh');
  h.calls.at(-1).resolve({ tickets: [ticket], nextCursor: null });
  await settle();
  const latest = { ...ticket, updated_at: '2026-10-17T09:30:00Z' };
  h.calls.at(-1).resolve({ ticket: latest, messages: [], nextCursor: null });
  await refreshed;
  assert.match(h.html, /Keep this private draft/);
  const retried = h.click('data-support-action', 'resolve');
  const retry = h.calls.at(-1);
  assert.equal(retry.options.body.expectedUpdatedAt, latest.updated_at);
  retry.resolve({ ticket: { ...latest, status: 'resolved' } });
  await settle();
  h.calls.at(-1).resolve({ tickets: [{ ...latest, status: 'resolved' }], nextCursor: null });
  await retried;
});

test('guests keep only valid ticket and order context through sign-in links', async () => {
  const orderId = '22222222-2222-4222-8222-222222222222';
  const h = harness(false, `?ticket=${ticket.id}&order=${orderId}&next=https://evil.example`);
  h.calls[0].resolve({ user: null });
  await settle();
  assert.match(h.html, new RegExp(`next=%2Fsupport%3Fticket%3D${ticket.id}%26order%3D${orderId}`));
  assert.doesNotMatch(h.html, /evil\.example/);
  assert.equal(h.calls.length, 1);
});

test('order context preselects only an order returned for the authenticated customer and never submits it', async () => {
  const ownId = '22222222-2222-4222-8222-222222222222';
  const h = harness(false, `?order=${ownId}`);
  await signIn(h, customer, [{ id: ownId, order_number: 'ALY-ORDER-OWN' }]);
  assert.match(h.html, new RegExp(`<option value="${ownId}" selected`));
  assert.match(h.html, /What can we help with/);
  assert.equal(h.calls.filter((call) => call.options?.method === 'POST').length, 0);
  const denied = harness(false, '?order=33333333-3333-4333-8333-333333333333');
  await signIn(denied, customer, [{ id: ownId, order_number: 'ALY-ORDER-OWN' }]);
  assert.doesNotMatch(denied.html, /id="support-create-form"/);
  await denied.click('data-support-new');
  assert.doesNotMatch(denied.html, /33333333-3333-4333-8333-333333333333/);
});

test('related-order summaries are lazy, escaped, and link to the exact order for customers and admins', async () => {
  const orderId = '22222222-2222-4222-8222-222222222222';
  const linked = { ...ticket, order_id: orderId };
  for (const admin of [false, true]) {
    const h = harness(admin);
    await signIn(h, { ...customer, role: admin ? 'admin' : 'customer' });
    assert.equal(
      h.calls.some((call) => call.url.endsWith('/order')),
      false
    );
    const opened = h.click('data-support-ticket', ticket.id);
    h.calls.at(-1).resolve({ ticket: linked, messages: [], nextCursor: null });
    await opened;
    const summary = h.calls.at(-1);
    assert.equal(summary.url, `/api/${admin ? 'admin/' : ''}support/tickets/${ticket.id}/order`);
    summary.resolve({
      order: {
        id: orderId,
        order_number: '<ORDER>',
        status: 'shipped',
        payment_status: 'paid',
        total: 1290,
        currency: 'THB',
        carrier: '<Carrier>',
        tracking_number: '<TRACK>',
      },
    });
    await settle();
    assert.match(h.html, /&lt;ORDER&gt;/);
    assert.match(h.html, /Shipped · Paid/);
    assert.match(h.html, /THB 1290\.00/);
    assert.match(h.html, new RegExp(`href="/${admin ? 'admin' : 'tracking'}\\?order=${orderId}"`));
    assert.match(h.html, /mode=product&amp;order=/);
    assert.doesNotMatch(h.html, /<ORDER>|<Carrier>|<TRACK>/);
  }
});

test('related-order responses cannot repaint private data after a logout or ticket switch', async () => {
  const orderId = '22222222-2222-4222-8222-222222222222';
  const h = harness();
  await signIn(h);
  const opened = h.click('data-support-ticket', ticket.id);
  h.calls
    .at(-1)
    .resolve({ ticket: { ...ticket, order_id: orderId }, messages: [], nextCursor: null });
  await opened;
  const summary = h.calls.at(-1);
  const switched = h.click('data-support-ticket', '2');
  h.calls.at(-1).resolve({
    ticket: { ...ticket, id: '2', ticket_number: 'ALY-S-2' },
    messages: [],
    nextCursor: null,
  });
  await switched;
  summary.resolve({ order: { id: orderId, order_number: 'PRIVATE-ORDER-NUMBER', total: 1 } });
  await settle();
  assert.doesNotMatch(h.html, /PRIVATE-ORDER-NUMBER/);
  const linkedAgain = h.click('data-support-ticket', ticket.id);
  h.calls
    .at(-1)
    .resolve({ ticket: { ...ticket, order_id: orderId }, messages: [], nextCursor: null });
  await linkedAgain;
  const late = h.calls.at(-1);
  h.event('storage', { key: 'alyzyus-auth-sync', newValue: 'logout:nonce' });
  late.resolve({ order: { id: orderId, order_number: 'PRIVATE-AFTER-LOGOUT', total: 1 } });
  await settle();
  assert.doesNotMatch(h.html, /PRIVATE-AFTER-LOGOUT/);
  assert.match(h.html, /Create an account/);
});

test('prepending earlier messages preserves the reading position', async () => {
  const h = harness();
  await signIn(h);
  const thread = {
    scrollTop: 0,
    get scrollHeight() {
      return (h.html.match(/class="support-message /g) || []).length * 100;
    },
  };
  h.node('.support-thread', thread);
  const message = (id) => ({
    id: String(id),
    author_role: 'customer',
    body: `Message ${id}`,
    created_at: ticket.created_at,
  });
  const opened = h.click('data-support-ticket', ticket.id);
  h.calls.at(-1).resolve({ ticket, messages: [message(3), message(4)], nextCursor: '3' });
  await opened;
  thread.scrollTop = 35;
  const earlier = h.click('data-support-message-more');
  h.calls.at(-1).resolve({ ticket, messages: [message(2)], nextCursor: '2' });
  await earlier;
  assert.equal(
    thread.scrollTop,
    135,
    'preserve the same message under the reader after prepending'
  );
});

test('loading older messages cannot acknowledge a newer conversation revision for a status change', async () => {
  const h = harness();
  await signIn(h);
  const opened = h.click('data-support-ticket', ticket.id);
  h.calls.at(-1).resolve({ ticket, messages: [], nextCursor: '5' });
  await opened;
  const earlier = h.click('data-support-message-more');
  h.calls.at(-1).resolve({
    ticket: { ...ticket, updated_at: '2026-10-17T09:30:00Z' },
    messages: [
      {
        id: '4',
        author_role: 'customer',
        body: 'An earlier message.',
        created_at: ticket.created_at,
      },
    ],
    nextCursor: null,
  });
  await earlier;
  assert.match(h.html, /This conversation changed/);
  const count = h.calls.length;
  await h.click('data-support-action', 'resolve');
  assert.equal(h.calls.length, count, 'a full latest-message refresh is required first');
});

test('mobile selection reveals the conversation without enabling continuous animation', async () => {
  const h = harness();
  await signIn(h);
  h.mobile();
  let focusOptions = null,
    scrollOptions = null;
  h.node('support-conversation-title', {
    focus: (options) => {
      focusOptions = options;
    },
    closest: () => ({
      scrollIntoView: (options) => {
        scrollOptions = options;
      },
    }),
  });
  const opened = h.click('data-support-ticket', ticket.id);
  h.calls.at(-1).resolve({ ticket, messages: [], nextCursor: null });
  await opened;
  assert.equal(focusOptions.preventScroll, true);
  assert.equal(scrollOptions.block, 'start');
  assert.equal(scrollOptions.behavior, 'auto');
});

test('keyboard focus and caret return after a temporarily disabled search input is replaced', async () => {
  const h = harness();
  await signIn(h);
  const caret = [];
  const input = {
    id: 'support-search',
    selectionStart: 2,
    selectionEnd: 2,
    get disabled() {
      return h.busy;
    },
    focus() {
      h.focus(input);
    },
    setSelectionRange(start, end) {
      caret.push([start, end]);
    },
  };
  h.node(input.id, input);
  h.focus(input);
  h.input('ticketSearch', '123', 'support-search-form');
  h.submit('support-search-form');
  // เมื่อ DOM เดิมถูกแทนที่ เบราว์เซอร์จะคืน focus ให้ body จนช่องค้นหาใช้งานได้อีกครั้ง
  h.focus({});
  h.calls.at(-1).resolve({ tickets: [ticket], nextCursor: null });
  await settle();
  assert.deepEqual(caret.at(-1), [2, 2]);
});
