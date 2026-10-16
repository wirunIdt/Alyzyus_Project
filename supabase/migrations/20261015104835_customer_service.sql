-- ศูนย์บริการลูกค้า: อ่านผ่าน RLS, เขียนเฉพาะ RPC service_role ที่ Flask ตรวจตัวตนแล้ว
create table public.support_tickets (
  id bigint generated always as identity primary key,
  ticket_number text generated always as ('ALY-S-' || id::text) stored,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  category text not null check (category in ('order','payment','return','product','account','other')),
  subject text not null check (char_length(btrim(subject)) between 5 and 120 and subject !~ '[[:cntrl:]]'),
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_message_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  unique(user_id,idempotency_key)
);
create table public.support_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('customer','staff')),
  body text not null check (char_length(btrim(body)) between 10 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  unique(author_id,idempotency_key)
);
create index support_tickets_user_id_idx on public.support_tickets(user_id,id desc);
create index support_tickets_status_id_idx on public.support_tickets(status,id desc);
create index support_tickets_user_created_idx on public.support_tickets(user_id,created_at desc);
create index support_tickets_order_id_idx on public.support_tickets(order_id) where order_id is not null;
create index support_messages_ticket_id_idx on public.support_messages(ticket_id,id desc);
create index support_messages_author_created_idx on public.support_messages(author_id,created_at desc);
create index activity_logs_support_status_actor_idx on public.activity_logs(actor_id,created_at desc)
  where action='support.status_changed';
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_tickets,public.support_messages from public,anon,authenticated,service_role;
grant select on public.support_tickets,public.support_messages to authenticated;
grant select,insert,update on public.support_tickets to service_role;
grant select,insert on public.support_messages to service_role;
grant usage,select on sequence public.support_tickets_id_seq,public.support_messages_id_seq to service_role;
create policy support_tickets_read on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy support_messages_read on public.support_messages for select to authenticated
  using (exists(select 1 from public.support_tickets t where t.id = ticket_id and (t.user_id = (select auth.uid()) or (select private.is_admin()))));
create policy support_tickets_server on public.support_tickets for all to service_role using(true) with check(true);
create policy support_messages_server on public.support_messages for all to service_role using(true) with check(true);

alter table public.activity_logs drop constraint activity_logs_entity_type_check;
alter table public.activity_logs add constraint activity_logs_entity_type_check
  check (entity_type in ('product','order','profile','session','media','system','ticket'));

-- Advisory lock ต่อผู้ใช้ทำให้ข้อจำกัดรายชั่วโมงและ idempotency คงทนแม้ Vercel หลาย instance
-- SECURITY INVOKER: ไม่ขยายสิทธิ์ผู้เรียก และ revoke จากทุก client role โดยชัดเจน
create function public.create_support_ticket(
  p_actor_id uuid,p_category text,p_subject text,p_body text,p_order_id uuid,p_idempotency_key uuid,p_fingerprint text
) returns text language plpgsql security invoker set search_path = '' as $$
declare v_ticket public.support_tickets%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id) then raise exception 'UNAUTHORIZED'; end if;
  if p_category is null or p_category not in ('order','payment','return','product','account','other')
     or p_subject is null or char_length(btrim(p_subject)) not between 5 and 120 or p_subject ~ '[[:cntrl:]]'
     or p_body is null or char_length(btrim(p_body)) not between 10 and 4000
     or p_idempotency_key is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,71581));
  select * into v_ticket from public.support_tickets where user_id=p_actor_id and idempotency_key=p_idempotency_key;
  if found then
    if v_ticket.request_fingerprint <> p_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_ticket.id::text;
  end if;
  if exists(select 1 from public.support_messages where author_id=p_actor_id and idempotency_key=p_idempotency_key) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if p_order_id is not null and not exists(select 1 from public.orders where id=p_order_id and user_id=p_actor_id) then raise exception 'ORDER_NOT_FOUND'; end if;
  if (select count(*) from public.support_tickets where user_id=p_actor_id and created_at > v_now - interval '1 hour') >= 5
     or (select count(*) from public.support_messages where author_id=p_actor_id and created_at > v_now - interval '1 hour') >= 20 then raise exception 'SUPPORT_RATE_LIMITED'; end if;
  insert into public.support_tickets(user_id,order_id,category,subject,idempotency_key,request_fingerprint)
    values(p_actor_id,p_order_id,p_category,btrim(p_subject),p_idempotency_key,p_fingerprint) returning * into v_ticket;
  insert into public.support_messages(ticket_id,author_id,author_role,body,idempotency_key,request_fingerprint)
    values(v_ticket.id,p_actor_id,'customer',btrim(p_body),p_idempotency_key,p_fingerprint);
  insert into public.activity_logs(category,action,source,actor_id,entity_type,details)
    values('system','support.created','database',p_actor_id,'ticket',jsonb_build_object('ticket_id',v_ticket.id::text,'category',p_category,'status','open'));
  return v_ticket.id::text;
end;
$$;
revoke all on function public.create_support_ticket(uuid,text,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_support_ticket(uuid,text,text,text,uuid,uuid,text) to service_role;

create function public.reply_support_ticket(
  p_actor_id uuid,p_ticket_id bigint,p_body text,p_as_staff boolean,p_idempotency_key uuid,p_fingerprint text
) returns text language plpgsql security invoker set search_path = '' as $$
declare v_ticket public.support_tickets%rowtype; v_message public.support_messages%rowtype;
        v_staff boolean; v_status text; v_now timestamptz := clock_timestamp();
begin
  if p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id) then raise exception 'UNAUTHORIZED'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 10 and 4000 or p_as_staff is null
     or p_idempotency_key is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
  v_staff := exists(select 1 from public.profiles where id=p_actor_id and role='admin');
  if p_as_staff and not v_staff then raise exception 'FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,71581));
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found or (not p_as_staff and v_ticket.user_id <> p_actor_id) then raise exception 'SUPPORT_NOT_FOUND'; end if;
  select * into v_message from public.support_messages where author_id=p_actor_id and idempotency_key=p_idempotency_key;
  if found then
    if v_message.ticket_id <> p_ticket_id or v_message.request_fingerprint <> p_fingerprint
       or v_message.author_role <> (case when p_as_staff then 'staff' else 'customer' end) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_message.id::text;
  end if;
  if exists(select 1 from public.support_tickets where user_id=p_actor_id and idempotency_key=p_idempotency_key) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_ticket.status='closed' then raise exception 'SUPPORT_CLOSED'; end if;
  if (select count(*) from public.support_messages where author_id=p_actor_id and created_at > v_now - interval '1 hour')
      >= (case when p_as_staff then 200 else 20 end) then raise exception 'SUPPORT_RATE_LIMITED'; end if;
  v_status := case when p_as_staff then 'pending' else 'open' end;
  insert into public.support_messages(ticket_id,author_id,author_role,body,idempotency_key,request_fingerprint)
    values(p_ticket_id,p_actor_id,case when p_as_staff then 'staff' else 'customer' end,btrim(p_body),p_idempotency_key,p_fingerprint) returning * into v_message;
  update public.support_tickets set status=v_status,updated_at=v_message.created_at,last_message_at=v_message.created_at where id=p_ticket_id;
  insert into public.activity_logs(category,action,source,actor_id,entity_type,details)
    values('system','support.replied','database',p_actor_id,'ticket',jsonb_build_object('ticket_id',p_ticket_id::text,'author_role',v_message.author_role,'status',v_status));
  return v_message.id::text;
end;
$$;
revoke all on function public.reply_support_ticket(uuid,bigint,text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.reply_support_ticket(uuid,bigint,text,boolean,uuid,text) to service_role;

create function public.change_support_ticket(p_actor_id uuid,p_ticket_id bigint,p_action text,p_as_staff boolean)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_ticket public.support_tickets%rowtype; v_staff boolean; v_status text;
begin
  if p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id) then raise exception 'UNAUTHORIZED'; end if;
  if p_action is null or p_action not in ('resolve','reopen','close') or p_as_staff is null then raise exception 'INVALID_INPUT'; end if;
  v_staff := exists(select 1 from public.profiles where id=p_actor_id and role='admin');
  if p_as_staff and not v_staff then raise exception 'FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,71581));
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found or (not p_as_staff and v_ticket.user_id <> p_actor_id) then raise exception 'SUPPORT_NOT_FOUND'; end if;
  if p_action='close' and not p_as_staff then raise exception 'FORBIDDEN'; end if;
  if v_ticket.status='closed' and (not p_as_staff or p_action='resolve') then raise exception 'SUPPORT_CLOSED'; end if;
  v_status := case p_action when 'resolve' then 'resolved' when 'reopen' then 'open' else 'closed' end;
  if v_status=v_ticket.status then return v_ticket.id::text; end if;
  if (select count(*) from public.activity_logs where actor_id=p_actor_id and action='support.status_changed'
      and created_at > clock_timestamp()-interval '1 hour')
      >= (case when p_as_staff then 200 else 30 end) then raise exception 'SUPPORT_RATE_LIMITED'; end if;
  update public.support_tickets set status=v_status,updated_at=clock_timestamp() where id=p_ticket_id;
  insert into public.activity_logs(category,action,source,actor_id,entity_type,details)
    values('system','support.status_changed','database',p_actor_id,'ticket',jsonb_build_object('ticket_id',p_ticket_id::text,'before',v_ticket.status,'after',v_status));
  return v_ticket.id::text;
end;
$$;
revoke all on function public.change_support_ticket(uuid,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.change_support_ticket(uuid,bigint,text,boolean) to service_role;

comment on table public.support_tickets is 'Customer-owned support tickets; no public read/write. Hourly limits enforced atomically by service-only RPCs.';
comment on table public.support_messages is 'Private customer/staff text conversation; no automated staff, attachments or external message delivery.';
notify pgrst,'reload schema';
