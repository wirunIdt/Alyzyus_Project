/* Public portfolio sandbox. No Auth, fetch, storage or payment APIs are used. */
export const DEMO_STAGES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];

export class DemoSession {
  constructor(products) {
    this.fixtures = structuredClone(products);
    this.reset();
  }
  reset() {
    this.products = structuredClone(this.fixtures);
    this.cart = new Map();
    this.orders = [];
    this.tickets = [];
    this.sequence = 1000;
    if (this.products.length) {
      this.add(this.products[0].id);
      const sample = this.placeOrder();
      sample.status = 'confirmed';
    }
  }
  product(id) {
    return this.products.find((product) => product.id === id);
  }
  add(id) {
    const product = this.product(id);
    const quantity = (this.cart.get(id) || 0) + 1;
    if (!product || quantity > product.stock || quantity > 10) return false;
    this.cart.set(id, quantity);
    return true;
  }
  remove(id) {
    const quantity = this.cart.get(id) || 0;
    if (quantity > 1) this.cart.set(id, quantity - 1);
    else this.cart.delete(id);
  }
  totals() {
    let subtotalCents = 0;
    for (const [id, quantity] of this.cart) {
      subtotalCents += Math.round(this.product(id).price * 100) * quantity;
    }
    const shippingCents = !subtotalCents || subtotalCents >= 250000 ? 0 : 8000;
    return {
      subtotal: subtotalCents / 100,
      shipping: shippingCents / 100,
      total: (subtotalCents + shippingCents) / 100,
    };
  }
  placeOrder() {
    if (!this.cart.size) return null;
    for (const [id, quantity] of this.cart) {
      const product = this.product(id);
      if (!product || quantity > product.stock) return null;
    }
    const totals = this.totals();
    const items = [...this.cart].map(([id, quantity]) => ({
      id,
      quantity,
      name: structuredClone(this.product(id).name),
      price: this.product(id).price,
    }));
    for (const item of items) this.product(item.id).stock -= item.quantity;
    const order = { number: `DEMO-${++this.sequence}`, status: 'pending', items, ...totals };
    this.orders.unshift(order);
    this.cart.clear();
    return order;
  }
  advance(number) {
    const order = this.orders.find((candidate) => candidate.number === number);
    const index = order ? DEMO_STAGES.indexOf(order.status) : -1;
    if (index < 0 || index >= DEMO_STAGES.length - 1) return false;
    order.status = DEMO_STAGES[index + 1];
    return true;
  }
  question(value) {
    const text = String(value).trim();
    if (text.length < 5 || text.length > 300 || this.tickets.length >= 5) return null;
    const ticket = { number: `DEMO-S-${String(this.tickets.length + 1).padStart(3, '0')}`, text };
    this.tickets.unshift(ticket);
    return ticket;
  }
}

const COPY = {
  th: {
    skip: 'ข้ามไปเนื้อหา',
    theme: 'สลับธีม',
    realStore: 'กลับหน้าร้าน',
    title: 'ลองเป็นลูกค้า แล้วสลับไปดูแลร้าน',
    intro:
      'เลือกสินค้า สร้างออเดอร์ตัวอย่าง แล้วสลับเป็นผู้ดูแลเพื่อเปลี่ยนสถานะและดูเส้นทางสินค้า',
    noticeTitle: 'ข้อมูลจำลองทั้งหมด',
    notice:
      'ไม่ต้องสมัคร ไม่มีการเก็บเงินจริง ไม่ส่งข้อมูลเข้าฐานข้อมูล รีเฟรชหน้านี้เพื่อเริ่มใหม่ กรุณาใช้ข้อความสมมติเท่านั้น',
    customer: 'ฝั่งลูกค้า',
    admin: 'ฝั่งผู้ดูแลจำลอง',
    reset: 'เริ่มตัวอย่างใหม่',
    products: 'เลือกชิ้นที่ชอบ',
    stepOne: '01 / สินค้าและถุง',
    bagEyebrow: 'YOUR DEMO BAG',
    bag: 'ถุงสินค้าจำลอง',
    shipping: 'ค่าจัดส่งตัวอย่าง ฿80 ส่งฟรีเมื่อยอดสินค้าถึง ฿2,500',
    checkout: 'สร้างออเดอร์จำลอง',
    payment: 'จำลองวิธีเก็บเงินปลายทาง ไม่มีการเรียกเก็บเงินจริง',
    adminTitle: 'รับออเดอร์และขยับงานทีละขั้น',
    adminNote:
      'หน้าตัวอย่างนี้ไม่ใช่สิทธิ์ Admin จริง ทุกการเปลี่ยนแปลงเกิดในเบราว์เซอร์นี้เท่านั้น',
    tracking: 'เส้นทางของออเดอร์ตัวอย่าง',
    stepTwo: '02 / สถานะคำสั่งซื้อ',
    supportTitle: 'ลองส่งคำถามให้ทีมร้าน',
    supportIntro: 'คำถามนี้เก็บเฉพาะในหน้านี้ เพื่อสาธิตการเปิดเรื่อง ไม่มีทีมงานได้รับข้อความจริง',
    question: 'ข้อความสมมติ',
    send: 'เปิดเรื่องจำลอง',
    back: 'กลับเว็บไซต์ Alyzyus',
    footer: 'ข้อมูลสาธิตแยกจากระบบจริง ไม่มีบัญชีหรือรหัสผ่านสำหรับแชร์',
    add: 'เพิ่มลงถุง',
    remove: 'ลดจำนวน',
    stock: 'เหลือ',
    pieces: 'ชิ้น',
    subtotal: 'ยอดสินค้า',
    delivery: 'ค่าจัดส่ง',
    total: 'ยอดรวมตัวอย่าง',
    empty: 'เลือกสินค้าเพื่อเริ่มลองสั่งซื้อ',
    advanced: 'อัปเดตสถานะในตัวอย่างแล้ว',
    next: 'ขยับเป็น',
    done: 'ครบทุกขั้นตอนแล้ว',
    now: 'ขั้นตอนปัจจุบัน',
    later: 'ขั้นตอนถัดไป',
    passed: 'ผ่านแล้ว',
    pending: 'รับคำสั่งซื้อ',
    confirmed: 'ยืนยันคำสั่งซื้อ',
    processing: 'เตรียมสินค้า',
    shipped: 'จัดส่งสินค้า',
    delivered: 'ส่งถึงลูกค้า',
    hint: 'ลองสลับไปฝั่งผู้ดูแล แล้วขยับสถานะ ออเดอร์นี้จะแสดงผลตามที่คุณเปลี่ยน ไม่มีการเดินสถานะอัตโนมัติ',
    sampleItems: 'รายการตัวอย่าง',
    orderCreated: 'สร้างออเดอร์จำลองแล้ว ลองสลับไปฝั่งผู้ดูแล',
    added: 'เพิ่มลงถุงจำลองแล้ว',
    unavailable: 'ตัวอย่างมีสินค้าไม่พอหรือถึงจำนวนสูงสุดแล้ว',
    restarted: 'เริ่มข้อมูลตัวอย่างใหม่แล้ว',
    questionSent: 'เปิดเรื่องจำลองแล้ว เก็บเฉพาะในหน้านี้',
    questionLimit: 'ใส่ข้อความสมมติ 5–300 ตัวอักษร เปิดได้ไม่เกิน 5 เรื่องต่อรอบ',
    ticketState: 'เปิดเรื่องจำลอง / ยังไม่มีข้อความจากทีมร้าน',
  },
  en: {
    skip: 'Skip to content',
    theme: 'Toggle theme',
    realStore: 'Real storefront',
    title: 'Try shopping, then manage the order',
    intro:
      'Choose a product, create a sample order, then switch to the staff view and follow its progress.',
    noticeTitle: 'All data is simulated',
    notice:
      'No signup, real payment or database writes. Reload to restart. Please enter fictional text only.',
    customer: 'Customer view',
    admin: 'Simulated staff',
    reset: 'Restart demo',
    products: 'Choose something you like',
    stepOne: '01 / PRODUCTS AND BAG',
    bagEyebrow: 'YOUR DEMO BAG',
    bag: 'Sample shopping bag',
    shipping: 'Sample delivery ฿80. Free delivery from ฿2,500 in products.',
    checkout: 'Create a sample order',
    payment: 'Simulated cash on delivery. No money is collected.',
    adminTitle: 'Receive an order and move it forward',
    adminNote: 'This is not real Admin access. Changes stay only in this browser page.',
    tracking: 'Follow the sample order',
    stepTwo: '02 / ORDER STATUS',
    supportTitle: 'Try a question for the store',
    supportIntro:
      'This demonstrates opening a request. It stays on this page and no staff member receives it.',
    question: 'Fictional message',
    send: 'Create a sample request',
    back: 'Back to Alyzyus',
    footer: 'Demo data is separate from the real system. No shared account or password.',
    add: 'Add to bag',
    remove: 'Remove one',
    stock: 'Stock',
    pieces: 'items',
    subtotal: 'Products',
    delivery: 'Delivery',
    total: 'Sample total',
    empty: 'Choose a product to try checkout.',
    advanced: 'Sample status updated.',
    next: 'Move to',
    done: 'All steps complete',
    now: 'Current step',
    later: 'Next step',
    passed: 'Completed',
    pending: 'Order received',
    confirmed: 'Order confirmed',
    processing: 'Preparing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    hint: 'Switch to the staff view and advance the order. This timeline follows your changes and never advances automatically.',
    sampleItems: 'Sample items',
    orderCreated: 'Sample order created. Try the staff view next.',
    added: 'Added to the sample bag.',
    unavailable: 'Sample stock is insufficient or the quantity limit was reached.',
    restarted: 'The demo has restarted.',
    questionSent: 'Sample request created only on this page.',
    questionLimit: 'Use 5–300 characters of fictional text. Up to 5 requests per demo session.',
    ticketState: 'Sample request open / No staff reply yet',
  },
  zh: {
    skip: '跳转到正文',
    theme: '切换主题',
    realStore: '返回商店',
    title: '先体验购物，再管理订单',
    intro: '选择商品并创建示例订单，然后切换到商家视角，更新状态并查看订单进度。',
    noticeTitle: '全部为模拟数据',
    notice: '无需注册，不收取费用，也不写入数据库。刷新页面可重新开始。请只输入虚构内容。',
    customer: '顾客视角',
    admin: '模拟商家',
    reset: '重新开始',
    products: '挑选喜欢的商品',
    stepOne: '01 / 商品和购物袋',
    bagEyebrow: 'YOUR DEMO BAG',
    bag: '示例购物袋',
    shipping: '示例运费 ฿80，商品金额满 ฿2,500 免运费。',
    checkout: '创建示例订单',
    payment: '模拟货到付款，不收取任何费用。',
    adminTitle: '接收订单并逐步处理',
    adminNote: '这不是实际管理员权限。所有更改仅保留在当前页面。',
    tracking: '查看示例订单进度',
    stepTwo: '02 / 订单状态',
    supportTitle: '试着向商店提问',
    supportIntro: '仅演示创建咨询请求。内容只留在当前页面，不会发送给真实工作人员。',
    question: '虚构信息',
    send: '创建示例咨询',
    back: '返回 Alyzyus',
    footer: '演示数据与真实系统分开，无需共享账户或密码。',
    add: '加入购物袋',
    remove: '减少一件',
    stock: '库存',
    pieces: '件',
    subtotal: '商品金额',
    delivery: '运费',
    total: '示例总计',
    empty: '选择商品即可体验下单。',
    advanced: '示例状态已更新。',
    next: '更新为',
    done: '所有步骤已完成',
    now: '当前步骤',
    later: '后续步骤',
    passed: '已完成',
    pending: '收到订单',
    confirmed: '确认订单',
    processing: '准备商品',
    shipped: '已发货',
    delivered: '已送达',
    hint: '切换到商家视角以更新订单。此进度仅跟随你的操作，不会自动前进。',
    sampleItems: '示例商品',
    orderCreated: '示例订单已创建。接下来可切换到商家视角。',
    added: '已加入示例购物袋。',
    unavailable: '示例库存不足或已达数量上限。',
    restarted: '演示已重新开始。',
    questionSent: '示例咨询已创建，内容仅保留在当前页面。',
    questionLimit: '请输入 5–300 个字符的虚构内容，每次演示最多创建 5 条咨询。',
    ticketState: '示例咨询已创建 / 尚无工作人员回复',
  },
};

function startDemo() {
  const get = (id) => document.getElementById(id);
  const session = new DemoSession(JSON.parse(get('demo-data').textContent));
  let locale = 'th';
  let feedbackTimer;
  const text = (key) => COPY[locale][key] || key;
  const name = (value) => value[locale] || value.en || value.th;
  const money = (value) =>
    new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale, {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: 0,
    }).format(value);
  const node = (tag, value, className) => {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = value;
    if (className) element.className = className;
    return element;
  };
  const button = (value, action, className = 'demo-secondary') => {
    const element = node('button', value, className);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  };
  function feedback(key) {
    clearTimeout(feedbackTimer);
    get('demo-feedback').textContent = text(key);
    feedbackTimer = setTimeout(() => {
      get('demo-feedback').textContent = '';
    }, 4500);
  }
  function renderProducts() {
    const target = get('demo-products');
    target.replaceChildren();
    for (const product of session.products) {
      const card = node('article', undefined, 'demo-product');
      const image = node('img', undefined, 'demo-product-image');
      image.src = product.images[0];
      image.alt = name(product.name);
      image.width = 220;
      image.height = 220;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      const details = node('p', undefined, 'demo-product-meta');
      details.append(
        node('span', money(product.price)),
        node('small', `${text('stock')} ${product.stock}`)
      );
      const add = button(text('add'), () => {
        const added = session.add(product.id);
        renderCart();
        feedback(added ? 'added' : 'unavailable');
      });
      add.disabled = product.stock <= 0;
      card.append(image, node('h3', name(product.name)), details, add);
      target.append(card);
    }
  }
  function renderCart() {
    const target = get('demo-cart');
    target.replaceChildren();
    if (!session.cart.size) target.append(node('p', text('empty'), 'demo-small'));
    for (const [id, quantity] of session.cart) {
      const product = session.product(id);
      const line = node('div', undefined, 'demo-cart-line');
      const content = node('div');
      content.append(
        node('p', `${name(product.name)} × ${quantity}`),
        button(
          text('remove'),
          () => {
            session.remove(id);
            renderCart();
          },
          ''
        )
      );
      line.append(content, node('span', money(product.price * quantity)));
      target.append(line);
    }
    const totals = session.totals();
    for (const [key, value] of [
      ['subtotal', totals.subtotal],
      ['delivery', totals.shipping],
      ['total', totals.total],
    ]) {
      const line = node('div', undefined, 'demo-total');
      line.append(node('span', text(key)), node(key === 'total' ? 'strong' : 'span', money(value)));
      target.append(line);
    }
    get('demo-checkout').disabled = !session.cart.size;
  }
  function renderOrders() {
    const order = session.orders[0];
    const target = get('demo-order');
    target.replaceChildren();
    const summary = node('div', undefined, 'demo-order-summary');
    summary.append(
      node('strong', order.number),
      node(
        'span',
        `${text('sampleItems')}: ${order.items.map((item) => `${name(item.name)} × ${item.quantity}`).join(', ')}`
      ),
      node('span', money(order.total))
    );
    const timeline = node('ol', undefined, 'demo-timeline');
    const current = DEMO_STAGES.indexOf(order.status);
    DEMO_STAGES.forEach((stage, index) => {
      const step = node('li', `${index + 1}. ${text(stage)}`);
      step.dataset.complete = String(index <= current);
      if (index === current) step.setAttribute('aria-current', 'step');
      step.append(
        node('span', text(index === current ? 'now' : index < current ? 'passed' : 'later'))
      );
      timeline.append(step);
    });
    target.append(summary, timeline, node('p', text('hint'), 'demo-order-hint'));
    const adminTarget = get('demo-admin-orders');
    adminTarget.replaceChildren();
    for (const item of session.orders) {
      const index = DEMO_STAGES.indexOf(item.status);
      const row = node('article', undefined, 'demo-admin-order');
      const title = node('div');
      title.append(
        node('strong', item.number),
        node(
          'p',
          `${item.items.reduce((count, line) => count + line.quantity, 0)} ${text('pieces')} · ${money(item.total)}`
        )
      );
      const next = DEMO_STAGES[index + 1];
      const advance = button(next ? `${text('next')} ${text(next)}` : text('done'), () => {
        session.advance(item.number);
        renderOrders();
        feedback('advanced');
      });
      advance.disabled = !next;
      row.append(title, node('p', text(item.status)), advance);
      adminTarget.append(row);
    }
  }
  function renderTickets() {
    const target = get('demo-tickets');
    target.replaceChildren();
    for (const ticket of session.tickets) {
      const card = node('article', undefined, 'demo-ticket');
      card.append(
        node('strong', ticket.number),
        node('p', ticket.text),
        node('small', text('ticketState'))
      );
      target.append(card);
    }
  }
  function render() {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
    document.querySelectorAll('[data-copy]').forEach((element) => {
      element.textContent = text(element.dataset.copy);
    });
    renderProducts();
    renderCart();
    renderOrders();
    renderTickets();
  }
  function showRole(role) {
    for (const name of ['customer', 'admin']) {
      get(`demo-${name}-panel`).hidden = name !== role;
      get(`demo-${name}-tab`).setAttribute('aria-selected', String(name === role));
      get(`demo-${name}-tab`).tabIndex = name === role ? 0 : -1;
    }
  }
  get('demo-language').addEventListener('change', (event) => {
    locale = Object.hasOwn(COPY, event.target.value) ? event.target.value : 'th';
    render();
  });
  get('demo-theme').addEventListener('click', () => {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  });
  get('demo-customer-tab').addEventListener('click', () => showRole('customer'));
  get('demo-admin-tab').addEventListener('click', () => showRole('admin'));
  for (const role of ['customer', 'admin']) {
    get(`demo-${role}-tab`).addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 'customer'
          : event.key === 'End'
            ? 'admin'
            : role === 'customer'
              ? 'admin'
              : 'customer';
      showRole(next);
      get(`demo-${next}-tab`).focus();
    });
  }
  get('demo-reset').addEventListener('click', () => {
    session.reset();
    get('demo-question').value = '';
    showRole('customer');
    render();
    feedback('restarted');
  });
  get('demo-checkout').addEventListener('click', () => {
    const order = session.placeOrder();
    if (!order) {
      feedback('unavailable');
      return;
    }
    render();
    feedback('orderCreated');
    get('demo-tracking-title').scrollIntoView({ behavior: 'auto', block: 'start' });
  });
  get('demo-support-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!session.question(get('demo-question').value)) {
      feedback('questionLimit');
      return;
    }
    get('demo-question').value = '';
    renderTickets();
    feedback('questionSent');
  });
  showRole('customer');
  render();
}

if (typeof document !== 'undefined') startDemo();
