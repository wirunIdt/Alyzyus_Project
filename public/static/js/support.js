/* ศูนย์บริการลูกค้า: ใช้ข้อมูลจริงจากเซิร์ฟเวอร์ ไม่สร้างคำตอบหรือสถานะเจ้าหน้าที่จำลอง */
(() => {
  'use strict';
  const S = window.Shop,
    root = document.getElementById('support-app');
  if (!S || !root) return;
  const admin = root.dataset.adminMode === 'true';
  const base = admin ? '/api/admin/support/tickets' : '/api/support/tickets';
  const e = S.escape,
    L = (th, en, zh) => S.t({ th, en, zh });
  const refreshIcon =
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 7a7 7 0 0 1 11.5-1L20 9M4 15l2.3 3A7 7 0 0 0 17.8 17"/></svg>';
  const tr = (values) => L(...values);
  const labels = {
    order: ['คำสั่งซื้อ / จัดส่ง', 'Order / delivery', '订单 / 配送'],
    payment: ['การชำระเงิน', 'Payment', '支付'],
    return: ['คืนสินค้า / คืนเงิน', 'Return / refund', '退货 / 退款'],
    product: ['สอบถามสินค้า', 'Product question', '商品咨询'],
    account: ['บัญชีผู้ใช้', 'Your account', '用户账户'],
    other: ['เรื่องอื่น ๆ', 'Something else', '其他问题'],
  };
  const statuses = {
    open: ['รอทีมร้านตอบ', 'Awaiting store reply', '等待商店回复'],
    pending: ['ทีมร้านตอบแล้ว', 'Store replied', '商店已回复'],
    resolved: ['แก้ไขเรียบร้อย', 'Resolved', '已解决'],
    closed: ['ปิดเรื่องแล้ว', 'Closed', '已关闭'],
  };
  const errors = {
    default: [
      'ดำเนินการไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่ ข้อความที่พิมพ์ไว้ยังอยู่',
      'We could not complete that request. Check your connection and try again. Your draft is still here.',
      '操作未完成。请检查网络后重试，已输入的草稿仍会保留。',
    ],
    SUPPORT_RATE_LIMITED: [
      'ถึงขีดจำกัดรายชั่วโมงแล้ว กรุณาลองใหม่ภายหลัง',
      'The hourly request limit has been reached. Please try again later.',
      '已达到每小时请求上限，请稍后再试。',
    ],
    SUPPORT_CLOSED: [
      'เรื่องนี้ปิดแล้ว ไม่สามารถส่งข้อความเพิ่มได้ ทีมร้านต้องเปิดเรื่องอีกครั้งก่อน',
      'This request is closed. The store team needs to reopen it before another reply can be sent.',
      '此咨询已关闭，商店团队重新开启后才能继续回复。',
    ],
    SUPPORT_NOT_FOUND: [
      'ไม่พบเรื่องนี้ หรือบัญชีของคุณไม่มีสิทธิ์ดู กรุณาอัปเดตรายการ',
      'This request was not found or is not available to your account. Refresh the list.',
      '未找到此咨询，或您的账户无权查看。请刷新列表。',
    ],
    SUPPORT_STALE: [
      'บทสนทนามีการเปลี่ยนแปลง กรุณาอัปเดตและอ่านข้อความล่าสุดก่อนเปลี่ยนสถานะอีกครั้ง ข้อความร่างยังอยู่',
      'This conversation changed. Refresh and read the latest messages before changing its status again. Your draft is still here.',
      '此对话已有更新。请先刷新并阅读最新消息，再次更改状态。草稿仍会保留。',
    ],
    IDEMPOTENCY_CONFLICT: [
      'คำขอครั้งก่อนอาจถูกบันทึกแล้ว กรุณากดอัปเดตข้อมูลและตรวจสอบก่อนส่งอีกครั้ง',
      'Your earlier request may already have been saved. Refresh and check the conversation before sending again.',
      '之前的请求可能已保存。请先刷新并检查咨询内容，再次发送前确认。',
    ],
    INVALID_INPUT: [
      'ตรวจสอบข้อมูลอีกครั้ง หัวข้อ 5–120 ตัวอักษร และข้อความ 10–4,000 ตัวอักษร',
      'Check the form: use 5–120 characters for the subject and 10–4,000 characters for a message.',
      '请检查表单：主题为 5–120 个字符，消息为 10–4,000 个字符。',
    ],
    EMAIL_NOT_VERIFIED: [
      'กรุณายืนยันอีเมลของบัญชีก่อนส่งเรื่อง',
      'Confirm your account email before sending a request.',
      '请先验证账户邮箱，再提交咨询。',
    ],
    SUPPORT_UNAVAILABLE: [
      'ระบบรับเรื่องยังไม่พร้อม กรุณาลองใหม่อีกครั้งภายหลัง',
      'Customer service requests are temporarily unavailable. Please try again later.',
      '客户咨询功能暂时不可用，请稍后重试。',
    ],
  };
  let user = null,
    checking = true,
    authError = false,
    tickets = [],
    cursor = null,
    listLoaded = false;
  let listBusy = false,
    detailBusy = false,
    writeBusy = false,
    status = 'all',
    category = 'all',
    query = '',
    searchDraft = '',
    searchError = '',
    selected = null;
  let messages = [],
    messageCursor = null,
    listError = '',
    detailError = '',
    formError = '',
    notice = '';
  let listRequest = 0,
    detailRequest = 0,
    orderRequest = 0,
    authRequest = 0,
    identityEpoch = 0,
    authTimer = null;
  let updated = null,
    newOpen = false,
    orders = [],
    ordersFailed = false;
  let relatedOrder = null,
    orderBusy = false,
    orderError = false,
    staleTicketId = null,
    queryOrderApplied = false,
    preservedFocus = null;
  let draft = { category: 'order', subject: '', message: '', orderId: '' };
  let createKey = uuid();
  let recovery = null,
    recoveryPrepared = '';
  const replyDrafts = new Map(),
    replyKeys = new Map();
  const parameters = new URLSearchParams(location.search),
    queryId = parameters.get('ticket'),
    queryOrder = String(parameters.get('order') || '').toLowerCase();
  const validId = (value) => /^[1-9]\d{0,18}$/.test(String(value || ''));
  const validOrderId = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(+parsed)
      ? '—'
      : new Intl.DateTimeFormat({ th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }[S.locale], {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(parsed);
  };
  // เก็บ UUID ในหน่วยความจำเดิมเมื่อส่งไม่สำเร็จ ป้องกันข้อความซ้ำจากการกดส่งหรือเครือข่ายขัดข้อง
  function uuid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function feedback(code, kind = 'error') {
    if (!code) return '';
    const text =
      kind === 'success'
        ? L(
            'บันทึกเรียบร้อยแล้ว คุณกลับมาติดตามคำตอบในหน้านี้ได้',
            'Saved. You can return to this page to follow the conversation.',
            '已保存。您可返回此页面跟进咨询。'
          )
        : tr(errors[code] || errors.default);
    return `<div class="support-feedback support-feedback-${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${e(text)}</div>`;
  }
  function badge(value) {
    const key = Object.hasOwn(statuses, value) ? value : 'open';
    return `<span class="support-status support-status-${key}">${e(tr(statuses[key]))}</span>`;
  }
  function submissionFeedback(kind) {
    let content = feedback(formError);
    if (recovery?.kind === kind && (kind === 'create' || recovery.ticketId === selected?.id)) {
      content += `<div class="support-feedback support-feedback-success"><p>${e(L('รายการเดิมอาจถูกบันทึกแล้ว ตรวจสอบเรื่องหรือข้อความที่มีอยู่ก่อน หากต้องการส่งแยกจริง ๆ จึงเตรียมรหัสส่งใหม่ โดยข้อความที่พิมพ์จะยังอยู่และจะไม่ถูกส่งอัตโนมัติ', 'Your earlier request may already be saved. First refresh and check existing requests or messages. If you really need a separate submission, prepare a new send ID. Your draft stays here and nothing is sent automatically.', '之前的请求可能已保存。请先刷新并检查已有咨询或消息。若确实需要单独发送，可准备新的发送编号。草稿会保留，且不会自动发送。'))}</p><div class="support-ticket-actions"><button type="button" data-support-check-conflict="${kind}" ${listBusy || detailBusy || writeBusy ? 'disabled' : ''}>${e(L('1. อัปเดตและตรวจสอบรายการเดิม', '1. Refresh and check existing items', '1. 刷新并检查已有内容'))}</button><button type="button" data-support-renew="${kind}" ${!recovery.reviewed || listBusy || detailBusy || writeBusy ? 'disabled' : ''}>${e(kind === 'create' ? L('2. เตรียมส่งเป็นเรื่องใหม่', '2. Prepare a separate request', '2. 准备单独提交咨询') : L('2. เตรียมส่งเป็นข้อความใหม่', '2. Prepare a separate message', '2. 准备单独发送消息'))}</button></div></div>`;
    }
    if (recoveryPrepared === kind)
      content += `<p class="support-feedback support-feedback-success" role="status">${e(L('เตรียมรหัสส่งใหม่แล้ว ข้อความยังไม่ถูกส่ง ตรวจสอบอีกครั้งแล้วกดปุ่มส่งเมื่อพร้อม', 'A new send ID is ready. Nothing has been sent. Review your draft, then press Send when ready.', '已准备新的发送编号，尚未发送任何内容。请检查草稿，准备好后点击发送。'))}</p>`;
    return content;
  }
  function permissionState() {
    if (checking)
      return `<div class="support-state" role="status">${e(L('กำลังตรวจสอบบัญชี…', 'Checking your account…', '正在检查账户…'))}</div>`;
    if (authError)
      return `<div class="support-state"><h2>${e(L('ยังเชื่อมต่อบัญชีไม่ได้', 'We could not check your account.', '暂时无法检查账户。'))}</h2><p>${e(L('ตรวจสอบการเชื่อมต่อ แล้วลองอีกครั้ง', 'Check your connection and try again.', '请检查网络连接后重试。'))}</p><button type="button" class="button" data-support-auth>${e(L('ลองอีกครั้ง', 'Try again', '重试'))}</button></div>`;
    if (!user) {
      const path = admin ? '/admin/support' : '/support';
      const nextParameters = new URLSearchParams();
      if (validId(queryId)) nextParameters.set('ticket', queryId);
      if (!admin && validOrderId(queryOrder)) nextParameters.set('order', queryOrder);
      const next = nextParameters.toString()
        ? encodeURIComponent(`${path}?${nextParameters}`)
        : path;
      return `<div class="support-state"><div class="support-state-icon">${S.icon('user', 28)}</div><h2>${e(admin ? L('เข้าสู่ระบบผู้ดูแลร้าน', 'Sign in to your store studio.', '登录商店管理。') : L('ให้เราดูแลเรื่องของคุณ', 'Let’s take care of your question.', '让我们用心处理您的问题。'))}</h2><p>${e(admin ? L('กล่องข้อความบริการลูกค้าเปิดให้ผู้ดูแลร้านที่ได้รับสิทธิ์เท่านั้น', 'The customer service inbox is available only to authorized store admins.', '客户服务收件箱仅供获授权的商店管理员使用。') : L('เข้าสู่ระบบหรือสมัครสมาชิก เพื่อส่งเรื่องและติดตามบทสนทนาเฉพาะบัญชีของคุณ', 'Sign in or create an account to send a request and keep your conversation private.', '登录或注册后即可提交咨询，并私密地跟进您的对话。'))}</p><div class="support-state-actions"><a class="button" href="/account?next=${e(next)}">${e(L('เข้าสู่ระบบ', 'Sign in', '登录'))}${S.icon('arrow', 16)}</a>${!admin ? `<a class="button secondary" href="/account?mode=signup&next=${e(next)}">${e(L('สมัครสมาชิกใหม่', 'Create an account', '注册新账户'))}</a>` : ''}</div></div>`;
    }
    if (admin && user.role !== 'admin')
      return `<div class="support-state"><h2>${e(L('พื้นที่นี้สำหรับผู้ดูแลร้าน', 'This space is for store admins.', '此区域仅供商店管理员使用。'))}</h2><p>${e(L('คุณยังติดต่อทีมร้านผ่านศูนย์บริการลูกค้าได้ตามปกติ', 'You can contact the store team from customer service.', '您仍可通过客户服务联系商店团队。'))}</p><a href="/support" class="button">${e(L('ไปศูนย์บริการลูกค้า', 'Open customer service', '打开客户服务'))}</a></div>`;
    if (!user.emailVerified)
      return `<div class="support-state"><h2>${e(L('ยืนยันอีเมลก่อนเริ่มสนทนา', 'One quick email confirmation.', '请先验证邮箱。'))}</h2><p>${e(L('เปิดลิงก์ยืนยันที่ส่งไปยังอีเมลของคุณ แล้วกดตรวจสอบอีกครั้ง เพื่อให้เรื่องและข้อมูลคำสั่งซื้ออยู่กับเจ้าของบัญชี', 'Open the confirmation link sent to your email, then check again to continue.', '打开已发送至邮箱的验证链接，然后重新检查即可继续。'))}</p><div class="support-state-actions"><button type="button" class="button" data-support-auth>${e(L('ตรวจสอบอีกครั้ง', 'Check again', '重新检查'))}</button><a class="button secondary" href="/account">${e(L('ไปที่บัญชี', 'Open your account', '打开账户'))}</a></div></div>`;
    return '';
  }
  function createForm() {
    if (admin || !newOpen) return '';
    return `<section class="support-create" aria-labelledby="support-create-title"><div class="support-create-head"><div><h2 id="support-create-title">${e(L('เล่าให้เราฟังได้เลย', 'What can we help with?', '有什么可以帮助您？'))}</h2><p>${e(L('เลือกหมวดหมู่และอธิบายปัญหา เพื่อให้ทีมร้านตรวจสอบเรื่องได้ตรงจุด', 'Choose a topic and share the details so the store team can understand your request.', '选择类别并描述问题，帮助商店团队了解您的需求。'))}</p></div><button type="button" class="support-close" data-support-close-form ${writeBusy ? 'disabled' : ''} aria-label="${e(L('ย่อแบบฟอร์ม ข้อความยังอยู่', 'Collapse form; keep draft', '收起表单并保留草稿'))}">${S.icon('minus', 18)}</button></div><form id="support-create-form"><div class="support-form-grid"><label class="support-field" for="support-category">${e(L('ต้องการความช่วยเหลือเรื่อง', 'I need help with', '需要帮助的类别'))}<select id="support-category" name="category" ${writeBusy ? 'disabled' : ''}>${Object.entries(
      labels
    )
      .map(
        ([key, values]) =>
          `<option value="${key}" ${draft.category === key ? 'selected' : ''}>${e(tr(values))}</option>`
      )
      .join(
        ''
      )}</select></label><label class="support-field" for="support-order">${e(L('คำสั่งซื้อที่เกี่ยวข้อง (ไม่บังคับ)', 'Related order (optional)', '相关订单（选填）'))}<select id="support-order" name="orderId" ${writeBusy ? 'disabled' : ''}><option value="">${e(L('ไม่ระบุคำสั่งซื้อ', 'No order selected', '不选择订单'))}</option>${orders.map((order) => `<option value="${e(order.id)}" ${draft.orderId === order.id ? 'selected' : ''}>${e(order.order_number)}</option>`).join('')}</select><small>${e(ordersFailed ? L('ยังโหลดคำสั่งซื้อไม่ได้ คุณสามารถระบุเลขคำสั่งซื้อในข้อความแทนได้', 'Orders could not be loaded. You can include your order number in the message.', '暂时无法加载订单，可在消息中填写订单号。') : L('แสดงคำสั่งซื้อล่าสุดของบัญชีนี้เท่านั้น', 'Only recent orders belonging to this account are shown.', '仅显示此账户最近的订单。'))}</small></label><label class="support-field support-field-wide" for="support-subject">${e(L('หัวข้อเรื่อง', 'Subject', '咨询主题'))}<input id="support-subject" name="subject" value="${e(draft.subject)}" minlength="5" maxlength="120" autocomplete="off" required ${writeBusy ? 'disabled' : ''} aria-describedby="support-subject-help"><span class="support-field-caption" id="support-subject-help"><span>${e(L('สรุปสั้น ๆ 5–120 ตัวอักษร', 'A short summary, 5–120 characters', '简短概述，5–120 个字符'))}</span><span class="support-counter" data-support-count="subject">${draft.subject.length}/120</span></span></label><label class="support-field support-field-wide" for="support-message">${e(L('รายละเอียดที่ต้องการให้ช่วย', 'How can we help?', '请描述您的问题'))}<textarea id="support-message" name="message" minlength="10" maxlength="4000" required ${writeBusy ? 'disabled' : ''} aria-describedby="support-message-help">${e(draft.message)}</textarea><span class="support-field-caption" id="support-message-help"><span>${e(L('10–4,000 ตัวอักษร ไม่ต้องส่งข้อมูลลับ', '10–4,000 characters. Keep sensitive details out.', '10–4,000 个字符，请勿包含敏感信息。'))}</span><span class="support-counter" data-support-count="message">${draft.message.length}/4000</span></span></label></div>${submissionFeedback('create')}<div class="support-form-end"><p>${e(L('ทีมร้านจะตอบในบทสนทนานี้ คุณกดอัปเดตข้อมูลเพื่อตรวจคำตอบได้', 'The store team replies in this conversation. Use Refresh to check for a reply.', '商店团队将在此对话中回复，请点击刷新查看新消息。'))}</p><button type="submit" class="button" ${writeBusy || recovery?.kind === 'create' ? 'disabled' : ''}>${e(writeBusy ? L('กำลังส่ง…', 'Sending…', '发送中…') : L('ส่งเรื่องให้ทีมร้าน', 'Send request', '提交咨询'))}${S.icon('arrow', 17)}</button></div></form></section>`;
  }
  function filterSelect(id, title, options, value) {
    return `<label for="${id}">${e(title)}<select id="${id}" ${listBusy || writeBusy ? 'disabled' : ''}>${options.map(([key, text]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
  }
  function inbox() {
    const statusOptions = [
      ['all', L('ทั้งหมด', 'All requests', '全部咨询')],
      ...Object.entries(statuses).map(([key, values]) => [key, tr(values)]),
    ];
    const categoryOptions = [
      ['all', L('ทุกหมวดหมู่', 'All topics', '全部类别')],
      ...Object.entries(labels).map(([key, values]) => [key, tr(values)]),
    ];
    return `<aside class="support-inbox" aria-labelledby="support-inbox-title">
      <div class="support-panel-top">
        <div class="support-panel-title"><h2 id="support-inbox-title">${e(admin ? L('กล่องข้อความ', 'Service inbox', '服务收件箱') : L('เรื่องของฉัน', 'My requests', '我的咨询'))}</h2>${!admin ? `<button type="button" class="button" data-support-new ${writeBusy ? 'disabled' : ''}>${S.icon('plus', 14)}${e(L('ส่งเรื่องใหม่', 'New request', '新建咨询'))}</button>` : ''}</div>
        <form class="support-search" id="support-search-form" role="search" aria-label="${e(L('ค้นหาเรื่องของบริการลูกค้า', 'Search service requests', '搜索客户咨询'))}">
          <label for="support-search">${e(L('ค้นหาเลขเรื่อง', 'Find a request number', '查找咨询编号'))}</label>
          <div><input type="search" id="support-search" name="ticketSearch" value="${e(searchDraft)}" placeholder="ALY-S-123" maxlength="25" autocomplete="off" aria-describedby="support-search-help" aria-invalid="${Boolean(searchError)}" ${listBusy || writeBusy ? 'disabled' : ''}><button type="submit" ${listBusy || writeBusy ? 'disabled' : ''}>${S.icon('search', 17)}<span class="support-sr-only">${e(L('ค้นหา', 'Search', '搜索'))}</span></button>${query ? `<button type="button" data-support-clear-search ${listBusy || writeBusy ? 'disabled' : ''} aria-label="${e(L('ล้างการค้นหา', 'Clear search', '清除搜索'))}">${S.icon('close', 16)}</button>` : ''}</div>
          <small id="support-search-help" ${searchError ? 'role="alert"' : ''}>${e(searchError || L('กรอกเลขเรื่องเต็มหรือเฉพาะตัวเลข แล้วกดค้นหา', 'Enter the full request number or its digits, then search.', '输入完整咨询编号或其中的数字，然后搜索。'))}</small>
        </form>
        <div class="support-filters">
          ${filterSelect('support-filter', L('สถานะ', 'Status', '状态'), statusOptions, status)}
          ${filterSelect('support-category-filter', L('หมวดหมู่', 'Topic', '类别'), categoryOptions, category)}
          <button type="button" class="support-refresh" data-support-refresh ${listBusy || detailBusy || writeBusy ? 'disabled' : ''} aria-label="${e(L('อัปเดตรายการและบทสนทนา', 'Refresh requests and conversation', '刷新咨询列表和对话'))}" title="${e(L('อัปเดตข้อมูล', 'Refresh', '刷新'))}">${refreshIcon}</button>
        </div>
        <p class="support-inbox-note">${e(L('เรียงตามความเคลื่อนไหวล่าสุด เรื่องที่มีคำตอบใหม่จะกลับขึ้นด้านบน', 'Latest activity first. A new reply brings a request back to the top.', '按最近动态排序，新回复会使咨询回到顶部。'))}<br>${e(L('กดรีเฟรชเพื่อตรวจข้อความใหม่ ไม่มีแชตสด', 'Refresh to check for new messages. No live chat.', '点击刷新查看新消息，无实时聊天。'))}${updated ? `<br>${e(L('ตรวจล่าสุด', 'Last checked', '最近检查'))} ${e(date(updated))}` : ''}</p>
      </div>${feedback(listError)}
      ${tickets.length ? `<ol class="support-ticket-list">${tickets.map((ticket) => `<li><button type="button" class="support-ticket-button" data-support-ticket="${e(ticket.id)}" aria-current="${selected?.id === ticket.id}" ${writeBusy ? 'disabled' : ''}><span class="support-ticket-meta"><span>${e(ticket.ticket_number)}</span><time datetime="${e(ticket.updated_at)}" title="${e(L('ความเคลื่อนไหวล่าสุด', 'Latest activity', '最近动态'))}">${e(date(ticket.updated_at))}</time></span><h3>${e(ticket.subject)}</h3><span class="support-ticket-bottom"><span>${e(labels[ticket.category] ? tr(labels[ticket.category]) : tr(labels.other))}</span>${badge(ticket.status)}</span></button></li>`).join('')}</ol>` : `<div class="support-list-empty" ${listBusy ? 'role="status"' : ''}>${e(listBusy ? L('กำลังโหลดเรื่อง…', 'Loading requests…', '正在加载咨询…') : listLoaded ? L('ไม่พบเรื่องที่ตรงกับตัวกรองนี้', 'No requests match these filters.', '未找到符合筛选条件的咨询。') : L('กดอัปเดตข้อมูลเพื่อลองอีกครั้ง', 'Use Refresh to try again.', '请点击刷新重试。'))}</div>`}
      <div class="support-list-end">${cursor ? `<button type="button" class="button secondary small" data-support-more ${listBusy || writeBusy ? 'disabled' : ''}>${e(listBusy ? L('กำลังโหลด…', 'Loading…', '加载中…') : L('ดูเรื่องเพิ่มเติม', 'Load more requests', '查看更多咨询'))}</button>` : ''}<span>${e(L(`แสดง ${tickets.length} เรื่อง · เคลื่อนไหวล่าสุดก่อน`, `Showing ${tickets.length} requests · latest activity first`, `显示 ${tickets.length} 条咨询 · 最近动态优先`))}</span></div>
    </aside>`;
  }
  function ticketActions(ticket) {
    const items = [];
    if (['open', 'pending'].includes(ticket.status))
      items.push(['resolve', L('แก้ไขเรียบร้อยแล้ว', 'Mark as resolved', '标记为已解决')]);
    if (ticket.status === 'resolved' || (admin && ticket.status === 'closed'))
      items.push(['reopen', L('เปิดเรื่องอีกครั้ง', 'Reopen request', '重新开启')]);
    if (admin && ticket.status !== 'closed')
      items.push(['close', L('ปิดเรื่อง', 'Close request', '关闭咨询')]);
    return items.length
      ? `<div class="support-ticket-actions">${items.map(([action, text]) => `<button type="button" data-support-action="${action}" ${writeBusy || detailBusy || staleTicketId === ticket.id ? 'disabled' : ''}>${e(text)}</button>`).join('')}</div>`
      : '';
  }
  // ขอข้อมูลคำสั่งซื้อเฉพาะเรื่องที่เปิดอยู่ และแสดงเพียงข้อมูลที่ API อนุญาต
  function orderContext() {
    if (!selected?.order_id) return '';
    if (orderBusy || (detailBusy && !relatedOrder && !orderError))
      return `<div class="support-order-context" role="status">${e(L('กำลังตรวจสอบคำสั่งซื้อที่เกี่ยวข้อง…', 'Checking the related order…', '正在检查相关订单…'))}</div>`;
    if (orderError || !relatedOrder)
      return `<div class="support-order-context"><p>${e(L('ยังแสดงข้อมูลคำสั่งซื้อไม่ได้ การสนทนายังใช้งานได้ตามปกติ', 'The related order could not be shown. You can continue this conversation.', '暂时无法显示相关订单，您仍可继续此对话。'))}</p><button type="button" class="button secondary small" data-support-order-refresh>${e(L('ลองโหลดคำสั่งซื้ออีกครั้ง', 'Retry related order', '重新加载相关订单'))}</button></div>`;
    const order = relatedOrder;
    const orderStates = {
      pending: ['รับคำสั่งซื้อแล้ว', 'Order received', '订单已收到'],
      confirmed: ['ยืนยันคำสั่งซื้อแล้ว', 'Confirmed', '已确认'],
      processing: ['กำลังเตรียมสินค้า', 'Preparing your order', '备货中'],
      shipped: ['จัดส่งแล้ว', 'Shipped', '已发货'],
      delivered: ['ส่งสำเร็จ', 'Delivered', '已送达'],
      cancelled: ['ยกเลิกแล้ว', 'Cancelled', '已取消'],
    };
    const paymentStates = {
      pending: ['รอชำระเงิน', 'Awaiting payment', '待支付'],
      paid: ['ชำระเงินแล้ว', 'Paid', '已支付'],
      failed: ['ชำระไม่สำเร็จ', 'Payment failed', '支付失败'],
      expired: ['การชำระเงินหมดเวลา', 'Payment expired', '支付已过期'],
      refund_required: ['อยู่ระหว่างดำเนินการคืนเงิน', 'Refund required', '需要退款'],
    };
    const orderUrl = `${admin ? '/admin' : '/tracking'}?order=${encodeURIComponent(order.id)}`;
    return `<section class="support-order-context" aria-label="${e(L('คำสั่งซื้อที่เกี่ยวข้อง', 'Related order', '相关订单'))}"><div class="support-order-heading"><span>${S.icon('package', 19)}<strong>${e(order.order_number)}</strong></span><strong>${e(S.money(order.total))}</strong></div><p>${e(orderStates[order.status] ? tr(orderStates[order.status]) : '—')} · ${e(paymentStates[order.payment_status] ? tr(paymentStates[order.payment_status]) : '—')}</p>${order.tracking_number ? `<p>${e(L('เลขพัสดุ', 'Tracking number', '运单号'))}: ${e(order.carrier || '')} ${e(order.tracking_number)}</p>` : ''}<div class="support-order-links"><a href="${e(orderUrl)}">${e(L('ดูรายละเอียดคำสั่งซื้อ', 'View order details', '查看订单详情'))}${S.icon('arrow', 13)}</a><a href="/simulation?mode=product&amp;order=${encodeURIComponent(order.id)}" target="_blank" rel="noopener">${e(L('เส้นทางสินค้า 3D', '3D product journey', '3D 商品旅程'))}${S.icon('arrow-up', 13)}</a></div></section>`;
  }
  function conversation() {
    if (!selected)
      return `<section class="support-conversation"><div class="support-conversation-empty">${S.icon('user', 38)}<h2>${e(admin ? L('พื้นที่สำหรับการดูแล', 'Room for a thoughtful reply.', '用心回复，从这里开始。') : L('ทุกคำถามมีพื้นที่ตรงนี้', 'Every question has a home.', '每个问题都值得倾听。'))}</h2><p>${e(admin ? L('เลือกเรื่องจากกล่องข้อความเพื่ออ่านและตอบลูกค้า', 'Choose a request from the inbox to read and reply.', '从收件箱中选择咨询以查看和回复客户。') : L('เลือกเรื่องเพื่อดูคำตอบ หรือส่งเรื่องใหม่ให้ทีมร้านช่วยตรวจสอบ', 'Choose a request to read the reply, or start a new conversation with the store team.', '选择咨询以查看回复，或向商店团队提交新的咨询。'))}</p>${!admin ? `<button type="button" class="button secondary" data-support-new style="margin-top:22px">${e(L('ส่งเรื่องแรกของคุณ', 'Start a request', '提交咨询'))}</button>` : ''}</div></section>`;
    const ticket = selected,
      reply = replyDrafts.get(ticket.id) || '';
    return `<section class="support-conversation" aria-labelledby="support-conversation-title" aria-busy="${detailBusy}"><header class="support-conversation-top"><div class="support-ticket-meta"><span>${e(ticket.ticket_number)}</span>${badge(ticket.status)}</div><h2 id="support-conversation-title" tabindex="-1">${e(ticket.subject)}</h2><div class="support-conversation-details"><span>${e(labels[ticket.category] ? tr(labels[ticket.category]) : tr(labels.other))}</span><span>·</span><span>${e(L('เริ่มเรื่อง', 'Opened', '提交于'))} ${e(date(ticket.created_at))}</span></div>${ticketActions(ticket)}</header>${orderContext()}${feedback(detailError)}${staleTicketId === ticket.id ? `<div class="support-stale-actions"><button type="button" class="button secondary" data-support-refresh ${listBusy || detailBusy || writeBusy ? 'disabled' : ''}>${e(L('อัปเดตและอ่านบทสนทนาล่าสุด', 'Refresh and read the latest conversation', '刷新并阅读最新对话'))}</button></div>` : ''}${messageCursor ? `<div class="support-thread-more"><button type="button" class="button secondary small" data-support-message-more ${detailBusy || writeBusy ? 'disabled' : ''}>${e(L('อ่านข้อความก่อนหน้า', 'Read earlier messages', '查看更早消息'))}</button></div>` : ''}${
      detailBusy && !messages.length
        ? `<p class="support-list-empty" role="status">${e(L('กำลังโหลดบทสนทนา…', 'Loading conversation…', '正在加载对话…'))}</p>`
        : `<ol class="support-thread" aria-label="${e(L('บทสนทนา', 'Conversation', '对话'))}">${messages
            .map((message) => {
              const staff = message.author_role === 'staff',
                self = admin ? staff : !staff;
              return `<li class="support-message ${self ? 'support-message-self' : ''} ${staff ? 'support-message-staff' : ''}"><div class="support-message-meta"><strong>${staff ? S.icon('user', 13) : ''}${e(staff ? L('ทีมร้าน Alyzyus', 'Alyzyus store team', 'Alyzyus 商店团队') : admin ? L('ลูกค้า', 'Customer', '客户') : L('คุณ', 'You', '您'))}</strong><time datetime="${e(message.created_at)}">${e(date(message.created_at))}</time></div><div class="support-message-body">${e(message.body)}</div></li>`;
            })
            .join('')}</ol>`
    }${ticket.status === 'closed' ? `<div class="support-closed-note">${e(admin ? L('เรื่องนี้ปิดแล้ว เปิดเรื่องอีกครั้งเพื่อส่งข้อความเพิ่มเติม', 'This request is closed. Reopen it to send another reply.', '此咨询已关闭，重新开启后可继续回复。') : L('เรื่องนี้ปิดแล้ว หากยังต้องการความช่วยเหลือ คุณสามารถส่งเรื่องใหม่และระบุเลขเรื่องนี้ได้', 'This request is closed. If you need more help, start a new request and include this request number.', '此咨询已关闭。如仍需帮助，请提交新咨询并附上此咨询编号。'))}</div>` : `<form id="support-reply-form" class="support-reply"><h3>${e(admin ? L('ตอบกลับลูกค้า', 'Reply to the customer', '回复客户') : L('ตอบกลับทีมร้าน', 'Reply to the store team', '回复商店团队'))}</h3><label class="support-field" for="support-reply"><span class="support-sr-only">${e(L('ข้อความตอบกลับ', 'Your reply', '回复内容'))}</span><textarea id="support-reply" name="reply" minlength="10" maxlength="4000" required ${writeBusy || detailBusy ? 'disabled' : ''} aria-describedby="support-reply-help">${e(reply)}</textarea><span class="support-field-caption" id="support-reply-help"><span>${e(L('10–4,000 ตัวอักษร', '10–4,000 characters', '10–4,000 个字符'))}</span><span class="support-counter" data-support-count="reply">${reply.length}/4000</span></span></label>${!newOpen ? submissionFeedback('reply') : ''}<div class="support-form-end"><p>${e(admin ? L('ข้อความจะบันทึกในบัญชีของลูกค้า ไม่ส่งอีเมลแจ้งเตือนอัตโนมัติ', 'Your reply is saved to the customer’s account. No automatic email notification is sent.', '回复会保存到客户账户，不会自动发送邮件通知。') : L('ทีมร้านจะเห็นข้อความเมื่อเปิดกล่องบริการลูกค้า ไม่ใช่บริการแชตสด', 'The store team sees your message in its service inbox. This is not live chat.', '商店团队可在服务收件箱中查看此消息，此处并非实时聊天。'))}</p><button class="button" type="submit" ${writeBusy || detailBusy || (recovery?.kind === 'reply' && recovery.ticketId === ticket.id) ? 'disabled' : ''}>${e(writeBusy ? L('กำลังส่ง…', 'Sending…', '发送中…') : L('ส่งข้อความ', 'Send reply', '发送回复'))}${S.icon('arrow', 16)}</button></div></form>`}</section>`;
  }
  function render() {
    const active = document.activeElement;
    if (active && root.contains?.(active))
      preservedFocus = active.id
        ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
        : null;
    const oldThread = root.querySelector('.support-thread');
    const scrollTop = oldThread?.scrollTop || 0;
    root.setAttribute('aria-busy', String(checking || listBusy || detailBusy || writeBusy));
    const access = permissionState();
    root.innerHTML =
      access ||
      `${notice ? `<div class="support-issue-area">${feedback(notice, 'success')}</div>` : ''}${detailError && !selected ? `<div class="support-issue-area">${feedback(detailError)}</div>` : ''}${createForm()}<div class="support-workspace">${inbox()}${conversation()}</div>`;
    const thread = root.querySelector('.support-thread');
    if (thread) thread.scrollTop = scrollTop;
    const focus = preservedFocus;
    const restored = focus && document.getElementById(focus.id);
    if (restored && !restored.disabled) {
      restored.focus({ preventScroll: true });
      if (typeof focus.start === 'number' && restored.setSelectionRange)
        restored.setSelectionRange(focus.start, focus.end);
    } else if (!restored && !checking) preservedFocus = null;
  }
  // ล้างข้อมูลส่วนตัวทันทีเมื่อออกจากระบบ รวมถึงยกเลิกผลลัพธ์เก่าที่อาจกลับมาทีหลัง
  function clearPrivate() {
    identityEpoch++;
    listRequest++;
    detailRequest++;
    orderRequest++;
    tickets = [];
    cursor = null;
    selected = null;
    relatedOrder = null;
    orderBusy = false;
    orderError = false;
    staleTicketId = null;
    queryOrderApplied = false;
    preservedFocus = null;
    messages = [];
    messageCursor = null;
    listLoaded = false;
    listBusy = false;
    detailBusy = false;
    writeBusy = false;
    listError = '';
    detailError = '';
    formError = '';
    status = 'all';
    category = 'all';
    query = '';
    searchDraft = '';
    searchError = '';
    notice = '';
    updated = null;
    newOpen = false;
    orders = [];
    ordersFailed = false;
    recovery = null;
    recoveryPrepared = '';
    draft = { category: 'order', subject: '', message: '', orderId: '' };
    createKey = uuid();
    replyDrafts.clear();
    replyKeys.clear();
  }
  function loseAuth(err) {
    if (err.status === 401) {
      authRequest++;
      clearPrivate();
      user = null;
      checking = false;
      render();
      return true;
    }
    if (err.status === 403 && ['FORBIDDEN', 'EMAIL_NOT_VERIFIED'].includes(err.code)) {
      authRequest++;
      clearPrivate();
      user =
        err.code === 'EMAIL_NOT_VERIFIED'
          ? { ...(user || {}), emailVerified: false }
          : { ...(user || {}), role: 'customer' };
      checking = false;
      render();
      return true;
    }
    return false;
  }
  function mergeUnique(oldRows, newRows) {
    const rows = new Map(oldRows.map((row) => [String(row.id), row]));
    newRows.forEach((row) => rows.set(String(row.id), { ...row, id: String(row.id) }));
    return [...rows.values()];
  }
  function rememberTicket(ticket) {
    if (!ticket || !validId(ticket.id)) return;
    ticket = { ...ticket, id: String(ticket.id) };
    selected = ticket;
    const index = tickets.findIndex((item) => item.id === ticket.id);
    if (index !== -1) tickets[index] = ticket;
    const url = new URL(location.href);
    url.searchParams.set('ticket', ticket.id);
    history.replaceState(null, '', url);
  }
  async function loadList(more = false) {
    if (listBusy || writeBusy) return;
    const token = ++listRequest,
      epoch = identityEpoch;
    listBusy = true;
    listError = '';
    render();
    try {
      const params = new URLSearchParams({ limit: '20', status, category });
      if (query) params.set('q', query);
      if (more && cursor) params.set('cursor', cursor);
      const data = await S.api(`${base}?${params}`, { cache: 'no-store' });
      if (token !== listRequest || epoch !== identityEpoch) return;
      const rows = Array.isArray(data.tickets)
        ? data.tickets
            .filter((item) => validId(item.id))
            .map((item) => ({ ...item, id: String(item.id) }))
        : [];
      tickets = more ? mergeUnique(tickets, rows) : rows;
      cursor = data.nextCursor || null;
      listLoaded = true;
      updated = new Date().toISOString();
    } catch (err) {
      if (token === listRequest && epoch === identityEpoch && !loseAuth(err))
        listError = err.code || 'default';
    } finally {
      if (token === listRequest) {
        listBusy = false;
        render();
      }
    }
  }
  async function loadDetail(id, more = false, focus = false) {
    if (!validId(id) || writeBusy) return;
    const token = ++detailRequest,
      epoch = identityEpoch;
    const oldThread = root.querySelector('.support-thread');
    const oldPosition =
      more && oldThread ? { top: oldThread.scrollTop, height: oldThread.scrollHeight } : null;
    let loaded = false;
    if (!more && selected?.id !== id) {
      orderRequest++;
      relatedOrder = null;
      orderBusy = false;
      orderError = false;
      staleTicketId = null;
      messages = [];
      messageCursor = null;
      selected = tickets.find((ticket) => ticket.id === id) || null;
    }
    detailBusy = true;
    detailError = '';
    formError = '';
    render();
    try {
      const params = new URLSearchParams({ limit: '40' });
      if (more && messageCursor) params.set('cursor', messageCursor);
      const data = await S.api(`${base}/${encodeURIComponent(id)}?${params}`, {
        cache: 'no-store',
      });
      if (token !== detailRequest || epoch !== identityEpoch) return;
      const previousUpdatedAt = selected?.updated_at;
      rememberTicket(data.ticket);
      const rows = Array.isArray(data.messages)
        ? data.messages.filter((message) => validId(message.id))
        : [];
      messages = mergeUnique(more ? messages : [], rows).sort((a, b) =>
        BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0
      );
      messageCursor = data.nextCursor || null;
      // การโหลดข้อความเก่าไม่ถือว่าอ่านความเคลื่อนไหวล่าสุดแล้ว
      if (
        more &&
        (staleTicketId === id ||
          (previousUpdatedAt && data.ticket?.updated_at !== previousUpdatedAt))
      ) {
        staleTicketId = id;
        detailError = 'SUPPORT_STALE';
      } else if (!more && staleTicketId === id) staleTicketId = null;
      loaded = true;
    } catch (err) {
      if (token === detailRequest && epoch === identityEpoch && !loseAuth(err))
        detailError = err.code || 'default';
    } finally {
      if (token === detailRequest) {
        detailBusy = false;
        render();
        const title = document.getElementById('support-conversation-title');
        if (focus) {
          title?.focus({ preventScroll: true });
          if (window.matchMedia?.('(max-width: 760px)')?.matches)
            title
              ?.closest('.support-conversation')
              ?.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
        const thread = root.querySelector('.support-thread');
        if (thread && !more) thread.scrollTop = thread.scrollHeight;
        if (thread && loaded && oldPosition)
          thread.scrollTop = oldPosition.top + thread.scrollHeight - oldPosition.height;
      }
    }
    if (loaded && !more && token === detailRequest && epoch === identityEpoch && selected?.order_id)
      void loadRelatedOrder(id);
  }
  async function loadRelatedOrder(id) {
    if (!selected?.order_id || selected.id !== id || !user?.emailVerified) return;
    const token = ++orderRequest,
      epoch = identityEpoch,
      orderId = selected.order_id;
    orderBusy = true;
    orderError = false;
    render();
    try {
      const data = await S.api(`${base}/${encodeURIComponent(id)}/order`, { cache: 'no-store' });
      if (token !== orderRequest || epoch !== identityEpoch || selected?.id !== id) return;
      relatedOrder = data.order && data.order.id === orderId ? data.order : null;
    } catch (err) {
      if (
        token === orderRequest &&
        epoch === identityEpoch &&
        selected?.id === id &&
        !loseAuth(err)
      )
        orderError = true;
    } finally {
      if (token === orderRequest && epoch === identityEpoch && selected?.id === id) {
        orderBusy = false;
        render();
      }
    }
  }
  async function loadOrders(epoch) {
    if (admin) return;
    try {
      const data = await S.api('/api/orders', { cache: 'no-store' });
      if (epoch !== identityEpoch) return;
      orders = Array.isArray(data.orders) ? data.orders : [];
      ordersFailed = false;
      // พารามิเตอร์ URL ช่วยเลือกได้เฉพาะออเดอร์ที่ API ยืนยันว่าเป็นของบัญชีนี้
      if (!queryOrderApplied && !queryId && validOrderId(queryOrder)) {
        queryOrderApplied = true;
        const ownOrder = orders.find((order) => order.id === queryOrder);
        if (ownOrder && !draft.subject && !draft.message) {
          draft.orderId = ownOrder.id;
          draft.category = 'order';
          newOpen = true;
        }
      }
    } catch {
      if (epoch === identityEpoch) ordersFailed = true;
    }
  }
  async function checkAuth() {
    const token = ++authRequest;
    checking = true;
    authError = false;
    render();
    try {
      const data = await S.api('/api/auth/me', { cache: 'no-store' });
      if (token !== authRequest) return;
      if (
        user?.id !== data.user?.id ||
        user?.role !== data.user?.role ||
        user?.emailVerified !== data.user?.emailVerified
      )
        clearPrivate();
      user = data.user || null;
      if (user?.emailVerified && (!admin || user.role === 'admin')) await loadOrders(identityEpoch);
    } catch {
      if (token === authRequest) authError = true;
    } finally {
      if (token === authRequest) {
        checking = false;
        render();
      }
    }
    if (token !== authRequest) return;
    if (!authError && user?.emailVerified && (!admin || user.role === 'admin')) {
      const selectedId = selected?.id || queryId;
      await loadList();
      if (token === authRequest && user && validId(selectedId)) await loadDetail(selectedId);
    }
  }
  async function createTicket() {
    if (writeBusy || recovery?.kind === 'create') return;
    const epoch = identityEpoch;
    writeBusy = true;
    formError = '';
    notice = '';
    recoveryPrepared = '';
    render();
    let saved = null;
    try {
      const data = await S.api('/api/support/tickets', {
        method: 'POST',
        body: { ...draft, orderId: draft.orderId || null, idempotencyKey: createKey },
      });
      if (epoch !== identityEpoch) return;
      saved = data.ticket;
      rememberTicket(saved);
      status = 'all';
      category = 'all';
      query = '';
      searchDraft = '';
      searchError = '';
      draft = { category: 'order', subject: '', message: '', orderId: '' };
      createKey = uuid();
      newOpen = false;
      notice = 'saved';
      messages = [];
      messageCursor = null;
    } catch (err) {
      if (epoch === identityEpoch && !loseAuth(err)) {
        formError = err.code || 'default';
        if (err.code === 'IDEMPOTENCY_CONFLICT') recovery = { kind: 'create', reviewed: false };
      }
    } finally {
      if (epoch === identityEpoch) {
        writeBusy = false;
        render();
      }
    }
    if (saved && epoch === identityEpoch) {
      await loadList();
      if (epoch === identityEpoch) await loadDetail(String(saved.id), false, true);
    }
  }
  async function sendReply() {
    if (
      writeBusy ||
      detailBusy ||
      !selected ||
      (recovery?.kind === 'reply' && recovery.ticketId === selected.id)
    )
      return;
    const id = selected.id,
      message = replyDrafts.get(id) || '',
      epoch = identityEpoch;
    if (!replyKeys.has(id)) replyKeys.set(id, uuid());
    writeBusy = true;
    formError = '';
    notice = '';
    recoveryPrepared = '';
    newOpen = false;
    render();
    let saved = false;
    try {
      const data = await S.api(`${base}/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: { message, idempotencyKey: replyKeys.get(id) },
      });
      if (epoch !== identityEpoch) return;
      rememberTicket(data.ticket);
      replyDrafts.delete(id);
      replyKeys.delete(id);
      saved = true;
      notice = 'saved';
    } catch (err) {
      if (epoch === identityEpoch && !loseAuth(err)) {
        formError = err.code || 'default';
        if (err.code === 'IDEMPOTENCY_CONFLICT')
          recovery = { kind: 'reply', ticketId: id, reviewed: false };
      }
    } finally {
      if (epoch === identityEpoch) {
        writeBusy = false;
        render();
      }
    }
    if (saved && epoch === identityEpoch) {
      await loadList();
      if (epoch === identityEpoch) {
        await loadDetail(id);
        document.getElementById('support-reply')?.focus({ preventScroll: true });
      }
    }
  }
  async function changeStatus(action) {
    if (
      writeBusy ||
      detailBusy ||
      !selected ||
      staleTicketId === selected.id ||
      !['resolve', 'reopen', 'close'].includes(action)
    )
      return;
    const epoch = identityEpoch,
      id = selected.id,
      expectedUpdatedAt = selected.updated_at;
    writeBusy = true;
    detailError = '';
    notice = '';
    render();
    let saved = false;
    try {
      const data = await S.api(`${base}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { action, expectedUpdatedAt },
      });
      if (epoch !== identityEpoch) return;
      rememberTicket(data.ticket);
      saved = true;
    } catch (err) {
      if (epoch === identityEpoch && !loseAuth(err)) {
        detailError = err.code || 'default';
        if (err.code === 'SUPPORT_STALE') staleTicketId = id;
      }
    } finally {
      if (epoch === identityEpoch) {
        writeBusy = false;
        render();
      }
    }
    if (saved && epoch === identityEpoch) await loadList();
  }
  async function checkConflict(kind) {
    if (writeBusy || listBusy || detailBusy || recovery?.kind !== kind) return;
    const epoch = identityEpoch,
      pending = recovery;
    if (kind === 'create') {
      status = 'all';
      category = 'all';
      query = '';
      searchDraft = '';
      searchError = '';
      cursor = null;
    }
    await loadList();
    if (epoch !== identityEpoch || recovery !== pending || listError) return;
    if (kind === 'reply') {
      await loadDetail(pending.ticketId);
      if (
        epoch !== identityEpoch ||
        recovery !== pending ||
        detailError ||
        selected?.id !== pending.ticketId
      )
        return;
    }
    pending.reviewed = true;
    render();
  }
  function prepareSeparateSubmission(kind) {
    if (writeBusy || listBusy || detailBusy || recovery?.kind !== kind || !recovery.reviewed)
      return;
    if (kind === 'reply' && recovery.ticketId !== selected?.id) return;
    // เปลี่ยน UUID เฉพาะเมื่อผู้ใช้ตรวจสอบและกดปุ่มชัดเจน ไม่ส่งซ้ำโดยอัตโนมัติ
    if (kind === 'create') createKey = uuid();
    else replyKeys.set(selected.id, uuid());
    recovery = null;
    recoveryPrepared = kind;
    formError = '';
    render();
  }
  // เก็บฉบับร่างเฉพาะหน้านี้ ไม่ใส่ข้อความส่วนตัวลง localStorage หรือ service worker
  root.addEventListener('input', (event) => {
    const field = event.target;
    if (field.id === 'support-search' || field.name === 'ticketSearch') searchDraft = field.value;
    if (field.form?.id === 'support-create-form' && Object.hasOwn(draft, field.name))
      draft[field.name] = field.value;
    if (field.id === 'support-reply' && selected) replyDrafts.set(selected.id, field.value);
    const counter = root.querySelector(
      `[data-support-count="${field.name === 'reply' ? 'reply' : field.name === 'message' ? 'message' : 'subject'}"]`
    );
    if (counter && ['reply', 'message', 'subject'].includes(field.name))
      counter.textContent = `${field.value.length}/${field.name === 'subject' ? 120 : 4000}`;
  });
  root.addEventListener('change', (event) => {
    if (['support-filter', 'support-category-filter'].includes(event.target.id)) {
      if (listBusy || writeBusy) return;
      if (event.target.id === 'support-filter') {
        if (event.target.value !== 'all' && !Object.hasOwn(statuses, event.target.value)) return;
        status = event.target.value;
      } else {
        if (event.target.value !== 'all' && !Object.hasOwn(labels, event.target.value)) return;
        category = event.target.value;
      }
      cursor = null;
      tickets = [];
      listLoaded = false;
      loadList();
    }
    if (['category', 'orderId'].includes(event.target.name))
      draft[event.target.name] = event.target.value;
  });
  root.addEventListener('submit', (event) => {
    if (event.target.id === 'support-search-form') {
      event.preventDefault();
      if (listBusy || writeBusy) return;
      const value = searchDraft.trim().toUpperCase();
      if (
        value &&
        (!/^(?:ALY-S-)?[1-9]\d{0,18}$/.test(value) ||
          BigInt(value.replace(/^ALY-S-/, '')) > 9223372036854775807n)
      ) {
        searchError = L(
          'ใช้เลขเรื่อง เช่น ALY-S-123 หรือ 123',
          'Use a request number such as ALY-S-123 or 123.',
          '请输入咨询编号，例如 ALY-S-123 或 123。'
        );
        render();
        return;
      }
      query = value;
      searchError = '';
      cursor = null;
      tickets = [];
      listLoaded = false;
      loadList();
    }
    if (event.target.id === 'support-create-form') {
      event.preventDefault();
      createTicket();
    }
    if (event.target.id === 'support-reply-form') {
      event.preventDefault();
      sendReply();
    }
  });
  root.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.hasAttribute('data-support-auth')) {
      await checkAuth();
      return;
    }
    if (writeBusy) return;
    if (target.hasAttribute('data-support-order-refresh')) {
      if (!orderBusy && selected) await loadRelatedOrder(selected.id);
      return;
    }
    if (target.hasAttribute('data-support-clear-search')) {
      if (listBusy) return;
      query = '';
      searchDraft = '';
      searchError = '';
      cursor = null;
      tickets = [];
      listLoaded = false;
      await loadList();
      return;
    }
    if (target.dataset.supportCheckConflict) {
      await checkConflict(target.dataset.supportCheckConflict);
      return;
    }
    if (target.dataset.supportRenew) {
      prepareSeparateSubmission(target.dataset.supportRenew);
      return;
    }
    if (target.hasAttribute('data-support-new')) {
      newOpen = true;
      formError = '';
      notice = '';
      render();
      document.getElementById('support-category')?.focus();
      return;
    }
    if (target.hasAttribute('data-support-close-form')) {
      newOpen = false;
      render();
      return;
    }
    if (target.hasAttribute('data-support-ticket')) {
      newOpen = false;
      notice = '';
      await loadDetail(target.dataset.supportTicket, false, true);
      return;
    }
    if (target.hasAttribute('data-support-more')) {
      await loadList(true);
      return;
    }
    if (target.hasAttribute('data-support-message-more')) {
      await loadDetail(selected.id, true);
      return;
    }
    if (target.hasAttribute('data-support-refresh')) {
      const id = selected?.id;
      await loadList();
      if (id && user) await loadDetail(id);
      return;
    }
    if (target.dataset.supportAction) await changeStatus(target.dataset.supportAction);
  });
  S.onChange((event) => {
    if (event.detail?.type === 'locale') render();
  });
  function forgetSession() {
    clearTimeout(authTimer);
    authRequest++;
    clearPrivate();
    user = null;
    checking = false;
    authError = false;
    render();
  }
  function recheckSession() {
    clearTimeout(authTimer);
    authTimer = setTimeout(() => checkAuth(), 120);
  }
  window.addEventListener('alyzyus:auth', (event) => {
    if (event.detail?.authenticated === false || event.detail?.reason === 'logout') forgetSession();
    else recheckSession();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== 'alyzyus-auth-sync') return;
    if (String(event.newValue || '').startsWith('logout:')) forgetSession();
    else recheckSession();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recheckSession();
  });
  window.addEventListener('pagehide', forgetSession);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) recheckSession();
  });
  checkAuth();
})();
