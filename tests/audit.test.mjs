// ตรวจสิทธิ์และ atomicity ด้วย PostgreSQL จริงแบบฝังตัว ไม่ใช่ mock SQL
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('audit records commit with business writes, redact PII and enforce admin-only append-only access', async () => {
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
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()) {
      await db.exec((await readFile(new URL(file, migrations), 'utf8')).replace('create extension if not exists pgcrypto with schema extensions;', ''));
    }
    assert.equal((await db.query('select count(*) from public.activity_logs')).rows[0].count, 0, 'migration does not fabricate prior history');
    const buyer = '10000000-0000-4000-8000-000000000001';
    const admin = '10000000-0000-4000-8000-000000000002';
    const product = '10000000-0000-4000-8000-000000000003';
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [buyer, 'private-buyer@example.test', admin, 'private-admin@example.test']);
    await db.query("update public.profiles set role='admin' where id=$1", [admin]);
    const privateText = { th: 'PRIVATE-THAI-NAME', en: 'PRIVATE-ENGLISH-DESCRIPTION', zh: 'PRIVATE-CHINESE-DESCRIPTION' };
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}';`);
    await db.query(`insert into public.products(id,slug,name,description,category,price,stock,active) values($1,'test-item',$2,$2,'home',100,5,true)`, [product, JSON.stringify(privateText)]);
    const created = (await db.query("select * from public.activity_logs where action='product.created'")).rows[0];
    assert.equal(created.actor_id, admin);
    await assert.rejects(db.query("insert into public.activity_logs(category,action,source,entity_type) values('system','fake.event','server','system')"), /permission denied/);
    await assert.rejects(db.query("update public.activity_logs set action='fake.event'"), /permission denied/);
    await assert.rejects(db.query('delete from public.activity_logs'), /permission denied/);
    await assert.rejects(db.query('select public.record_activity_event($1,$2)', ['auth.login', buyer]), /permission denied/);
    await assert.rejects(db.query('select private.capture_commerce_activity()'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${buyer}';`);
    assert.equal((await db.query('select * from public.activity_logs')).rows.length, 0, 'customer cannot read another user audit');
    await db.exec('set role anon;');
    await assert.rejects(db.query('select * from public.activity_logs'), /permission denied/);
    await db.exec("reset role; set request.jwt.claim.sub='';");

    const customer = { name: 'PRIVATE-CUSTOMER', email: 'private-buyer@example.test', phone: 'PRIVATE-PHONE', address: 'PRIVATE-SHIPPING-ADDRESS' };
    const checkout = async (quantity, key) => (await db.query('select public.create_order($1,$2,$3,$4,$5,$6,$7) id', [buyer, JSON.stringify([{ productId: product, quantity }]), JSON.stringify(customer), 'cod', '', key, 'a'.repeat(64)])).rows[0].id;
    const key = '20000000-0000-4000-8000-000000000001';
    const order = await checkout(1, key);
    const stock = (await db.query("select * from public.activity_logs where action='inventory.stock_changed' order by id desc limit 1")).rows[0];
    assert.equal(stock.actor_id, buyer);
    assert.equal(stock.details.operation, 'checkout');
    assert.deepEqual(stock.details.before, { stock: 5 });
    assert.deepEqual(stock.details.after, { stock: 4 });
    assert.equal((await db.query('select * from public.activity_logs where entity_id=$1', [order])).rows[0].actor_id, buyer);
    const beforeRetry = Number((await db.query('select count(*) from public.activity_logs')).rows[0].count);
    assert.equal(await checkout(1, key), order);
    assert.equal(Number((await db.query('select count(*) from public.activity_logs')).rows[0].count), beforeRetry, 'retry does not fabricate duplicate mutation');
    await assert.rejects(checkout(99, '20000000-0000-4000-8000-000000000002'), /OUT_OF_STOCK/);
    assert.equal(Number((await db.query('select count(*) from public.activity_logs')).rows[0].count), beforeRetry, 'rejected transaction leaves no success log');

    await db.query('select public.update_order_admin($1,$2,$3)', [admin, order, 'confirmed']);
    const changed = (await db.query("select * from public.activity_logs where action='order.updated' order by id desc limit 1")).rows[0];
    assert.equal(changed.actor_id, admin);
    assert.deepEqual(changed.details.before, { status: 'pending' });
    assert.deepEqual(changed.details.after, { status: 'confirmed' });
    await db.query("update public.orders set tracking_number='PRIVATE-TRACKING',carrier='PRIVATE-CARRIER' where id=$1", [order]);
    await db.exec('begin;');
    await db.query('update public.products set stock=stock+2 where id=$1', [product]);
    await db.exec('rollback;');
    assert.equal((await db.query('select stock from public.products where id=$1', [product])).rows[0].stock, 4);
    assert.equal((await db.query("select count(*) from public.activity_logs where action='inventory.stock_changed'")).rows[0].count, 1, 'rolled-back stock update also rolls back its audit');
    await db.exec('set role service_role;');
    await db.query('select public.record_activity_event($1,$2)', ['auth.login', buyer]);
    await assert.rejects(db.query('select public.record_activity_event($1,$2)', ['untrusted.action', buyer]), /INVALID_AUDIT_ACTION/);
    await assert.rejects(db.query('select public.record_activity_event($1,$2)', ['media.uploaded', buyer]), /FORBIDDEN/);
    await assert.rejects(db.query('delete from public.activity_logs'), /permission denied/);
    await db.exec('reset role;');
    const online = (await db.query('select public.create_order($1,$2,$3,$4,$5,$6,$7) id', [buyer, JSON.stringify([{ productId: product, quantity: 1 }]), JSON.stringify(customer), 'card', '', '20000000-0000-4000-8000-000000000003', 'b'.repeat(64)])).rows[0].id;
    await db.query('select public.apply_stripe_event($1,$2,$3,$4,$5,$6,$7)', ['evt_expired', 'checkout.session.expired', online, 'cs_private', 18000, 'thb', null]);
    const restored = (await db.query("select * from public.activity_logs where action='inventory.stock_changed' order by id desc limit 1")).rows[0];
    assert.equal(restored.actor_id, null, 'provider webhook does not impersonate a human');
    assert.equal(restored.details.operation, 'webhook');
    await db.query('update public.products set stock=stock+1 where id=$1', [product]);
    const direct = (await db.query("select * from public.activity_logs where action='inventory.stock_changed' order by id desc limit 1")).rows[0];
    assert.equal(direct.actor_id, null, 'service actor context does not leak into later writes');
    assert.equal(direct.details.operation, 'direct');
    const rows = (await db.query('select * from public.activity_logs')).rows;
    const serialized = JSON.stringify(rows);
    for (const value of [...Object.values(privateText), ...Object.values(customer), 'PRIVATE-TRACKING', 'PRIVATE-CARRIER']) {
      assert.equal(serialized.includes(value), false, `audit must not contain ${value}`);
    }
    assert.equal((await db.query("select has_function_privilege('service_role','private.create_order_internal(uuid,jsonb,jsonb,text,text,uuid,text)','execute') allowed")).rows[0].allowed, false);
  } finally {
    await db.close();
  }
});
