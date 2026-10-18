// ตรวจ PostgreSQL ในหน่วยความจำเท่านั้น ไม่มี connection หรือข้อมูลของระบบจริง
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const CUSTOMER = '81000000-0000-4000-8000-000000000001';
const OTHER = '81000000-0000-4000-8000-000000000002';
const ADMIN = '81000000-0000-4000-8000-000000000003';
const PRODUCT = '82000000-0000-4000-8000-000000000001';
const HIDDEN_PRODUCT = '82000000-0000-4000-8000-000000000002';
const TABLES = [
  'activity_logs',
  'order_items',
  'orders',
  'payment_events',
  'products',
  'profiles',
  'support_messages',
  'support_tickets',
];
const PUBLIC_RPCS = [
  'apply_stripe_event',
  'change_support_ticket',
  'change_support_ticket_revision',
  'create_order',
  'create_support_ticket',
  'record_activity_event',
  'reply_support_ticket',
  'update_order_admin',
];

test('database security boundaries reject privilege escalation, foreign data and incomplete payments', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema extensions;
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function extensions.gen_random_uuid() returns uuid language sql as $$
        select pg_catalog.gen_random_uuid();
      $$;
    `);
    const folder = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()) {
      await db.exec(
        (await readFile(new URL(file, folder), 'utf8')).replace(
          'create extension if not exists pgcrypto with schema extensions;',
          ''
        )
      );
    }
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)', [
      CUSTOMER,
      'customer@example.test',
      OTHER,
      'other@example.test',
      ADMIN,
      'admin@example.test',
    ]);
    await db.query("update public.profiles set role='admin' where id=$1", [ADMIN]);
    const localized = JSON.stringify({ th: 'ทดสอบ', en: 'Fixture', zh: '测试' });
    await db.query(
      `insert into public.products(id,slug,name,description,category,price,stock,active)
       values($1,'security-active',$3,$3,'home',100,10,true),
             ($2,'security-hidden',$3,$3,'home',100,10,false)`,
      [PRODUCT, HIDDEN_PRODUCT, localized]
    );
    let sequence = 0;
    const key = () => `83000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
    const createOrder = async (actor, method = 'cod') =>
      (
        await db.query('select public.create_order($1,$2,$3,$4,$5,$6,$7) id', [
          actor,
          JSON.stringify([{ productId: PRODUCT, quantity: 1 }]),
          JSON.stringify({
            name: 'Fixture Customer',
            email: 'customer@example.test',
            phone: '0800000000',
            address: '123 Fixture Address for Security Tests',
          }),
          method,
          '',
          key(),
          'a'.repeat(64),
        ])
      ).rows[0].id;
    const ownerOrder = await createOrder(CUSTOMER);
    const otherOrder = await createOrder(OTHER);
    const ownerTicket = (
      await db.query('select public.create_support_ticket($1,$2,$3,$4,$5,$6,$7) id', [
        CUSTOMER,
        'order',
        'Private fixture request',
        'Private fixture message for this owner only.',
        ownerOrder,
        key(),
        'b'.repeat(64),
      ])
    ).rows[0].id;

    const asRole = async (role, actor, action) => {
      // ชื่อ role มาจาก fixture ที่กำหนดในไฟล์เท่านั้น ไม่รับค่าจากผู้ใช้
      assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
      await db.exec(`set role ${role};`);
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor || '']);
        return await action();
      } finally {
        await db.exec('reset role;');
        await db.query("select set_config('request.jwt.claim.sub','',false)");
      }
    };
    const ids = async (table) =>
      (await db.query(`select id::text from public.${table} order by id`)).rows.map(
        (row) => row.id
      );

    await t.test('all public tables have RLS and only the intended client grants', async () => {
      const tables = (
        await db.query(`
          select c.relname name,c.relrowsecurity rls
          from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p') order by c.relname
        `)
      ).rows;
      assert.deepEqual(
        tables.map((row) => row.name),
        TABLES
      );
      for (const table of tables) {
        assert.equal(table.rls, true, `${table.name} must enforce RLS`);
        for (const role of ['anon', 'authenticated']) {
          for (const operation of [
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER',
          ]) {
            const { allowed } = (
              await db.query('select has_table_privilege($1,$2,$3) allowed', [
                role,
                `public.${table.name}`,
                operation,
              ])
            ).rows[0];
            const expected =
              operation === 'SELECT'
                ? role === 'anon'
                  ? table.name === 'products'
                  : table.name !== 'payment_events'
                : role === 'authenticated' &&
                  table.name === 'products' &&
                  ['INSERT', 'UPDATE'].includes(operation);
            assert.equal(allowed, expected, `${role} ${operation} ${table.name}`);
          }
        }
      }
      for (const role of ['anon', 'authenticated']) {
        for (const schema of ['public', 'private']) {
          assert.equal(
            (
              await db.query('select has_schema_privilege($1,$2,$3) allowed', [
                role,
                schema,
                'CREATE',
              ])
            ).rows[0].allowed,
            false,
            `${role} cannot create objects in ${schema}`
          );
        }
      }
    });

    await t.test('all write RPCs and internal helpers deny every browser identity', async () => {
      const functions = (
        await db.query(`
          select p.oid,p.proname name,n.nspname schema,p.pronargs argument_count,p.proconfig config,
            pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') anon,
            pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') customer,
            pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') server
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','private') order by n.nspname,p.proname
        `)
      ).rows;
      assert.deepEqual(
        functions.filter((row) => row.schema === 'public').map((row) => row.name),
        PUBLIC_RPCS
      );
      for (const fn of functions) {
        const isAdminLookup = fn.schema === 'private' && fn.name === 'is_admin';
        assert.equal(fn.anon, false, `${fn.schema}.${fn.name} anon`);
        assert.equal(fn.customer, isAdminLookup, `${fn.schema}.${fn.name} customer`);
        assert.equal(
          fn.server,
          fn.schema === 'public' || isAdminLookup,
          `${fn.schema}.${fn.name} server`
        );
        assert.ok(fn.config.includes('search_path=""'), `${fn.name} has a fixed empty search_path`);
      }
      for (const [role, actor] of [
        ['anon', null],
        ['authenticated', CUSTOMER],
        ['authenticated', ADMIN],
      ]) {
        await asRole(role, actor, async () => {
          for (const fn of functions.filter((row) => row.schema === 'public')) {
            // สิทธิ์ EXECUTE ต้องถูกปฏิเสธก่อนถึง validation หรือ body ของฟังก์ชัน
            const argumentsSql = Array(fn.argument_count).fill('null').join(',');
            await assert.rejects(
              db.query(`select public.${fn.name}(${argumentsSql})`),
              /permission denied/
            );
          }
        });
      }
    });

    await t.test(
      'customer data, staff privileges, hidden inventory and audit remain isolated',
      async () => {
        await asRole('anon', null, async () => {
          assert.deepEqual(await ids('products'), [PRODUCT]);
          for (const table of TABLES.filter((name) => name !== 'products')) {
            await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
          }
        });
        for (const [actor, order, tickets] of [
          [CUSTOMER, ownerOrder, [ownerTicket]],
          [OTHER, otherOrder, []],
        ]) {
          await asRole('authenticated', actor, async () => {
            assert.deepEqual(await ids('products'), [PRODUCT]);
            assert.deepEqual(await ids('orders'), [order]);
            assert.deepEqual(await ids('profiles'), [actor]);
            assert.deepEqual(await ids('support_tickets'), tickets);
            assert.equal(
              (await db.query('select * from public.support_messages')).rows.length,
              tickets.length
            );
            assert.deepEqual(
              (await db.query('select distinct order_id::text from public.order_items')).rows.map(
                (row) => row.order_id
              ),
              [order]
            );
            assert.deepEqual(await ids('activity_logs'), []);
            await assert.rejects(
              db.query('select * from public.payment_events'),
              /permission denied/
            );
            await assert.rejects(
              db.query("update public.profiles set role='admin' where id=$1", [actor]),
              /permission denied/
            );
            await assert.rejects(
              db.query("update public.orders set payment_status='paid'"),
              /permission denied/
            );
            await assert.rejects(
              db.query('delete from public.support_messages'),
              /permission denied/
            );
            await assert.rejects(
              db.query(
                "insert into public.activity_logs(category,action,source,entity_type) values('security','auth.login','server','session')"
              ),
              /permission denied/
            );
            assert.equal(
              (
                await db.query('update public.products set stock=999 where id=$1 returning id', [
                  PRODUCT,
                ])
              ).rows.length,
              0
            );
            await assert.rejects(
              db.query(
                "insert into public.products(slug,name,description,category,price) values('forged-product',$1,$1,'home',1)",
                [localized]
              ),
              /row-level security/
            );
          });
        }
        await asRole('authenticated', ADMIN, async () => {
          assert.deepEqual(await ids('products'), [PRODUCT, HIDDEN_PRODUCT]);
          assert.deepEqual(new Set(await ids('orders')), new Set([ownerOrder, otherOrder]));
          assert.deepEqual(await ids('support_tickets'), [ownerTicket]);
          assert.ok((await ids('activity_logs')).length > 0);
          await assert.rejects(
            db.query('select * from public.payment_events'),
            /permission denied/
          );
          await assert.rejects(
            db.query("update public.profiles set role='admin' where id=$1", [OTHER]),
            /permission denied/
          );
        });
      }
    );

    let online;
    const applyEvent = (overrides = {}) => {
      const event = {
        id: 'evt_security_fixture',
        type: 'checkout.session.completed',
        order: online,
        session: 'cs_security_fixture',
        amount: 18_000,
        currency: 'thb',
        intent: 'pi_security_fixture',
        ...overrides,
      };
      return db.query('select public.apply_stripe_event($1,$2,$3,$4,$5,$6,$7)', [
        event.id,
        event.type,
        event.order,
        event.session,
        event.amount,
        event.currency,
        event.intent,
      ]);
    };
    const stock = async () =>
      (await db.query('select stock from public.products where id=$1', [PRODUCT])).rows[0].stock;
    const orderState = async (id) =>
      (
        await db.query(
          'select status,payment_status,stock_released from public.orders where id=$1',
          [id]
        )
      ).rows[0];

    await t.test(
      'NULL, blank, unknown and mismatched payment inputs never mutate an order',
      async () => {
        await asRole('service_role', null, async () => {
          online = await createOrder(OTHER, 'card');
          const previousStock = await stock();
          const invalid = [
            { amount: null },
            { amount: 0 },
            { amount: -1 },
            { amount: 1 },
            { currency: null },
            { currency: '' },
            { currency: 'usd' },
            { id: null },
            { id: '' },
            { id: '   ' },
            { id: '\n' },
            { id: 'e'.repeat(256) },
            { type: null },
            { type: '' },
            { type: 'payment_intent.succeeded' },
            { order: null },
            { session: null },
            { session: '' },
            { session: '  ' },
            { session: '\t' },
            { session: 's'.repeat(256) },
            { intent: null },
            { intent: '' },
            { intent: '  ' },
            { intent: '\r' },
            { intent: 'p'.repeat(256) },
          ];
          for (const value of invalid) {
            await assert.rejects(applyEvent(value), /PAYMENT_MISMATCH/, JSON.stringify(value));
            assert.deepEqual(await orderState(online), {
              status: 'pending',
              payment_status: 'pending',
              stock_released: false,
            });
            assert.equal(await stock(), previousStock);
            assert.equal(
              (await db.query('select count(*) from public.payment_events')).rows[0].count,
              0
            );
          }
        });
      }
    );

    await t.test(
      'valid paid, async, expired and failed callbacks preserve retries and stock semantics',
      async () => {
        await asRole('service_role', null, async () => {
          await applyEvent();
          const paidStock = await stock();
          await applyEvent();
          assert.deepEqual(await orderState(online), {
            status: 'confirmed',
            payment_status: 'paid',
            stock_released: false,
          });
          assert.equal(await stock(), paidStock);
          await assert.rejects(
            applyEvent({ id: 'evt_other_session', session: 'cs_foreign' }),
            /PAYMENT_MISMATCH/
          );
          for (const [type, expected] of [
            ['checkout.session.expired', 'expired'],
            ['checkout.session.async_payment_failed', 'failed'],
          ]) {
            const order = await createOrder(OTHER, 'card');
            const before = await stock();
            const event = {
              id: `evt_${expected}`,
              type,
              order,
              session: `cs_${expected}`,
              intent: null,
            };
            await applyEvent(event);
            await applyEvent(event);
            assert.deepEqual(await orderState(order), {
              status: 'cancelled',
              payment_status: expected,
              stock_released: true,
            });
            assert.equal(
              await stock(),
              before + 1,
              'unpaid terminal events restore stock exactly once without a PaymentIntent'
            );
            await applyEvent({
              ...event,
              id: `evt_late_${expected}`,
              type: 'checkout.session.completed',
              intent: `pi_${expected}`,
            });
            assert.equal((await orderState(order)).payment_status, 'refund_required');
            assert.equal(
              await stock(),
              before + 1,
              'a late payment never re-reserves or double-restocks cancelled inventory'
            );
          }
          const asyncOrder = await createOrder(OTHER, 'promptpay');
          await applyEvent({
            id: 'evt_async_success',
            type: 'checkout.session.async_payment_succeeded',
            order: asyncOrder,
            session: 'cs_async',
            intent: 'pi_async',
          });
          assert.equal((await orderState(asyncOrder)).payment_status, 'paid');
        });
      }
    );
  } finally {
    await db.close();
  }
});
