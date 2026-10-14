-- Run once through Supabase SQL Editor or `supabase db push`.
-- Application writes use validated server routes; RLS protects direct browser access too.
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Deliberately ignore user-editable signup metadata for authorization.
  insert into public.profiles(id, role) values (new.id, 'customer') on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into public.profiles(id, role) select id, 'customer' from auth.users on conflict do nothing;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create table public.products (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name jsonb not null check (jsonb_typeof(name) = 'object' and name ?& array['th','en','zh']),
  description jsonb not null check (jsonb_typeof(description) = 'object' and description ?& array['th','en','zh']),
  category text not null check (length(category) between 2 and 40),
  price numeric(12,2) not null check (price > 0),
  compare_at numeric(12,2) check (compare_at is null or compare_at >= price),
  stock integer not null default 0 check (stock between 0 and 1000000),
  images text[] not null default '{}', colors text[] not null default '{}',
  featured boolean not null default false, badge text check (badge in ('new','bestseller')),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create sequence public.order_number_seq start 1001;
create table public.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  order_number text not null unique default 'ALY-' || to_char(now(),'YYYY') || '-' || nextval('public.order_number_seq'),
  user_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','confirmed','processing','shipped','delivered','cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','expired','refund_required')),
  payment_method text not null check (payment_method in ('cod','bank_transfer','card','promptpay')),
  subtotal numeric(12,2) not null check (subtotal >= 0), shipping numeric(12,2) not null check (shipping >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0), total numeric(12,2) not null check (total > 0),
  currency text not null default 'thb' check (currency = 'thb'), coupon text,
  customer_name text not null, email text not null, phone text not null, address text not null,
  tracking_number text, carrier text,
  idempotency_key uuid not null, request_fingerprint text not null,
  stripe_session_id text unique, stripe_payment_intent text,
  stock_released boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key), check (total = subtotal + shipping - discount)
);
create index orders_user_created_idx on public.orders(user_id, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at desc);
create table public.order_items (
  id uuid primary key default extensions.gen_random_uuid(), order_id uuid not null references public.orders(id),
  product_id uuid not null references public.products(id), name jsonb not null,
  quantity integer not null check (quantity between 1 and 99), price numeric(12,2) not null check (price > 0),
  image text not null default '', unique (order_id, product_id)
);
create index order_items_order_idx on public.order_items(order_id);
create table public.payment_events (
  event_id text primary key, order_id uuid not null references public.orders(id),
  event_type text not null, created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_events enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy products_public_read on public.products for select to anon, authenticated using (active or (select public.is_admin()));
create policy products_admin_insert on public.products for insert to authenticated with check ((select public.is_admin()));
create policy products_admin_update on public.products for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy orders_owner_read on public.orders for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy order_items_owner_read on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or (select public.is_admin())))
);

revoke all on public.profiles, public.products, public.orders, public.order_items, public.payment_events from anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.profiles, public.orders, public.order_items to authenticated;
grant insert, update on public.products to authenticated;
grant all on public.profiles, public.products, public.orders, public.order_items, public.payment_events to service_role;
grant usage, select on sequence public.order_number_seq to service_role;
revoke all on function public.handle_new_user() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- Only the trusted server can invoke this function. It supplies user_id from auth.getUser().
-- Deterministic product locks prevent overselling; advisory locks serialize retries for the same key.
create function public.create_order(
  p_user_id uuid, p_items jsonb, p_customer jsonb, p_payment_method text,
  p_coupon text, p_idempotency_key uuid, p_request_fingerprint text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype; v_product public.products%rowtype; v_item jsonb;
  v_subtotal numeric(12,2) := 0; v_shipping numeric(12,2); v_discount numeric(12,2) := 0;
  v_id uuid; v_qty integer; v_count integer; v_coupon text := upper(trim(coalesce(p_coupon,'')));
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then raise exception 'UNAUTHORIZED'; end if;
  if p_idempotency_key is null or length(coalesce(p_request_fingerprint,'')) <> 64 then raise exception 'INVALID_CART'; end if;
  -- Also serialize distinct carts for this buyer, making rate limits and first-order coupons atomic.
  perform pg_advisory_xact_lock(hashtextextended('buyer:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_idempotency_key::text, 0));
  select * into v_order from public.orders where user_id = p_user_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_order.request_fingerprint <> p_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_order.id;
  end if;
  if (select count(*) from public.orders where user_id = p_user_id and created_at > now() - interval '10 minutes') >= 5 then raise exception 'RATE_LIMITED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'INVALID_CART'; end if;
  if p_payment_method not in ('cod','bank_transfer','card','promptpay') then raise exception 'INVALID_PAYMENT'; end if;
  if length(coalesce(p_customer->>'name','')) not between 2 and 120
    or length(coalesce(p_customer->>'email','')) not between 3 and 254
    or length(coalesce(p_customer->>'phone','')) not between 8 and 30
    or length(coalesce(p_customer->>'address','')) not between 10 and 1000 then raise exception 'INVALID_CUSTOMER'; end if;
  select count(distinct value->>'productId') into v_count from jsonb_array_elements(p_items);
  if v_count <> jsonb_array_length(p_items) then raise exception 'INVALID_CART'; end if;
  -- Always acquire inventory locks in UUID order, even if two carts use different line ordering.
  perform 1 from public.products where id in (select (value->>'productId')::uuid from jsonb_array_elements(p_items)) order by id for update;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item->'quantity') <> 'number' or (v_item->>'quantity')::numeric <> trunc((v_item->>'quantity')::numeric) then raise exception 'INVALID_QUANTITY'; end if;
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty not between 1 and 99 then raise exception 'INVALID_QUANTITY'; end if;
    select * into v_product from public.products where id = (v_item->>'productId')::uuid;
    if not found or not v_product.active then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if v_product.stock < v_qty then raise exception 'OUT_OF_STOCK'; end if;
    v_subtotal := v_subtotal + v_product.price * v_qty;
  end loop;
  if v_coupon <> '' then
    if v_coupon <> 'WELCOME10' then raise exception 'INVALID_COUPON'; end if;
    -- Serialize first-order coupons across different idempotency keys for the same user.
    perform pg_advisory_xact_lock(hashtextextended('coupon:' || p_user_id::text, 0));
    if exists (select 1 from public.orders where user_id = p_user_id and status <> 'cancelled') then raise exception 'COUPON_NOT_ELIGIBLE'; end if;
    v_discount := round(v_subtotal * 0.10, 2);
  end if;
  v_shipping := case when v_subtotal >= 2500 then 0 else 80 end;
  insert into public.orders(user_id, payment_method, subtotal, shipping, discount, total, coupon,
    customer_name, email, phone, address, idempotency_key, request_fingerprint)
  values (p_user_id, p_payment_method, v_subtotal, v_shipping, v_discount, v_subtotal+v_shipping-v_discount, nullif(v_coupon,''),
    p_customer->>'name', lower(p_customer->>'email'), p_customer->>'phone', p_customer->>'address', p_idempotency_key, p_request_fingerprint)
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id = (v_item->>'productId')::uuid;
    insert into public.order_items(order_id,product_id,name,quantity,price,image)
      values(v_id,v_product.id,v_product.name,v_qty,v_product.price,coalesce(v_product.images[1],''));
    update public.products set stock = stock - v_qty, updated_at = now() where id = v_product.id;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.create_order(uuid,jsonb,jsonb,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_order(uuid,jsonb,jsonb,text,text,uuid,text) to service_role;

create function public.update_order_admin(
  p_actor_id uuid, p_order_id uuid, p_status text default null,
  p_tracking_number text default null, p_carrier text default null, p_payment_status text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_next text; v_item record;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role = 'admin') then raise exception 'FORBIDDEN'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  v_next := coalesce(p_status, v_order.status);
  if p_payment_status is not null then
    if p_payment_status <> 'paid' then raise exception 'INVALID_PAYMENT'; end if;
    if v_order.payment_method not in ('cod','bank_transfer') then raise exception 'PAYMENT_PROVIDER_MANAGED'; end if;
    if v_order.status = 'cancelled' or v_next = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;
  end if;
  if v_next <> v_order.status then
    if v_next = 'cancelled' then
      if v_order.status not in ('pending','confirmed','processing') then raise exception 'INVALID_STATUS_TRANSITION'; end if;
      if v_order.payment_status = 'paid' then raise exception 'REFUND_REQUIRED'; end if;
    elsif not ((v_order.status = 'pending' and v_next = 'confirmed')
      or (v_order.status = 'confirmed' and v_next = 'processing')
      or (v_order.status = 'processing' and v_next = 'shipped')
      or (v_order.status = 'shipped' and v_next = 'delivered')) then raise exception 'INVALID_STATUS_TRANSITION'; end if;
    if v_next in ('processing','shipped','delivered') and v_order.payment_method <> 'cod'
      and coalesce(p_payment_status,v_order.payment_status) <> 'paid' then raise exception 'INVALID_PAYMENT'; end if;
  end if;
  if v_next = 'shipped' and (length(coalesce(p_tracking_number,v_order.tracking_number,'')) = 0
    or length(coalesce(p_carrier,v_order.carrier,'')) = 0) then raise exception 'INVALID_INPUT'; end if;
  if v_next = 'cancelled' and not v_order.stock_released then
    for v_item in select product_id, quantity from public.order_items where order_id = p_order_id order by product_id loop
      update public.products set stock = stock + v_item.quantity, updated_at = now() where id = v_item.product_id;
    end loop;
  end if;
  update public.orders set status = v_next, payment_status = coalesce(p_payment_status,payment_status),
    tracking_number = coalesce(p_tracking_number,tracking_number), carrier = coalesce(p_carrier,carrier),
    stock_released = stock_released or v_next = 'cancelled', updated_at = now() where id = p_order_id;
  return p_order_id;
end;
$$;
revoke all on function public.update_order_admin(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.update_order_admin(uuid,uuid,text,text,text,text) to service_role;

-- Payment callbacks are processed transactionally. Redelivery and overlapping webhook calls are safe.
create function public.apply_stripe_event(
  p_event_id text, p_event_type text, p_order_id uuid, p_session_id text,
  p_amount bigint, p_currency text, p_payment_intent text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_item record; v_paid boolean;
begin
  if exists(select 1 from public.payment_events where event_id = p_event_id) then return; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if exists(select 1 from public.payment_events where event_id = p_event_id) then return; end if;
  if v_order.payment_method not in ('card','promptpay') or p_amount <> (v_order.total * 100)::bigint
    or p_currency <> 'thb' or (v_order.stripe_session_id is not null and v_order.stripe_session_id <> p_session_id)
    then raise exception 'PAYMENT_MISMATCH'; end if;
  v_paid := p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded');
  if v_paid then
    update public.orders set payment_status = case when status = 'cancelled' then 'refund_required' else 'paid' end,
      status = case when status = 'pending' then 'confirmed' else status end,
      stripe_session_id = p_session_id, stripe_payment_intent = p_payment_intent, updated_at = now()
      where id = p_order_id;
  elsif p_event_type in ('checkout.session.expired','checkout.session.async_payment_failed') and v_order.payment_status not in ('paid','refund_required') then
    if not v_order.stock_released then
      for v_item in select product_id, quantity from public.order_items where order_id = p_order_id order by product_id loop
        update public.products set stock = stock + v_item.quantity, updated_at = now() where id = v_item.product_id;
      end loop;
    end if;
    update public.orders set status = 'cancelled', stock_released = true,
      payment_status = case when p_event_type = 'checkout.session.expired' then 'expired' else 'failed' end,
      stripe_session_id = p_session_id, updated_at = now() where id = p_order_id;
  elsif p_event_type not in ('checkout.session.expired','checkout.session.async_payment_failed') then raise exception 'INVALID_PAYMENT';
  end if;
  insert into public.payment_events(event_id,order_id,event_type) values(p_event_id,p_order_id,p_event_type);
end;
$$;
revoke all on function public.apply_stripe_event(text,text,uuid,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text,text,uuid,text,bigint,text,text) to service_role;

-- Create an administrator only with the Supabase SQL Editor / service role, after that person signs up:
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'owner@example.com');
-- Do not add an authenticated UPDATE policy to profiles, and never derive role from user_metadata.
