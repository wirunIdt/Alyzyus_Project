import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../public/static/queue3d.html', import.meta.url));
const html = fs.readFileSync(file, 'utf8');
const source = html.match(/<script>([\s\S]+)<\/script>/)[1];
new vm.Script(source);

class Element {
  constructor() {
    this.style = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
    this.children = [];
    this.textContent = '';
    this.hidden = false;
    this.value = '';
  }
  replaceChildren(...children) {
    this.children = children;
  }
  append(...children) {
    this.children.push(...children);
  }
  setAttribute() {}
  addEventListener() {}
  querySelector(selector) {
    this.selectors ??= {};
    return (this.selectors[selector] ??= new Element());
  }
}

function model(search = '', responses = {}) {
  const windowEvents = new Map();
  let seed = 727;
  const seededMath = Object.create(Math);
  seededMath.random = () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296;
  const elements = new Map(),
    requests = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement() {
      return new Element();
    },
    createTextNode(value) {
      return { textContent: String(value) };
    },
    querySelectorAll() {
      return [];
    },
    documentElement: new Element(),
    body: new Element(),
    head: new Element(),
  };
  const sandbox = {
    document,
    window: {
      addEventListener(name, callback) {
        const listeners = windowEvents.get(name) || [];
        listeners.push(callback);
        windowEvents.set(name, listeners);
      },
    },
    innerWidth: 1280,
    location: { search, href: 'http://localhost/queue3d.html' + search, protocol: 'http:' },
    localStorage: {
      getItem() {
        return null;
      },
    },
    history: { replaceState() {} },
    URL,
    URLSearchParams,
    Math: seededMath,
    performance: {
      now() {
        return 0;
      },
    },
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      requests.push(url);
      const configured = responses[url] ?? { status: 404 };
      const reply = typeof configured === 'function' ? await configured() : configured;
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body,
      };
    },
  };
  vm.createContext(sandbox);
  const instrumented = source.replace(
    /window\.Queue3DMath\s*=/,
    `window.__model={
    configure:values=>{Object.assign(config,values);syncStaff();},
    installServers:()=>{servers=[];for(let stage=0;stage<5;stage++){for(let slot=0;slot<(stage===1?3:stage===2?5:1);slot++)servers.push({stage,slot,x:stageX[stage],student:null,group:{visible:true},body:{}});}syncStaff();},
    reset:resetSimulation,step:simulate,read:readOrders,
    addAtStage:stage=>{newStudent();const s=students[students.length-1];s.stage=stage;s.state='queued';s.x=stageX[stage];s.z=-2.89;s.path=[];queues[stage].push(s);},
    snapshot:()=>({created:studentId,completed,active:students.length,queues:queues.map(q=>q.length),stages:students.map(s=>s.stage),visible:visibleStudents().map(s=>({x:s.x,z:s.z,state:s.state,stage:s.stage})),servers:servers.map(s=>({stage:s.stage,slot:s.slot,busy:!!s.student,visible:s.group.visible})),selected:selectedOrder,counts:productCounts(),current:currentStage(),error:realError,minute:simMinute})
  };window.Queue3DMath=`
  );
  vm.runInContext(instrumented, sandbox);
  return {
    api: sandbox.window.__model,
    math: sandbox.window.Queue3DMath,
    elements,
    requests,
    event(name, event = {}) {
      (windowEvents.get(name) || []).forEach((callback) => callback(event));
    },
  };
}

test('Poisson intervals match configured hourly rate and service durations stay positive', () => {
  const { math } = model();
  let sum = 0;
  for (let i = 0; i < 100000; i++) sum += math.arrivalInterval(7);
  assert.ok(Math.abs(sum / 100000 - 60 / 7) < 0.08);
  for (let stage = 0; stage < 5; stage++) {
    let serviceSum = 0;
    for (let i = 0; i < 10000; i++) {
      const value = math.serviceTime(stage);
      assert.ok(Number.isFinite(value) && value > 0);
      serviceSum += value;
    }
    assert.ok(Math.abs(serviceSum / 10000 - [3.5, 12, 6, 4.5, 2.5][stage]) < 0.1);
  }
});

test('a complete workday conserves people and counts completion only after exit', () => {
  const { api } = model();
  api.installServers();
  api.configure({ arrivals: 30, documents: 3, advisors: 5 });
  api.reset();
  api.step(480);
  let state = api.snapshot();
  assert.equal(state.created, state.active + state.completed);
  assert.ok(state.completed > 0);
  assert.ok(state.stages.every((stage) => stage >= 0 && stage <= 5));
  const created = state.created;
  api.step(2400);
  state = api.snapshot();
  assert.equal(state.created, created);
  assert.equal(state.completed, created);
  assert.equal(state.active, 0);
  assert.deepEqual(Array.from(state.queues), [0, 0, 0, 0, 0]);
});

test('zero advisors block stage three without dropping arrivals above the visible mesh limit', () => {
  const { api } = model();
  api.installServers();
  api.configure({ arrivals: 30, documents: 3, advisors: 0 });
  api.reset();
  api.step(480);
  const state = api.snapshot();
  assert.ok(state.created > 80);
  assert.ok(state.active > 80);
  assert.equal(state.completed, 0);
  assert.equal(state.created, state.active);
  assert.ok(state.queues[2] > 80);
  assert.ok(state.stages.every((stage) => stage <= 2));
  assert.ok(state.visible.length <= 80);
  for (let stage = 0; stage < 5; stage++)
    assert.ok(state.visible.filter((s) => s.state === 'queued' && s.stage === stage).length <= 12);
  assert.ok(state.visible.every((s) => s.state !== 'queued' || (s.z >= -0.8 && s.z <= 1.1)));
});

test('staff reduction preserves three busy document desks until each current job finishes', () => {
  const { api } = model();
  api.installServers();
  api.configure({ arrivals: 1, documents: 3 });
  api.reset();
  for (let i = 0; i < 3; i++) api.addAtStage(1);
  api.step(0.5);
  assert.equal(api.snapshot().servers.filter((s) => s.stage === 1 && s.busy).length, 3);
  api.configure({ documents: 1 });
  assert.equal(api.snapshot().servers.filter((s) => s.stage === 1 && s.visible).length, 3);
  api.step(30);
  assert.ok(
    api
      .snapshot()
      .servers.filter((s) => s.stage === 1 && s.slot > 0)
      .every((s) => !s.busy && !s.visible)
  );
});

const selected = {
  id: '76420864-2f91-4b12-a742-8904dff1f288',
  order_number: 'ALY-TEST-1',
  status: 'shipped',
  items: [{ name: { th: 'สินค้าทดสอบ', en: 'Test item', zh: '测试商品' }, quantity: 3 }],
};
const realQuery = '?mode=product&order=' + selected.id;

test('anonymous real-order links never load administrator records or show a demo', async () => {
  const { api, requests } = model(realQuery, { '/api/orders': { status: 401 } });
  await api.read();
  const state = api.snapshot();
  assert.equal(state.selected, null);
  assert.equal(state.current, -1);
  assert.ok(state.error.includes('เข้าสู่ระบบ'));
  assert.ok(!requests.includes('/api/admin'));
});

test('unowned order stays empty after administrator API denies access', async () => {
  const { api } = model(realQuery, {
    '/api/orders': { status: 200, body: { orders: [] } },
    '/api/admin': { status: 403 },
  });
  await api.read();
  const state = api.snapshot();
  assert.equal(state.selected, null);
  assert.ok(state.error.includes('ไม่พบคำสั่งซื้อ'));
});

test('owner data displays actual shipped status and actual items without progressing status', async () => {
  const { api, requests } = model(realQuery, {
    '/api/orders': { status: 200, body: { orders: [selected] } },
  });
  await api.read();
  assert.equal(api.snapshot().current, 3);
  assert.equal(api.snapshot().selected.items[0].quantity, 3);
  assert.equal(api.snapshot().counts[3], 1);
  assert.ok(!requests.includes('/api/admin'));
  api.step(100);
  assert.equal(api.snapshot().current, 3);
});

test('a separate 3D order view clears private order data when another tab signs out', async () => {
  const h = model(realQuery, { '/api/orders': { status: 200, body: { orders: [selected] } } });
  await h.api.read();
  assert.equal(h.api.snapshot().selected.id, selected.id);
  const requests = h.requests.length;
  h.event('storage', { key: 'alyzyus-auth-sync', newValue: 'logout:1' });
  assert.equal(h.api.snapshot().selected, null);
  assert.equal(h.api.snapshot().current, -1);
  assert.equal(h.requests.length, requests, 'logout must not race cookies by fetching again');
});

test('3D order data cannot return from a pending response after pagehide', async () => {
  const responses = { '/api/orders': { status: 200, body: { orders: [selected] } } };
  const h = model(realQuery, responses);
  await h.api.read();
  let resolve;
  responses['/api/orders'] = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = h.api.read();
  h.event('pagehide', { persisted: true });
  resolve({ status: 200, body: { orders: [selected] } });
  await pending;
  assert.equal(h.api.snapshot().selected, null);
  assert.equal(h.api.snapshot().current, -1);
});

test('administrator fallback requires server authorization; cancelled order has no current stage', async () => {
  const cancelled = { ...selected, status: 'cancelled' };
  const { api, requests } = model(realQuery, {
    '/api/orders': { status: 200, body: { orders: [] } },
    '/api/admin': { status: 200, body: { orders: [cancelled] } },
  });
  await api.read();
  assert.ok(requests.includes('/api/admin'));
  assert.equal(api.snapshot().selected.status, 'cancelled');
  assert.equal(api.snapshot().current, -1);
  assert.deepEqual(Array.from(api.snapshot().counts), [0, 0, 0, 0, 0]);
});
