-- Sri Sri Boutique — 0012
-- 1. 4-digit customer IDs (1001, 1002, …)
-- 2. Automatic WhatsApp sending through the WhatsApp Business Platform (Cloud API)
-- 3. Photos on customers (same private storage as order photos)

-- ---------------------------------------------------------------------------
-- 1. Customer IDs: 4 digits, starting at 1001, never reused.
--    (After 9999 customers the numbers simply continue: 10000, 10001, …)
-- ---------------------------------------------------------------------------
create or replace function app.customers_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  new.customer_code := (1000 + app.next_number(new.business_id, 'customer_id', 'all'))::text;
  new.created_by := auth.uid();
  new.user_id := null;  -- portal linking happens only through accept_invite
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. WhatsApp automatic sending
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column whatsapp_auto_send boolean not null default false,
  add column whatsapp_template_name text not null default 'invoice_with_pdf'
    check (whatsapp_template_name ~ '^[a-z0-9_]{1,250}$'),
  add column whatsapp_template_lang text not null default 'en'
    check (whatsapp_template_lang ~ '^[a-z]{2}(_[A-Z]{2})?$');

-- What we have learned about each customer's number from real send results.
alter table public.customers
  add column whatsapp_status text not null default 'unknown' check (whatsapp_status in ('unknown', 'yes', 'no')),
  add column whatsapp_checked_at timestamptz;

-- One row per message sent by the app. Status comes from WhatsApp itself:
-- accepted → sent → delivered → read, or failed / not_on_whatsapp.
create table public.whatsapp_messages (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  invoice_id    uuid references public.invoices(id) on delete set null,
  order_id      uuid references public.orders(id) on delete set null,
  customer_id   uuid references public.customers(id) on delete set null,
  phone_e164    text not null,
  purpose       text not null default 'invoice',
  wamid         text unique,
  status        text not null check (status in ('accepted', 'sent', 'delivered', 'read', 'failed', 'not_on_whatsapp')),
  error_code    text,
  error_text    text,
  sent_by       uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_wa_messages_invoice on public.whatsapp_messages(invoice_id, created_at desc);
create index idx_wa_messages_order on public.whatsapp_messages(order_id, created_at desc);
alter table public.whatsapp_messages enable row level security;
create policy wa_messages_select on public.whatsapp_messages for select to authenticated
  using (app.has_any_perm(business_id, array['orders.manage', 'invoices.manage', 'payments.record']::permission_key[]));
revoke insert, update, delete on public.whatsapp_messages from authenticated;

-- Called only by the whatsapp-webhook Edge Function (service role) when WhatsApp reports a status.
create or replace function public.whatsapp_status_update(p_wamid text, p_status text, p_error_code text, p_error_text text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m whatsapp_messages%rowtype;
  v_rank_old int;
  v_rank_new int;
  v_status text := case when p_error_code = '131026' then 'not_on_whatsapp' else p_status end;
begin
  select * into m from whatsapp_messages where wamid = p_wamid for update;
  if not found then return; end if;
  -- Statuses can arrive out of order; never move backwards (read > delivered > sent > accepted).
  v_rank_old := array_position(array['accepted', 'sent', 'delivered', 'read'], m.status);
  v_rank_new := array_position(array['accepted', 'sent', 'delivered', 'read'], v_status);
  if v_rank_new is not null and v_rank_old is not null and v_rank_new <= v_rank_old then return; end if;
  if m.status in ('failed', 'not_on_whatsapp') then return; end if;

  update whatsapp_messages set status = v_status, error_code = p_error_code, error_text = left(p_error_text, 500), updated_at = now()
  where id = m.id;

  if m.customer_id is not null then
    perform set_config('app.linking', 'on', true);  -- allow this system update past the customer guard
    update customers set
      whatsapp_status = case when v_status in ('delivered', 'read') then 'yes'
                             when v_status = 'not_on_whatsapp' then 'no' else whatsapp_status end,
      whatsapp_checked_at = case when v_status in ('delivered', 'read', 'not_on_whatsapp') then now() else whatsapp_checked_at end
    where id = m.customer_id;
    perform set_config('app.linking', 'off', true);
  end if;
end $$;

revoke execute on function public.whatsapp_status_update(text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_status_update(text, text, text, text) to service_role;

-- The customer guard must also block staff from editing the WhatsApp status by hand.
create or replace function app.customers_guard() returns trigger
language plpgsql as $$
declare v_system boolean := coalesce(current_setting('app.linking', true), '') = 'on';
begin
  if new.customer_code is distinct from old.customer_code then
    raise exception 'Customer ID cannot change' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id and not v_system then
    raise exception 'Portal logins are linked only through an invite' using errcode = '42501';
  end if;
  if new.business_id <> old.business_id then
    raise exception 'Cannot move records between businesses' using errcode = '42501';
  end if;
  if new.whatsapp_e164 is distinct from old.whatsapp_e164 then
    -- A new WhatsApp number: forget what we knew about the old one.
    new.whatsapp_status := 'unknown';
    new.whatsapp_checked_at := null;
  elsif not v_system and (new.whatsapp_status, new.whatsapp_checked_at) is distinct from (old.whatsapp_status, old.whatsapp_checked_at) then
    raise exception 'WhatsApp status is set from delivery results' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Photos on customers
-- ---------------------------------------------------------------------------
alter table public.attachments drop constraint attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('order', 'order_line', 'purchase', 'expense', 'delivery', 'invoice', 'customer'));

revoke execute on all functions in schema public from anon;
