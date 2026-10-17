// PostgreSQL จริง: คิวกิจกรรมล่าสุดและการเปลี่ยนสถานะจาก revision ที่อ่านแล้ว
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('support activity pages keep bigint ties exact and stale actions cannot hide new replies', async () => {
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
    for (const file of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort())
      await db.exec(
        (await readFile(new URL(file, folder), 'utf8')).replace(
          'create extension if not exists pgcrypto with schema extensions;',
          ''
        )
      );
    const customer = '71000000-0000-4000-8000-000000000001',
      other = '71000000-0000-4000-8000-000000000002',
      staff = '71000000-0000-4000-8000-000000000003';
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)', [
      customer,
      'customer@example.test',
      other,
      'other@example.test',
      staff,
      'staff@example.test',
    ]);
    await db.query("update public.profiles set role='admin' where id=$1", [staff]);
    await db.exec('alter sequence public.support_tickets_id_seq restart with 9007199254740993;');
    let sequence = 0;
    const key = () => `72000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
    const create = async () =>
      (
        await db.query('select public.create_support_ticket($1,$2,$3,$4,$5,$6,$7) id', [
          customer,
          'product',
          'Product help needed',
          'Please explain how to use this product.',
          null,
          key(),
          'a'.repeat(64),
        ])
      ).rows[0].id;
    const reply = (id) =>
      db.query('select public.reply_support_ticket($1,$2,$3,$4,$5,$6)', [
        customer,
        id,
        'Here is another detail for the store team.',
        false,
        key(),
        'b'.repeat(64),
      ]);
    const revision = async (id) =>
      (
        await db.query('select updated_at::text revision from public.support_tickets where id=$1', [
          id,
        ])
      ).rows[0].revision;
    const change = (id, action, expected, actor = staff, asStaff = true) =>
      db.query('select public.change_support_ticket_revision($1,$2,$3,$4,$5) id', [
        actor,
        id,
        action,
        asStaff,
        expected,
      ]);
    const state = async (id) =>
      (await db.query('select status from public.support_tickets where id=$1', [id])).rows[0]
        .status;
    const auditCount = async () =>
      Number(
        (
          await db.query(
            "select count(*) from public.activity_logs where action='support.status_changed'"
          )
        ).rows[0].count
      );

    await db.exec('set role service_role;');
    const oldest = await create(),
      middle = await create(),
      newest = await create();
    assert.equal(oldest, '9007199254740993');
    const tiedAt = '2026-10-17T12:00:00.123456Z';
    await db.query('update public.support_tickets set updated_at=$1', [tiedAt]);
    await db.query('update public.support_tickets set updated_at=$1 where id=$2', [
      '2026-10-17T12:00:01.123456Z',
      oldest,
    ]);
    const firstPage = (
      await db.query(
        'select id::text,updated_at::text revision from public.support_tickets order by updated_at desc,id desc limit 2'
      )
    ).rows;
    assert.deepEqual(
      firstPage.map((row) => row.id),
      [oldest, newest],
      'an old request with fresh activity precedes newly created requests'
    );
    const boundary = firstPage.at(-1);
    const nextPage = (
      await db.query(
        'select id::text from public.support_tickets where updated_at < $1 or (updated_at=$1 and id<$2) order by updated_at desc,id desc',
        [boundary.revision, boundary.id]
      )
    ).rows;
    assert.deepEqual(
      nextPage.map((row) => row.id),
      [middle]
    );

    const displayedRevision = await revision(newest);
    await reply(newest);
    assert.notEqual(await revision(newest), displayedRevision);
    const before = await auditCount();
    await assert.rejects(change(newest, 'resolve', displayedRevision), /SUPPORT_STALE/);
    await assert.rejects(change(newest, 'close', displayedRevision), /SUPPORT_STALE/);
    assert.equal(await state(newest), 'open');
    assert.equal(await auditCount(), before, 'stale actions never change state or write audit');
    const freshRevision = await revision(newest);
    await change(newest, 'resolve', freshRevision);
    assert.equal(await state(newest), 'resolved');
    assert.equal(await auditCount(), before + 1);
    await change(newest, 'resolve', freshRevision);
    assert.equal(await auditCount(), before + 1, 'successful same-state retry is a no-op');

    const resolvedRevision = await revision(newest);
    await reply(newest);
    await assert.rejects(change(newest, 'close', resolvedRevision), /SUPPORT_STALE/);
    await assert.rejects(
      change(newest, 'resolve', resolvedRevision, other, false),
      /SUPPORT_NOT_FOUND/,
      'owner checks take precedence over revision information'
    );
    await assert.rejects(
      change(newest, 'close', await revision(newest), customer, false),
      /FORBIDDEN/
    );
    await assert.rejects(
      change(newest, 'resolve', await revision(newest), customer, true),
      /FORBIDDEN/
    );
    await assert.rejects(change(newest, 'resolve', null), /INVALID_INPUT/);
    await change(newest, 'close', await revision(newest));
    assert.equal(await state(newest), 'closed');
    await assert.rejects(
      change(newest, 'reopen', await revision(newest), customer, false),
      /SUPPORT_CLOSED/
    );
    await assert.rejects(change(newest, 'reopen', resolvedRevision), /SUPPORT_STALE/);
    await change(newest, 'reopen', await revision(newest));
    assert.equal(await state(newest), 'open');

    await db.exec(`set role authenticated;set request.jwt.claim.sub='${customer}';`);
    await assert.rejects(change(newest, 'resolve', await revision(newest)), /permission denied/);
    await db.exec('reset role;');
    const grant = (
      await db.query(
        "select has_function_privilege('anon','public.change_support_ticket_revision(uuid,bigint,text,boolean,timestamptz)','execute') anon,has_function_privilege('authenticated','public.change_support_ticket_revision(uuid,bigint,text,boolean,timestamptz)','execute') client,has_function_privilege('service_role','public.change_support_ticket_revision(uuid,bigint,text,boolean,timestamptz)','execute') server"
      )
    ).rows[0];
    assert.deepEqual(grant, { anon: false, client: false, server: true });
  } finally {
    await db.close();
  }
});
