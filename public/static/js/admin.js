/* Alyzyus Store Studio — permission-checked product and order management. */
(() => {
  'use strict';
  const S = window.Shop,
    root = document.getElementById('admin-root'),
    dialog = document.getElementById('admin-dialog');
  if (!S || !root || !dialog) return;
  const e = S.escape,
    L = (th, en, zh) => S.t({ th, en, zh }),
    demo = !S.configured;
  const orderParameters = new URLSearchParams(location.search).getAll('order');
  let requestedOrder = !demo && orderParameters.length === 1 ? orderParameters[0] : null,
    orderLinkMissing = false;
  let section = 'overview',
    data = null,
    loading = true,
    access = 'allowed',
    search = '',
    filter = 'all',
    busy = false,
    editor = null,
    contentLanguage = 'th',
    selected = null,
    shipment = { carrier: '', tracking_number: '' },
    confirmAction = '',
    modalError = null,
    lastFocus = null;
  const languages = ['th', 'en', 'zh'],
    languageNames = { th: 'ไทย', en: 'English', zh: '中文' };
  let sourceLanguage = 'th',
    translatedSignature = '',
    operation = 'save',
    autoTranslate = true;
  let sessionEpoch = 0,
    loadRequest = 0;
  const translationSignature = () =>
    JSON.stringify([
      sourceLanguage,
      editor?.name[sourceLanguage],
      editor?.description[sourceLanguage],
    ]);
  function imageGallery() {
    const images = editor.images
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    return `<div class="adm-image-gallery">${images.map((url, i) => `<figure>${image(url) ? `<img src="${image(url)}" alt="${e(L('รูปสินค้า', 'Product image', '商品图片'))} ${i + 1}" loading="lazy">` : ''}<figcaption>${i === 0 ? e(L('ภาพหลัก', 'Cover', '封面')) : i + 1}<div>${i > 0 ? `<button type="button" data-cover-image="${i}" aria-label="${e(L('ใช้เป็นภาพหลัก', 'Use as cover', '设为封面'))}">${S.icon('arrow-up', 15)}</button>` : ''}<button type="button" data-remove-image="${i}" aria-label="${e(L('นำรูปออกจากสินค้า', 'Remove image from product', '移除商品图片'))}">${S.icon('close', 15)}</button></div></figcaption></figure>`).join('')}</div>`;
  }
  async function translateDraft() {
    if (demo || busy || !editor) return false;
    const epoch = sessionEpoch;
    const name = editor.name[sourceLanguage].trim(),
      description = editor.description[sourceLanguage].trim();
    if (!name || !description) {
      modalError = {
        th: 'กรอกชื่อและรายละเอียดในภาษาหลักก่อนแปล',
        en: 'Add a name and description in the source language first.',
        zh: '请先填写源语言的名称和描述。',
      };
      renderModal();
      return false;
    }
    busy = true;
    operation = 'translate';
    modalError = null;
    renderModal();
    try {
      const result = await S.api('/api/admin/translate', {
        method: 'POST',
        body: { source: sourceLanguage, name, description },
      });
      if (epoch !== sessionEpoch) return false;
      editor.name = result.name;
      editor.description = result.description;
      translatedSignature = translationSignature();
      S.toast(
        L(
          'แปลแล้ว สามารถเปิดแต่ละภาษาเพื่อตรวจแก้ได้',
          'Translated. Open each language to review and edit.',
          '已翻译，可逐个语言检查和修改。'
        )
      );
      return true;
    } catch (err) {
      if (epoch !== sessionEpoch) return false;
      modalError =
        err.code === 'TRANSLATION_UNAVAILABLE'
          ? {
              th: 'บริการแปลไม่พร้อมหรือโควตาหมด ข้อมูลที่กรอกยังอยู่ ลองใหม่ภายหลังหรือกรอกคำแปลเองในแท็บภาษา',
              en: 'Translation is unavailable or its quota is reached. Your draft is retained. Retry later or enter translations in the language tabs.',
              zh: '翻译服务暂不可用或额度已用完。草稿已保留，可稍后重试或手动填写。',
            }
          : message(err.code);
      return false;
    } finally {
      if (epoch === sessionEpoch) {
        busy = false;
        operation = 'save';
        renderModal();
      }
    }
  }
  async function uploadImages(files) {
    if (demo || busy || !editor || !files.length) return;
    const epoch = sessionEpoch;
    const urls = editor.images
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    if (urls.length + files.length > 10) {
      modalError = {
        th: 'สินค้าใส่ภาพได้ไม่เกิน 10 รูป',
        en: 'Add up to ten images per product.',
        zh: '每个商品最多十张图片。',
      };
      renderModal();
      return;
    }
    busy = true;
    operation = 'upload';
    modalError = null;
    renderModal();
    try {
      // ย่อรูปทีละไฟล์และคืนหน่วยความจำทันที ไม่โหลดรูปทั้งหมดพร้อมกัน
      for (const file of files) {
        if (
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size > 12 * 1024 * 1024
        )
          throw new Error('INVALID_IMAGE');
        const bitmap = await createImageBitmap(file);
        if (epoch !== sessionEpoch) {
          bitmap.close();
          return;
        }
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
        if (blob?.size > 800000)
          blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.6));
        canvas.width = canvas.height = 1;
        if (epoch !== sessionEpoch) return;
        if (!blob || blob.size > 800000) throw new Error('INVALID_IMAGE');
        const body = new FormData();
        body.append('file', blob, 'product.webp');
        const result = await S.api('/api/admin/images', { method: 'POST', body });
        if (epoch !== sessionEpoch) return;
        urls.push(result.url);
        editor.images = urls.join('\n');
      }
      S.toast(
        L(
          'อัปโหลดรูปแล้ว รูปแรกเป็นภาพหลัก',
          'Images uploaded. The first image is the cover.',
          '图片已上传，第一张为封面。'
        )
      );
    } catch (err) {
      if (epoch !== sessionEpoch) return;
      modalError = {
        th: 'อัปโหลดบางรูปไม่สำเร็จ ใช้ JPG PNG หรือ WebP ไม่เกิน 12 MB ต่อรูป รูปที่สำเร็จยังอยู่',
        en: 'Some images could not be uploaded. Use JPG, PNG or WebP under 12 MB each. Completed uploads are retained.',
        zh: '部分图片未上传成功。请使用每张不超过12MB的 JPG、PNG 或 WebP。成功上传的图片已保留。',
      };
    } finally {
      if (epoch === sessionEpoch) {
        busy = false;
        operation = 'save';
        renderModal();
      }
    }
  }
  const sections = {
    overview: { th: 'ภาพรวมร้านค้า', en: 'Overview', zh: '商店概览' },
    orders: { th: 'คำสั่งซื้อ', en: 'Orders', zh: '订单' },
    products: { th: 'สินค้า', en: 'Products', zh: '商品' },
  };
  const statuses = {
    pending: { th: 'รอยืนยัน', en: 'Pending', zh: '待确认' },
    confirmed: { th: 'ยืนยันแล้ว', en: 'Confirmed', zh: '已确认' },
    processing: { th: 'กำลังเตรียมสินค้า', en: 'Processing', zh: '备货中' },
    shipped: { th: 'จัดส่งแล้ว', en: 'Shipped', zh: '已发货' },
    delivered: { th: 'ส่งสำเร็จ', en: 'Delivered', zh: '已送达' },
    cancelled: { th: 'ยกเลิก', en: 'Cancelled', zh: '已取消' },
  };
  const payments = {
    pending: { th: 'รอชำระ', en: 'Unpaid', zh: '待支付' },
    paid: { th: 'ชำระแล้ว', en: 'Paid', zh: '已支付' },
    failed: { th: 'ชำระไม่สำเร็จ', en: 'Failed', zh: '支付失败' },
    expired: { th: 'หมดเวลา', en: 'Expired', zh: '已过期' },
    refund_required: { th: 'ต้องคืนเงิน', en: 'Refund required', zh: '需要退款' },
  };
  const paymentMethods = {
    cod: { th: 'เก็บเงินปลายทาง', en: 'Cash on delivery', zh: '货到付款' },
    bank_transfer: { th: 'โอนเงินผ่านธนาคาร', en: 'Bank transfer', zh: '银行转账' },
    card: { th: 'บัตรและช่องทางออนไลน์', en: 'Cards & online payments', zh: '银行卡和在线支付' },
    promptpay: { th: 'พร้อมเพย์', en: 'PromptPay', zh: 'PromptPay' },
  };
  const nextStatuses = {
    pending: 'confirmed',
    confirmed: 'processing',
    processing: 'shipped',
    shipped: 'delivered',
  };
  const orders = () => (demo ? [] : data?.orders || []),
    products = () => (demo ? S.products : data?.products || []);
  function label(values, key) {
    return values[key] ? S.t(values[key]) : String(key || '—');
  }
  function date(value, full = false) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return full
      ? parsed.toLocaleString({ th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }[S.locale], {
          timeZone: 'Asia/Bangkok',
        })
      : parsed.toLocaleDateString({ th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }[S.locale], {
          day: 'numeric',
          month: 'short',
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
  const status = (order, payment = false) => {
    const value = payment ? order.payment_status : order.status,
      known = Object.hasOwn(payment ? payments : statuses, value);
    return `<span class="adm-status adm-status-${known ? e(value) : 'pending'}"><span></span>${e(label(payment ? payments : statuses, value))}</span>`;
  };
  function message(code) {
    const dictionary = {
      UNAUTHORIZED: {
        th: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลอีกครั้ง',
        en: 'Your session expired. Sign in again with your administrator account.',
        zh: '登录已过期，请重新使用管理员账户登录。',
      },
      FORBIDDEN: {
        th: 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลร้านค้า',
        en: 'This account does not have administrator access.',
        zh: '此账户没有管理员权限。',
      },
      INVALID_STATUS_TRANSITION: {
        th: 'เปลี่ยนสถานะนี้ไม่ได้ กรุณารีเฟรชรายการอีกครั้ง',
        en: 'This status change is not available. Refresh the order and try again.',
        zh: '无法更改为此状态，请刷新订单后重试。',
      },
      INVALID_PAYMENT: {
        th: 'กรุณายืนยันการชำระเงินก่อนดำเนินการต่อ ยกเว้นออเดอร์เก็บเงินปลายทาง',
        en: 'Verify payment before proceeding, unless this is a cash-on-delivery order.',
        zh: '除货到付款订单外，请先确认付款再继续。',
      },
      REFUND_REQUIRED: {
        th: 'คำสั่งซื้อชำระแล้ว กรุณาดำเนินการคืนเงินผ่านผู้ให้บริการก่อนยกเลิก',
        en: 'This order is paid. Process its refund with the payment provider before cancelling.',
        zh: '此订单已支付，请先通过支付服务商处理退款。',
      },
      PAYMENT_RECONCILIATION_REQUIRED: {
        th: 'กรุณาตรวจสอบรายการกับผู้ให้บริการชำระเงินก่อนยกเลิก',
        en: 'Check this order with the payment provider before cancelling.',
        zh: '取消前请先向支付服务商核对订单。',
      },
      PRODUCT_ALREADY_EXISTS: {
        th: 'ลิงก์สินค้านี้ถูกใช้แล้ว กรุณาตั้ง slug ใหม่',
        en: 'This product URL is already in use. Choose a different slug.',
        zh: '此商品链接已被使用，请更换链接标识。',
      },
    };
    return (
      dictionary[code] || {
        th: 'บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูลและลองอีกครั้ง',
        en: 'Changes could not be saved. Check your information and try again.',
        zh: '保存失败，请检查信息后重试。',
      }
    );
  }
  const empty = (title, body, action = '') =>
    `<div class="adm-empty"><div class="adm-empty-icon">${S.icon('bag', 25)}</div><h3>${e(title)}</h3><p>${e(body)}</p>${action}</div>`;
  function visibleOrders() {
    const query = search.toLocaleLowerCase().trim();
    return orders().filter(
      (order) =>
        (filter === 'all' || order.status === filter) &&
        `${order.order_number} ${order.customer_name} ${order.email}`
          .toLocaleLowerCase()
          .includes(query)
    );
  }
  function visibleProducts() {
    const query = search.toLocaleLowerCase().trim();
    return products().filter(
      (p) =>
        (filter === 'all' ||
          (filter === 'low' && p.stock <= 5) ||
          (filter === 'active' && p.active !== false) ||
          (filter === 'archived' && p.active === false)) &&
        `${S.t(p.name)} ${p.slug} ${p.category}`.toLocaleLowerCase().includes(query)
    );
  }
  function orderTable(list, filtered = false) {
    if (!list.length)
      return empty(
        filtered
          ? L('ไม่พบคำสั่งซื้อ', 'No matching orders', '未找到匹配订单')
          : L('พร้อมรับออเดอร์แรกแล้ว', 'Ready for your first order', '准备好迎接第一笔订单'),
        filtered
          ? L(
              'ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ',
              'Try a different search or status filter.',
              '请尝试其他搜索词或状态筛选。'
            )
          : L(
              'เมื่อมีลูกค้าสั่งซื้อ รายละเอียดทั้งหมดจะแสดงอยู่ที่นี่',
              'When a customer checks out, all the details appear here.',
              '客户下单后，所有订单详情将显示在此处。'
            )
      );
    return `<div class="adm-table-scroll"><table class="adm-table"><thead><tr>${[L('คำสั่งซื้อ', 'Order', '订单'), L('ลูกค้า', 'Customer', '客户'), L('สถานะ', 'Status', '状态'), L('การชำระเงิน', 'Payment', '支付'), L('ยอดรวม', 'Total', '总计')].map((title) => `<th scope="col">${e(title)}</th>`).join('')}<th scope="col"><span class="adm-sr-only">${e(L('รายละเอียด', 'Details', '详情'))}</span></th></tr></thead><tbody>${list.map((order) => `<tr><td><button class="adm-order-link" type="button" data-order="${e(order.id)}">${e(order.order_number)}</button><small class="adm-cell-sub">${e(date(order.created_at))}</small></td><td><strong class="adm-customer-name">${e(order.customer_name)}</strong><small class="adm-cell-sub">${(order.items || []).reduce((sum, item) => sum + Number(item.quantity), 0)} ${e(L('ชิ้น', 'items', '件商品'))}</small></td><td>${status(order)}</td><td>${status(order, true)}</td><td class="adm-money">${e(S.money(order.total))}</td><td><button type="button" class="adm-icon-button" data-order="${e(order.id)}" aria-label="${e(L('ดูคำสั่งซื้อ', 'View order', '查看订单'))} ${e(order.order_number)}">${S.icon('arrow-up', 17)}</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function productTable(list) {
    if (!list.length)
      return empty(
        L('ยังไม่พบสินค้า', 'No products here yet', '暂无商品'),
        L(
          'ลองเปลี่ยนคำค้น หรือเพิ่มสินค้าแรกของร้าน',
          'Try another search, or add your first product.',
          '尝试其他搜索词，或添加第一件商品。'
        ),
        `<button type="button" class="button secondary" data-add-product>${S.icon('plus', 16)}${e(L('เพิ่มสินค้า', 'Add product', '添加商品'))}</button>`
      );
    return `<div class="adm-table-scroll"><table class="adm-table adm-products-table"><thead><tr>${[L('สินค้า', 'Product', '商品'), L('หมวดหมู่', 'Category', '分类'), L('ราคา', 'Price', '价格'), L('สต็อก', 'Inventory', '库存'), L('สถานะ', 'Status', '状态')].map((title) => `<th scope="col">${e(title)}</th>`).join('')}<th scope="col"><span class="adm-sr-only">${e(L('แก้ไข', 'Edit', '编辑'))}</span></th></tr></thead><tbody>${list
      .map((p) => {
        const url = image(p.images?.[0]);
        return `<tr><td><button class="adm-product-name" type="button" data-product="${e(p.id)}">${url ? `<img src="${url}" alt="" loading="lazy">` : `<span class="adm-product-image-fallback">${S.icon('package', 18)}</span>`}<span><strong>${e(S.t(p.name))}</strong><small>${e(p.slug)}</small></span></button></td><td><span class="adm-category">${e(S.categories[p.category] ? S.t(S.categories[p.category]) : p.category)}</span></td><td class="adm-money">${e(S.money(p.price))}</td><td><span class="adm-inventory ${p.stock <= 5 ? 'low' : ''}"><i></i>${e(p.stock)} ${e(L('ชิ้น', 'in stock', '件'))}</span></td><td><span class="adm-status ${p.active === false ? 'adm-status-cancelled' : 'adm-status-paid'}"><span></span>${e(p.active === false ? L('เก็บเข้าคลัง', 'Archived', '已归档') : L('วางขาย', 'Active', '在售'))}</span></td><td><button class="adm-icon-button" type="button" data-product="${e(p.id)}" aria-label="${e(L('แก้ไข', 'Edit', '编辑'))} ${e(S.t(p.name))}">${S.icon('filter', 17)}</button></td></tr>`;
      })
      .join('')}</tbody></table></div>`;
  }
  function metric(title, value, note, icon, featured = false) {
    return `<div class="adm-metric ${featured ? 'featured' : ''}"><div class="adm-metric-top"><span>${e(title)}</span><span class="adm-metric-icon">${S.icon(icon, 18)}</span></div><strong>${e(value)}</strong><p><span></span>${e(note)}</p>${featured ? '<span class="adm-metric-decoration" aria-hidden="true">✦</span>' : ''}</div>`;
  }
  function overview() {
    const all = orders(),
      paid = all.filter((o) => o.payment_status === 'paid'),
      open = all.filter((o) => !['delivered', 'cancelled'].includes(o.status)),
      active = products().filter((p) => p.active !== false),
      low = active.filter((p) => p.stock <= 5),
      total = demo ? 0 : (data?.totalOrderCount ?? all.length),
      limited = total > all.length,
      revenue = paid.reduce((sum, o) => sum + Number(o.total), 0);
    const dayKey = (date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
      week = Array.from({ length: 7 }, (_, i) => {
        const day = new Date();
        day.setDate(day.getDate() - (6 - i));
        return {
          date: day,
          value: paid
            .filter((o) => dayKey(new Date(o.created_at)) === dayKey(day))
            .reduce((sum, o) => sum + Number(o.total), 0),
        };
      }),
      weekTotal = week.reduce((sum, day) => sum + day.value, 0),
      max = Math.max(1, ...week.map((day) => day.value));
    const radar = (title, body, count, icon, color, section, filter) =>
      `<button class="adm-radar-row" type="button" data-section="${section}" data-section-filter="${filter}"><span class="adm-radar-icon ${color}">${S.icon(icon, 18)}</span><span><strong>${e(title)}</strong><small>${e(body)}</small></span><b>${count}</b>${S.icon('arrow', 16)}</button>`;
    return `<div class="adm-metrics">${metric(limited ? L('ยอดรับชำระ (รายการที่แสดง)', 'Collected · displayed orders', '收款 · 当前显示订单') : L('ยอดรับชำระทั้งหมด', 'Total collected', '累计已收款'), S.money(revenue), L(`จาก ${paid.length} คำสั่งซื้อที่ชำระแล้ว`, `From ${paid.length} paid orders`, `来自 ${paid.length} 个已付款订单`), 'card', true)}${metric(L('คำสั่งซื้อทั้งหมด', 'All orders', '全部订单'), String(total).padStart(2, '0'), L(`${open.length} รายการที่ต้องดูแลต่อ`, `${open.length} orders in progress`, `${open.length} 个订单进行中`), 'bag')}${metric(L('สินค้าที่วางขาย', 'Active products', '在售商品'), String(demo ? 0 : active.length).padStart(2, '0'), demo ? L(`${products().length} สินค้าตัวอย่าง · ยังไม่มีข้อมูลร้านจริง`, `${products().length} sample products · no store data yet`, `${products().length} 件示例商品 · 暂无实际商店数据`) : L(`${low.length} รายการใกล้หมดหรือหมดสต็อก`, `${low.length} low or out of stock`, `${low.length} 件库存较低或缺货`), 'package')}</div><div class="adm-overview-grid"><section class="adm-panel adm-revenue-panel"><div class="adm-panel-heading"><div><h2>${e(L('ยอดรับชำระ', 'Revenue overview', '收入概览'))}</h2><p>${e(L('ยอดคำสั่งซื้อที่ชำระแล้ว แบ่งตามวันที่สั่งซื้อ', 'Paid order totals, grouped by order date', '已付款订单金额，按下单日期分组'))}</p></div><span class="adm-period">${e(L('7 วันล่าสุด', 'Last 7 days', '最近7天'))}</span></div><strong class="adm-chart-total">${e(S.money(weekTotal))}</strong><div class="adm-chart" role="img" aria-label="${e(L(`ยอดรับชำระ 7 วันล่าสุด ${S.money(weekTotal)}`, `Paid orders in the last seven days: ${S.money(weekTotal)}`, `最近七天已付款订单：${S.money(weekTotal)}`))}"><div class="adm-chart-grid"><span>${e(S.money(max === 1 ? 0 : max))}</span><span>${e(S.money(max === 1 ? 0 : max / 2))}</span><span>0</span></div><div class="adm-bars">${week.map((day, index) => `<div class="adm-day"><div class="adm-bar-area"><div class="adm-bar ${index === 6 ? 'current' : ''} ${!day.value ? 'zero' : ''}" style="height:${day.value ? Math.max(4, (day.value / max) * 100) + '%' : '3px'}" title="${e(date(day.date.toISOString()))}: ${e(S.money(day.value))}"></div></div><span>${e(day.date.toLocaleDateString({ th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }[S.locale], { weekday: 'short', timeZone: 'Asia/Bangkok' }))}</span></div>`).join('')}</div></div>${!weekTotal ? `<p class="adm-chart-empty-note">${e(L('กราฟจะเริ่มแสดงข้อมูลเมื่อมีคำสั่งซื้อที่ชำระแล้ว', 'Your chart will take shape with the first paid order.', '首笔订单付款后，图表将开始显示数据。'))}</p>` : ''}</section><section class="adm-panel adm-fulfillment"><div class="adm-panel-heading"><div><h2>${e(L('สิ่งที่ต้องดูแล', 'On your radar', '待办事项'))}</h2><p>${e(L('รายละเอียดเล็ก ๆ ที่ทำให้ร้านไปต่อ', 'The details that keep things moving', '让店铺持续运转的每个细节'))}</p></div><span class="adm-mini-orbit">✦</span></div>${radar(L('รอยืนยันออเดอร์', 'Awaiting confirmation', '待确认订单'), L('เริ่มต้นประสบการณ์ที่ดี', 'Make a good first impression', '从良好的第一印象开始'), all.filter((o) => o.status === 'pending').length, 'card', '', 'orders', 'pending')}${radar(L('เตรียมจัดส่ง', 'Ready for your attention', '等待备货处理'), L('ออเดอร์ที่กำลังเตรียมสินค้า', 'Orders currently being prepared', '正在准备中的订单'), all.filter((o) => o.status === 'processing').length, 'truck', 'peach', 'orders', 'processing')}${radar(L('เช็กสต็อกสินค้า', 'Running a little low', '关注库存'), demo ? L('ดูสินค้าตัวอย่าง', 'Explore sample products', '查看示例商品') : L('สินค้าที่เหลือไม่เกิน 5 ชิ้น', 'Products with 5 units or fewer', '库存不超过5件的商品'), demo ? 0 : low.length, 'package', 'green', 'products', 'low')}<div class="adm-radar-footer"><span class="adm-green-dot"></span>${e(demo ? L('ยังไม่มีข้อมูลจากร้านจริง', 'Awaiting store data', '等待实际商店数据') : L('ข้อมูลจากร้านค้าของคุณ', 'A live view of your workspace', '实时查看您的工作空间'))}</div></section></div><section class="adm-panel"><div class="adm-panel-heading"><div><h2>${e(L('คำสั่งซื้อล่าสุด', 'Recent orders', '最近订单'))}</h2><p>${e(L('ทุกออเดอร์มีเรื่องราว ดูแลให้ดีตั้งแต่เริ่มต้น', 'Every order is the start of something good.', '每笔订单，都是美好故事的开始。'))}</p></div><button type="button" class="adm-text-button" data-section="orders">${e(L('ดูทั้งหมด', 'View all', '查看全部'))}${S.icon('arrow', 15)}</button></div>${orderTable(all.slice(0, 5))}</section>`;
  }
  function toolbar() {
    const isOrders = section === 'orders';
    return `<div class="adm-list-toolbar"><label class="adm-search">${S.icon('search', 17)}<span class="adm-sr-only">${e(isOrders ? L('ค้นหาออเดอร์', 'Search orders', '搜索订单') : L('ค้นหาสินค้า', 'Search products', '搜索商品'))}</span><input type="search" id="admin-search" value="${e(search)}" placeholder="${e(isOrders ? L('ค้นหาเลขออเดอร์ ชื่อ หรืออีเมล…', 'Search order, customer, or email…', '搜索订单号、客户或邮箱…') : L('ค้นหาชื่อสินค้า หรือหมวดหมู่…', 'Search products or categories…', '搜索商品或分类…'))}"></label><label class="adm-filter">${S.icon('filter', 15)}<span class="adm-sr-only">${e(L('กรองรายการ', 'Filter records', '筛选记录'))}</span><select id="admin-filter">${(isOrders
      ? [
          ['all', { th: 'ทุกสถานะ', en: 'All statuses', zh: '全部状态' }],
          ...Object.entries(statuses),
        ]
      : [
          ['all', { th: 'สินค้าทั้งหมด', en: 'All products', zh: '全部商品' }],
          ['active', { th: 'วางขาย', en: 'Active', zh: '在售' }],
          ['low', { th: 'สต็อกเหลือน้อย', en: 'Low stock', zh: '库存较低' }],
          ['archived', { th: 'เก็บเข้าคลัง', en: 'Archived', zh: '已归档' }],
        ]
    )
      .map(
        ([key, value]) =>
          `<option value="${e(key)}" ${filter === key ? 'selected' : ''}>${e(S.t(value))}</option>`
      )
      .join('')}</select></label></div>`;
  }
  function renderList() {
    const target = document.getElementById('admin-list'),
      footer = document.getElementById('admin-list-footer');
    if (!target) return;
    if (section === 'orders') {
      const list = visibleOrders();
      target.innerHTML = orderTable(list, !!search || filter !== 'all');
      footer.textContent = L(
        `${list.length} จาก ${orders().length} คำสั่งซื้อ`,
        `${list.length} of ${orders().length} orders`,
        `显示 ${list.length} / ${orders().length} 个订单`
      );
    } else {
      const list = visibleProducts();
      target.innerHTML = productTable(list);
      footer.textContent = L(
        `${list.length} จาก ${products().length} สินค้า${demo ? 'ตัวอย่าง' : ''}`,
        `${list.length} of ${products().length} ${demo ? 'sample ' : ''}products`,
        `显示 ${list.length} / ${products().length} 件${demo ? '示例' : ''}商品`
      );
    }
  }
  function linkedOrderNotice() {
    if (!orderLinkMissing) return '';
    return `<div class="adm-demo-banner" role="status"><p>${e(L('ไม่พบคำสั่งซื้อที่เชื่อมไว้ในรายการล่าสุดของร้าน ออเดอร์เก่าอาจอยู่นอกช่วงข้อมูลที่แสดง กรุณากลับไปดูสรุปในเรื่องบริการลูกค้า หรือลองรีเฟรชรายการ', 'The linked order is not in the store’s latest loaded orders. Older orders may be outside this list. Return to the service conversation for its summary, or refresh the list.', '关联订单不在商店最新加载的订单中，较早订单可能不在此列表范围内。请返回服务对话查看摘要，或刷新列表。'))} <a href="/admin/support">${e(L('กลับไปบริการลูกค้า', 'Back to customer service', '返回客户服务'))}</a></p></div>`;
  }
  function render() {
    if (access !== 'allowed') {
      root.innerHTML = `<div class="adm-access page-shell"><div class="adm-empty-icon">${S.icon('user', 28)}</div><span class="adm-eyebrow">ALYZYUS / STUDIO</span><h1>${e(access === 'denied' ? L('พื้นที่สำหรับผู้ดูแลร้านค้า', 'Your store, behind the scenes.', '商店管理空间') : access === 'unavailable' ? L('พื้นที่จัดการร้านยังไม่เปิดให้บริการ', 'Store studio is not available yet.', '商店管理暂未开放。') : L('ยังโหลดข้อมูลไม่ได้', 'We could not load your store.', '无法加载商店数据'))}</h1><p>${e(access === 'denied' ? L('เข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์ผู้ดูแล เพื่อจัดการสินค้าและคำสั่งซื้อ', 'Sign in with an authorized administrator account to manage products and orders.', '请使用已获授权的管理员账户登录，以管理商品和订单。') : access === 'unavailable' ? L('ร้านยังตั้งค่าระบบจัดการไม่ครบ กรุณาลองใหม่ภายหลัง', 'Store management setup is still in progress. Please check back shortly.', '商店管理尚未配置完成，请稍后再试。') : L('ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง', 'Check your connection and try again.', '请检查网络连接后重试。'))}</p><div class="adm-inline-actions">${access === 'denied' ? `<a class="button" href="/account?next=/admin">${e(L('เข้าสู่ระบบ', 'Sign in', '登录'))}${S.icon('arrow', 16)}</a>` : `<button type="button" class="button" data-refresh>${e(L('ลองอีกครั้ง', 'Try again', '重试'))}</button>`}<a href="/" class="button secondary">${e(L('กลับหน้าร้าน', 'Back to store', '返回商店'))}</a></div></div>`;
      return;
    }
    const all = orders(),
      open = all.filter((o) => !['delivered', 'cancelled'].includes(o.status)),
      total = demo ? 0 : (data?.totalOrderCount ?? all.length),
      limited = total > all.length;
    const description =
      section === 'overview'
        ? L(
            'มองภาพรวม แล้วดูแลทุกรายละเอียดของร้าน',
            'A clear view of your store. A little room to grow.',
            '清晰掌握店铺全貌，为成长留出空间。'
          )
        : section === 'orders'
          ? L(
              'จากคำสั่งซื้อแรก จนถึงพัสดุหน้าบ้านลูกค้า',
              'From the first click to the customer’s doorstep.',
              '从下单那一刻，到送达客户手中。'
            )
          : L(
              'จัดระเบียบสินค้า เติมสต็อก และเตรียมสิ่งดี ๆ ให้ลูกค้า',
              'Curate your collection. Keep the essentials ready.',
              '精心管理商品，让美好随时就绪。'
            );
    root.innerHTML = `<div class="admin-app"><aside class="adm-sidebar"><a href="/admin" class="adm-studio-brand"><span class="adm-brand-symbol">a<span>✦</span></span><div>Alyzyus<span>STORE STUDIO</span></div></a><div class="adm-store-switch"><span class="adm-store-avatar">${S.icon('bag', 18)}</span><div><strong>Alyzyus</strong><small>${e(L('ร้านค้าของคุณ', 'Your workspace', '您的工作空间'))}</small></div>${S.icon('down', 14)}</div><p class="adm-nav-label">${e(L('จัดการร้านค้า', 'WORKSPACE', '工作空间'))}</p><nav aria-label="${e(L('เมนูผู้ดูแล', 'Admin navigation', '管理员导航'))}">${Object.entries(
      sections
    )
      .map(
        ([key, value]) =>
          `<button type="button" class="adm-nav-item ${section === key ? 'active' : ''}" data-section="${key}" ${section === key ? 'aria-current="page"' : ''}>${S.icon(key === 'overview' ? 'filter' : key === 'orders' ? 'bag' : 'package', 18)}<span>${e(S.t(value))}</span>${key === 'orders' && open.length ? `<small>${open.length}</small>` : ''}</button>`
      )
      .join(
        ''
      )}</nav><div class="adm-sidebar-bottom"><div class="adm-workspace-note">${S.icon('package', 21)}<strong>${e(L('ดูแลร้านจากที่เดียว', 'A little more in control.', '轻松掌握店铺动态'))}</strong><p>${e(L('จัดการสินค้าและออเดอร์ ให้ทุกวันเป็นวันที่ง่ายขึ้น', 'Your products, orders, and the details that make a difference.', '商品、订单与每一个重要细节，尽在掌握。'))}</p></div><a class="adm-back-store" href="/">${S.icon('arrow-up', 17)}${e(L('ดูหน้าร้าน', 'Visit storefront', '访问商店'))}</a><div class="adm-admin-profile"><span>AY</span><div><strong>Alyzyus Studio</strong><small>${e(demo ? L('โหมดตัวอย่าง', 'Preview workspace', '预览工作空间') : L('ผู้ดูแลร้านค้า', 'Store administrator', '商店管理员'))}</small></div></div></div></aside><div class="adm-main"><div class="adm-topbar"><div><span>${e(L('พื้นที่ร้านค้า', 'Workspace', '工作空间'))}</span>${S.icon('arrow', 13)}<strong>${e(S.t(sections[section]))}</strong></div><span class="adm-connection ${demo ? 'preview' : ''}"><i></i>${e(demo ? L('พรีวิวร้านค้า', 'Store preview', '商店预览') : L('เชื่อมต่อร้านค้าแล้ว', 'Store connected', '商店已连接'))}</span></div><div class="adm-content">${demo ? `<div class="adm-demo-banner"><span class="adm-demo-label">DEMO</span><p>${e(L('พื้นที่ตัวอย่าง: ยังไม่ได้เชื่อมต่อฐานข้อมูล สินค้าเป็นตัวอย่าง ไม่มีคำสั่งซื้อจริง สถิติเป็นศูนย์และการบันทึกถูกปิดไว้', 'Preview workspace: the database is not connected. Products are samples, no real orders exist, statistics are zero, and saving is disabled.', '预览空间：数据库尚未连接。商品为示例，无真实订单，统计为零，保存功能已禁用。'))}</p></div>` : ''}${limited ? `<div class="adm-demo-banner"><p>${e(L(`แสดง ${all.length} คำสั่งซื้อล่าสุดจากทั้งหมด ${total} รายการ การค้นหา กราฟ ยอดชำระ และไฟล์ส่งออกคำนวณจากรายการที่แสดง`, `Showing the latest ${all.length} of ${total} orders. Search, charts, collected amounts, and exports cover these displayed orders.`, `显示全部 ${total} 个订单中最新的 ${all.length} 个。搜索、图表、收款金额和导出仅涵盖这些订单。`))}</p></div>` : ''}${linkedOrderNotice()}<header class="adm-page-header"><div><span class="adm-eyebrow">ALYZYUS / STORE STUDIO</span><h1>${e(section === 'overview' ? L('ทุกอย่างอยู่ในมือคุณ', 'Let us make a good day.', '美好一天，从这里开始。') : S.t(sections[section]))}<span class="adm-title-dot">.</span></h1><p>${e(description)}</p></div><div class="adm-inline-actions"><button class="adm-icon-button adm-refresh" type="button" data-refresh ${loading ? 'disabled' : ''} aria-label="${e(L('รีเฟรชข้อมูล', 'Refresh data', '刷新数据'))}">${'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.8-2L20 8M4 16l2.1 3a7 7 0 0 0 11.8-2"/></svg>'}</button>${section === 'orders' ? `<button type="button" class="button secondary adm-compact-button" data-export ${demo || !visibleOrders().length ? 'disabled' : ''}>${S.icon('down', 16)}${e(L('ส่งออก CSV', 'Export CSV', '导出 CSV'))}</button>` : `<button type="button" class="button adm-compact-button" data-add-product>${S.icon('plus', 17)}${e(L('เพิ่มสินค้า', 'Add product', '添加商品'))}</button>`}</div></header>${loading && !data && !demo ? `<div class="adm-loading" role="status">${e(L('กำลังโหลดร้านค้า…', 'Loading your store…', '正在加载商店…'))}</div>` : section === 'overview' ? overview() : `<section class="adm-panel">${toolbar()}<div id="admin-list"></div><div class="adm-table-footer" id="admin-list-footer"></div></section>`}<footer class="adm-footer"><span>Alyzyus Studio</span><span>${e(L('ใส่ใจทุกรายละเอียด', 'Thoughtfully, down to the details.', '每个细节，都用心对待。'))}<span>✦</span></span></footer></div></div></div>`;
    renderList();
  }
  function draftFrom(p) {
    return {
      id: p?.id,
      slug: p?.slug || '',
      name: { th: p?.name?.th || '', en: p?.name?.en || '', zh: p?.name?.zh || '' },
      description: {
        th: p?.description?.th || '',
        en: p?.description?.en || '',
        zh: p?.description?.zh || '',
      },
      category: p?.category || 'everyday',
      price: p ? String(p.price) : '',
      compareAt: p?.compareAt ? String(p.compareAt) : '',
      stock: p ? String(p.stock) : '0',
      images: p?.images?.join('\n') || '',
      colors: p?.colors?.join(', ') || '',
      featured: !!p?.featured,
      badge: p?.badge || '',
      active: p ? p.active !== false : false,
    };
  }
  function openProduct(p) {
    editor = draftFrom(p);
    selected = null;
    autoTranslate = true;
    sourceLanguage = contentLanguage = S.locale;
    translatedSignature = translationSignature();
    modalError = null;
    confirmAction = '';
    showDialog();
  }
  function openOrder(o) {
    selected = o;
    editor = null;
    shipment = { carrier: o.carrier || '', tracking_number: o.tracking_number || '' };
    modalError = null;
    confirmAction = '';
    showDialog();
  }
  function showDialog() {
    lastFocus = document.activeElement;
    renderModal();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('input')?.focus();
  }
  function closeDialog() {
    if (busy) return;
    dialog.close();
    dialog.innerHTML = '';
    editor = null;
    selected = null;
    confirmAction = '';
    modalError = null;
    const returnFocus = lastFocus?.isConnected
      ? lastFocus
      : root.querySelector('.adm-nav-item.active, [data-refresh]');
    returnFocus?.focus();
    lastFocus = null;
  }
  const modalTop = (title, subtitle) =>
    `<div class="adm-modal-top"><div><h2 id="admin-dialog-title">${e(title)}</h2><p>${e(subtitle)}</p></div><button type="button" class="adm-icon-button" data-close-modal aria-label="${e(L('ปิด', 'Close', '关闭'))}" ${busy ? 'disabled' : ''}>${S.icon('close', 20)}</button></div>`;
  function field(name, title, value, options = '') {
    return `<label class="adm-field" for="editor-${name}">${e(title)}<input id="editor-${name}" name="${e(name)}" value="${e(value)}" ${options} ${busy ? 'disabled' : ''}></label>`;
  }
  function productEditor() {
    const d = editor,
      lang = contentLanguage;
    return `${modalTop(d.id ? L('แก้ไขสินค้า', 'Edit product', '编辑商品') : L('เพิ่มสินค้าใหม่', 'A new addition', '添加新商品'), L('กรอกภาษาหลักครั้งเดียว ระบบช่วยแปลอีกสองภาษา', 'Write in one language. Translate and review the other two.', '填写一种语言，翻译并检查另外两种语言。'))}<form id="product-editor-form"><div class="adm-modal-body">${demo ? `<div class="adm-form-note">${e(L('โหมดตัวอย่าง: ลองกรอกข้อมูลได้ แต่ยังบันทึกไม่ได้จนกว่าจะเชื่อมต่อฐานข้อมูลและเข้าสู่ระบบผู้ดูแล', 'Preview: explore the editor. Saving requires a connected database and an administrator account.', '预览模式：可体验编辑功能。连接数据库并以管理员身份登录后才能保存。'))}</div>` : ''}<label class="adm-field" for="editor-source-language">${e(L('ภาษาหลักที่ใช้แปล', 'Source language', '源语言'))}<select id="editor-source-language" ${busy ? 'disabled' : ''}>${languages.map((code) => `<option value="${code}" ${sourceLanguage === code ? 'selected' : ''}>${languageNames[code]}</option>`).join('')}</select></label><p class="adm-form-note">${e(L('แปลเฉพาะชื่อและรายละเอียดด้วย MyMemory คำแปลแก้ไขได้ บริการมีโควตา ไม่ส่งข้อมูลลูกค้าหรือรหัสผ่าน', 'MyMemory translates only the name and description. Edit translations before publishing. Service quotas apply. Customer data and passwords are not sent.', 'MyMemory 仅翻译名称和描述，发布前可修改。服务有额度限制，不发送客户资料或密码。'))}</p><div class="adm-editor-language" role="group" aria-label="${e(L('ภาษาของเนื้อหา', 'Content language', '内容语言'))}">${languages.map((language) => `<button type="button" data-content-language="${language}" class="${lang === language ? 'active' : ''}" aria-pressed="${lang === language}" ${busy ? 'disabled' : ''}>${languageNames[language]}${d.name[language].trim() && d.description[language].trim() ? ' ✓' : ''}</button>`).join('')}</div>${field('localized-name', `${L('ชื่อสินค้า', 'Product name', '商品名称')} · ${languageNames[lang]}`, d.name[lang], 'maxlength="180"')}<label class="adm-field" for="editor-localized-description">${e(L('รายละเอียดสินค้า', 'Description', '商品描述'))} · ${languageNames[lang]}<textarea id="editor-localized-description" name="localized-description" rows="4" maxlength="4000" ${busy ? 'disabled' : ''}>${e(d.description[lang])}</textarea></label><label class="adm-checkbox-row"><input type="checkbox" id="editor-auto-translate" ${autoTranslate ? 'checked' : ''} ${busy ? 'disabled' : ''}>${e(L('สร้างคำแปลอัตโนมัติเมื่อบันทึก', 'Translate automatically when saving', '保存时自动翻译'))}</label><div class="adm-translation-actions"><button type="button" class="button secondary" data-translate ${busy || demo ? 'disabled' : ''}>${e(operation === 'translate' && busy ? L('กำลังแปล…', 'Translating…', '正在翻译…') : L('แปลอีก 2 ภาษา', 'Translate other languages', '翻译其他语言'))}</button><small>${e(L('เมื่อบันทึก จะช่วยแปลภาษาที่ยังไม่มีโดยอัตโนมัติ', 'Saving automatically translates missing languages.', '保存时自动翻译缺失的语言。'))}</small></div><div class="adm-form-two">${field('slug', L('ลิงก์สินค้า (slug)', 'Product URL (slug)', '商品链接标识'), d.slug, 'required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minlength="2" maxlength="100" placeholder="your-product-name"')}${field('category', L('หมวดหมู่', 'Category', '分类'), d.category, 'required minlength="2" maxlength="40" list="alyzyus-categories"')}<datalist id="alyzyus-categories">${['audio', 'workspace', 'everyday', 'style', 'home', 'beauty'].map((value) => `<option value="${value}"></option>`).join('')}</datalist></div><div class="adm-form-three">${field('price', L('ราคาขาย (บาท)', 'Selling price (THB)', '售价（泰铢）'), d.price, 'required type="number" min="0.01" max="10000000" step="0.01"')}${field('compareAt', L('ราคาเดิม (ไม่บังคับ)', 'Original price (optional)', '原价（选填）'), d.compareAt, 'type="number" min="0.01" max="10000000" step="0.01"')}${field('stock', L('จำนวนสต็อก', 'Stock quantity', '库存数量'), d.stock, 'required type="number" min="0" max="1000000" step="1"')}</div><div class="adm-media-editor"><label class="adm-upload-label" for="editor-image-upload">${S.icon('plus', 18)}${e(busy && operation === 'upload' ? L('กำลังอัปโหลด…', 'Uploading…', '正在上传…') : L('อัปโหลดรูปสินค้า', 'Upload product images', '上传商品图片'))}</label><input id="editor-image-upload" type="file" accept="image/jpeg,image/png,image/webp" multiple ${busy || demo ? 'disabled' : ''}><p class="adm-form-note">${e(L('เลือก JPG PNG หรือ WebP ได้ครั้งละหลายรูป สูงสุด 10 รูป ระบบย่อภาพให้ก่อนอัปโหลด รูปแรกเป็นภาพหลัก', 'Choose JPG, PNG or WebP images, up to ten. Images are resized before upload. The first is the cover.', '最多选择十张 JPG、PNG 或 WebP，上传前自动缩小，第一张为封面。'))}</p><div id="editor-image-gallery">${imageGallery()}</div><details><summary>${e(L('หรือใช้ลิงก์ภาพที่มีอยู่แล้ว', 'Or use existing image links', '或使用已有图片链接'))}</summary><label class="adm-field" for="editor-images">${e(L('ลิงก์รูปภาพ', 'Image links', '图片链接'))}<textarea id="editor-images" name="images" rows="3" maxlength="10000" placeholder="https://example.com/product.jpg" ${busy ? 'disabled' : ''}>${e(d.images)}</textarea><small>${e(L('วางที่อยู่ไฟล์ภาพจริงทีละบรรทัด ไม่ใช่ลิงก์หน้าเว็บขายสินค้า', 'Paste a direct image address per line, not a product webpage link.', '每行粘贴一个图片文件地址，而非商品页面链接。'))}</small></label></details></div><div class="adm-form-two">${field('colors', L('สี (HEX คั่นด้วยจุลภาค)', 'Colors (comma-separated HEX)', '颜色（HEX代码以逗号分隔）'), d.colors, 'maxlength="150" placeholder="#222222, #f5f0e8"')}<label class="adm-field" for="editor-badge">${e(L('ป้ายสินค้า', 'Product badge', '商品标签'))}<select id="editor-badge" name="badge" ${busy ? 'disabled' : ''}>${[
      ['', L('ไม่มีป้าย', 'No badge', '无标签')],
      ['new', L('มาใหม่', 'New arrival', '新品')],
      ['bestseller', L('ขายดี', 'Bestseller', '热销')],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${d.badge === value ? 'selected' : ''}>${e(label)}</option>`
      )
      .join(
        ''
      )}</select></label></div><div class="adm-checkbox-row"><label><input type="checkbox" name="featured" ${d.featured ? 'checked' : ''} ${busy ? 'disabled' : ''}>${e(L('แสดงในสินค้าคัดสรร', 'Show in the featured collection', '展示在精选商品中'))}</label><label><input type="checkbox" name="active" ${d.active ? 'checked' : ''} ${busy ? 'disabled' : ''}>${e(L('เปิดวางขาย', 'Available on the storefront', '在商店中上架'))}</label></div>${modalError ? `<p class="adm-error" role="alert">${e(S.t(modalError))}</p>` : ''}${confirmAction === 'archive' ? `<div class="adm-archive-note"><p>${e(L('สินค้าจะถูกซ่อนจากหน้าร้าน ประวัติคำสั่งซื้อยังคงอยู่ ยืนยันเก็บเข้าคลังหรือไม่?', 'This product will be hidden from your storefront. Order history stays intact. Archive it?', '商品将从商店隐藏，历史订单将被保留。确认归档？'))}</p><div class="adm-inline-actions"><button type="button" class="button" data-confirm-archive ${busy || demo ? 'disabled' : ''}>${e(L('ยืนยันเก็บเข้าคลัง', 'Confirm archive', '确认归档'))}</button><button type="button" class="button secondary" data-cancel-confirmation ${busy ? 'disabled' : ''}>${e(L('กลับ', 'Go back', '返回'))}</button></div></div>` : ''}</div><div class="adm-modal-actions">${d.id && d.active ? `<button type="button" class="adm-text-button adm-danger-text" data-archive ${busy || demo ? 'disabled' : ''}>${e(L('เก็บเข้าคลัง', 'Archive product', '归档商品'))}</button>` : ''}<div class="adm-inline-actions"><button type="button" class="button secondary" data-close-modal ${busy ? 'disabled' : ''}>${e(L('ยกเลิก', 'Cancel', '取消'))}</button><button type="submit" class="button" ${busy || demo ? 'disabled' : ''}>${e(busy ? L('กำลังบันทึก…', 'Saving…', '正在保存…') : L('บันทึกสินค้า', 'Save product', '保存商品'))}</button></div></div></form>`;
  }
  function orderDetail() {
    const o = selected,
      transition = nextStatuses[o.status],
      cancellable =
        ['pending', 'confirmed', 'processing'].includes(o.status) && o.payment_status !== 'paid',
      payable =
        ['bank_transfer', 'cod'].includes(o.payment_method) &&
        o.payment_status !== 'paid' &&
        o.status !== 'cancelled',
      needsPayment =
        transition &&
        ['processing', 'shipped', 'delivered'].includes(transition) &&
        o.payment_method !== 'cod' &&
        o.payment_status !== 'paid';
    return `${modalTop(o.order_number, date(o.created_at, true))}<div class="adm-modal-body"><div class="adm-order-badges">${status(o)}${status(o, true)}</div><div class="adm-order-items">${(
      o.items || []
    )
      .map((item) => {
        const url = image(item.image);
        return `<div class="adm-order-item">${url ? `<img src="${url}" alt="" loading="lazy">` : ''}<div><strong>${e(S.t(item.name))}</strong><small>${e(S.money(item.price))} × ${e(item.quantity)}</small></div><span>${e(S.money(Number(item.price) * Number(item.quantity)))}</span></div>`;
      })
      .join(
        ''
      )}</div><div class="adm-order-totals"><div><span>${e(L('ยอดสินค้า', 'Subtotal', '商品小计'))}</span><span>${e(S.money(o.subtotal))}</span></div><div><span>${e(L('ค่าจัดส่ง', 'Shipping', '运费'))}</span><span>${e(S.money(o.shipping))}</span></div>${o.discount > 0 ? `<div><span>${e(L('ส่วนลด', 'Discount', '折扣'))}</span><span>−${e(S.money(o.discount))}</span></div>` : ''}<div class="total"><strong>${e(L('ยอดรวม', 'Total', '总计'))}</strong><strong>${e(S.money(o.total))}</strong></div></div><section class="adm-detail-section"><h3>${e(L('ลูกค้าและที่อยู่จัดส่ง', 'Customer & delivery', '客户与配送'))}</h3><strong>${e(o.customer_name)}</strong><p>${e(o.email)}<br>${e(o.phone)}</p><p class="adm-address">${e(o.address)}</p></section><section class="adm-detail-section"><h3>${e(L('การชำระเงิน', 'Payment', '付款'))}</h3><p>${e(label(paymentMethods, o.payment_method))}</p>${payable ? `<button type="button" class="button secondary" data-confirm-action="paid" ${busy || demo ? 'disabled' : ''}>${S.icon('card', 16)}${e(L('ยืนยันรับชำระเงิน', 'Confirm payment received', '确认已收款'))}</button>` : ''}${needsPayment ? `<p class="adm-form-note">${e(S.t(message('INVALID_PAYMENT')))}</p>` : ''}</section>${o.status !== 'cancelled' ? `<section class="adm-detail-section"><h3>${e(L('การจัดส่ง', 'Shipment details', '配送详情'))}</h3><form id="order-shipment-form"><div class="adm-form-two"><label class="adm-field" for="order-carrier">${e(L('บริษัทขนส่ง', 'Carrier', '物流公司'))}<input id="order-carrier" name="carrier" value="${e(shipment.carrier)}" maxlength="80" placeholder="DHL, Flash, J&T…" ${busy ? 'disabled' : ''}></label><label class="adm-field" for="order-tracking">${e(L('เลขติดตามพัสดุ', 'Tracking number', '运单号'))}<input id="order-tracking" name="tracking_number" value="${e(shipment.tracking_number)}" maxlength="100" ${busy ? 'disabled' : ''}></label></div><button type="submit" class="button secondary" ${busy || demo ? 'disabled' : ''}>${e(L('บันทึกข้อมูลขนส่ง', 'Save shipment details', '保存配送信息'))}</button></form></section>` : ''}<section class="adm-detail-section"><h3>${e(L('เส้นทางสินค้า', 'Product journey', '商品旅程'))}</h3><a href="/simulation?mode=product&order=${encodeURIComponent(o.id)}" class="button secondary" target="_blank" rel="noopener">${S.icon('package', 17)}${e(L('เส้นทางสินค้า 3D', '3D product journey', '3D 商品旅程'))}${S.icon('arrow-up', 14)}</a><p>${e(L('อ้างอิงสถานะที่บันทึกจริงของคำสั่งซื้อนี้', 'Based on this order’s recorded status.', '基于此订单已记录的真实状态。'))}</p></section>${confirmAction ? `<div class="adm-archive-note"><p>${e(confirmAction === 'paid' ? L('ตรวจสอบกับธนาคารหรือบริษัทขนส่งแล้วว่าได้รับเงินครบถ้วน ยืนยันทำเครื่องหมายว่าชำระแล้วหรือไม่?', 'Confirm you have verified receipt of the full payment with your bank or delivery carrier. Mark this order as paid?', '请确认已向银行或物流公司核实收到全额款项。将此订单标记为已付款？') : L('ยืนยันยกเลิกคำสั่งซื้อนี้? การเปลี่ยนแปลงนี้จะปิดคำสั่งซื้อ', 'Cancel this order? This will close the order.', '确认取消此订单？此操作将关闭订单。'))}</p><div class="adm-inline-actions"><button type="button" class="button" data-confirm-order ${busy || demo ? 'disabled' : ''}>${e(L('ยืนยัน', 'Confirm', '确认'))}</button><button type="button" class="button secondary" data-cancel-confirmation ${busy ? 'disabled' : ''}>${e(L('กลับ', 'Go back', '返回'))}</button></div></div>` : ''}${modalError ? `<p class="adm-error" role="alert">${e(S.t(modalError))}</p>` : ''}</div><div class="adm-modal-actions">${cancellable ? `<button type="button" class="adm-text-button adm-danger-text" data-confirm-action="cancel" ${busy || demo ? 'disabled' : ''}>${e(L('ยกเลิกคำสั่งซื้อ', 'Cancel order', '取消订单'))}</button>` : '<span></span>'}<div class="adm-inline-actions"><button type="button" class="button secondary" data-close-modal ${busy ? 'disabled' : ''}>${e(L('ปิด', 'Close', '关闭'))}</button>${transition ? `<button type="button" class="button" data-next-order ${busy || demo || needsPayment ? 'disabled' : ''}>${S.icon('arrow', 16)}${e(label(statuses, transition))}</button>` : ''}</div></div>`;
  }
  function renderModal() {
    if (!editor && !selected) return;
    const focused = dialog.contains(document.activeElement) ? document.activeElement : null,
      focusId = focused?.id,
      start = focused?.selectionStart,
      end = focused?.selectionEnd;
    dialog.classList.toggle('adm-modal-wide', !!editor);
    dialog.innerHTML = editor ? productEditor() : orderDetail();
    if (focusId) {
      const replacement = document.getElementById(focusId);
      if (replacement && !replacement.disabled) {
        replacement.focus();
        try {
          replacement.setSelectionRange(start, end);
        } catch {}
      }
    }
  }
  function validateProduct() {
    const d = editor;
    for (const lang of languages)
      if (!d.name[lang].trim() || !d.description[lang].trim()) {
        contentLanguage = lang;
        return {
          th: `กรุณากรอกชื่อและรายละเอียดภาษา ${languageNames[lang]} ให้ครบ`,
          en: `Add a product name and description in ${languageNames[lang]}.`,
          zh: `请填写${languageNames[lang]}的商品名称和描述。`,
        };
      }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug) || d.slug.length < 2)
      return {
        th: 'ใช้ slug ภาษาอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลาง',
        en: 'Use a slug with lowercase letters, numbers, and hyphens.',
        zh: '链接标识应使用小写字母、数字和连字符。',
      };
    if (
      !d.category.trim() ||
      !Number.isFinite(Number(d.price)) ||
      Number(d.price) <= 0 ||
      !Number.isInteger(Number(d.stock)) ||
      Number(d.stock) < 0
    )
      return {
        th: 'ตรวจสอบหมวดหมู่ ราคาขาย และจำนวนสต็อก',
        en: 'Check the category, selling price, and stock quantity.',
        zh: '请检查分类、售价和库存数量。',
      };
    if (
      d.compareAt &&
      (!Number.isFinite(Number(d.compareAt)) || Number(d.compareAt) <= Number(d.price))
    )
      return {
        th: 'ราคาเดิมต้องสูงกว่าราคาขาย',
        en: 'The original price must be higher than the selling price.',
        zh: '原价必须高于售价。',
      };
    const images = d.images
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      !images.length ||
      images.length > 10 ||
      images.some((value) => {
        if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return false;
        try {
          const url = new URL(value);
          return url.protocol !== 'https:' || !!url.username || !!url.password;
        } catch {
          return true;
        }
      })
    )
      return {
        th: 'เพิ่มรูปภาพ 1–10 รูป ใช้ URL แบบ HTTPS หรือเส้นทางรูปในเว็บไซต์',
        en: 'Add 1–10 image URLs. Use HTTPS or a local image path.',
        zh: '请添加1–10个图片链接，使用 HTTPS 或本地图片路径。',
      };
    if (
      d.colors
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .some((value) => !/^#[0-9a-f]{6}$/i.test(value))
    )
      return {
        th: 'ใช้รหัสสี HEX 6 หลัก เช่น #222222',
        en: 'Use six-digit HEX colors, for example #222222.',
        zh: '请使用六位 HEX 颜色代码，例如 #222222。',
      };
    return null;
  }
  async function saveProduct(archive = false) {
    if (demo || busy || !editor) return;
    const epoch = sessionEpoch;
    if (
      autoTranslate &&
      (translatedSignature !== translationSignature() ||
        languages.some((lang) => !editor.name[lang].trim() || !editor.description[lang].trim())) &&
      !(await translateDraft())
    )
      return;
    if (epoch !== sessionEpoch || !editor) return;
    modalError = validateProduct();
    if (modalError) {
      renderModal();
      return;
    }
    busy = true;
    renderModal();
    const d = editor,
      payload = {
        ...d,
        name: Object.fromEntries(languages.map((lang) => [lang, d.name[lang].trim()])),
        description: Object.fromEntries(
          languages.map((lang) => [lang, d.description[lang].trim()])
        ),
        category: d.category.trim(),
        price: Number(d.price),
        compareAt: d.compareAt ? Number(d.compareAt) : null,
        stock: Number(d.stock),
        images: d.images
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        colors: d.colors
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        badge: d.badge || null,
        active: archive ? false : d.active,
      };
    try {
      await S.api('/api/admin/products', { method: d.id ? 'PATCH' : 'POST', body: payload });
      if (epoch !== sessionEpoch) return;
      busy = false;
      closeDialog();
      S.toast(L('บันทึกสินค้าเรียบร้อยแล้ว', 'Product saved successfully.', '商品已成功保存。'));
      await load();
    } catch (err) {
      if (epoch !== sessionEpoch) return;
      modalError = message(err.code);
      busy = false;
      renderModal();
    }
  }
  async function updateOrder(patch) {
    if (demo || busy || !selected) return;
    const epoch = sessionEpoch;
    modalError = null;
    if (
      patch.status === 'shipped' &&
      (!shipment.carrier.trim() || !shipment.tracking_number.trim())
    ) {
      modalError = {
        th: 'กรุณากรอกบริษัทขนส่งและเลขพัสดุก่อนเปลี่ยนเป็นจัดส่งแล้ว',
        en: 'Add a carrier and tracking number before marking this order shipped.',
        zh: '请先填写物流公司和运单号，再将订单标记为已发货。',
      };
      renderModal();
      return;
    }
    busy = true;
    renderModal();
    try {
      const result = await S.api('/api/admin/orders', {
        method: 'PATCH',
        body: { id: selected.id, ...patch },
      });
      if (epoch !== sessionEpoch) return;
      selected = result.order || { ...selected, ...patch };
      confirmAction = '';
      S.toast(L('อัปเดตคำสั่งซื้อแล้ว', 'Order updated.', '订单已更新。'));
      await load();
    } catch (err) {
      if (epoch === sessionEpoch) modalError = message(err.code);
    } finally {
      if (epoch === sessionEpoch) {
        busy = false;
        renderModal();
      }
    }
  }
  function exportOrders() {
    if (demo) return;
    const list = visibleOrders();
    if (!list.length) return;
    const safeCell = (value) =>
        `"${String(value ?? '')
          .replace(/^([\s]*[=+@-])/, "'$1")
          .replaceAll('"', '""')}"`,
      rows = [
        ['Order', 'Date', 'Customer', 'Status', 'Payment', 'Total (THB)', 'Carrier', 'Tracking'],
        ...list.map((o) => [
          o.order_number,
          o.created_at,
          o.customer_name,
          o.status,
          o.payment_status,
          o.total,
          o.carrier,
          o.tracking_number,
        ]),
      ],
      url = URL.createObjectURL(
        new Blob(['\uFEFF', rows.map((row) => row.map(safeCell).join(',')).join('\r\n')], {
          type: 'text/csv;charset=utf-8;',
        })
      ),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `alyzyus-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  root.addEventListener('input', (event) => {
    if (event.target.id === 'admin-search') {
      search = event.target.value;
      renderList();
    }
  });
  root.addEventListener('change', (event) => {
    if (event.target.id === 'admin-filter') {
      filter = event.target.value;
      renderList();
    }
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.dataset.section) {
      section = button.dataset.section;
      search = '';
      filter = button.dataset.sectionFilter || 'all';
      render();
    }
    if (button.hasAttribute('data-refresh')) load();
    if (button.hasAttribute('data-add-product')) openProduct();
    if (button.dataset.product) {
      const p = products().find((p) => p.id === button.dataset.product);
      if (p) openProduct(p);
    }
    if (button.dataset.order) {
      const o = orders().find((o) => o.id === button.dataset.order);
      if (o) openOrder(o);
    }
    if (button.hasAttribute('data-export')) exportOrders();
  });
  dialog.addEventListener('input', (event) => {
    const input = event.target;
    if (editor && input.name) {
      if (input.name === 'localized-name') editor.name[contentLanguage] = input.value;
      else if (input.name === 'localized-description')
        editor.description[contentLanguage] = input.value;
      else if (Object.hasOwn(editor, input.name))
        editor[input.name] = input.type === 'checkbox' ? input.checked : input.value;
      if (input.name === 'images')
        dialog.querySelector('#editor-image-gallery').innerHTML = imageGallery();
    }
    if (selected && Object.hasOwn(shipment, input.name)) shipment[input.name] = input.value;
  });
  dialog.addEventListener('change', (event) => {
    const input = event.target;
    if (editor && input.id === 'editor-auto-translate') {
      autoTranslate = input.checked;
      return;
    }
    if (editor && input.id === 'editor-image-upload') {
      uploadImages(Array.from(input.files || []));
      return;
    }
    if (editor && input.id === 'editor-source-language') {
      sourceLanguage = contentLanguage = input.value;
      renderModal();
      return;
    }
    if (editor && Object.hasOwn(editor, input.name))
      editor[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
      return;
    }
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.hasAttribute('data-translate')) {
      translateDraft();
      return;
    }
    if (
      editor &&
      (button.hasAttribute('data-remove-image') || button.hasAttribute('data-cover-image'))
    ) {
      const list = editor.images
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean);
      const index = Number(button.dataset.removeImage ?? button.dataset.coverImage);
      if (button.hasAttribute('data-remove-image')) list.splice(index, 1);
      else if (index > 0) list.unshift(...list.splice(index, 1));
      editor.images = list.join('\n');
      renderModal();
      return;
    }
    if (button.hasAttribute('data-close-modal')) closeDialog();
    if (button.dataset.contentLanguage) {
      contentLanguage = button.dataset.contentLanguage;
      renderModal();
      dialog.querySelector('#editor-localized-name')?.focus();
    }
    if (button.hasAttribute('data-archive')) {
      confirmAction = 'archive';
      renderModal();
    }
    if (button.hasAttribute('data-confirm-archive')) saveProduct(true);
    if (button.hasAttribute('data-cancel-confirmation')) {
      confirmAction = '';
      renderModal();
    }
    if (button.dataset.confirmAction) {
      confirmAction = button.dataset.confirmAction;
      renderModal();
    }
    if (button.hasAttribute('data-confirm-order'))
      updateOrder(confirmAction === 'paid' ? { payment_status: 'paid' } : { status: 'cancelled' });
    if (button.hasAttribute('data-next-order')) {
      const next = nextStatuses[selected.status];
      if (next)
        updateOrder({
          status: next,
          ...(next === 'shipped'
            ? { carrier: shipment.carrier.trim(), tracking_number: shipment.tracking_number.trim() }
            : {}),
        });
    }
  });
  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'product-editor-form') saveProduct();
    else if (event.target.id === 'order-shipment-form')
      updateOrder({
        carrier: shipment.carrier.trim(),
        tracking_number: shipment.tracking_number.trim(),
      });
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  S.onChange((event) => {
    if (event.detail.type === 'locale') {
      render();
      renderModal();
    }
  });
  function clearSession() {
    sessionEpoch++;
    loadRequest++;
    data = null;
    loading = false;
    access = 'denied';
    busy = false;
    search = '';
    requestedOrder = null;
    orderLinkMissing = false;
    shipment = { carrier: '', tracking_number: '' };
    closeDialog();
    render();
  }
  async function load() {
    if (loading && data) return;
    const token = ++loadRequest;
    loading = true;
    render();
    try {
      const result = await S.api('/api/admin', { cache: 'no-store' });
      if (token !== loadRequest) return;
      if (!Array.isArray(result.orders) || !Array.isArray(result.products)) throw new Error('data');
      if (result.configured === false && !demo) {
        data = null;
        access = 'unavailable';
        if (dialog.open) {
          busy = false;
          closeDialog();
        }
        return;
      }
      data = result;
      access = 'allowed';
      if (requestedOrder) {
        section = 'orders';
        // ลิงก์เลือกได้เฉพาะข้อมูลจริงที่ API ตรวจสิทธิ์ Admin และส่งกลับมาแล้ว
        const linkedOrder = result.orders.find((order) => order.id === requestedOrder);
        orderLinkMissing = !linkedOrder;
        if (linkedOrder) {
          requestedOrder = null;
          openOrder(linkedOrder);
        }
      }
      if (selected) {
        const updated = result.orders.find((o) => o.id === selected.id);
        if (updated) selected = updated;
      }
    } catch (err) {
      if (token !== loadRequest) return;
      if (demo) {
        data = { orders: [], products: S.products, configured: false, totalOrderCount: 0 };
        access = 'allowed';
      } else {
        access = err.status === 401 || err.status === 403 ? 'denied' : 'error';
        data = null;
        if (dialog.open) {
          busy = false;
          closeDialog();
        }
      }
    } finally {
      if (token === loadRequest) {
        loading = false;
        render();
        renderModal();
      }
    }
  }
  if (!demo)
    S.watchPrivateSession({
      clear: clearSession,
      reload: () => {
        if (!busy) return load();
      },
    });
  load();
})();
