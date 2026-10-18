-- ตรวจข้อมูลซ้ำที่ขอบเขต RPC แม้ Flask จะตรวจลายเซ็นและข้อมูล webhook แล้ว
-- SQL ใช้สามค่าความจริง: NULL <> ยอดที่ถูกต้อง ไม่ได้ให้ค่า true จึงต้องกัน NULL ชัดเจน
-- คง transaction, idempotency, audit และ logic คืนสต็อกเดิมไว้ใน private implementation
create or replace function public.apply_stripe_event(
  p_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_session_id text,
  p_amount bigint,
  p_currency text,
  p_payment_intent text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := current_setting('alyzyus.audit_actor',true);
  v_origin text := current_setting('alyzyus.audit_origin',true);
begin
  if p_order_id is null
     or char_length(btrim(coalesce(p_event_id,''))) not between 1 and 255
     or p_event_id ~ '[[:cntrl:]]'
     or char_length(btrim(coalesce(p_session_id,''))) not between 1 and 255
     or p_session_id ~ '[[:cntrl:]]'
     or p_event_type is null
     or p_event_type not in (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'checkout.session.async_payment_failed',
       'checkout.session.expired'
     )
     or p_amount is null or p_amount <= 0
     or p_currency is distinct from 'thb'
     or (p_payment_intent is not null and (
       char_length(btrim(p_payment_intent)) not between 1 and 255
       or p_payment_intent ~ '[[:cntrl:]]'
     ))
     or (p_event_type in (
       'checkout.session.completed','checkout.session.async_payment_succeeded'
     ) and p_payment_intent is null) then
    raise exception 'PAYMENT_MISMATCH';
  end if;

  -- เหตุการณ์หมดอายุ/ล้มเหลวอาจไม่มี PaymentIntent จึงยังส่ง NULL ผ่านได้ตามปกติ
  perform set_config('alyzyus.audit_actor','',true);
  perform set_config('alyzyus.audit_origin','webhook',true);
  perform private.apply_stripe_event_internal(
    p_event_id,p_event_type,p_order_id,p_session_id,p_amount,p_currency,p_payment_intent
  );
  perform set_config('alyzyus.audit_actor',coalesce(v_actor,''),true);
  perform set_config('alyzyus.audit_origin',coalesce(v_origin,''),true);
end;
$$;

revoke all on function public.apply_stripe_event(text,text,uuid,text,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_stripe_event(text,text,uuid,text,bigint,text,text)
  to service_role;

comment on function public.apply_stripe_event(text,text,uuid,text,bigint,text,text)
  is 'Service-only signed webhook transaction. Reject incomplete payment identifiers and NULL amount/currency before delegating to the existing stock/audit implementation.';

notify pgrst,'reload schema';
