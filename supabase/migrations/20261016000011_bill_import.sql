-- Sri Sri Boutique — 0011 Importing bills from the paper bill book
-- * orders.source_ref: the bill number written in the old book (prevents importing the same bill twice)
-- * save_order accepts order_date (a past date, for old bills) and source_ref
-- * has_permission(): lets an Edge Function ask "may this signed-in user do X?"
-- * bill_scans: one row per photo read, for usage tracking and rate limits

alter table public.orders add column source_ref text check (source_ref is null or length(source_ref) <= 60);
create unique index uq_orders_source_ref on public.orders(business_id, lower(source_ref)) where source_ref is not null;

create table public.bill_scans (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null,
  status       text not null check (status in ('ok', 'failed')),
  model        text,
  error        text,
  order_id     uuid references public.orders(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index idx_bill_scans_business on public.bill_scans(business_id, created_at desc);
alter table public.bill_scans enable row level security;
create policy bill_scans_select on public.bill_scans for select to authenticated using (app.is_owner(business_id));
revoke insert, update, delete on public.bill_scans from authenticated;

create or replace function public.has_permission(p_business_id uuid, p_perm public.permission_key)
returns boolean language sql stable security definer set search_path = public, app as $$
  select app.has_perm(p_business_id, p_perm)
$$;

-- Called by the scan-bill Edge Function (service role) after each read.
create or replace function public.log_bill_scan(p_business_id uuid, p_user_id uuid, p_status text, p_model text, p_error text)
returns void language sql security definer set search_path = public as $$
  insert into bill_scans (business_id, user_id, status, model, error) values (p_business_id, p_user_id, p_status, p_model, left(p_error, 500))
$$;

-- save_order: wrap the original to add order_date and source_ref.
alter function public.save_order(jsonb) rename to save_order_core;

create or replace function public.save_order(p jsonb)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_id uuid;
  v_b uuid := (p->>'business_id')::uuid;
  v_date date := nullif(p->>'order_date', '')::date;
  v_ref text := nullif(trim(p->>'source_ref'), '');
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform app.require_perm(v_b, 'orders.manage');
  if v_date is not null and (v_date > v_today or v_date < v_today - 3650) then
    raise exception 'Bill date must be in the last 10 years and not in the future' using errcode = '22023';
  end if;
  -- A retry of the same submission (same idempotency key) is not a duplicate.
  if v_ref is not null and exists (
      select 1 from orders where business_id = v_b and lower(source_ref) = lower(v_ref)
        and id is distinct from nullif(p->>'id', '')::uuid
        and idempotency_key is distinct from nullif(p->>'idempotency_key', '')::uuid) then
    raise exception 'Bill % from the book is already entered', v_ref using errcode = '23505';
  end if;

  v_id := public.save_order_core(p);

  if p ? 'order_date' or p ? 'source_ref' then
    update orders set
      order_date = coalesce(v_date, order_date),
      source_ref = case when p ? 'source_ref' then v_ref else source_ref end
    where id = v_id;
  end if;
  return v_id;
end $$;

revoke execute on function public.save_order_core(jsonb) from public, anon, authenticated;
revoke execute on all functions in schema public from anon;
grant execute on function public.save_order(jsonb), public.has_permission(uuid, public.permission_key) to authenticated, service_role;
revoke execute on function public.log_bill_scan(uuid, uuid, text, text, text) from public, authenticated;
grant execute on function public.log_bill_scan(uuid, uuid, text, text, text) to service_role;
