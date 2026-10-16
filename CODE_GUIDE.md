# คู่มือโค้ด Alyzyus

เว็บใช้ Python/Flask แสดง HTML ผ่าน Jinja2 และ JavaScript ปกติสำหรับการโต้ตอบ ไม่ต้อง build frontend ก่อนใช้งาน

## จุดเริ่มต้น

- `app.py` เป็น entrypoint ของ Flask/Vercel
- `server/` แยกการตั้งค่า ฐานข้อมูล การตรวจข้อมูล บัญชีสมาชิก และ API ออกจากกัน
- `server/media.py` ตรวจภาพจริง ย่อและลบ metadata ก่อนส่ง Supabase Storage รวมบริการแปลชื่อ/รายละเอียด MyMemory ที่ตรวจสิทธิ์ Admin
- `templates/base.html` เป็นโครงร่วม: เมนู ภาษา ธีม ถุงสินค้า และ footer
- `templates/macros.html` รวมข้อความ 3 ภาษา ไอคอน และการ์ดสินค้า
- `public/static/js/app.js` เป็น state ของหน้าเว็บใน `window.Shop` และตัวช่วยเรียก API
- `data/demo-products.json` ใช้เฉพาะตอนยังไม่เชื่อม Supabase
- `supabase/migrations/` เป็น schema, สิทธิ์ RLS และธุรกรรมคำสั่งซื้อ

## เพิ่มข้อความสามภาษา

ใน HTML ใช้ macro:

```jinja2
{{ tr('ข้อความไทย', 'English text', '中文文本') }}
```

ใน JavaScript ใช้:

```javascript
Shop.t({th: 'ข้อความไทย', en: 'English text', zh: '中文文本'});
```

ข้อความจากลูกค้าหรือฐานข้อมูลต้องใส่ด้วย `textContent` หรือผ่าน `Shop.escape()` ก่อนสร้าง HTML ห้ามนำข้อมูลที่รับมาวางใน `innerHTML` โดยตรง

## เรียก API

```javascript
const result = await Shop.api('/api/orders');
const result = await Shop.api('/api/checkout', {
  method: 'POST',
  body: {items, customer, paymentMethod, idempotencyKey}
});
```

`Shop.api()` ส่งคุกกี้เฉพาะ origin เดียวกัน และแปลง error เป็น `error.code`/`error.status` เพื่อแสดงข้อความที่เหมาะกับผู้ใช้ ราคาที่เบราว์เซอร์คำนวณเป็นเพียงประมาณการ เซิร์ฟเวอร์/ฐานข้อมูลเป็นผู้ตรวจยอดจริง

## แบบจำลอง 3 มิติไฟล์เดียว

เปิด `public/static/queue3d.html` ได้โดยตรง หรือไป `/simulation` ในเว็บ ต้องเชื่อมอินเทอร์เน็ตสำหรับ Three.js จาก cdnjs และ Google Fonts ไม่ต้องติดตั้ง Node หรือไลบรารีอื่นเพื่อเปิดไฟล์

- โหมดสำนักงานจำลอง Poisson arrivals, การเดิน, คิว และเวลาให้บริการผ่าน 5 จุด
- โหมดสินค้าเป็นภาพขั้นตอนของคำสั่งซื้อ ไม่ใช่ตำแหน่ง GPS หรือเส้นทางพัสดุจริง
- ลิงก์ `/simulation?mode=product&order=<UUID>` อ่านสถานะด้วยบัญชีที่เข้าสู่ระบบ และใช้สิทธิ์เดียวกับ API คำสั่งซื้อ
- พารามิเตอร์จำลองรวมอยู่ในกลุ่มค่าต้นสคริปต์ เพื่อแก้เวลาให้บริการ อัตราการเดิน และข้อจำกัดการวาดได้ง่าย

จำนวนตัวละครที่วาดถูกจำกัด แต่ตัวเลขคิวคำนวณจากข้อมูลจำลองทั้งหมด การแสดงผลลดความละเอียดตามอุปกรณ์ จำกัดเฟรมเรต และพักเมื่อแท็บไม่อยู่ด้านหน้า ควรเปิดหน้าต่าง 3 มิติเฉพาะเมื่อใช้งาน

## เปลี่ยนสินค้าและการชำระเงิน

เพิ่ม/แก้สินค้าในหน้า `/admin` ด้วยบัญชีที่ได้รับ role `admin` รายละเอียดของสินค้าเป็น object สามภาษา ส่วนราคาคิดเป็นเงินบาท สินค้า draft ไม่ปรากฏบนหน้าร้านจนกว่าจะเปิดใช้งาน

การเปลี่ยนค่า environment ต้อง redeploy บน Vercel ห้ามฝัง service role key, Stripe secret, รหัสผ่าน หรือข้อมูลลูกค้าจริงในไฟล์ HTML/JavaScript

รายละเอียดฐานข้อมูล สิทธิ์แอดมิน webhook และการคืนเงินอยู่ใน `supabase/OPERATIONS.md`


## ส่วนแอปและประสบการณ์ผู้ใช้

- `public/static/js/experience.js` / `css/experience.css`: dialog ปรับหน้าตา, palette, ตัวหนังสืออ่านสบาย, รูปพื้นหลังใน IndexedDB และ animation แบบทำครั้งเดียวเมื่อเลื่อนเห็น
- `public/static/js/install.js` / `css/install.css`: ตรวจความสามารถเบราว์เซอร์และ UI ติดตั้งที่ผู้ใช้กดเอง
- `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`: metadata ของ PWA และ cache เฉพาะไฟล์สาธารณะที่กำหนด
- `templates/install.html`: คำแนะนำติดตั้งแต่ละอุปกรณ์
- `templates/logs.html`, `public/static/js/logs.js`, `css/logs.css`: หน้ากิจกรรมของผู้ดูแล อ่านล่าสุดก่อนและโหลดหน้าก่อนหน้าด้วย cursor

การเพิ่มไฟล์ต้องปรับ allowlist ใน `scripts/package-vercel.py` เพื่อให้เข้า Deploy และตรวจ `scripts/package-github.py` เพื่อให้ source ส่งขึ้น GitHub โดยไม่รวมไฟล์ส่วนตัว


## Customer Service และสิทธิ์แต่งแอป

- `server/support.py`: API ที่ตรวจสิทธิ์และเรียกธุรกรรมคำร้องใน Supabase
- `templates/support.html`, `public/static/js/support.js`, `css/support.css`: ใช้ร่วมกันสำหรับศูนย์ช่วยเหลือลูกค้าและกล่องรับเรื่องของ Admin
- `server/preferences.py`: ตรวจบัญชีที่ยืนยันอีเมลก่อนอนุญาตตัวเลือกแต่งแอป
- การตั้งค่าแต่งแอปไม่เชื่อข้อมูลบัญชีที่กรอกเองใน localStorage; สีและรูปพื้นหลังแยก key ตาม UUID ที่เซิร์ฟเวอร์ยืนยันแล้ว
- `public/sw.js`: ยกเว้น `/support` และ API จากการจัดเก็บออฟไลน์ ข้อความคำร้องต้องอ่านจากเครือข่าย
