-- Sri Sri Boutique — 0001 Foundation
-- Extensions, enums, tenancy, members, permissions, number sequences, audit log.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'staff', 'customer');

create type public.permission_key as enum (
  'customers.manage', 'orders.manage', 'invoices.manage', 'payments.record',
  'inventory.manage', 'purchasing.manage', 'delivery.manage', 'expenses.manage',
  'finance.view', 'reports.export', 'staff.manage', 'settings.manage'
);

create type public.order_status as enum (
  'draft', 'confirmed', 'in_progress', 'waiting_materials', 'quality_check',
  'ready', 'out_for_delivery', 'delivered', 'cancelled'
);

create type public.invoice_status as enum ('issued', 'cancelled');
create type public.payment_kind as enum ('payment', 'refund', 'reversal');
create type public.payment_method as enum ('cash', 'upi', 'bank', 'card', 'other');
create type public.unit_kind as enum ('pcs', 'm', 'g', 'ml', 'roll', 'set', 'hour', 'job');
create type public.stock_movement_type as enum (
  'receipt', 'consumption', 'return_in', 'return_out', 'waste', 'adjustment'
);
create type public.delivery_method as enum ('pickup', 'local_delivery', 'courier', 'rapido');
create type public.delivery_status as enum ('pending', 'booked', 'dispatched', 'delivered', 'failed', 'cancelled');
create type public.attachment_visibility as enum ('customer', 'internal');
create type public.purchase_status as enum ('draft', 'received', 'cancelled');
create type public.order_priority as enum ('normal', 'high', 'urgent');

-- ---------------------------------------------------------------------------
-- Common trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Businesses (tenants)
-- ---------------------------------------------------------------------------
create table public.businesses (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(trim(name)) between 2 and 120),
  invoice_prefix        text not null default 'SSB' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  logo_path             text,
  address               text,
  phone                 text,
  whatsapp_e164         text check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email                 text,
  gstin                 text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  payment_instructions  text,
  invoice_footer        text default 'Thank you for choosing us!',
  timezone              text not null default 'Asia/Kolkata',
  -- Tax is off by default. When on, tax_rate (percent) applies to the taxable amount.
  tax_enabled           boolean not null default false,
  tax_label             text not null default 'GST',
  tax_rate              numeric(5,2) not null default 0 check (tax_rate between 0 and 50),
  -- 'rupee' rounds invoice totals to the nearest rupee; 'none' keeps paise.
  rounding_rule         text not null default 'rupee' check (rounding_rule in ('rupee', 'none')),
  -- 'block' refuses consumption beyond stock; 'override' lets the owner approve it.
  stock_shortage_mode   text not null default 'override' check (stock_shortage_mode in ('block', 'override')),
  share_link_days       int not null default 30 check (share_link_days between 1 and 365),
  whatsapp_template     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_businesses_touch before update on public.businesses
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Create a profile automatically when an auth user is created.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.phone)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Membership and permissions
-- ---------------------------------------------------------------------------
create table public.business_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.member_role not null,
  display_name text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, user_id)
);
create index idx_members_user on public.business_members(user_id) where active;
create trigger trg_members_touch before update on public.business_members
  for each row execute function app.touch_updated_at();

create table public.member_permissions (
  member_id   uuid not null references public.business_members(id) on delete cascade,
  permission  public.permission_key not null,
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz not null default now(),
  primary key (member_id, permission)
);

-- ---------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so RLS policies can call them
-- without recursive policy evaluation. They only read auth.uid().
-- ---------------------------------------------------------------------------
create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.role_in(b uuid) returns public.member_role
language sql stable security definer set search_path = public as $$
  select role from public.business_members
  where business_id = b and user_id = auth.uid() and active
$$;

-- Owner or staff (not customers).
create or replace function app.is_team(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_members
    where business_id = b and user_id = auth.uid() and active and role in ('owner', 'staff')
  )
$$;

create or replace function app.is_owner(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_members
    where business_id = b and user_id = auth.uid() and active and role = 'owner'
  )
$$;

-- Owners hold every permission. Staff hold only explicitly granted ones.
create or replace function app.has_perm(b uuid, p public.permission_key) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b and m.user_id = auth.uid() and m.active
      and (m.role = 'owner'
           or (m.role = 'staff' and exists (
                 select 1 from public.member_permissions mp
                 where mp.member_id = m.id and mp.permission = p)))
  )
$$;

create or replace function app.has_any_perm(b uuid, ps public.permission_key[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b and m.user_id = auth.uid() and m.active
      and (m.role = 'owner'
           or (m.role = 'staff' and exists (
                 select 1 from public.member_permissions mp
                 where mp.member_id = m.id and mp.permission = any(ps))))
  )
$$;

-- Raises unless the caller holds the permission. Used at the top of every RPC.
create or replace function app.require_perm(b uuid, p public.permission_key) returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not app.has_perm(b, p) then
    raise exception 'You do not have permission: %', p using errcode = '42501';
  end if;
end $$;

create or replace function app.require_owner(b uuid) returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.is_owner(b) then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Gap-free, concurrency-safe numbering
-- ---------------------------------------------------------------------------
create table public.number_sequences (
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null,
  period      text not null,
  next_value  bigint not null default 1,
  primary key (business_id, kind, period)
);

create or replace function app.next_number(b uuid, k text, per text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.number_sequences (business_id, kind, period, next_value)
  values (b, k, per, 1)
  on conflict (business_id, kind, period) do nothing;

  update public.number_sequences
     set next_value = next_value + 1
   where business_id = b and kind = k and period = per
  returning next_value - 1 into v;   -- row lock held until the transaction ends
  return v;
end $$;

-- Indian financial year label for a timestamp, e.g. 2026-27.
create or replace function app.fy_label(ts timestamptz, tz text default 'Asia/Kolkata') returns text
language sql immutable as $$
  select case
    when extract(month from ts at time zone tz) >= 4
      then to_char(ts at time zone tz, 'YYYY') || '-' ||
           lpad(((extract(year from ts at time zone tz)::int + 1) % 100)::text, 2, '0')
    else (extract(year from ts at time zone tz)::int - 1)::text || '-' ||
         lpad((extract(year from ts at time zone tz)::int % 100)::text, 2, '0')
  end
$$;

-- ---------------------------------------------------------------------------
-- Audit log (written by triggers and RPCs; readable by owner only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  actor        uuid,
  action       text not null,
  entity       text not null,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);
create index idx_audit_business_at on public.audit_log(business_id, at desc);

create or replace function app.audit(b uuid, act text, ent text, ent_id text, bef jsonb, aft jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
  values (b, auth.uid(), act, ent, ent_id, bef, aft)
$$;

-- Generic row trigger for tables that have business_id and id.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  perform app.audit(
    (rec->>'business_id')::uuid,
    lower(tg_op),
    tg_table_name,
    rec->>'id',
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

-- Rejects UPDATE/DELETE on append-only tables.
create or replace function app.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% records cannot be changed or deleted. Record a correction instead.', tg_table_name
    using errcode = '42501';
end $$;
