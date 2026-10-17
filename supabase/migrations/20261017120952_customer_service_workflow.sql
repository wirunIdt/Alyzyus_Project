-- เรียงเรื่องตามกิจกรรมล่าสุด โดยใช้ id เป็นตัวตัดสินเมื่อเวลาเท่ากัน
create index support_tickets_activity_idx
  on public.support_tickets(updated_at desc,id desc);
create index support_tickets_user_activity_idx
  on public.support_tickets(user_id,updated_at desc,id desc);
create index support_tickets_status_activity_idx
  on public.support_tickets(status,updated_at desc,id desc);

-- ป้องกันการปิด/แก้ไขเรื่องจากหน้าจอเก่าที่ไม่ได้อ่านข้อความล่าสุด
-- ใช้ transaction lock เดียวกับ RPC เดิม จึงรักษา quota และ audit เดิมไว้ทั้งหมด
create function public.change_support_ticket_revision(
  p_actor_id uuid,
  p_ticket_id bigint,
  p_action text,
  p_as_staff boolean,
  p_expected_updated_at timestamptz
) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_status text;
begin
  if p_actor_id is null or not exists(
    select 1 from public.profiles where id=p_actor_id
  ) then
    raise exception 'UNAUTHORIZED';
  end if;
  if p_action is null or p_action not in ('resolve','reopen','close')
     or p_as_staff is null or p_expected_updated_at is null
     or not pg_catalog.isfinite(p_expected_updated_at) then
    raise exception 'INVALID_INPUT';
  end if;
  if p_as_staff and not exists(
    select 1 from public.profiles where id=p_actor_id and role='admin'
  ) then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_id::text,71581)
  );
  select * into v_ticket
    from public.support_tickets where id=p_ticket_id for update;
  if not found or (not p_as_staff and v_ticket.user_id <> p_actor_id) then
    raise exception 'SUPPORT_NOT_FOUND';
  end if;
  if p_action='close' and not p_as_staff then
    raise exception 'FORBIDDEN';
  end if;
  if v_ticket.status='closed' and (not p_as_staff or p_action='resolve') then
    raise exception 'SUPPORT_CLOSED';
  end if;

  v_status := case p_action
    when 'resolve' then 'resolved'
    when 'reopen' then 'open'
    else 'closed'
  end;
  -- ส่งซ้ำหลังสำเร็จได้โดยไม่สร้าง audit หรือคิด quota ซ้ำ
  if v_status <> v_ticket.status and v_ticket.updated_at <> p_expected_updated_at then
    raise exception 'SUPPORT_STALE';
  end if;
  return public.change_support_ticket(p_actor_id,p_ticket_id,p_action,p_as_staff);
end;
$$;

revoke all on function public.change_support_ticket_revision(uuid,bigint,text,boolean,timestamptz)
  from public,anon,authenticated;
grant execute on function public.change_support_ticket_revision(uuid,bigint,text,boolean,timestamptz)
  to service_role;

comment on function public.change_support_ticket_revision(uuid,bigint,text,boolean,timestamptz)
  is 'Service-only optimistic concurrency guard. Compare the displayed revision while holding the ticket lock; preserve existing authorization, quotas and audit.';

notify pgrst,'reload schema';
