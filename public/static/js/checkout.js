/* Server-verified checkout with an idempotency reference for safe retries. */
(() => {
  'use strict';
  const S = window.Shop,
    form = document.getElementById('checkout-form');
  if (!S || !form) return;
  const e = S.escape,
    L = (th, en, zh) => S.t({ th, en, zh }),
    get = (id) => document.getElementById(id);
  let user = null,
    checking = true,
    settings = null,
    settingsLoading = true,
    settingsError = false,
    authError = false,
    busy = false,
    method = '',
    order = null,
    instructions = null,
    paymentUrl = '',
    errorCode = '',
    attempt = null;
  let sessionEpoch = 0,
    authRequest = 0;
  const options = [
    {
      id: 'card',
      icon: 'card',
      name: { th: 'บัตรและช่องทางออนไลน์', en: 'Cards & online payments', zh: '银行卡和在线支付' },
      detail: {
        th: 'เลือกช่องทางที่ร้านเปิดใช้ในหน้าชำระเงินที่ปลอดภัย',
        en: 'Choose from the store’s enabled methods at secure checkout.',
        zh: '在安全支付页面选择商店已开通的支付方式。',
      },
    },
    {
      id: 'promptpay',
      icon: 'card',
      name: { th: 'พร้อมเพย์', en: 'PromptPay', zh: 'PromptPay 二维码' },
      detail: {
        th: 'สแกน QR ผ่านแอปธนาคาร ผู้ให้บริการยืนยันการชำระเงินอัตโนมัติ',
        en: 'Scan with your banking app. The payment provider verifies payment.',
        zh: '使用银行应用扫码，由支付服务商确认付款。',
      },
    },
    {
      id: 'bank_transfer',
      icon: 'card',
      name: { th: 'โอนเงินผ่านธนาคาร', en: 'Bank transfer', zh: '银行转账' },
      detail: {
        th: 'รับข้อมูลบัญชีหลังสั่งซื้อ ร้านจะตรวจสอบยอดโอน',
        en: 'Get bank details after ordering. The store verifies your transfer.',
        zh: '下单后获取银行信息，商店将核实转账。',
      },
    },
    {
      id: 'cod',
      icon: 'truck',
      name: { th: 'เก็บเงินปลายทาง', en: 'Cash on delivery', zh: '货到付款' },
      detail: {
        th: 'ชำระเงินเมื่อได้รับสินค้า',
        en: 'Pay when your order arrives.',
        zh: '收到商品时付款。',
      },
    },
  ];
  function checkoutError(code) {
    const key = String(code || '').toLowerCase();
    if (key.includes('auth') || key.includes('unauthorized'))
      return L(
        'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้งก่อนสั่งซื้อ',
        'Your session has expired. Please sign in again before ordering.',
        '登录已过期，请重新登录后下单。'
      );
    if (key.includes('stock') || key.includes('inventory') || key.includes('product'))
      return L(
        'สินค้าบางรายการมีจำนวนไม่เพียงพอหรือเปลี่ยนแปลงแล้ว กรุณาตรวจสอบถุงสินค้าและปรับจำนวน',
        'Some items are unavailable or have insufficient stock. Review your bag and quantities.',
        '部分商品已变更或库存不足，请检查购物袋并调整数量。'
      );
    if (key.includes('coupon'))
      return L(
        'โค้ดส่วนลดใช้ไม่ได้ หมดอายุ หรือยอดสั่งซื้อไม่ตรงเงื่อนไข กรุณาตรวจสอบหรือลบโค้ด',
        'This code is invalid, expired, or does not apply. Check or remove it and try again.',
        '优惠码无效、已过期或不符合条件，请检查或移除后重试。'
      );
    if (key.includes('payment') || key.includes('stripe'))
      return L(
        'ช่องทางชำระเงินนี้ยังไม่พร้อม กรุณาเลือกวิธีอื่น และตรวจสอบหน้าคำสั่งซื้อหากสร้างออเดอร์แล้ว',
        'This payment method is unavailable. Choose another method and check My orders for any order already created.',
        '此支付方式暂不可用，请选择其他方式。如订单已创建，请查看我的订单。'
      );
    if (key.includes('rate'))
      return L(
        'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
        'Too many requests. Please wait a moment and try again.',
        '请求过于频繁，请稍后重试。'
      );
    if (key.includes('invalid') || key.includes('validation'))
      return L(
        'กรุณาตรวจสอบชื่อ อีเมล เบอร์โทร ที่อยู่ และจำนวนสินค้าให้ครบถ้วน',
        'Please check your name, email, phone, address, and item quantities.',
        '请检查姓名、邮箱、电话、地址和商品数量。'
      );
    return L(
      'ยังดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง ข้อมูลเดิมจะใช้เลขอ้างอิงเดียวกันเพื่อป้องกันการสั่งซ้ำ',
      'We could not complete your order. Please retry. Unchanged details use the same reference to avoid duplicate orders.',
      '订单未完成，请重试。相同信息将使用同一参考编号，避免重复下单。'
    );
  }
  function renderNotices() {
    const root = get('checkout-notices');
    let html = '';
    if (!S.configured)
      html += `<div class="customer-notice checkout-notice">${S.icon('package', 20)}<span>${e(L('นี่คือตัวอย่างร้าน สินค้าและราคาสำหรับทดลองดูเท่านั้น ยังไม่รับคำสั่งซื้อหรือชำระเงินจริง', 'This is a store preview with sample products and prices. Ordering and payments are unavailable until the store is connected.', '当前为示例商品和价格的商店预览，连接商店后才能下单及付款。'))}</span></div>`;
    if (S.configured && !settingsLoading && settings && !settings.configured)
      html += `<div class="customer-notice">${e(L('ร้านยังไม่เปิดรับคำสั่งซื้อ กรุณากลับมาใหม่เมื่อพร้อมให้บริการ', 'Ordering is not open yet. Please check back when the store is ready.', '暂未开放下单，请在商店准备就绪后再试。'))}</div>`;
    if (checking && S.configured)
      html += `<div class="customer-notice" role="status">${e(L('กำลังตรวจสอบบัญชี…', 'Checking your account…', '正在检查账户…'))}</div>`;
    if (!checking && !user && S.configured)
      html += `<div class="customer-notice checkout-auth"><span>${S.icon('user', 20)}${e(L('เข้าสู่ระบบเพื่อสั่งซื้อและเก็บออเดอร์ไว้ในบัญชีของคุณ', 'Sign in to place your order and keep it in your account.', '登录以提交订单，并将订单保存至您的账户。'))}</span><a href="/account?next=/checkout" class="button">${e(L('เข้าสู่ระบบ / สมัครสมาชิก', 'Sign in / create account', '登录 / 注册'))}${S.icon('arrow', 17)}</a></div>`;
    if (authError)
      html += `<div class="customer-error">${e(L('ตรวจสอบบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง', 'We could not check your account. Please try again.', '无法检查账户，请重试。'))}<button type="button" class="customer-text-button" data-checkout-retry="auth">${e(L('ลองอีกครั้ง', 'Try again', '重试'))}</button></div>`;
    if (settingsError)
      html += `<div class="customer-error">${e(L('โหลดช่องทางชำระเงินไม่สำเร็จ กรุณาลองอีกครั้ง', 'We could not load payment methods. Please try again.', '无法加载支付方式，请重试。'))}<button type="button" class="customer-text-button" data-checkout-retry="settings">${e(L('ลองอีกครั้ง', 'Try again', '重试'))}</button></div>`;
    root.innerHTML = html;
    root.hidden = !!order || !S.cart.length;
  }
  function renderPayments() {
    get('checkout-payments').innerHTML =
      `<legend class="customer-sr-only">${e(L('วิธีชำระเงิน', 'Payment method', '支付方式'))}</legend>${options
        .map((option) => {
          const available = !!settings?.configured && !!settings.payments?.[option.id];
          return `<label class="payment-option ${available && method === option.id ? 'selected' : ''} ${!available ? 'unavailable' : ''}"><input type="radio" name="paymentMethod" value="${option.id}" ${method === option.id && available ? 'checked' : ''} ${!available || busy ? 'disabled' : ''}><span class="payment-icon">${S.icon(option.icon, 22)}</span><span class="payment-copy"><strong>${e(S.t(option.name))}</strong><small>${e(available ? S.t(option.detail) : settingsLoading ? L('กำลังตรวจสอบช่องทาง…', 'Checking availability…', '正在检查支付方式…') : L('ยังไม่เปิดให้บริการ — ร้านต้องตั้งค่าช่องทางนี้ก่อน', 'Not available yet — the store needs to enable this method.', '暂未开通 — 商店需先配置此支付方式。'))}</small></span>${available && method === option.id ? '<span class="payment-check">✓</span>' : ''}</label>`;
        })
        .join('')}`;
  }
  function renderSummary() {
    const focusedQuantity = document.activeElement?.dataset?.checkoutQuantity,
      focusedChange = document.activeElement?.dataset?.change;
    const cart = S.cart,
      subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0),
      shipping = S.shippingFor(subtotal),
      count = cart.reduce((sum, line) => sum + line.quantity, 0);
    form.hidden = !cart.length || !!order;
    get('checkout-empty').hidden = !!cart.length || !!order;
    get('checkout-item-count').textContent = L(`${count} ชิ้น`, `${count} items`, `${count} 件`);
    get('checkout-items').innerHTML = cart
      .map(
        ({ product: p, quantity: q }) =>
          `<div class="checkout-item"><a class="checkout-item-image" href="/product/${encodeURIComponent(p.slug)}"><img src="${e(p.images?.[0] || '')}" alt="${e(S.t(p.name))}"></a><div class="checkout-item-info"><a class="checkout-item-name" href="/product/${encodeURIComponent(p.slug)}">${e(S.t(p.name))}</a><strong>${e(S.money(p.price))}</strong><div class="checkout-quantity"><button type="button" data-checkout-quantity="${e(p.id)}" data-change="decrease" data-value="${q - 1}" ${busy ? 'disabled' : ''} aria-label="${e(L('ลดจำนวน', 'Decrease quantity', '减少数量'))}">${S.icon('minus', 12)}</button><span>${q}</span><button type="button" data-checkout-quantity="${e(p.id)}" data-change="increase" data-value="${q + 1}" ${busy || q >= Math.min(20, p.stock) ? 'disabled' : ''} aria-label="${e(L('เพิ่มจำนวน', 'Increase quantity', '增加数量'))}">${S.icon('plus', 12)}</button></div></div><button type="button" class="checkout-remove" data-checkout-remove="${e(p.id)}" ${busy ? 'disabled' : ''} aria-label="${e(L('นำสินค้าออก', 'Remove item', '移除商品'))}">${S.icon('trash', 15)}</button></div>`
      )
      .join('');
    get('checkout-totals').innerHTML =
      `<div><dt>${e(L('ยอดสินค้า', 'Subtotal', '商品小计'))}</dt><dd>${e(S.money(subtotal))}</dd></div><div><dt>${e(L('ค่าจัดส่ง', 'Shipping', '运费'))}</dt><dd class="${shipping === 0 ? 'free-shipping' : ''}">${e(shipping === 0 ? L('ฟรี', 'Complimentary', '免费') : S.money(shipping))}</dd></div><div class="checkout-grand-total"><dt>${e(L('ยอดรวมโดยประมาณ', 'Estimated total', '预计总额'))}</dt><dd>${e(S.money(subtotal + shipping))}</dd></div>`;
    renderNotices();
    syncBusy();
    if (focusedQuantity) {
      const nextFocus = [
        ...get('checkout-items').querySelectorAll('[data-checkout-quantity]'),
      ].find(
        (button) =>
          button.dataset.checkoutQuantity === focusedQuantity &&
          button.dataset.change === focusedChange
      );
      if (nextFocus && !nextFocus.disabled) nextFocus.focus();
    }
  }
  function syncBusy() {
    const allowed =
      !!user &&
      S.configured &&
      !!settings?.configured &&
      !!settings.payments?.[method] &&
      S.cart.length > 0 &&
      !checking &&
      !settingsLoading &&
      !authError;
    get('checkout-submit').disabled = busy || !allowed;
    get('checkout-submit').innerHTML =
      `${e(busy ? L('กำลังยืนยัน…', 'Confirming…', '正在确认…') : L('ยืนยันคำสั่งซื้อ', 'Place your order', '确认下单'))}${S.icon('arrow', 17)}`;
    form.querySelectorAll('input:not([name="paymentMethod"]),textarea').forEach((input) => {
      input.disabled = busy;
    });
    const box = get('checkout-error');
    box.hidden = !errorCode;
    box.textContent = errorCode ? checkoutError(errorCode) : '';
  }
  function safePaymentURL(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.origin);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  }
  function renderReceipt() {
    if (!order) return;
    form.hidden = true;
    get('checkout-empty').hidden = true;
    get('checkout-notices').hidden = true;
    const receipt = get('checkout-receipt');
    receipt.hidden = false;
    receipt.innerHTML = `<div class="receipt-check">${S.icon('package', 42)}</div><p class="customer-eyebrow">${e(L('รับคำสั่งซื้อแล้ว', 'ORDER RECEIVED', '订单已收到'))}</p><h1 id="receipt-title" tabindex="-1">${e(L('ขอบคุณที่เลือก Alyzyus', 'A little good is on its way.', '感谢选择 Alyzyus。'))}</h1><p class="receipt-subtitle">${e(L('หมายเลขคำสั่งซื้อ', 'Order number', '订单编号'))} <strong>${e(order.order_number)}</strong></p><div class="receipt-status">${S.icon('package', 18)}<span>${e(order.payment_status === 'paid' ? L('ยืนยันการชำระเงินแล้ว ตรวจสอบความคืบหน้าได้ที่หน้าคำสั่งซื้อ', 'Payment is confirmed. Follow progress in My orders.', '付款已确认，请在我的订单查看进度。') : paymentUrl ? L('รอการชำระเงิน สถานะจะอัปเดตเมื่อผู้ให้บริการยืนยัน', 'Awaiting payment. Status updates after confirmation from the payment provider.', '等待付款，支付服务商确认后状态将更新。') : order.payment_method === 'cod' ? L('เก็บเงินปลายทาง — ชำระเมื่อได้รับสินค้า', 'Cash on delivery — pay when your order arrives.', '货到付款 — 收到商品时支付。') : L('รอชำระเงินและตรวจสอบยอดโอน', 'Awaiting your transfer and payment verification.', '等待转账及付款核实。'))}</span></div>${
      instructions
        ? `<div class="receipt-bank"><h2>${S.icon('card', 19)}${e(L('รายละเอียดสำหรับโอนเงิน', 'Bank transfer details', '银行转账信息'))}</h2><dl>${[
            [L('ธนาคาร', 'Bank', '银行'), instructions.bank],
            [L('ชื่อบัญชี', 'Account name', '账户名称'), instructions.accountName],
            [L('เลขบัญชี', 'Account number', '账号'), instructions.accountNumber],
            [L('เลขอ้างอิง', 'Reference', '参考编号'), instructions.reference],
            [L('ยอดโอน', 'Amount to transfer', '转账金额'), S.money(instructions.amount)],
          ]
            .map(([name, value]) => `<div><dt>${e(name)}</dt><dd>${e(value)}</dd></div>`)
            .join(
              ''
            )}</dl><p>${e(L('ใช้เลขคำสั่งซื้อเป็นเลขอ้างอิง และเก็บหลักฐานจนกว่าร้านยืนยันการชำระเงิน', 'Use your order number as the reference and keep your transfer receipt until payment is confirmed.', '请使用订单编号作为转账参考，并保留凭证直到商店确认付款。'))}</p></div>`
        : ''
    }<div class="receipt-total"><span>${e(L('ยอดคำสั่งซื้อที่ยืนยันแล้ว', 'Confirmed order total', '确认订单总额'))}</span><strong>${e(S.money(order.total))}</strong></div><div class="receipt-actions">${paymentUrl ? `<a href="${e(paymentUrl)}" class="button">${e(L('ไปชำระเงิน', 'Continue to payment', '继续付款'))}${S.icon('arrow', 17)}</a>` : ''}<a href="/tracking?order=${encodeURIComponent(order.id)}" class="button ${paymentUrl ? 'secondary' : ''}">${e(L('ติดตามคำสั่งซื้อ', 'Follow your order', '追踪订单'))}${S.icon('arrow', 17)}</a><a href="/simulation?mode=product&order=${encodeURIComponent(order.id)}" class="button secondary" target="_blank" rel="noopener">${S.icon('package', 17)}${e(L('เส้นทางสินค้า 3D', '3D product journey', '3D 商品旅程'))}</a><a href="/shop" class="customer-text-button">${e(L('เลือกซื้อสินค้าต่อ', 'Continue exploring', '继续购物'))}</a></div>`;
  }
  function clearSession() {
    sessionEpoch++;
    authRequest++;
    user = null;
    busy = false;
    checking = false;
    authError = false;
    order = null;
    instructions = null;
    paymentUrl = '';
    errorCode = '';
    attempt = null;
    form.reset();
    get('checkout-receipt').innerHTML = '';
    get('checkout-receipt').hidden = true;
    renderSummary();
    renderPayments();
  }
  async function loadAuth() {
    const token = ++authRequest,
      epoch = sessionEpoch;
    checking = true;
    authError = false;
    renderNotices();
    syncBusy();
    try {
      const data = await S.api('/api/auth/me', { cache: 'no-store' });
      if (token !== authRequest || epoch !== sessionEpoch) return;
      if (user && user.id !== data.user?.id) {
        clearSession();
        void loadAuth();
        return;
      }
      user = data.user || null;
      if (user) {
        if (!get('checkout-email').value) get('checkout-email').value = user.email || '';
        if (!get('checkout-name').value) get('checkout-name').value = user.name || '';
      }
    } catch {
      if (token === authRequest && epoch === sessionEpoch) {
        authError = true;
        user = null;
      }
    } finally {
      if (token === authRequest && epoch === sessionEpoch) {
        checking = false;
        renderNotices();
        syncBusy();
      }
    }
  }
  async function loadSettings() {
    settingsLoading = true;
    settingsError = false;
    renderPayments();
    renderNotices();
    syncBusy();
    try {
      const data = await S.api('/api/settings', { cache: 'no-store' });
      if (!data.payments) throw new Error('settings');
      settings = data;
      if (!settings.payments[method])
        method = options.find((option) => settings.payments[option.id])?.id || '';
    } catch {
      settingsError = true;
      settings = null;
    } finally {
      settingsLoading = false;
      renderPayments();
      renderNotices();
      syncBusy();
    }
  }
  get('checkout-page').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.dataset.checkoutRetry === 'auth') loadAuth();
    if (button.dataset.checkoutRetry === 'settings') loadSettings();
    if (button.dataset.checkoutQuantity)
      S.updateQuantity(button.dataset.checkoutQuantity, Number(button.dataset.value));
    if (button.dataset.checkoutRemove) S.removeFromCart(button.dataset.checkoutRemove);
  });
  get('checkout-payments').addEventListener('change', (event) => {
    if (event.target.name === 'paymentMethod') {
      method = event.target.value;
      renderPayments();
      syncBusy();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !user || !settings?.configured || !settings.payments?.[method] || !S.cart.length)
      return;
    const epoch = sessionEpoch;
    const fields = new FormData(form),
      coupon = String(fields.get('coupon') || '')
        .trim()
        .toUpperCase();
    const payload = {
      items: S.cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      customer: {
        name: String(fields.get('name') || '').trim(),
        email: String(fields.get('email') || '').trim(),
        phone: String(fields.get('phone') || '').trim(),
        address: String(fields.get('address') || '').trim(),
      },
      paymentMethod: method,
      ...(coupon ? { coupon } : {}),
    };
    const signature = JSON.stringify(payload);
    if (!attempt || attempt.signature !== signature)
      attempt = { signature, key: crypto.randomUUID() };
    busy = true;
    errorCode = '';
    syncBusy();
    renderPayments();
    renderSummary();
    try {
      const data = await S.api('/api/checkout', {
        method: 'POST',
        body: { ...payload, idempotencyKey: attempt.key },
      });
      if (epoch !== sessionEpoch) return;
      if (!data.order?.id) throw new Error('MISSING_ORDER');
      order = data.order;
      instructions =
        data.paymentInstructions?.type === 'bank_transfer' ? data.paymentInstructions : null;
      paymentUrl = safePaymentURL(data.checkoutUrl);
      S.clearCart();
      attempt = null;
      renderReceipt();
      get('receipt-title')?.focus();
      if (paymentUrl) location.assign(paymentUrl);
    } catch (err) {
      if (epoch !== sessionEpoch) return;
      errorCode = err.code || 'REQUEST_FAILED';
      if (err.status === 401) {
        user = null;
        renderNotices();
      }
    } finally {
      if (epoch === sessionEpoch) {
        busy = false;
        syncBusy();
        renderPayments();
        if (order) renderReceipt();
        else renderSummary();
      }
    }
  });
  S.watchPrivateSession({
    clear: clearSession,
    reload: () => {
      if (!busy) return loadAuth();
    },
  });
  S.onChange((event) => {
    if (event.detail.type === 'locale') {
      renderPayments();
      renderReceipt();
      renderSummary();
      syncBusy();
    } else if (event.detail.type === 'cart') renderSummary();
  });
  renderSummary();
  renderPayments();
  Promise.allSettled([loadAuth(), loadSettings()]);
})();
