/* ติดตั้งเมื่อผู้ใช้เลือกเท่านั้น ไม่ขอ notification/location และไม่ reload อัตโนมัติ */
(() => {
  'use strict';
  const copy = {
    add: {
      th: 'เพิ่ม Alyzyus บนอุปกรณ์',
      en: 'Add Alyzyus to your device',
      zh: '将 Alyzyus 添加到设备',
    },
    installed: {
      th: 'กำลังใช้แอป Alyzyus',
      en: 'You’re using the Alyzyus app',
      zh: '正在使用 Alyzyus 应用',
    },
    success: {
      th: 'เพิ่ม Alyzyus แล้ว เปิดได้จากไอคอนบนอุปกรณ์',
      en: 'Alyzyus has been added. Open it from your device’s app icon.',
      zh: '已添加 Alyzyus，可通过设备上的应用图标打开。',
    },
    ready: {
      th: 'อุปกรณ์นี้พร้อมติดตั้ง กดปุ่มด้านบนเพื่อเพิ่มแอป',
      en: 'This browser is ready. Use the button above to install.',
      zh: '此浏览器已准备就绪，点击上方按钮安装。',
    },
    manual: {
      th: 'เลือกอุปกรณ์ด้านล่างเพื่อดูวิธีเพิ่มแอป หรือใช้เว็บต่อได้เลย',
      en: 'Choose your device below for installation steps, or keep using the website.',
      zh: '选择下方设备查看安装方法，也可继续使用网页版。',
    },
    dismissed: {
      th: 'ยังไม่ได้เพิ่มแอป สามารถติดตั้งภายหลังหรือใช้เว็บต่อได้',
      en: 'You can install later or keep using the website.',
      zh: '可稍后安装，或继续使用网页版。',
    },
    failed: {
      th: 'เบราว์เซอร์ยังไม่เปิดหน้าติดตั้ง ลองทำตามวิธีสำหรับอุปกรณ์ด้านล่าง',
      en: 'This browser could not open installation. Try the device instructions below.',
      zh: '此浏览器无法打开安装窗口，请尝试下方设备说明。',
    },
    update: {
      th: 'มี Alyzyus เวอร์ชันใหม่ พร้อมเมื่อคุณต้องการ',
      en: 'A new Alyzyus version is ready when you are.',
      zh: 'Alyzyus 新版本已就绪，可随时更新。',
    },
    updateButton: { th: 'อัปเดตตอนนี้', en: 'Update now', zh: '立即更新' },
    later: { th: 'ไว้ภายหลัง', en: 'Later', zh: '稍后' },
  };
  const t = (value) =>
    window.Shop ? window.Shop.t(value) : value[document.documentElement.lang] || value.th;
  const displayMode = window.matchMedia('(display-mode: standalone)');
  let installed = displayMode.matches || window.navigator.standalone === true;
  let deferredPrompt = null;
  let waitingWorker = null;
  let acceptedUpdate = false;
  let noticeDismissed = false;
  let statusKey = installed ? 'installed' : 'manual';
  const transactionPath = /^\/(?:checkout|auth|payment|payments)(?:\/|$)/;

  function setStatus(key) {
    statusKey = key;
    document.querySelectorAll('[data-install-status]').forEach((el) => {
      el.textContent = t(copy[key]);
    });
  }
  function render() {
    document.querySelectorAll('[data-install-action]').forEach((button) => {
      button.disabled = installed;
      const label = button.querySelector('[data-install-action-label]');
      if (label) label.textContent = t(copy[installed ? 'installed' : 'add']);
    });
    document.querySelectorAll('[data-install-label]').forEach((label) => {
      label.textContent = t(copy[installed ? 'installed' : 'add']);
    });
    setStatus(statusKey);
    renderUpdate();
  }
  function showInstructions() {
    const guide = document.getElementById('install-guide');
    if (guide) {
      guide.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
      guide.focus({ preventScroll: true });
    } else location.assign('/install');
  }
  async function requestInstall(event) {
    if (installed) return;
    if (!deferredPrompt) {
      showInstructions();
      return;
    }
    event?.preventDefault();
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setStatus(choice.outcome === 'accepted' ? 'success' : 'dismissed');
    } catch {
      setStatus('failed');
      showInstructions();
    }
    render();
  }

  // beforeinstallprompt is a progressive enhancement, not available in Safari.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!installed) {
      setStatus('ready');
      render();
    }
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    setStatus('success');
    render();
  });
  displayMode.addEventListener?.('change', (event) => {
    installed = event.matches || navigator.standalone === true;
    setStatus(installed ? 'installed' : 'manual');
    render();
  });
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-install-action]');
    if (action) {
      event.preventDefault();
      void requestInstall(event);
      return;
    }
    const entry = event.target.closest('[data-install-app]');
    if (entry && !installed && deferredPrompt) {
      event.preventDefault();
      void requestInstall(event);
    } else if (entry && location.pathname === '/install') {
      event.preventDefault();
      showInstructions();
    }
    const update = event.target.closest('[data-app-update]');
    if (update && waitingWorker && !transactionPath.test(location.pathname)) {
      acceptedUpdate = true;
      waitingWorker.postMessage({ type: 'ACTIVATE_UPDATE' });
      update.disabled = true;
    }
  });

  function choosePlatform(platform) {
    const allowed = ['android', 'ios', 'mac', 'desktop', 'other'];
    if (!allowed.includes(platform)) platform = 'other';
    document
      .querySelectorAll('[data-install-platform]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.installPlatform === platform))
      );
    document.querySelectorAll('[data-install-instructions]').forEach((panel) => {
      panel.hidden = panel.dataset.installInstructions !== platform;
    });
  }
  document
    .querySelectorAll('[data-install-platform]')
    .forEach((button) =>
      button.addEventListener('click', () => choosePlatform(button.dataset.installPlatform))
    );
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  choosePlatform(
    ios
      ? 'ios'
      : /Android/.test(ua)
        ? 'android'
        : /Macintosh/.test(ua)
          ? 'mac'
          : /Windows|Linux/.test(ua)
            ? 'desktop'
            : 'other'
  );

  function renderUpdate() {
    const allowed = !!waitingWorker && !transactionPath.test(location.pathname);
    document.querySelectorAll('[data-app-update]').forEach((button) => {
      button.hidden = !allowed;
    });
    let notice = document.getElementById('app-update-notice');
    if (!allowed || noticeDismissed) {
      notice?.remove();
      return;
    }
    if (!notice) {
      notice = document.createElement('aside');
      notice.id = 'app-update-notice';
      notice.className = 'app-update-notice';
      notice.setAttribute('aria-label', 'Alyzyus update');
      notice.innerHTML =
        '<span data-update-message></span><button type="button" data-app-update></button><button type="button" class="app-update-dismiss">×</button>';
      notice.querySelector('.app-update-dismiss').addEventListener('click', () => {
        noticeDismissed = true;
        notice.remove();
      });
      document.body.append(notice);
    }
    notice.querySelector('[data-update-message]').textContent = t(copy.update);
    notice.querySelector('[data-app-update]').textContent = t(copy.updateButton);
    notice.querySelector('.app-update-dismiss').setAttribute('aria-label', t(copy.later));
  }
  window.addEventListener('shop:change', render);
  render();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener(
      'load',
      () => {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/', updateViaCache: 'none' })
          .then((registration) => {
            if (registration.waiting && navigator.serviceWorker.controller) {
              waitingWorker = registration.waiting;
              renderUpdate();
            }
            registration.addEventListener('updatefound', () => {
              const worker = registration.installing;
              worker?.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                  waitingWorker = registration.waiting || worker;
                  renderUpdate();
                }
              });
            });
          })
          .catch(() => {
            // การติดตั้งไม่สำเร็จต้องไม่ทำให้การเลือกซื้อหรือชำระเงินหยุดทำงาน
            if (!installed && !deferredPrompt) setStatus('manual');
          });
      },
      { once: true }
    );
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // ไม่รีเฟรชแท็บอื่น และไม่รีเฟรชผู้ใช้ที่กำลังชำระเงิน
      if (acceptedUpdate && !transactionPath.test(location.pathname)) {
        acceptedUpdate = false;
        location.reload();
      }
    });
  }
})();
