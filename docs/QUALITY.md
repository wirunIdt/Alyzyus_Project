# ตรวจคุณภาพและดูแลโค้ด Alyzyus

ใช้คู่มือนี้ก่อนส่งโค้ดและ Deploy เพื่อให้แก้ไขง่าย รักษาพฤติกรรมเดิม และไม่ส่งข้อมูลส่วนตัวขึ้น GitHub/Vercel โค้ดหลักไม่ต้อง build frontend; Node และเครื่องมือจัดรูปแบบใช้เฉพาะงานพัฒนา

## เตรียมเครื่องพัฒนา

ต้องมี Python และ Node.js/npm ตามเวอร์ชันใน workflow ของ repository จากโฟลเดอร์โปรเจกต์บน Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm --prefix tests ci --ignore-scripts
```

`requirements.txt` คือ dependency ที่แอปใช้จริง ส่วน `requirements-dev.txt` เพิ่มเครื่องมือ QC; `tests/package-lock.json` ล็อกเครื่องมือ JavaScript/ฐานข้อมูลทดสอบ เครื่องมือเหล่านี้ไม่ใช่ dependency ที่ติดตั้งบนโทรศัพท์ผู้ใช้

การเปิดแอปในเครื่องยังใช้ `.env` ตาม [README](../README.md) การตรวจแบบอัตโนมัติด้านล่างใช้ mock และฐานข้อมูลทดสอบแยก ไม่ต้องใส่ production credentials

## คำสั่งตรวจงาน

```powershell
# ตรวจรูปแบบ, lint, syntax, ชุดทดสอบ และแพ็กเกจไฟล์
.\.venv\Scripts\python.exe -X utf8 scripts/check.py

# แก้ lint ที่แก้ได้อย่างปลอดภัย/จัดรูปแบบ แล้วตรวจทุกขั้นตอน
.\.venv\Scripts\python.exe -X utf8 scripts/check.py --fix

# ตรวจรูปแบบ, lint, syntax, Jinja และแพ็กเกจ โดยข้ามชุด Python/Node tests
.\.venv\Scripts\python.exe -X utf8 scripts/check.py --fast
```

อ่านผลจบทุกขั้นตอนและ exit code; สถานะผ่านต้องมาจากคำสั่งสำเร็จทั้งหมด ไม่ใช่จากการเปิดหน้าแรกได้อย่างเดียว `--fix` ใช้ safe lint fixes กับการจัดรูปแบบ source ไม่แก้ schema, เติม environment หรือทำรายการจริงให้ผู้ใช้ ตรวจ diff หลังใช้เสมอ ส่วน `--fast` เหมาะระหว่างแก้ไขและไม่แทนการตรวจเต็มก่อนส่งงาน

Ruff จัดรูปแบบ Python ใน `app.py`, `server/`, `scripts/`, `tests/`; Prettier จัด JavaScript/CSS, service worker และไฟล์เครื่องมือ JavaScript ตามรายการ `PRETTIER_TARGETS` ใน `scripts/check.py` ส่วน Jinja templates ตรวจด้วยการ compile และ JavaScript ใน HTML 3D ตรวจ syntax โดยคงไฟล์เดี่ยวไว้ ไม่ใช้ formatter HTML ทั่วไปแปลง Jinja โดยไม่ตรวจผล

หากกำลังแก้ข้อผิดพลาดเฉพาะจุด สามารถรันชุดที่เกี่ยวข้องก่อน แล้วใช้คำสั่ง QC เต็มก่อนส่งงาน:

```powershell
# Backend ทั้งหมด
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -p 'test_*.py'

# API ศูนย์ช่วยเหลือเฉพาะส่วน
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -p 'test_support.py'

# SQL และพฤติกรรม JavaScript ทั้งหมด
npm --prefix tests test

# Manifest ไฟล์ที่อนุญาตให้ส่ง โดยไม่มีเนื้อหาคีย์ลับ
.\.venv\Scripts\python.exe -X utf8 scripts/package-github.py
.\.venv\Scripts\python.exe -X utf8 scripts/package-vercel.py
```

ใช้ `-X utf8` บน Windows เพื่อให้ผลลัพธ์/manifest ที่มีภาษาไทยอ่านได้ หากการติดตั้ง dependency ไม่สำเร็จ ให้แก้สาเหตุและติดตั้งตาม lockfile อย่าลบชุดตรวจหรือปิดกฎเพียงเพื่อให้สถานะผ่าน

## แต่ละชั้นตรวจอะไร

| ชั้นตรวจ | สิ่งที่ตรวจได้ | สิ่งที่ยังต้องตรวจจริง |
|---|---|---|
| Ruff และ formatter | รูปแบบ Python, import, ความผิดพลาดโค้ดที่กฎตรวจจับได้ | ความหมายของกฎธุรกิจและการออกแบบ API |
| Prettier และ JavaScript syntax | source อ่านง่ายและ parser อ่านโค้ดได้ | DOM จริง, layout, การคลิก/สัมผัสบนอุปกรณ์ |
| Jinja compilation | syntax ของทุก template ถูกต้อง | ข้อมูลและหน้าตาเมื่อ render ในแต่ละสถานะ |
| Python tests | validation, Origin, authorization, HTTP/cookie behavior และ provider responses ที่จำลองไว้ | Supabase/Auth/Stripe/SMTP จริง |
| Node tests และ PGlite | SQL transactions/RLS/quotas/idempotency รวมกรณี UI privacy และ simulation | การตั้งค่าจริงของโปรเจกต์ cloud และ browser ทุกยี่ห้อ |
| Packaging allowlist | ไฟล์ที่จะส่งอยู่ในขอบเขตที่กำหนด และรูปแบบคีย์ที่ scanner รู้จัก | การตรวจข้อมูลส่วนตัว/ความลับทุกชนิดโดยผู้พัฒนา |
| Browser smoke test | หน้าจอจริง, คอนทราสต์, ฟอร์ม, error และ console | การใช้งานจริงทุกอุปกรณ์/เครือข่ายหรือปริมาณโหลดสูง |

การทดสอบอัตโนมัติผ่านเป็นหลักฐานตามขอบเขตชุดทดสอบ ไม่ใช่การรับรองความปลอดภัยหรือความพร้อมรับเงินจริงทุกช่องทาง

## รูปแบบโค้ดที่รักษาร่วมกัน

- `ruff.toml` กำหนดกฎ Python, `.prettierrc.json`/`.prettierignore` กำหนดรูปแบบและขอบเขต frontend, `.editorconfig` กำหนดรูปแบบไฟล์ร่วมกัน
- ใช้ formatter ที่ล็อกเวอร์ชันในโปรเจกต์ ไม่ minify source ที่ต้องแก้ต่อ ถ้าจัดรูปแบบผิดให้แก้ config ที่ใช้ร่วมกัน
- ตั้งชื่อบอกหน้าที่ ฟังก์ชันควรรับผิดชอบงานเดียว แยก validation, authorization, HTTP transport และการ render ตามโครงเดิม
- ใช้ CSS variables กับ theme; ใช้ตัวช่วย `Shop` เดิมสำหรับภาษา เงิน error และการเรียก API
- คอมเมนต์อธิบายเหตุผล ข้อจำกัด และกฎสำคัญ ไม่บรรยายซ้ำว่าทุกบรรทัดทำอะไร
- เปลี่ยนโค้ดเฉพาะขอบเขตงาน แยกการแก้พฤติกรรมจากการจัดรูปแบบให้ตรวจ diff ได้
- เพิ่ม regression test เมื่อแก้ bug ที่เกิดซ้ำได้ โดยทดสอบพฤติกรรม ไม่ยืนยันเพียงว่าชื่อฟังก์ชัน/ข้อความใน source ยังเหมือนเดิม
- ไม่แก้ migration ที่ใช้แล้ว; schema ใหม่ต้องใช้ migration ใหม่ และทดสอบกับฐานข้อมูลแยกก่อน
- คู่มือ แผนผังไฟล์ และ API ต้องเปลี่ยนพร้อม implementation ดูจุดแก้แต่ละเรื่องใน [CODE_GUIDE](../CODE_GUIDE.md)

## ตรวจผ่านเบราว์เซอร์ก่อน Deploy

เลือกทดสอบเส้นทางที่เปลี่ยนและองค์ประกอบร่วมที่ได้รับผลกระทบ:

1. เปิดหน้าที่แก้ทั้งภาษาไทย อังกฤษ จีน และ Light/Dark ตรวจข้อความ, select/options, placeholder, error, focus และปุ่ม disabled
2. ตรวจความกว้างหน้าจอเล็กประมาณ 280–390 px, tablet และ desktop ไม่มีข้อมูลสำคัญล้นแนวนอน ตรวจคีย์บอร์ดและ touch ตามการใช้งานจริง
3. ทดสอบ loading/empty/error state และเมื่อ network ล้มเหลว ฟอร์มไม่ล้าง draft และไม่กดส่งซ้ำจนเกิดรายการใหม่โดยไม่ตั้งใจ
4. งานส่วนตัวต้องทดสอบ guest, สมาชิกยืนยันอีเมล, ผู้ไม่มีสิทธิ์ และ Admin ในบัญชีทดสอบ ตรวจ logout/สลับบัญชี/response ที่ตอบช้า
5. ถ้าแก้ animation หรือฉาก 3D ให้ตรวจ reduced motion, หยุดเมื่อซ่อนหน้า, กล้อง touch และอย่าเพิ่ม loop/polling ให้หน้าที่ไม่ต้องใช้
6. ถ้าแก้ PWA ให้ตรวจอัปเดตเมื่อกดเอง หน้าออฟไลน์ไม่แสดงข้อมูลลูกค้า และไม่ reload ระหว่าง checkout
7. ตรวจ console และ HTTP responses ที่สัมพันธ์กับงาน บันทึกข้อจำกัดหรือขั้นตอนที่ยังไม่ได้ทดสอบตามจริง

อย่าสร้างบัญชีลูกค้าปลอม รายการจ่ายเงินจริง หรือแก้ข้อมูล production เพียงเพื่อ smoke test ใช้ test fixtures/บัญชีทดสอบและผู้ให้บริการใน test mode สำหรับการทดสอบธุรกรรม

## ก่อนส่ง GitHub และ Vercel

1. ตรวจ diff ว่าไม่มี environment, คีย์, รหัสผ่าน, ข้อมูลส่งสินค้า, บทสนทนา, export หรือไฟล์ส่วนตัวติดไป
2. รัน `scripts/check.py` ให้ผ่าน ถ้าพึ่ง schema ใหม่ให้ใช้ migration ที่ตรวจแล้วกับโปรเจกต์ที่ถูกต้องก่อน Deploy code
3. ตรวจ manifest ของ GitHub กับ Vercel โดยเฉพาะเมื่อเพิ่ม/ย้ายไฟล์ ไม่ใช้การอัปโหลดทั้งโฟลเดอร์ workspace โดยไม่ตรวจ
4. บันทึก commit ที่ส่งและผล CI; Deploy ให้ตรงกับ commit นั้นและรอ READY
5. ตรวจ `/api/health` และเส้นทางที่แก้บนโดเมน production การตอบ `status: ok` ของ health สาธารณะไม่ได้ตรวจระบบรับเงินทั้งหมด
6. เก็บ deployment ก่อนหน้าไว้สำหรับ rollback และรายงานผลทดสอบกับข้อจำกัดตามที่ทำจริง

Repository ใช้ Public ตามที่เจ้าของกำหนด GitHub Actions ตรวจ source เมื่อ push/PR แต่ไม่มี production secret สำหรับทำรายการจริง การผ่าน CI ไม่ได้สั่ง Deploy production โดยอัตโนมัติ
