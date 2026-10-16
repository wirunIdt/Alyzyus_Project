/* Alyzyus storefront: dependency-free, progressively enhanced HTML. */
(() => {
  'use strict';
  const boot = window.__SHOP__ || { products: [], configured: false };
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const readText = (key, fallback) => {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  };
  let locale = readText('alyzyus-locale', 'th');
  if (!['th', 'en', 'zh'].includes(locale)) locale = 'th';
  let theme = readText('alyzyus-theme', 'light');
  if (!['light', 'dark'].includes(theme)) theme = 'light';
  let wishlist = read('alyzyus-wishlist', []);
  if (!Array.isArray(wishlist)) wishlist = [];
  let cart = [];
  const stored = read('alyzyus-cart', []);
  if (Array.isArray(stored))
    for (const line of stored) {
      if (!line || typeof line !== 'object') continue;
      const product = boot.products.find((p) => p.id === line.id);
      if (
        product &&
        product.stock > 0 &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0 &&
        !cart.some((l) => l.product.id === line.id)
      )
        cart.push({ product, quantity: Math.min(20, product.stock, line.quantity) });
    }
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  const t = (value) => (typeof value === 'string' ? value : value?.[locale] || value?.en || '');
  const money = (value) =>
    new Intl.NumberFormat({ th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }[locale], {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: Number(value) % 1 ? 2 : 0,
    }).format(Number(value) || 0);
  const icon = (name, size = 18) =>
    `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${escape(name)}"/></svg>`;
  const categories = {
    audio: { th: 'เครื่องเสียง', en: 'Sound & audio', zh: '音频设备' },
    workspace: { th: 'มุมทำงาน', en: 'Workspace', zh: '工作空间' },
    home: { th: 'บ้านและการใช้ชีวิต', en: 'Home & living', zh: '家居生活' },
    style: { th: 'สไตล์และเครื่องแต่งกาย', en: 'Style & carry', zh: '时尚配饰' },
    everyday: { th: 'ของใช้ประจำวัน', en: 'Everyday essentials', zh: '日常必备' },
  };
  const shippingFor = (subtotal) => (subtotal === 0 || subtotal >= 2500 ? 0 : 80);
  function persist() {
    try {
      localStorage.setItem('alyzyus-locale', locale);
      localStorage.setItem('alyzyus-theme', theme);
      localStorage.setItem(
        'alyzyus-cart',
        JSON.stringify(cart.map((l) => ({ id: l.product.id, quantity: l.quantity })))
      );
      localStorage.setItem('alyzyus-wishlist', JSON.stringify(wishlist));
    } catch {}
  }
  function translate(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      try {
        el.textContent = t(JSON.parse(el.dataset.i18n));
      } catch {}
    });
    root.querySelectorAll('[data-money]').forEach((el) => {
      el.textContent = money(el.dataset.money);
    });
    root.querySelectorAll('[data-category-name]').forEach((el) => {
      el.textContent = categories[el.dataset.categoryName]
        ? t(categories[el.dataset.categoryName])
        : el.dataset.categoryName;
    });
  }
  let toastTimer;
  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  }
  function emit(type) {
    persist();
    renderShared();
    window.dispatchEvent(new CustomEvent('shop:change', { detail: { type } }));
  }
  function addToCart(product, quantity = 1) {
    if (typeof product === 'string') product = boot.products.find((p) => p.id === product);
    if (!product || product.stock < 1) return;
    quantity = Number.isFinite(Number(quantity)) ? Math.max(1, Math.floor(Number(quantity))) : 1;
    const line = cart.find((l) => l.product.id === product.id);
    if (line) line.quantity = Math.min(20, product.stock, line.quantity + quantity);
    else cart.push({ product, quantity: Math.min(20, product.stock, quantity) });
    emit('cart');
    toast(t({ th: 'เพิ่มลงในถุงแล้ว', en: 'Added to your bag', zh: '已加入购物袋' }));
  }
  function updateQuantity(id, quantity) {
    quantity = Math.floor(Number(quantity));
    if (!Number.isFinite(quantity)) return;
    cart = cart.flatMap((l) =>
      l.product.id === id
        ? quantity < 1
          ? []
          : [{ ...l, quantity: Math.min(20, l.product.stock, quantity) }]
        : [l]
    );
    emit('cart');
  }
  function removeFromCart(id) {
    cart = cart.filter((l) => l.product.id !== id);
    emit('cart');
  }
  function clearCart() {
    cart = [];
    emit('cart');
  }
  function toggleWishlist(id) {
    wishlist = wishlist.includes(id) ? wishlist.filter((x) => x !== id) : [...wishlist, id];
    emit('wishlist');
  }
  function authSignal(authenticated, reason) {
    window.dispatchEvent(new CustomEvent('alyzyus:auth', { detail: { authenticated, reason } }));
    if (['login', 'signup', 'logout'].includes(reason)) {
      try {
        localStorage.setItem(
          'alyzyus-auth-sync',
          reason + ':' + String(Date.now()) + ':' + Math.random().toString(36).slice(2)
        );
      } catch {}
    }
  }
  // หน้าข้อมูลส่วนตัวล้าง DOM เมื่อออกจากระบบ และตรวจบัญชีใหม่เมื่อคืนหน้าจอจาก BFCache
  // callback ของแต่ละหน้าต้องเพิ่ม token ของคำขอ เพื่อกันผลลัพธ์เก่ากลับมาแสดง
  function watchPrivateSession({ clear, reload, ignoreLocalSignIn = false }) {
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reload();
      }, 120);
    };
    const invalidate = (reason) => {
      clearTimeout(timer);
      clear(reason);
    };
    const auth = (event) => {
      const { authenticated, reason } = event.detail || {};
      if (ignoreLocalSignIn && ['login', 'signup'].includes(reason)) return;
      if (authenticated === false || reason === 'logout') invalidate(reason || 'expired');
      else {
        invalidate(reason || 'signin');
        schedule();
      }
    };
    const storage = (event) => {
      if (event.key !== 'alyzyus-auth-sync') return;
      invalidate('storage');
      if (!String(event.newValue || '').startsWith('logout:')) schedule();
    };
    const hide = () => invalidate('pagehide');
    const show = (event) => {
      if (event.persisted) {
        invalidate('restore');
        schedule();
      }
    };
    const visible = () => {
      if (!document.hidden) schedule();
    };
    window.addEventListener('alyzyus:auth', auth);
    window.addEventListener('storage', storage);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('alyzyus:auth', auth);
      window.removeEventListener('storage', storage);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visible);
    };
  }
  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    let body = options.body;
    if (body && typeof body !== 'string' && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    } else if (typeof body === 'string') headers.set('Content-Type', 'application/json');
    if (boot.csrf) headers.set('X-CSRF-Token', boot.csrf);
    const authAction =
      typeof url === 'string' && /^\/api\/auth\/(login|signup|logout)$/.exec(url)?.[1];
    // ยกเลิกสีและภาพส่วนตัวทันทีที่กดออกจากระบบ แม้เครือข่ายตอบช้า
    if (authAction === 'logout') authSignal(false, 'logout');
    const response = await fetch(url, { ...options, body, headers, credentials: 'same-origin' });
    if (authAction === 'logout') authSignal(false, 'logout');
    let data;
    try {
      data = await response.json();
    } catch {
      data = { error: { code: 'SERVER_ERROR', message: 'Request failed' } };
    }
    if (!response.ok) {
      if (response.status === 401) authSignal(false, 'expired');
      const info = data.error || data;
      const err = new Error(typeof info === 'string' ? info : info.message || 'Request failed');
      err.code = info.code || data.code || 'REQUEST_FAILED';
      err.status = response.status;
      err.details = info.details;
      throw err;
    }
    if (authAction && authAction !== 'logout') authSignal(!!data.user, authAction);
    return data;
  }
  function openCart() {
    const dialog = document.getElementById('cart-dialog');
    renderCart();
    if (dialog && !dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
  }
  function closeCart() {
    document.getElementById('cart-dialog')?.close();
    document.body.style.overflow = '';
  }
  function renderCart() {
    const root = document.getElementById('cart-content');
    if (!root) return;
    const subtotal = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);
    if (!cart.length) {
      root.innerHTML = `<div class="empty-state">${icon('bag', 44)}<h3>${escape(t({ th: 'พื้นที่สำหรับชิ้นโปรดของคุณ', en: 'Room for something good', zh: '留给心爱好物的空间' }))}</h3><p>${escape(t({ th: 'เลือกสิ่งที่ชอบ แล้วเพิ่มลงในถุงได้เลย', en: 'Find a little something for your everyday.', zh: '挑选喜爱的商品，加入购物袋。' }))}</p><a href="/shop" class="button">${escape(t({ th: 'สำรวจสินค้า', en: 'Explore the collection', zh: '探索商品' }))}${icon('arrow', 17)}</a></div>`;
      return;
    }
    const shippingText =
      subtotal >= 2500
        ? t({
            th: 'คำสั่งซื้อนี้ส่งฟรีแล้ว',
            en: 'Your order qualifies for free shipping',
            zh: '此订单已享免运费',
          })
        : t({
            th: `อีก ${money(2500 - subtotal)} ก็ส่งฟรี`,
            en: `You're ${money(2500 - subtotal)} away from free shipping`,
            zh: `再购 ${money(2500 - subtotal)} 即免运费`,
          });
    root.innerHTML = `<div class="shipping-progress"><p>${escape(shippingText)}</p><progress max="2500" value="${Math.min(subtotal, 2500)}"></progress></div><div class="cart-lines">${cart.map(({ product: p, quantity: q }) => `<div class="cart-line"><img src="${escape(p.images[0])}" alt="${escape(t(p.name))}"><div><a href="/product/${encodeURIComponent(p.slug)}">${escape(t(p.name))}</a><span>${escape(money(p.price))}</span><div class="quantity"><button data-quantity="${escape(p.id)}" data-value="${q - 1}" aria-label="${escape(t({ th: 'ลดจำนวน', en: 'Decrease quantity', zh: '减少数量' }))}">${icon('minus', 14)}</button><span>${q}</span><button data-quantity="${escape(p.id)}" data-value="${q + 1}" ${q >= Math.min(p.stock, 20) ? 'disabled' : ''} aria-label="${escape(t({ th: 'เพิ่มจำนวน', en: 'Increase quantity', zh: '增加数量' }))}">${icon('plus', 14)}</button></div></div><button class="icon-button" data-remove="${escape(p.id)}" aria-label="${escape(t({ th: 'นำสินค้าออก', en: 'Remove item', zh: '移除商品' }))}">${icon('trash', 16)}</button></div>`).join('')}</div><div class="cart-total"><div><span>${escape(t({ th: 'ยอดสินค้า', en: 'Subtotal', zh: '商品小计' }))}</span><strong>${escape(money(subtotal))}</strong></div><div><span>${escape(t({ th: 'ค่าจัดส่ง', en: 'Shipping', zh: '运费' }))}</span><span>${escape(money(shippingFor(subtotal)))}</span></div><a href="/checkout" class="button full">${escape(t({ th: 'ดำเนินการสั่งซื้อ', en: 'Continue to checkout', zh: '前往结账' }))}${icon('arrow')}</a><p>${escape(t({ th: 'ยอดสุดท้ายจะตรวจสอบอีกครั้งก่อนยืนยัน', en: 'Final pricing is verified before confirmation.', zh: '确认前将再次核对最终金额。' }))}</p></div>`;
  }
  function renderShared() {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    const select = document.getElementById('language');
    if (select) select.value = locale;
    const button = document.getElementById('theme-toggle');
    if (button) button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    translate();
    const count = document.getElementById('bag-count');
    if (count) count.textContent = cart.reduce((s, l) => s + l.quantity, 0);
    document.querySelectorAll('[data-save]').forEach((button) => {
      const saved = wishlist.includes(button.dataset.save);
      button.setAttribute('aria-pressed', String(saved));
      button.classList.toggle('saved', saved);
      const svg = button.querySelector('svg');
      if (svg) svg.setAttribute('fill', saved ? 'currentColor' : 'none');
    });
    renderCart();
  }
  window.Shop = {
    get locale() {
      return locale;
    },
    get theme() {
      return theme;
    },
    get products() {
      return boot.products;
    },
    get configured() {
      return !!boot.configured;
    },
    get cart() {
      return cart;
    },
    get wishlist() {
      return wishlist;
    },
    t,
    money,
    shippingFor,
    escape,
    icon,
    categories,
    translate,
    api,
    toast,
    watchPrivateSession,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    toggleWishlist,
    openCart,
    closeCart,
    setLocale(value) {
      if (['th', 'en', 'zh'].includes(value)) {
        locale = value;
        emit('locale');
      }
    },
    setTheme(value) {
      if (['light', 'dark'].includes(value)) {
        theme = value;
        emit('theme');
      }
    },
    onChange(callback) {
      window.addEventListener('shop:change', callback);
      return () => window.removeEventListener('shop:change', callback);
    },
  };
  document
    .getElementById('language')
    ?.addEventListener('change', (e) => Shop.setLocale(e.target.value));
  document
    .getElementById('theme-toggle')
    ?.addEventListener('click', () => Shop.setTheme(theme === 'light' ? 'dark' : 'light'));
  document.getElementById('bag-toggle')?.addEventListener('click', openCart);
  document.getElementById('bag-close')?.addEventListener('click', closeCart);
  const dialog = document.getElementById('cart-dialog');
  dialog?.addEventListener('cancel', () => {
    document.body.style.overflow = '';
  });
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) closeCart();
  });
  document.getElementById('search-toggle')?.addEventListener('click', () => {
    const form = document.getElementById('header-search');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input').focus();
  });
  document.getElementById('menu-toggle')?.addEventListener('click', (e) => {
    const nav = document.getElementById('main-nav');
    nav.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(nav.classList.contains('open')));
  });
  document.getElementById('main-nav')?.addEventListener('click', () => {
    document.getElementById('main-nav').classList.remove('open');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      addToCart(add.dataset.add);
      return;
    }
    const save = e.target.closest('[data-save]');
    if (save) {
      toggleWishlist(save.dataset.save);
      return;
    }
    const qty = e.target.closest('[data-quantity]');
    if (qty) {
      updateQuantity(qty.dataset.quantity, Number(qty.dataset.value));
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) removeFromCart(remove.dataset.remove);
  });
  const detail = document.querySelector('[data-detail-product]');
  if (detail) {
    const product = boot.products.find((p) => p.id === detail.dataset.detailProduct);
    let quantity = 1;
    const minus = document.getElementById('quantity-minus'),
      plus = document.getElementById('quantity-plus');
    function sync() {
      document.getElementById('detail-quantity').textContent = quantity;
      minus.disabled = quantity <= 1;
      plus.disabled = quantity >= Math.min(product.stock, 20);
    }
    minus.addEventListener('click', () => {
      quantity = Math.max(1, quantity - 1);
      sync();
    });
    plus.addEventListener('click', () => {
      quantity = Math.min(product.stock, 20, quantity + 1);
      sync();
    });
    document.getElementById('detail-add').addEventListener('click', () => {
      addToCart(product, quantity);
      openCart();
    });
    detail.querySelectorAll('[data-image]').forEach((button) =>
      button.addEventListener('click', () => {
        document.getElementById('detail-image').src = button.dataset.image;
      })
    );
    sync();
  }
  renderShared();
  const intro = document.getElementById('cinematic-intro');
  if (intro) {
    try {
      if (
        !sessionStorage.getItem('alyzyus-intro') &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        sessionStorage.setItem('alyzyus-intro', '1');
        intro.hidden = false;
        const skip = () => {
          intro.hidden = true;
        };
        document.getElementById('skip-intro').addEventListener('click', skip);
        setTimeout(skip, 2700);
      }
    } catch {}
  }
})();
