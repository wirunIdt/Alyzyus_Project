-- ฟังก์ชันภายในเก็บใน schema ที่ไม่เปิดเป็น REST endpoint
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

alter function public.handle_new_user() set schema private;
alter function public.is_admin() set schema private;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated, service_role;

-- ผู้ไม่เข้าสู่ระบบอ่านเฉพาะสินค้าที่เปิดขาย ไม่ต้องเรียกตัวตรวจสิทธิ์ Admin
drop policy products_public_read on public.products;
create policy products_anon_read on public.products for select to anon using (active);
create policy products_authenticated_read on public.products for select to authenticated
  using (active or (select private.is_admin()));

-- บันทึก webhook ให้เฉพาะเซิร์ฟเวอร์เข้าถึงได้
create policy payment_events_server_only on public.payment_events for all to service_role
  using (true) with check (true);

-- ฟังก์ชัน event trigger ที่แพลตฟอร์มสร้างไว้ไม่จำเป็นต้องเรียกผ่าน API
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
