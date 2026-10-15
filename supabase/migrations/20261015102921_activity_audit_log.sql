-- ประวัติกิจกรรมแบบ append-only สำหรับ API ผู้ดูแล ไม่มีข้อมูลติดต่อหรือ credential
create table public.activity_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  category text not null check (category in ('product','inventory','order','account','security','system')),
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  severity text not null default 'info' check (severity in ('info','warning','error')),
  source text not null check (source in ('database','server')),
  actor_id uuid,
  entity_type text not null check (entity_type in ('product','order','profile','session','media','system')),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8192),
  request_id uuid
);
create index activity_logs_category_id_idx on public.activity_logs(category, id desc);
create index activity_logs_created_at_idx on public.activity_logs(created_at desc);
alter table public.activity_logs enable row level security;
revoke all on public.activity_logs from public, anon, authenticated, service_role;
grant select on public.activity_logs to authenticated;
grant select, insert on public.activity_logs to service_role;
grant usage, select on sequence public.activity_logs_id_seq to service_role;
create policy activity_logs_admin_read on public.activity_logs for select to authenticated
  using ((select private.is_admin()));
create policy activity_logs_server_insert on public.activity_logs for insert to service_role
  with check (true);
create policy activity_logs_server_read on public.activity_logs for select to service_role
  using (true);

-- ฟังก์ชัน trigger อยู่ใน schema private: ข้อมูล audit เป็นส่วนหนึ่งของ transaction เดียวกับสินค้า/ออเดอร์
create function private.capture_commerce_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := '{}'::jsonb; v_after jsonb := '{}'::jsonb;
  v_fields jsonb := '[]'::jsonb; v_field text;
  v_actor uuid := auth.uid(); v_origin text; v_entity uuid;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('products','orders','profiles') then
    raise exception 'INVALID_AUDIT_TRIGGER';
  end if;
  v_origin := nullif(current_setting('alyzyus.audit_origin', true), '');
  if v_origin in ('checkout','admin','webhook') then
    -- RPC ฝั่ง service เท่านั้นที่ตั้ง context นี้ได้; webhook ไม่มี actor บุคคล
    v_actor := nullif(current_setting('alyzyus.audit_actor', true), '')::uuid;
  else
    v_origin := 'direct';
  end if;
  v_entity := coalesce(v_new->>'id', v_old->>'id')::uuid;
  if tg_table_name = 'products' then
    if tg_op = 'INSERT' then
      insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
      values ('product','product.created','database',v_actor,'product',v_entity,
        jsonb_build_object('after',jsonb_build_object('price',new.price,'stock',new.stock,'active',new.active),'operation',v_origin));
    elsif tg_op = 'DELETE' then
      insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
      values ('product','product.deleted','database',v_actor,'product',v_entity,jsonb_build_object('operation',v_origin));
    else
      if old.stock is distinct from new.stock then
        insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
        values ('inventory','inventory.stock_changed','database',v_actor,'product',v_entity,
          jsonb_build_object('changed_fields',jsonb_build_array('stock'),
            'before',jsonb_build_object('stock',old.stock),'after',jsonb_build_object('stock',new.stock),'operation',v_origin));
      end if;
      -- เก็บเพียงชื่อ field ที่แก้ เนื้อหาชื่อ/คำอธิบาย/รูปภาพไม่ถูกคัดลอกลง log
      foreach v_field in array array['slug','name','description','category','price','compare_at','images','colors','featured','badge','active'] loop
        if v_old->v_field is distinct from v_new->v_field then
          v_fields := v_fields || jsonb_build_array(v_field);
          if v_field in ('price','compare_at','featured','active') then
            v_before := v_before || jsonb_build_object(v_field,v_old->v_field);
            v_after := v_after || jsonb_build_object(v_field,v_new->v_field);
          end if;
        end if;
      end loop;
      if jsonb_array_length(v_fields) > 0 then
        insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
        values ('product','product.updated','database',v_actor,'product',v_entity,
          jsonb_build_object('changed_fields',v_fields,'before',v_before,'after',v_after,'operation',v_origin));
      end if;
    end if;
  elsif tg_table_name = 'orders' then
    if tg_op = 'INSERT' then
      insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
      values ('order','order.created','database',coalesce(v_actor,new.user_id),'order',v_entity,
        jsonb_build_object('after',jsonb_build_object('status',new.status,'payment_status',new.payment_status,'payment_method',new.payment_method,'total',new.total),'operation',v_origin));
    elsif tg_op = 'DELETE' then
      insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
      values ('order','order.deleted','database',v_actor,'order',v_entity,jsonb_build_object('operation',v_origin));
    else
      foreach v_field in array array['status','payment_status','tracking_number','carrier','stock_released','total'] loop
        if v_old->v_field is distinct from v_new->v_field then
          v_fields := v_fields || jsonb_build_array(v_field);
          if v_field in ('status','payment_status','stock_released','total') then
            v_before := v_before || jsonb_build_object(v_field,v_old->v_field);
            v_after := v_after || jsonb_build_object(v_field,v_new->v_field);
          end if;
        end if;
      end loop;
      if jsonb_array_length(v_fields) > 0 then
        insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
        values ('order','order.updated','database',v_actor,'order',v_entity,
          jsonb_build_object('changed_fields',v_fields,'before',v_before,'after',v_after,'operation',v_origin));
      end if;
    end if;
  elsif tg_table_name = 'profiles' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.role is distinct from new.role) then
      insert into public.activity_logs(category,action,source,actor_id,entity_type,entity_id,details)
      values ('account',case when tg_op = 'INSERT' then 'account.created' else 'account.role_changed' end,'database',v_actor,'profile',v_entity,
        jsonb_build_object('changed_fields',jsonb_build_array('role'),
          'before',case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object('role',old.role) end,
          'after',jsonb_build_object('role',new.role),'operation',v_origin));
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.capture_commerce_activity() from public, anon, authenticated, service_role;
create trigger audit_product_activity after insert or update or delete on public.products
  for each row execute function private.capture_commerce_activity();
create trigger audit_order_activity after insert or update or delete on public.orders
  for each row execute function private.capture_commerce_activity();
create trigger audit_profile_activity after insert or update on public.profiles
  for each row execute function private.capture_commerce_activity();

-- ย้าย implementation เดิมเข้า private แล้วหุ้มด้วย RPC ชื่อเดิมเพื่อแนบ actor จากเซิร์ฟเวอร์
-- ไม่คัดลอก business logic และไม่เปลี่ยน signature/ผลลัพธ์ของ API เดิม
alter function public.create_order(uuid,jsonb,jsonb,text,text,uuid,text) set schema private;
alter function private.create_order(uuid,jsonb,jsonb,text,text,uuid,text) rename to create_order_internal;
revoke all on function private.create_order_internal(uuid,jsonb,jsonb,text,text,uuid,text) from public, anon, authenticated, service_role;
create function public.create_order(
  p_user_id uuid, p_items jsonb, p_customer jsonb, p_payment_method text,
  p_coupon text, p_idempotency_key uuid, p_request_fingerprint text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_actor text := current_setting('alyzyus.audit_actor',true); v_origin text := current_setting('alyzyus.audit_origin',true);
begin
  perform set_config('alyzyus.audit_actor',coalesce(p_user_id::text,''),true);
  perform set_config('alyzyus.audit_origin','checkout',true);
  v_id := private.create_order_internal(p_user_id,p_items,p_customer,p_payment_method,p_coupon,p_idempotency_key,p_request_fingerprint);
  perform set_config('alyzyus.audit_actor',coalesce(v_actor,''),true);
  perform set_config('alyzyus.audit_origin',coalesce(v_origin,''),true);
  return v_id;
end;
$$;
revoke all on function public.create_order(uuid,jsonb,jsonb,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_order(uuid,jsonb,jsonb,text,text,uuid,text) to service_role;

alter function public.update_order_admin(uuid,uuid,text,text,text,text) set schema private;
alter function private.update_order_admin(uuid,uuid,text,text,text,text) rename to update_order_admin_internal;
revoke all on function private.update_order_admin_internal(uuid,uuid,text,text,text,text) from public, anon, authenticated, service_role;
create function public.update_order_admin(
  p_actor_id uuid, p_order_id uuid, p_status text default null,
  p_tracking_number text default null, p_carrier text default null, p_payment_status text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_actor text := current_setting('alyzyus.audit_actor',true); v_origin text := current_setting('alyzyus.audit_origin',true);
begin
  perform set_config('alyzyus.audit_actor',coalesce(p_actor_id::text,''),true);
  perform set_config('alyzyus.audit_origin','admin',true);
  v_id := private.update_order_admin_internal(p_actor_id,p_order_id,p_status,p_tracking_number,p_carrier,p_payment_status);
  perform set_config('alyzyus.audit_actor',coalesce(v_actor,''),true);
  perform set_config('alyzyus.audit_origin',coalesce(v_origin,''),true);
  return v_id;
end;
$$;
revoke all on function public.update_order_admin(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.update_order_admin(uuid,uuid,text,text,text,text) to service_role;

alter function public.apply_stripe_event(text,text,uuid,text,bigint,text,text) set schema private;
alter function private.apply_stripe_event(text,text,uuid,text,bigint,text,text) rename to apply_stripe_event_internal;
revoke all on function private.apply_stripe_event_internal(text,text,uuid,text,bigint,text,text) from public, anon, authenticated, service_role;
create function public.apply_stripe_event(
  p_event_id text, p_event_type text, p_order_id uuid, p_session_id text,
  p_amount bigint, p_currency text, p_payment_intent text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := current_setting('alyzyus.audit_actor',true); v_origin text := current_setting('alyzyus.audit_origin',true);
begin
  perform set_config('alyzyus.audit_actor','',true);
  perform set_config('alyzyus.audit_origin','webhook',true);
  perform private.apply_stripe_event_internal(p_event_id,p_event_type,p_order_id,p_session_id,p_amount,p_currency,p_payment_intent);
  perform set_config('alyzyus.audit_actor',coalesce(v_actor,''),true);
  perform set_config('alyzyus.audit_origin',coalesce(v_origin,''),true);
end;
$$;
revoke all on function public.apply_stripe_event(text,text,uuid,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text,text,uuid,text,bigint,text,text) to service_role;

-- รับเหตุการณ์ที่ยืนยันฝั่ง Flask แล้วเท่านั้น ไม่มี endpoint รับ log ตามใจจาก browser
create function public.record_activity_event(p_action text, p_actor_id uuid, p_request_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_category text; v_entity text;
begin
  if p_actor_id is null or not exists (select 1 from auth.users where id = p_actor_id) then raise exception 'UNAUTHORIZED'; end if;
  if p_action in ('auth.login','auth.logout') then v_category := 'account'; v_entity := 'session';
  elsif p_action = 'auth.password_changed' then v_category := 'security'; v_entity := 'session';
  elsif p_action in ('media.uploaded','product.translated') then
    if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then raise exception 'FORBIDDEN'; end if;
    v_category := 'product'; v_entity := case when p_action = 'media.uploaded' then 'media' else 'product' end;
  else raise exception 'INVALID_AUDIT_ACTION'; end if;
  insert into public.activity_logs(category,action,source,actor_id,entity_type,request_id)
    values(v_category,p_action,'server',p_actor_id,v_entity,p_request_id);
end;
$$;
revoke all on function public.record_activity_event(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_activity_event(text,uuid,uuid) to service_role;

comment on table public.activity_logs is 'Admin-only append-only business audit; no payloads, contact details, credentials or IP addresses. Records start when this migration is applied.';
notify pgrst, 'reload schema';
