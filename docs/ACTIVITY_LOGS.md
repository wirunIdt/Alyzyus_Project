# Activity logs ของ Alyzyus

ประวัติกิจกรรมเริ่มตั้งแต่ติดตั้ง migration `20261015102921_activity_audit_log.sql` ไม่มีการสร้างประวัติย้อนหลังหรือข้อมูลตัวอย่างปะปนกับเหตุการณ์จริง

## ข้อมูลสองระดับ

- **ประวัติในฐานข้อมูล:** สร้าง/แก้สินค้า เปลี่ยนสต็อก สร้างออเดอร์ เปลี่ยนสถานะออเดอร์/การชำระเงิน เปลี่ยนสิทธิ์บัญชี เข้าสู่ระบบ ออกจากระบบ เปลี่ยนรหัสผ่าน อัปโหลดรูปสินค้า และแปลสินค้า Admin อ่านได้ผ่าน `/admin/logs`
- **Structured runtime logs:** เวลาเปิดแอปและผล HTTP แต่ละคำขอเป็น JSON ใน log ของเซิร์ฟเวอร์/Vercel มี `request_id`, route pattern, HTTP status, ระยะเวลา และ error code ที่ปลอดภัย ไฟล์ static กับ health check ที่สำเร็จไม่สร้าง log ต่อครั้งเพื่อลดปริมาณข้อมูล

ชื่อ รหัสผ่าน โทเค็น cookie อีเมล เบอร์โทร ที่อยู่จัดส่ง เนื้อหา request หมายเลข IP และ query string ไม่ถูกบันทึกลง log นี้ Route ที่มีตัวแปรจะบันทึกเป็น `/product/<slug>` และ path ที่ไม่รู้จักเป็น `unmatched` แต่ละ response มี `X-Request-ID` ที่เซิร์ฟเวอร์สร้างเองสำหรับตามปัญหา

## สิทธิ์และความถูกต้อง

ตาราง `public.activity_logs` เปิด RLS ผู้ใช้ทั่วไปอ่านไม่ได้ ผู้ดูแลมี SELECT เท่านั้น ไม่มี API สำหรับ browser เขียน แก้ หรือลบ log ใช้ `profiles.role` ตรวจ Admin ไม่ใช้ `user_metadata`

การเปลี่ยนสินค้า สต็อก ออเดอร์ และสิทธิ์บัญชีใช้ PostgreSQL trigger ใน transaction เดียวกับข้อมูลจริง ถ้า transaction ย้อนกลับ ประวัตินั้นย้อนกลับด้วย การส่ง checkout ซ้ำแบบ idempotent ไม่เพิ่มประวัติความสำเร็จซ้ำ การเปลี่ยนสต็อกจาก checkout/การยกเลิกมี actor จากผู้ใช้ที่เซิร์ฟเวอร์ยืนยัน และ webhook ระบุแหล่งงานโดยไม่มี actor บุคคล

ค่า before/after เก็บเฉพาะราคา สต็อก สถานะ และค่าที่กำหนดไว้ ชื่อ field ที่แก้ เช่น `description` หรือ `tracking_number` แสดงได้ แต่ไม่คัดลอกข้อความ/หมายเลขดังกล่าวลงประวัติ

การเข้าสู่ระบบและงาน media มีการเขียนประวัติเสริมหนึ่งครั้งหลังสำเร็จ ใช้ network timeout 2 วินาที ไม่ retry และไม่สร้าง background worker ถ้าฐานข้อมูลประวัติใช้งานไม่ได้ การเข้าสู่ระบบยังสำเร็จและมี `audit.persist_failed` ใน runtime logs ความล้มเหลวในการเข้าสู่ระบบถูกบันทึกเฉพาะ runtime logs เพื่อลดการเขียนฐานข้อมูลจากคำขอที่ไม่ผ่านการยืนยัน

## API สำหรับ Admin

`GET /api/admin/logs?limit=50&category=all&cursor=123`

- `limit`: 1–100 ค่าเริ่มต้น 50
- `category`: `all`, `product`, `inventory`, `order`, `account`, `security`, `system`
- `cursor`: ไม่ต้องส่งในหน้าแรก หน้าถัดไปใช้ `nextCursor` ที่ตอบกลับ ค่านี้เป็น string เพื่อไม่สูญเสียความแม่นยำของ bigint ใน JavaScript

Response มี `logs`, `nextCursor`, `hasMore`, `limit`, `categories` แต่ละ log มี `id`, `created_at`, `category`, `action`, `severity`, `source`, `actor_id`, `entity_type`, `entity_id`, `details`, `request_id` ไม่มีการนับทุกแถวหรือโหลดประวัติทั้งฐานข้อมูลทุกครั้ง

## การดูแลข้อมูล

ไม่มีการลบประวัติอัตโนมัติในรุ่นนี้ ผู้ดูแลฐานข้อมูลควรกำหนดอายุเก็บรักษาตามการใช้งานจริงและสำรองข้อมูลก่อนทำงานบำรุงรักษา การลบ/ส่งออกระดับฐานข้อมูลทำโดยเจ้าของฐานข้อมูลที่ได้รับสิทธิ์เท่านั้น

นี่คือประวัติกิจกรรมของแอป ไม่ใช่ storage แบบ WORM เจ้าของฐานข้อมูลยังจัดการตารางได้ ไม่มีการติดตามตำแหน่งหรือวิเคราะห์พฤติกรรมผู้ใช้ ระบบแจ้งเตือนเหตุผิดปกติและการจัดเก็บ runtime logs ระยะยาวเป็นงานตั้งค่าผู้ให้บริการเพิ่มเติม

## การตรวจสอบ

Python: `python -m unittest discover -s tests -p "test_audit.py"`

PostgreSQL แบบฝังตัว: เรียก `npm test` จากโฟลเดอร์ `tests` หลัง `npm ci` ทดสอบสิทธิ์ RLS, append-only, actor, การไม่เก็บข้อมูลส่วนตัว, retry และ rollback ด้วย SQL จริง โดยไม่เขียนข้อมูลลง production


ผลตรวจ Supabase Security Advisor วันที่ 15 ตุลาคม 2026: ไม่พบปัญหา RLS/สิทธิ์เข้าถึงตาราง Log แต่บัญชีมีคำเตือนว่า Leaked Password Protection ยังไม่เปิด เจ้าของโปรเจกต์ควรตรวจฟีเจอร์ใน Authentication และแผนที่ใช้งาน: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection การตรวจนี้ไม่ใช่การรับรองความปลอดภัยครบทุกด้าน
