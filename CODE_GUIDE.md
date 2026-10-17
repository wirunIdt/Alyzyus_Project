# คู่มือแก้ไขโค้ด Alyzyus

เว็บใช้ Python/Flask ฝั่งเซิร์ฟเวอร์, HTML/Jinja2, CSS และ JavaScript ปกติฝั่งเบราว์เซอร์ ไม่มี frontend build สำหรับใช้งานจริง เครื่องมือจัดรูปแบบและทดสอบใช้เฉพาะตอนพัฒนา ไม่ถูกโหลดลงเครื่องลูกค้า

เริ่มตรวจงานด้วย [คู่มือ QC](docs/QUALITY.md) แล้วเลือกไฟล์จากตารางด้านล่าง แก้ที่ source โดยตรง ไม่ต้องแก้ไฟล์ที่สร้างจาก build

## ต้องการเปลี่ยนอะไร ให้เริ่มตรงไหน

| สิ่งที่ต้องการแก้ | ไฟล์หลัก | สิ่งที่ควรตรวจร่วมกัน |
|---|---|---|
| เมนู, footer, ปุ่มสมัคร, ถุงสินค้า | `templates/base.html`, `public/static/js/app.js` | หน้าจอเล็ก, คีย์บอร์ด, ภาษา, Light/Dark |
| สี, ฟอนต์, ปุ่ม, ช่องกรอกมาตรฐาน | `public/static/css/store.css` | CSS variables ใน `:root` และ `[data-theme="dark"]` |
| หน้าแรกและอินโทร | `templates/index.html`, `public/static/js/app.js`, `public/static/css/store.css` | ปุ่มข้าม, เปิดครั้งเดียวต่อ session, reduced motion |
| ค้นหา, หมวดหมู่, เรียงสินค้า | `templates/shop.html`, `public/static/js/catalog.js` | ภาษาทั้ง 3 ภาษา, หมวดใหม่ใน `Shop.categories` |
| หน้ารายละเอียดสินค้า | `templates/product.html`, `templates/macros.html`, `public/static/js/app.js` | สินค้าหมด, ปริมาณสูงสุด, ภาพ/ชื่อที่ไม่มีข้อมูล |
| สมาชิกและรหัสผ่าน | `server/auth.py`, `templates/account.html`, `public/static/js/account.js` | Cookies, email confirmation, callback, logout |
| เช็กเอาต์และชำระเงิน | `server/api.py`, `server/payments.py`, `server/validation.py`, `public/static/js/checkout.js` | ธุรกรรม SQL, idempotency, webhook, การตัดสต็อก |
| หลังบ้านสินค้า/คำสั่งซื้อ | `templates/admin.html`, `public/static/js/admin.js`, `public/static/css/admin.css` | `require_admin()`, RLS, validation ฝั่งเซิร์ฟเวอร์ |
| อัปโหลดภาพและแปลรายละเอียด | `server/media.py`, `public/static/js/admin.js` | ขนาดไฟล์/พิกเซล, metadata, แปลล้มเหลวแล้วยังเก็บข้อความเดิม |
| ประวัติและติดตามคำสั่งซื้อ | `templates/tracking.html`, `public/static/js/tracking.js` | เจ้าของออเดอร์, สถานะยกเลิก, ข้อมูลขนส่งจริง |
| Customer Service | `server/support.py`, `server/support_context.py`, `templates/support.html`, `public/static/js/support.js`, `public/static/css/support.css` | อ่านเฉพาะเจ้าของ/Admin, retry, activity cursor, revision, logout |
| บันทึกกิจกรรม | `server/audit.py`, `templates/logs.html`, `public/static/js/logs.js` | ห้ามเก็บเนื้อหาคำร้อง, รหัสผ่าน, token หรือที่อยู่ |
| แต่งแอปเฉพาะสมาชิก | `server/preferences.py`, `public/static/js/experience.js`, `public/static/css/experience.css` | เซิร์ฟเวอร์ยืนยันสมาชิก, แยก UUID, ล้างสิ่งที่แสดงเมื่อ logout |
| ติดตั้งแอปและออฟไลน์ | `templates/install.html`, `public/static/js/install.js`, `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html` | HTTPS, ความสามารถของ browser, ห้าม cache ข้อมูลส่วนตัว |
| ฉาก 3 มิติ | `public/static/queue3d.html` | ตัวแปร `PARAMETERS`, เฟรมเรต, กล้อง, สถานะจริงกับตัวอย่าง |
| Environment และการเชื่อม Supabase | `server/config.py`, `server/database.py`, `.env.example` | ตรวจ origin, เก็บคีย์ฝั่งเซิร์ฟเวอร์, timeout |
| เพิ่มหน้า HTML หรือ API | `server/views.py` หรือ Blueprint ที่เกี่ยวข้อง | template/script, สิทธิ์, validation, deployment allowlist |

## โครงสร้างและเส้นทางข้อมูล

```text
app.py → server.create_app()
  ├─ server/views.py → templates/ → public/static/css/ และ js/
  ├─ API Blueprints → auth + validation → server/database.py → Supabase
  └─ audit + response headers → ผลลัพธ์ที่ไม่เผยข้อมูลลับ

supabase/migrations/ → schema, RLS, ธุรกรรม และ audit ของข้อมูลธุรกิจ
tests/              → ตรวจ Python, JavaScript และ SQL ในฐานข้อมูลทดสอบ
scripts/            → QC และสร้างรายการไฟล์สำหรับ GitHub/Vercel
```

- `app.py` เป็น entrypoint สำหรับรันในเครื่องและ Vercel
- `server/__init__.py` ประกอบแอป, ลงทะเบียน Blueprint, ตรวจ Origin/ชนิดข้อมูล, ใส่ security headers และจัดการ error
- `server/database.py` เป็นจุดสำหรับ HTTP ไป Supabase และแปลงชื่อฟิลด์ข้อมูลเป็นรูปแบบที่หน้าเว็บใช้
- `templates/base.html` เป็นโครงทุกหน้า; `templates/macros.html` รวมข้อความ 3 ภาษา ไอคอน และการ์ดสินค้า
- `public/static/js/app.js` สร้าง `window.Shop` ให้สคริปต์ของแต่ละหน้าใช้ร่วมกัน
- `data/demo-products.json` เป็นข้อมูลสาธิตตอนยังไม่ตั้งค่าฐานข้อมูล ไม่มีข้อมูลลูกค้าและไม่ใช้รับเงินจริง

คงชื่อ API, ชื่อ `data-*` attribute และรูปแบบ JSON ที่หน้าเว็บใช้ หากเปลี่ยนต้องปรับผู้เรียกกับการทดสอบพร้อมกัน การเปลี่ยนรูปแบบโค้ดอย่างเดียวไม่ควรเปลี่ยนพฤติกรรม

## ค่าที่แก้ได้บ่อย

| ค่าที่ต้องการเปลี่ยน | จุดแก้ | ข้อควรคงไว้ |
|---|---|---|
| ขนาด JSON, page size, ขอบเขต bigint และเงิน | `MAX_JSON_BYTES`, `MAX_PAGE_SIZE`, `MAX_BIGINT`, `MAX_PRICE`, `PRICE_QUANTUM` ต้น `server/validation.py` | ใช้ `pagination()`/`bigint_id()` ร่วมกัน; คำนวณเงินด้วย Decimal |
| ขอบเขตหัวข้อ/ข้อความ Customer Service | `SUBJECT_MIN_LENGTH`, `SUBJECT_MAX_LENGTH`, `MESSAGE_MIN_LENGTH`, `MESSAGE_MAX_LENGTH` ต้น `server/support.py` | ปรับฟอร์ม, SQL validation และ tests ร่วมกัน |
| ขนาดภาพ, pixel limit, ขอบภาพ, คุณภาพ WebP | `MAX_IMAGE_BYTES`, `MAX_PIXELS`, `IMAGE_MAX_EDGE`, `IMAGE_WEBP_QUALITY` ต้น `server/media.py` | ตรวจข้อมูลภาพจริงก่อน decode และลบ metadata |
| Timeout, workers และ cache ของบริการแปล | ค่าชื่อ `TRANSLATION_*` ต้น `server/media.py` | จำกัดงานพร้อมกัน/เวลารอ และรักษาข้อความเดิมเมื่อแปลไม่สำเร็จ |
| ชุดสีส่วนตัว | `PALETTES` ต้น `public/static/js/experience.js` | ตรวจ contrast ทั้ง Light/Dark |
| ค่าจำลองและข้อจำกัดงานวาด 3D | `PARAMETERS` ต้น `public/static/queue3d.html` | จำกัด FPS/ตัวละครและพักเมื่อซ่อนหน้า |

ค่าที่ตรวจซ้ำใน SQL เป็นกฎของฐานข้อมูลด้วย การเปลี่ยนตัวเลข Python/JavaScript อย่างเดียวไม่แก้ข้อจำกัดในฐานข้อมูลที่ Deploy แล้ว

## เพิ่มข้อความและปรับหน้าตา

ใน template ใช้ macro 3 ภาษา:

```jinja2
{{ tr('ข้อความไทย', 'English text', '中文文本') }}
```

ใน JavaScript ใช้ตัวช่วยเดิม:

```javascript
const label = Shop.t({
  th: 'ข้อความไทย',
  en: 'English text',
  zh: '中文文本',
});
```

ข้อความจากลูกค้าหรือฐานข้อมูลต้องใส่ด้วย `textContent` หรือผ่าน `Shop.escape()` ก่อนประกอบ HTML ห้ามนำข้อความที่รับมาวางใน `innerHTML` โดยตรง แสดงชื่อสินค้า/คำร้องเป็นข้อความ แม้เนื้อหามีอักขระ `<` หรือ `>`

สีที่ใช้ร่วมกันอยู่ใน CSS variables เช่น `--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--accent` ปรับตัวแปรก่อนเพิ่มสีตายตัวใน component ส่วน palette สมาชิกอยู่ใน `PALETTES` ต้น `experience.js` ตรวจตัวหนังสือทั้ง Light และ Dark ทุกครั้งที่เพิ่มสีใหม่

ภาษาและ Light/Dark พื้นฐานใช้ได้ทุกคนเพื่อให้เข้าถึงเว็บสะดวก ตัวเลือก palette, รูปพื้นหลัง และความสบายในการอ่านต้องผ่านสิทธิ์สมาชิกที่เซิร์ฟเวอร์ยืนยันแล้ว

## เพิ่มหรือเปลี่ยน API

ใช้ `Shop.api()` เพื่อคงรูปแบบ error และ session ของเว็บ:

```javascript
const result = await Shop.api('/api/orders');

const created = await Shop.api('/api/support/tickets', {
  method: 'POST',
  body: {
    category: 'product',
    subject: 'สอบถามข้อมูลสินค้า',
    message: 'ต้องการสอบถามรายละเอียดเพิ่มเติมของสินค้ารายการนี้',
    orderId: null,
    idempotencyKey: crypto.randomUUID(),
  },
});
```

ตัวอย่างข้างต้นเป็นการเรียกครั้งแรก การ retry ข้อมูลเดิมหลัง network error ต้องใช้ `idempotencyKey` เดิม เก็บ key ไว้ข้าง draft ระหว่างรอผล ไม่สร้างใหม่อัตโนมัติทุกครั้งที่กดซ้ำ เมื่อข้อมูลเปลี่ยนหรือเกิด conflict ให้ผู้ใช้ตรวจผลเดิมก่อนเตรียมรายการใหม่

`Shop.api()` ส่ง cookies แบบ same-origin และคืนข้อผิดพลาดผ่าน `error.code`/`error.status` ฝั่ง Python ใช้ `ApiError` พร้อม code ที่กำหนดไว้ใน `server/errors.py` อย่าส่ง traceback, SQL หรือข้อความ provider ที่อาจมีข้อมูลส่วนตัวกลับไปยังผู้ใช้

สำหรับ API ใหม่:

1. อ่านข้อมูลด้วย `validation.read_json()` และกำหนด allowed/required fields ให้ชัดเจน
2. เรียก `require_user()` หรือ `require_admin()` ตามสิทธิ์จริงก่อนเข้าถึงข้อมูลส่วนตัว
3. อ่านข้อมูลส่วนตัวด้วย JWT ของบัญชีนั้นให้ RLS ตรวจซ้ำ ห้ามเปลี่ยนเป็น service key เพียงเพื่อให้ query ผ่าน
4. งานเขียนที่เกี่ยวกับเงิน สต็อก quota หรือ idempotency ต้องอยู่ในธุรกรรมฐานข้อมูล ไม่แยกเป็นหลายคำสั่งจาก browser
5. เพิ่มการทดสอบสิทธิ์ ข้อมูลผิดรูป และกรณี retry ที่สัมพันธ์กับพฤติกรรมใหม่

## กฎธุรกิจและฐานข้อมูล

ราคา ส่วนลด ค่าจัดส่ง และสต็อกใน browser เป็นข้อมูลแสดงผลเท่านั้น ธุรกรรม `create_order` ใน Supabase เป็นผู้ตรวจและคำนวณยอดจริง การแก้ค่าบนหน้าเว็บอย่างเดียวไม่เปลี่ยนยอดที่ฐานข้อมูลอนุมัติ

นโยบายเริ่มต้นใน SQL คือค่าจัดส่ง 80 บาท, ส่งฟรีเมื่อยอดสินค้าก่อนส่วนลดถึง 2,500 บาท และ `WELCOME10` สำหรับออเดอร์แรกที่มีสิทธิ์ ถ้าเปลี่ยนให้สร้าง migration ใหม่ ปรับค่าประมาณใน `Shop.shippingFor()`/ข้อความ progress และตรวจผลด้วย database tests ด้วยกัน

ไฟล์ใน `supabase/migrations/` เป็นประวัติที่ใช้ติดตั้งจริงแล้ว ห้ามแก้ย้อนหลังเพื่อเปลี่ยนฐานข้อมูลที่ Deploy อยู่ ให้สร้าง migration ใหม่ด้วย Supabase CLI, ทดสอบกับฐานข้อมูลแยก, ตรวจ RLS/grants และใช้ migration กับโปรเจกต์ที่ถูกต้องก่อน Deploy โค้ดที่พึ่ง schema ใหม่ ห้ามทดลองล้างตาราง production เพื่อทดสอบ

เพิ่ม/แก้สินค้าจริงผ่าน `/admin` ไม่แก้ JSON สาธิตเพื่อหวังเปลี่ยนสินค้าบน Supabase รายละเอียดชื่อ/คำอธิบายจัดเก็บเป็น object 3 ภาษา เลือกภาษาต้นฉบับครั้งเดียวแล้วให้ระบบช่วยแปลได้ แต่ผู้ดูแลควรตรวจคำแปลก่อนเปิดขาย

ขั้นตอนฐานข้อมูล, การให้สิทธิ์ Admin, webhook และข้อจำกัดการคืนเงินอยู่ใน [Supabase Operations](supabase/OPERATIONS.md)

## ข้อมูลส่วนตัวและ Customer Service

- สมาชิกต้องยืนยันอีเมล; role ผู้ดูแลอ่านจากตาราง `profiles` ไม่ใช้ `user_metadata`, hidden input หรือ localStorage เป็นหลักฐานสิทธิ์
- Cookies บัญชีเป็น HttpOnly; คีย์ Supabase ฝั่งเซิร์ฟเวอร์และ Stripe secret ห้ามอยู่ใน template, JavaScript, GitHub หรือ screenshot
- คำร้องอยู่ใน Supabase อ่านผ่าน RLS ไม่มีสำเนาบทสนทนาใน localStorage, public artifact หรือ cache ของ PWA
- ID ของคำร้อง/ข้อความ/audit เป็น bigint ส่งไป JavaScript เป็น string เปรียบเทียบโดยไม่ผ่าน `Number()` เพื่อไม่เสียเลขเกิน `2^53`
- เมื่อ logout, สลับบัญชี หรือ session หมดอายุ ให้ล้างเนื้อหาส่วนตัวที่แสดง และปฏิเสธ response เก่าที่กลับมาช้า ใช้กลไก session/identity epoch ของหน้าที่มีอยู่แล้ว
- รูปพื้นหลังสมาชิกเก็บใน IndexedDB บนอุปกรณ์ แยก key ตาม UUID ที่เซิร์ฟเวอร์ยืนยัน ไม่มีการอัปโหลดรูปให้ร้าน
- ฝั่ง API ตรวจสิทธิ์แต่งแอปด้วย `/api/account/appearance`; การซ่อนปุ่มอย่างเดียวไม่เพียงพอ
- Activity log เก็บเฉพาะข้อมูลที่จำเป็นต่อการตรวจสอบ ห้ามคัดลอกข้อความคำร้อง อีเมล ที่อยู่ รหัสผ่าน token หรือ URL query ที่อาจมี secret

รายละเอียดสถานะคำร้อง, quota, API และการ retry อยู่ใน [คู่มือ Customer Service](docs/CUSTOMER_SERVICE.md) ส่วนรูปแบบ log อยู่ใน [คู่มือ Activity Logs](docs/ACTIVITY_LOGS.md)

หน้า account, admin, checkout, tracking และ logs ใช้ `Shop.watchPrivateSession({ clear: clearSession, reload: load })` จาก `app.js` เพื่อจัดการ logout, สัญญาณข้ามแท็บ และการกลับจาก BFCache ร่วมกัน Callback `clear` ของแต่ละหน้าต้องล้าง DOM/state ส่วนตัวและเพิ่ม request token หรือ session epoch; callback `reload` ต้องตรวจบัญชีจริงจากเซิร์ฟเวอร์อีกครั้ง ทุก response ที่รอต้องเทียบ token/epoch ก่อนเขียนกลับลงหน้า ตัวช่วยคืนฟังก์ชันถอด event listeners สำหรับกรณีที่ component ถูกถอดออก อย่าเชื่อสัญญาณ `storage` ว่าเป็นหลักฐานการเข้าสู่ระบบ

หน้า account ใช้ตัวเลือก `ignoreLocalSignIn: true` เพราะจัดการผล login/signup เองเพื่อคงข้อความยืนยันอีเมล ส่วน support และ appearance มีกลไก identity epoch เฉพาะอยู่แล้ว ไม่ควรเพิ่มตัวเฝ้า session ซ้อนโดยไม่ตรวจพฤติกรรม

## แอนิเมชัน 3D และ PWA

`public/static/queue3d.html` ต้องเปิดเป็น HTML ไฟล์เดียวได้ต่อไป ใช้ Three.js จาก cdnjs และฟอนต์ Google Fonts จึงต้องมีอินเทอร์เน็ต แต่ไม่ต้องติดตั้ง Node เพื่อเปิดฉาก

แก้ค่าจำลองที่วัตถุ `PARAMETERS` ต้นสคริปต์ เช่นเวลาให้บริการ จำนวนคนที่วาด และเฟรมเรต อย่าเพิ่ม geometry/texture จำนวนมากใน loop วาดภาพ แยกจำนวนที่จำลองจริงออกจากจำนวนตัวละครที่วาด ปัจจุบันจำกัดตัวละคร 80 ตัว, สำนักงาน 30 FPS และเส้นทางสินค้า 18 FPS พร้อมลด pixel ratio และพักงานเมื่อซ่อนแท็บ/ฉาก

โหมดสำนักงานเป็นการจำลองคิว ส่วน `/simulation?mode=product&order=<UUID>` เป็นภาพกระบวนการจากสถานะออเดอร์ที่บัญชีมีสิทธิ์ดู ไม่มี GPS และไม่เปลี่ยนสถานะจริงเพราะ animation อย่าใช้เวลาจำลองแทนหลักฐานว่าพัสดุถูกจัดส่งแล้ว

Animation หน้าเว็บควรทำด้วย `transform`/`opacity`, หยุดเมื่อไม่จำเป็น และเคารพ `prefers-reduced-motion` ใช้ `IntersectionObserver` เดิมสำหรับการเผยเนื้อหาเมื่อเลื่อนเห็น ไม่เพิ่ม polling หรือ animation loop ให้ทุกหน้า

Service worker เก็บเฉพาะไอคอนและหน้าออฟไลน์สาธารณะใน allowlist ของ `public/sw.js` API, หน้าบัญชี, หลังบ้าน, เช็กเอาต์, ติดตามสินค้า และ Customer Service ต้องไม่ลง cache เมื่อแก้ public assets ที่ cache ไว้ให้เปลี่ยน version ของ cache/URL ที่เกี่ยวข้อง อัปเดตแอปเมื่อผู้ใช้กด ไม่ reload ระหว่างชำระเงิน

การติดตั้ง PWA ขึ้นกับ browser/ระบบปฏิบัติการ ไม่ใช่ไฟล์ APK/IPA และไม่ได้แปลว่าเผยแพร่ใน App Store/Play Store แล้ว ดูข้อจำกัดกับขั้นตอนทดสอบอุปกรณ์ใน [คู่มือ Mobile App](docs/MOBILE_APP.md)

## เพิ่มไฟล์และส่งงาน

- เพิ่ม runtime file หรือ template ใหม่: ตรวจ `scripts/package-vercel.py` ว่าอยู่ใน allowlist
- เพิ่ม source, tests, docs หรือเครื่องมือพัฒนา: ตรวจ `scripts/package-github.py` ว่าอยู่ใน allowlist
- ไม่เพิ่ม `.env`, คีย์, customer exports, `.venv`, `tests/node_modules`, log ส่วนตัว หรือ `legacy/private/` เข้าแพ็กเกจ
- การเปลี่ยน environment บน Vercel ต้อง Deploy ใหม่ อย่าพิมพ์ค่าลับลงคู่มือหรือผลทดสอบ
- รัน QC หลังแก้ไฟล์ และตรวจรายการไฟล์ที่จะส่งก่อน push/Deploy ตาม [QUALITY.md](docs/QUALITY.md)

GitHub และ Vercel ใช้แพ็กเกจคนละ allowlist การ push ขึ้น GitHub ไม่ได้ยืนยันว่าเว็บไซต์ production เปลี่ยนแล้ว ต้องตรวจ deployment ว่า READY และทดสอบ URL จริงอีกครั้ง
