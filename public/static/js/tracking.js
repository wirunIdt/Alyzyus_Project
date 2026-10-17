/* Private order history: all statuses originate from authenticated server data. */
(() => {
  'use strict';
  const S = window.Shop,
    root = document.getElementById('tracking-content'),
    refresh = document.getElementById('tracking-refresh');
  if (!S || !root) return;
  const e = S.escape,
    L = (th, en, zh) => S.t({ th, en, zh }),
    parameters = new URLSearchParams(location.search);
  let user = null,
    loading = true,
    orders = [],
    expanded = null,
    requestedOrder = parameters.get('order') || null,
    query = '',
    error = '',
    bank = null,
    loadToken = 0;
  const status = {
    pending: { th: 'รับคำสั่งซื้อแล้ว', en: 'Order received', zh: '订单已收到' },
    confirmed: { th: 'ยืนยันคำสั่งซื้อ', en: 'Confirmed', zh: '已确认' },
    processing: { th: 'กำลังเตรียมสินค้า', en: 'Preparing your order', zh: '备货中' },
    shipped: { th: 'จัดส่งแล้ว', en: 'Shipped', zh: '已发货' },
    delivered: { th: 'ส่งสำเร็จ', en: 'Delivered', zh: '已送达' },
    cancelled: { th: 'ยกเลิก', en: 'Cancelled', zh: '已取消' },
  };
  const payment = {
    pending: { th: 'รอชำระเงิน', en: 'Awaiting payment', zh: '待支付' },
    paid: { th: 'ชำระเงินแล้ว', en: 'Paid', zh: '已支付' },
    failed: { th: 'ชำระไม่สำเร็จ', en: 'Payment failed', zh: '支付失败' },
    expired: { th: 'การชำระเงินหมดเวลา', en: 'Payment expired', zh: '支付已过期' },
    refund_required: { th: 'อยู่ระหว่างดำเนินการคืนเงิน', en: 'Refund required', zh: '需要退款' },
  };
  const methods = {
    card: { th: 'บัตรและช่องทางออนไลน์', en: 'Cards & online payments', zh: '银行卡和在线支付' },
    promptpay: { th: 'พร้อมเพย์', en: 'PromptPay', zh: 'PromptPay' },
    bank_transfer: { th: 'โอนเงินผ่านธนาคาร', en: 'Bank transfer', zh: '银行转账' },
    cod: { th: 'เก็บเงินปลายทาง', en: 'Cash on delivery', zh: '货到付款' },
  };
  function date(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? '—'
      : parsed.toLocaleDateString({ th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }[S.locale], {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Bangkok',
        });
  }
  function image(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, location.origin);
      return (url.origin === location.origin || url.protocol === 'https:') &&
        !url.username &&
        !url.password
        ? e(url.href)
        : '';
    } catch {
      return '';
    }
  }
  const label = (dictionary, key) => (dictionary[key] ? S.t(dictionary[key]) : String(key || '—'));
  const statusBadge = (o) =>
    `<span class="order-status status-${Object.hasOwn(status, o.status) ? e(o.status) : 'pending'}">${e(label(status, o.status))}</span>`;
  const empty = (title, body, action) =>
    `<section class="customer-empty"><div class="customer-icon-badge">${S.icon('package', 29)}</div><h2>${e(title)}</h2><p>${e(body)}</p>${action || ''}</section>`;
  function progress(order) {
    if (order.status === 'cancelled')
      return `<div class="order-cancelled">${S.icon('close', 19)}${e(L('คำสั่งซื้อนี้ถูกยกเลิกแล้ว', 'This order has been cancelled.', '此订单已取消。'))}</div>`;
    const stages = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'],
      index = stages.indexOf(order.status);
    return `<ol class="order-progress" aria-label="${e(L('ความคืบหน้าของคำสั่งซื้อ', 'Order progress', '订单进度'))}">${stages.map((stage, i) => `<li class="${i < index ? 'complete' : i === index ? 'current' : ''}" ${i === index ? 'aria-current="step"' : ''}><span>${i < index ? '✓' : S.icon(i < 3 ? 'package' : 'truck', 16)}</span><small>${e(label(status, stage))}</small></li>`).join('')}</ol>`;
  }
  function detail(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const pendingBank =
      order.payment_method === 'bank_transfer' &&
      order.payment_status !== 'paid' &&
      order.status !== 'cancelled';
    return `${progress(order)}${order.tracking_number ? `<div class="order-parcel">${S.icon('truck', 22)}<span><strong>${e(order.carrier || L('ข้อมูลพัสดุ', 'Shipment details', '配送信息'))}</strong><small class="customer-mono">${e(order.tracking_number)}</small></span></div>` : ''}<div class="order-detail-grid"><div><div class="order-detail-items">${items
      .map((item) => {
        const url = image(item.image);
        return `<div class="order-detail-item">${url ? `<img src="${url}" alt="${e(S.t(item.name))}" loading="lazy">` : `<div class="order-image-placeholder">${S.icon('package', 22)}</div>`}<div><strong>${e(S.t(item.name))}</strong><span>${e(S.money(item.price))} × ${e(item.quantity)}</span></div><b>${e(S.money(Number(item.price) * Number(item.quantity)))}</b></div>`;
      })
      .join(
        ''
      )}</div><dl class="order-detail-totals"><div><dt>${e(L('ยอดสินค้า', 'Subtotal', '商品小计'))}</dt><dd>${e(S.money(order.subtotal))}</dd></div><div><dt>${e(L('ค่าจัดส่ง', 'Shipping', '运费'))}</dt><dd>${e(S.money(order.shipping))}</dd></div>${Number(order.discount) > 0 ? `<div><dt>${e(L('ส่วนลด', 'Discount', '折扣'))}</dt><dd>−${e(S.money(order.discount))}</dd></div>` : ''}<div class="order-detail-total"><dt>${e(L('ยอดรวม', 'Total', '总计'))}</dt><dd>${e(S.money(order.total))}</dd></div></dl></div><div class="order-info"><section><h3>${S.icon('user', 15)}${e(L('ผู้รับและที่อยู่', 'Delivery details', '收货信息'))}</h3><strong>${e(order.customer_name)}</strong><p>${e(order.email)}<br>${e(order.phone)}</p><p class="order-address">${e(order.address)}</p></section><section><h3>${S.icon('card', 15)}${e(L('การชำระเงิน', 'Payment', '支付'))}</h3><strong>${e(label(methods, order.payment_method))}</strong><span class="payment-status ${order.payment_status === 'paid' ? 'is-paid' : ''}">${order.payment_status === 'paid' ? '✓' : ''}${e(label(payment, order.payment_status))}</span>${order.payment_method === 'cod' && order.payment_status !== 'paid' ? `<p>${e(L('ชำระเงินเมื่อได้รับสินค้า', 'Pay when your order arrives.', '收到商品时付款。'))}</p>` : ''}</section></div></div>${pendingBank && bank ? `<div class="order-bank-info">${S.icon('card', 20)}<div><strong>${e(L('รายละเอียดสำหรับโอนเงิน', 'Bank transfer details', '银行转账信息'))}</strong><p>${e(bank.bank)} · ${e(bank.accountName)}<br><span class="customer-mono">${e(bank.accountNumber)}</span></p><small>${e(L(`ยอดโอน ${S.money(order.total)} · เลขอ้างอิง ${order.order_number}`, `Transfer ${S.money(order.total)} · Reference ${order.order_number}`, `转账 ${S.money(order.total)} · 参考编号 ${order.order_number}`))}</small><small>${e(L('เก็บหลักฐานการโอนจนกว่าร้านจะยืนยันการชำระเงิน', 'Keep your transfer receipt until the store confirms payment.', '请保留转账凭证直到商店确认付款。'))}</small></div></div>` : ''}<div class="order-journey-link"><a href="/support?order=${encodeURIComponent(order.id)}" class="button">${S.icon('user', 17)}${e(L('ขอความช่วยเหลือเกี่ยวกับออเดอร์นี้', 'Get help with this order', '获取此订单帮助'))}</a><a href="/simulation?mode=product&order=${encodeURIComponent(order.id)}" target="_blank" rel="noopener" class="button secondary">${S.icon('package', 17)}${e(L('เส้นทางสินค้า 3D', '3D product journey', '3D 商品旅程'))}${S.icon('arrow-up', 14)}</a><p>${e(L('แสดงข้อมูลสถานะล่าสุดจากคำสั่งซื้อของคุณ', 'Shows the latest recorded status of your order.', '显示您订单最新记录的状态。'))}</p></div>`;
  }
  function list() {
    const target = document.getElementById('tracking-list');
    if (!target) return;
    const search = query.toLocaleLowerCase().trim(),
      visible = orders.filter((o) =>
        `${o.order_number} ${o.items?.map((item) => S.t(item.name)).join(' ')}`
          .toLocaleLowerCase()
          .includes(search)
      );
    target.innerHTML = visible.length
      ? visible
          .map((order) => {
            const open = expanded === order.id;
            return `<article class="tracking-order ${open ? 'expanded' : ''}"><button type="button" class="tracking-order-toggle" data-expand-order="${e(order.id)}" aria-expanded="${open}" aria-controls="order-detail-${e(order.id)}"><span class="tracking-order-icon">${S.icon('package', 23)}</span><span class="tracking-order-identity"><strong>${e(order.order_number)}</strong><small>${e(date(order.created_at))} · ${e((order.items || []).reduce((sum, item) => sum + Number(item.quantity), 0))} ${e(L('ชิ้น', 'items', '件'))}</small></span>${statusBadge(order)}<span class="tracking-order-total">${e(S.money(order.total))}</span><span class="tracking-chevron">${S.icon('down', 15)}</span></button><div class="tracking-order-detail" id="order-detail-${e(order.id)}" ${!open ? 'hidden' : ''}>${open ? detail(order) : ''}</div></article>`;
          })
          .join('')
      : `<div class="tracking-no-results">${e(L('ไม่พบคำสั่งซื้อที่ตรงกับคำค้น', 'No matching orders. Try another search.', '未找到匹配订单，请尝试其他搜索词。'))}</div>`;
  }
  function render() {
    refresh.disabled = loading;
    if (loading && !orders.length) {
      root.innerHTML = `<div class="customer-loading" role="status">${e(L('กำลังโหลดคำสั่งซื้อ…', 'Loading your orders…', '正在加载订单…'))}</div>`;
      return;
    }
    if (error) {
      root.innerHTML = empty(
        L('ยังโหลดคำสั่งซื้อไม่ได้', 'We could not load your orders.', '无法加载您的订单。'),
        L(
          'ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง',
          'Check your connection and try again.',
          '请检查网络连接后重试。'
        ),
        `<button class="button" type="button" data-tracking-retry>${e(L('ลองอีกครั้ง', 'Try again', '重试'))}</button>`
      );
      return;
    }
    if (!S.configured) {
      root.innerHTML = empty(
        L('พื้นที่สำหรับคำสั่งซื้อของคุณ', 'Your orders will live here.', '您的订单将显示在这里。'),
        L(
          'นี่คือตัวอย่างร้าน จะแสดงคำสั่งซื้อจริงเมื่อร้านเปิดบริการและคุณเข้าสู่ระบบแล้ว',
          'This is a store preview. Real orders appear when the store is connected and you sign in.',
          '当前为商店预览，商店连接完成并登录后即可查看真实订单。'
        ),
        `<a href="/shop" class="button">${e(L('สำรวจสินค้า', 'Explore the collection', '浏览商品'))}${S.icon('arrow', 17)}</a>`
      );
      return;
    }
    if (!user) {
      root.innerHTML = empty(
        L('ออเดอร์ของคุณ อยู่กับคุณ', 'A little space for your orders.', '您的订单，专属空间。'),
        L(
          'เข้าสู่ระบบเพื่อดูคำสั่งซื้อเฉพาะบัญชีของคุณ',
          'Sign in to see the orders that belong to your account.',
          '登录以查看属于您账户的订单。'
        ),
        `<a href="/account?next=/tracking" class="button">${e(L('เข้าสู่ระบบ / สมัครสมาชิก', 'Sign in / create account', '登录 / 注册'))}${S.icon('arrow', 17)}</a>`
      );
      return;
    }
    if (!orders.length) {
      root.innerHTML = empty(
        L('พร้อมสำหรับชิ้นโปรดชิ้นแรก', 'Your first good find awaits.', '等待您的第一件心爱好物。'),
        L(
          'คุณยังไม่มีคำสั่งซื้อ เมื่อสั่งซื้อแล้วจะติดตามทุกขั้นตอนได้ที่นี่',
          'You have no orders yet. After checking out, you can follow your order here.',
          '您还没有订单，下单后可在此追踪订单进度。'
        ),
        `<a href="/shop" class="button">${e(L('เลือกซื้อสินค้า', 'Explore the collection', '浏览商品'))}${S.icon('arrow', 17)}</a>`
      );
      return;
    }
    const stats = [
      [orders.length, L('คำสั่งซื้อทั้งหมด', 'All orders', '全部订单'), 'bag'],
      [
        orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length,
        L('กำลังดำเนินการ', 'In progress', '进行中'),
        'truck',
      ],
      [
        orders.filter((o) => o.status === 'delivered').length,
        L('ส่งสำเร็จ', 'Delivered', '已送达'),
        'package',
      ],
    ];
    root.innerHTML = `${parameters.has('session_id') ? `<div class="customer-notice">${e(L('กลับจากหน้าชำระเงินแล้ว สถานะจะเปลี่ยนเมื่อผู้ให้บริการยืนยันการชำระเงินเท่านั้น', 'You have returned from checkout. Payment status changes only after the provider confirms payment.', '您已从支付页面返回，付款状态仅在支付服务商确认后更新。'))}</div>` : ''}<div class="tracking-overview">${stats.map(([value, title, icon]) => `<div><span class="tracking-stat-icon">${S.icon(icon, 24)}</span><div><span>${e(title)}</span><strong>${value}</strong></div></div>`).join('')}</div><div class="tracking-list-heading"><h2>${e(L('คำสั่งซื้อของฉัน', 'My orders', '我的订单'))}</h2><label class="tracking-search">${S.icon('search', 16)}<span class="customer-sr-only">${e(L('ค้นหาคำสั่งซื้อ', 'Search orders', '搜索订单'))}</span><input id="tracking-query" type="search" value="${e(query)}" placeholder="${e(L('ค้นหาเลขคำสั่งซื้อ หรือชื่อสินค้า…', 'Search order number or product…', '搜索订单号或商品…'))}"></label></div><div class="tracking-list" id="tracking-list"></div>`;
    list();
  }
  root.addEventListener('input', (event) => {
    if (event.target.id === 'tracking-query') {
      query = event.target.value;
      list();
    }
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-tracking-retry')) load();
    if (button.dataset.expandOrder) {
      expanded = expanded === button.dataset.expandOrder ? null : button.dataset.expandOrder;
      list();
    }
  });
  refresh.addEventListener('click', () => load());
  S.onChange((event) => {
    if (event.detail.type === 'locale') render();
  });
  function clearSession() {
    loadToken++;
    user = null;
    orders = [];
    expanded = null;
    requestedOrder = null;
    query = '';
    error = '';
    loading = false;
    render();
  }
  async function load() {
    const token = ++loadToken;
    loading = true;
    error = '';
    render();
    try {
      const auth = await S.api('/api/auth/me', { cache: 'no-store' });
      if (token !== loadToken) return;
      if (user?.id !== auth.user?.id) {
        orders = [];
        expanded = null;
        query = '';
      }
      user = auth.user || null;
      render();
      if (user && S.configured) {
        const data = await S.api('/api/orders', { cache: 'no-store' });
        if (!Array.isArray(data.orders)) throw new Error('orders');
        if (token !== loadToken) return;
        orders = data.orders;
        if (requestedOrder) {
          // เปิดเฉพาะออเดอร์ของบัญชีนี้ที่เซิร์ฟเวอร์ส่งมาแล้ว ไม่อ่านข้อมูลจาก URL โดยตรง
          expanded = orders.some((order) => order.id === requestedOrder) ? requestedOrder : null;
          requestedOrder = null;
        }
        if (expanded && !orders.some((o) => o.id === expanded)) expanded = null;
        if (!expanded) expanded = orders[0]?.id || null;
      } else orders = [];
    } catch (err) {
      if (token !== loadToken) return;
      if (err.status === 401) {
        user = null;
        orders = [];
      } else error = 'load';
    } finally {
      if (token === loadToken) {
        loading = false;
        render();
      }
    }
  }
  S.watchPrivateSession({ clear: clearSession, reload: load });
  S.api('/api/settings', { cache: 'no-store' })
    .then((data) => {
      bank = data.bankDetails || null;
      if (!loading) list();
    })
    .catch(() => {});
  load();
})();
