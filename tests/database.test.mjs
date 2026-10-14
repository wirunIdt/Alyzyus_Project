// ตรวจ SQL จริงด้วย PostgreSQL แบบฝังตัว เฉพาะงานพัฒนา ไม่โหลดในเว็บ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('stock, prices, retries, cancellations, payments and customer isolation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema extensions; create schema auth;
      create role anon; create role authenticated; create role service_role bypassrls;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function extensions.gen_random_uuid() returns uuid language sql as $$ select pg_catalog.gen_random_uuid(); $$;
    `);
    const migrations=new URL('../supabase/migrations/',import.meta.url);
    for(const file of (await readdir(migrations)).filter(file=>file.endsWith('.sql')).sort()){
      const sql=(await readFile(new URL(file,migrations),'utf8')).replace('create extension if not exists pgcrypto with schema extensions;','');
      await db.exec(sql);
    }
    const customer='10000000-0000-4000-8000-000000000001';
    const other='10000000-0000-4000-8000-000000000002';
    const admin='10000000-0000-4000-8000-000000000003';
    const product='00000000-0000-4000-8000-000000000001';
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',[customer,'a@example.test',other,'b@example.test',admin,'owner@example.test']);
    await db.query("update public.profiles set role='admin' where id=$1",[admin]);
    assert.equal((await db.query("select has_function_privilege('anon','private.is_admin()','execute') allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('authenticated','private.handle_new_user()','execute') allowed")).rows[0].allowed,false);
    await db.query(`insert into public.products(id,slug,name,description,category,price,stock,active) values($1,'test-item',$2,$2,'home',1200,5,true)`,[product,JSON.stringify({th:'สินค้า',en:'Item',zh:'商品'})]);
    const contact={name:'Test buyer',email:'a@example.test',phone:'0800000000',address:'123 Test Road, Bangkok 10110, Thailand'};
    let keyNumber=1;
    const key=()=>`20000000-0000-4000-8000-${String(keyNumber++).padStart(12,'0')}`;
    const create=async({user=customer,quantity=1,method='cod',coupon='',idempotency=key(),fingerprint='a'.repeat(64)}={})=>{
      const result=await db.query('select public.create_order($1,$2,$3,$4,$5,$6,$7) id',[user,JSON.stringify([{productId:product,quantity}]),JSON.stringify(contact),method,coupon,idempotency,fingerprint]);
      return result.rows[0].id;
    };
    const firstKey=key();
    const orderId=await create({quantity:2,coupon:'WELCOME10',idempotency:firstKey});
    let order=(await db.query('select * from public.orders where id=$1',[orderId])).rows[0];
    assert.equal(Number(order.subtotal),2400);
    assert.equal(Number(order.shipping),80);
    assert.equal(Number(order.discount),240);
    assert.equal(Number(order.total),2240);
    assert.equal((await db.query('select stock from public.products where id=$1',[product])).rows[0].stock,3);
    assert.equal(await create({quantity:2,coupon:'WELCOME10',idempotency:firstKey}),orderId);
    assert.equal((await db.query('select stock from public.products where id=$1',[product])).rows[0].stock,3);
    await assert.rejects(create({idempotency:firstKey,fingerprint:'b'.repeat(64)}),/IDEMPOTENCY_CONFLICT/);
    await assert.rejects(create({quantity:4}),/OUT_OF_STOCK/);
    await assert.rejects(create({quantity:1.5}),/INVALID_QUANTITY/);
    await assert.rejects(create({coupon:'WELCOME10'}),/COUPON_NOT_ELIGIBLE/);
    // RLS ป้องกันการอ่านออเดอร์คนอื่นและห้ามลูกค้าเปลี่ยนสิทธิ์ตนเอง
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select id from public.orders')).rows.length,0);
    await assert.rejects(db.query("update public.profiles set role='admin' where id=$1",[other]),/permission denied/);
    await assert.rejects(db.query('select public.create_order($1,$2,$3,$4,$5,$6,$7)',[other,'[]',JSON.stringify(contact),'cod','',key(),'a'.repeat(64)]),/permission denied/);
    await db.exec(`set request.jwt.claim.sub='${customer}';`);
    assert.equal((await db.query('select id from public.orders')).rows.length,1);
    await db.exec('reset role;');
    const update=async(id,status)=>db.query('select public.update_order_admin($1,$2,$3)',[admin,id,status]);
    await assert.rejects(update(orderId,'shipped'),/INVALID_STATUS_TRANSITION/);
    await update(orderId,'cancelled'); await update(orderId,'cancelled');
    assert.equal((await db.query('select stock from public.products where id=$1',[product])).rows[0].stock,5);
    // webhook ต้องตรวจยอด และการส่งซ้ำคืนสต็อกได้ครั้งเดียว
    const online=await create({method:'card'});
    const event=async(eventId,type,amount=128000)=>db.query('select public.apply_stripe_event($1,$2,$3,$4,$5,$6,$7)',[eventId,type,online,'cs_test',amount,'thb','pi_test']);
    await assert.rejects(event('bad','checkout.session.completed',1),/PAYMENT_MISMATCH/);
    await event('expired','checkout.session.expired'); await event('expired','checkout.session.expired');
    assert.equal((await db.query('select stock from public.products where id=$1',[product])).rows[0].stock,5);
    await event('late-paid','checkout.session.completed');
    order=(await db.query('select * from public.orders where id=$1',[online])).rows[0];
    assert.equal(order.status,'cancelled'); assert.equal(order.payment_status,'refund_required');
    assert.equal((await db.query('select stock from public.products where id=$1',[product])).rows[0].stock,5);
    // ออเดอร์ COD ดำเนินการได้ แต่ส่งพัสดุต้องมีบริษัทขนส่งและเลขติดตาม
    const cod=await create({user:other});
    await update(cod,'confirmed'); await update(cod,'processing');
    await assert.rejects(update(cod,'shipped'),/INVALID_INPUT/);
    await db.query('select public.update_order_admin($1,$2,$3,$4,$5)',[admin,cod,'shipped','TRACK-001','Test carrier']);
    await update(cod,'delivered');
  } finally {await db.close();}
});
