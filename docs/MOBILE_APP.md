# Alyzyus บนโทรศัพท์ แท็บเล็ต และคอมพิวเตอร์

อัปเดต 15 ตุลาคม 2026 — รุ่นนี้เป็น Progressive Web App (PWA) ของเว็บ Flask เดิม เปิดผ่านเบราว์เซอร์และเพิ่มไอคอนบนอุปกรณ์ได้ตามความสามารถของเบราว์เซอร์ ยังไม่มีแอปที่เผยแพร่ใน App Store หรือ Google Play และไม่ได้รวมไฟล์ APK/IPA ที่ผ่านการลงนาม

## การใช้งาน

เปิด [หน้าติดตั้ง Alyzyus](https://alyzyus.vercel.app/install) มีปุ่มเพิ่มแอปและปุ่ม **สมัครสมาชิก** แยกชัดเจน การติดตั้งเพิ่มทางเข้าเว็บ ส่วนการสมัครสมาชิกสร้างบัญชีสำหรับสั่งซื้อ

- Android / Chrome / Edge: กดปุ่มเพิ่มแอปเมื่อเบราว์เซอร์เปิดให้ติดตั้ง หรือเมนู ⋮ → Install app / Add to Home screen
- iPhone / iPad / Safari: แชร์ → เพิ่มไปยังหน้าจอโฮม → เปิดเป็นเว็บแอปหากมีตัวเลือก → เพิ่ม ไม่มีการใช้ `beforeinstallprompt` กับ Safari
- macOS / Safari: File → Add to Dock หรือ Share → Add to Dock เมื่อระบบรองรับ ส่วน Chrome / Edge ใช้ปุ่มติดตั้งของเบราว์เซอร์
- Windows / Linux / Chrome / Edge: ปุ่มติดตั้งที่หน้าเว็บหรือไอคอนใกล้แถบที่อยู่
- มือถือพับ Flip / Fold ที่ใช้ Android และเบราว์เซอร์ปัจจุบันใช้วิธีเดียวกับ Android หน้าเว็บปรับตามพื้นที่หน้าจอ ไม่ตรวจชื่อรุ่นเพื่อบังคับขนาด
- มือถือปุ่มกดและเบราว์เซอร์ที่ไม่รองรับการติดตั้ง: ใช้เว็บและบุ๊กมาร์ก ความสามารถขึ้นกับเบราว์เซอร์จริง ไม่รับประกันว่ารุ่นเก่าจะใช้ฟังก์ชัน JavaScript หรือ WebGL ได้ทั้งหมด

คำแนะนำในหน้า `/install` เลือกอุปกรณ์จากข้อมูลเบราว์เซอร์เพื่อความสะดวก ผู้ใช้เปลี่ยนกลุ่มอุปกรณ์เองได้เพราะการตรวจด้วย User-Agent อาจไม่ตรงเสมอ

## การจัดไฟล์และ Flask

- `public/manifest.webmanifest` → เสิร์ฟ `/manifest.webmanifest` ชนิด `application/manifest+json`
- `public/sw.js` → เสิร์ฟ `/sw.js` ชนิด `application/javascript`, `Cache-Control: no-cache`, `Service-Worker-Allowed: /`
- `public/offline.html` → เสิร์ฟ `/offline.html` เป็นไฟล์สาธารณะคงที่ ห้าม render Bootstrap, session หรือข้อมูลบัญชีลงไฟล์นี้
- `templates/install.html` → หน้า `/install`
- `public/static/js/install.js` → ลงทะเบียน Service Worker, รับ install prompt เมื่อผู้ใช้กด, แสดงวิธีติดตั้งและอัปเดตแบบผู้ใช้เลือก
- `public/static/css/install.css` → หน้าติดตั้งและ safe-area ในโหมดแอป
- `public/static/icons/*-v1.png` → ไอคอนสร้างในเครื่องด้วย Pillow และ Tahoma Bold ไม่พึ่งบริการภายนอก

Base template ต้องประกาศ `<link rel="manifest" href="/manifest.webmanifest">`, Apple touch icon ขนาด 180, viewport ที่มี `viewport-fit=cover` และโหลด install CSS / JS โดย JS อยู่หลัง `app.js` เพื่อใช้ `window.Shop` และภาษาเดิมทั้ง 3 ภาษา

`beforeinstallprompt` ขึ้นอยู่กับเบราว์เซอร์ การเคยติดตั้ง เกณฑ์การใช้งานและนโยบายของระบบ จึงไม่สัญญาว่าทุกเครื่องจะเห็นหน้าต่างติดตั้งทันที ปุ่มยังนำไปอ่านคำแนะนำได้เสมอ

## ขอบเขตออฟไลน์และข้อมูลส่วนตัว

Service Worker ใช้ allowlist คงที่เพียง 5 ไฟล์: ไอคอน 4 ไฟล์และ `/offline.html?v=20261015` ไม่เก็บหน้าเว็บที่ render ด้วย session, ข้อมูลบัญชี, ออเดอร์, ตะกร้า, API, การชำระเงิน, รูปสินค้า, CSS / JS ที่เปลี่ยนไปตาม release หรือบริการภายนอก

เส้นทาง `/api`, `/account`, `/admin`, `/auth`, `/cart`, `/checkout`, `/tracking`, `/payment` และ `/payments` รวมเส้นทางย่อยไม่ถูก intercept เลย ทุกคำขอที่ไม่ใช่ GET และคำขอข้ามโดเมนผ่านเครือข่ายตามปกติ

หน้า public ใช้ network-first และไม่บันทึก HTML เมื่อออฟไลน์จะแสดงเพียงหน้าขอเชื่อมต่อใหม่ ไม่แสดงราคา/สต็อก/สถานะเก่า ไม่รับคำสั่งซื้อออฟไลน์ และไม่มี Background Sync, Push หรือการติดตามตำแหน่ง

ภาษา ธีมและการปรับหน้าตาที่ผู้ใช้เลือกอาจอยู่ใน Local Storage / IndexedDB ตามระบบปรับแต่งของหน้าเว็บ ซึ่งแยกจาก Service Worker Cache Storage ผู้ใช้ที่ใช้เครื่องร่วมกันควรออกจากบัญชีเมื่อเลิกใช้งาน ระบบ PWA ไม่ได้เปลี่ยนวิธีตรวจสิทธิ์ของเซิร์ฟเวอร์

## การอัปเดตและทรัพยากร

ไม่มี polling, ไม่มี timer ทำงานถี่, ไม่มีการดาวน์โหลดข้อมูลเพื่อซิงก์เบื้องหลัง Service Worker ทำงานเมื่อเบราว์เซอร์เรียก event เท่านั้น ไฟล์ CSS / JS ของร้านอ่านจากเซิร์ฟเวอร์ตามปกติ จึงไม่ติดค้างในแคชของ PWA

เมื่อแก้ไอคอนหรือหน้าออฟไลน์ ให้เปลี่ยนเลขไฟล์/version ของ `PUBLIC_ASSETS` และ `CACHE_NAME` ใน `sw.js` พร้อม manifest และ Apple icon หากเปลี่ยนชื่อไอคอน ห้าม cache รายการเส้นทางแบบ wildcard

Service Worker ใหม่รอให้รุ่นเก่าหมดการใช้งาน หรือผู้ใช้กดอัปเดต ไม่มี `skipWaiting()` อัตโนมัติและไม่มีการ reload ทุกแท็บ ปุ่มอัปเดตไม่แสดงบนเส้นทาง checkout/auth/payment และแท็บที่ไม่ได้กดยืนยันจะไม่ reload เมื่อตัวควบคุมเปลี่ยน

## ตรวจสอบก่อนส่งมอบหรือเผยแพร่ในสโตร์

1. ตรวจ `/manifest.webmanifest`, `/sw.js`, `/offline.html` ว่าเป็น 200 และ MIME ถูกต้องบน HTTPS จริง
2. เปิด DevTools → Application: manifest ไม่ error ไอคอนตรงขนาด Service Worker scope `/`
3. ลองติดตั้งจาก Android/Chrome จริง, Safari/iOS จริง และ Safari/macOS จริง รวมถอนและติดตั้งใหม่ ตรวจ rotation, safe area, พับ/กางจอ และแป้นพิมพ์เสมือนด้วยอุปกรณ์จริง
4. เปิดบัญชีที่ล็อกอิน แล้วตรวจ Cache Storage ว่ามีเพียงไฟล์ใน allowlist จากนั้นออฟไลน์ หน้า public ต้องแจ้ง reconnect ส่วน API/checkout/account ต้องไม่ใช้ข้อมูลแคช
5. เปิด checkout อีกแท็บแล้ว Deploy SW รุ่นใหม่ ต้องไม่มีการ refresh checkout อัตโนมัติ
6. ทดสอบผู้ใช้ทุกวัยด้วยแป้นพิมพ์และ screen reader รวมภาษาไทย/อังกฤษ/จีน, light/dark, font scale 200%, reduced motion และหน้าต่างแคบ

มี contract test `node --test tests/pwa.test.mjs` ตรวจ manifest/ขนาดไอคอน ขอบเขต cache การปฏิเสธข้อมูล private การไม่เก็บ HTML และการอัปเดตแบบกดเลือก Tests นี้ไม่แทนการทดสอบติดตั้งบนอุปกรณ์จริง

หากต้องการเผยแพร่ Google Play / App Store ในขั้นถัดไป ต้องเลือกวิธีแพ็กเกจและประเมินข้อกำหนดแต่ละสโตร์ก่อน รวมบัญชีนักพัฒนา, signing, privacy / data safety declarations, screenshot, package identifiers, build และทดสอบบนเครื่องจริง และ review การผ่านสโตร์ไม่รับประกันจากการมี PWA เพียงอย่างเดียว

## เอกสารอ้างอิงทางการ

- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) — manifest, HTTPS และความต่างของการติดตั้งแต่ละแพลตฟอร์ม
- [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation) — Service Worker และกลยุทธ์แคช
- [Apple: Add a website to the iPhone Home Screen](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios) — Share / Add to Home Screen
- [Apple: Use Safari web apps on Mac](https://support.apple.com/en-ie/104996) — Add to Dock

อ่านเอกสารเมื่อ 15 ตุลาคม 2026 เมนูจริงอาจต่างตามภาษาและเวอร์ชันของอุปกรณ์
