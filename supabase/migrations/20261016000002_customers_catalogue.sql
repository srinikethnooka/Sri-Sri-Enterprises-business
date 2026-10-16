-- Sri Sri Boutique — 0002 Customers, measurements, workers, service catalogue

create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  customer_code   text not null,
  full_name       text not null check (length(trim(full_name)) between 1 and 120),
  phone_e164      text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_e164   text check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email           text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address         text,
  notes           text,                  -- visible to the team; not shown in the portal
  user_id         uuid unique references auth.users(id) on delete set null,
  active          boolean not null default true,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, customer_code)
);
create index idx_customers_phone on public.customers(business_id, phone_e164);
create index idx_customers_name_trgm on public.customers using gin (full_name extensions.gin_trgm_ops);
create index idx_customers_created on public.customers(business_id, created_at desc);
create trigger trg_customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();

-- Assign customer_code server-side; never trust a client-supplied one.
create or replace function app.customers_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  new.customer_code := 'CUS-' || lpad(app.next_number(new.business_id, 'customer', 'all')::text, 5, '0');
  new.created_by := auth.uid();
  new.user_id := null;  -- portal linking happens only through the link_customer RPC
  return new;
end $$;
create trigger trg_customers_bi before insert on public.customers
  for each row execute function app.customers_before_insert();

-- Measurement sets are insert-only so orders keep the exact set they used.
create table public.measurement_sets (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,
  garment_type  text not null default 'blouse',
  values        jsonb not null default '{}'::jsonb check (jsonb_typeof(values) = 'object'),
  unit          text not null default 'inch' check (unit in ('inch', 'cm')),
  notes         text,
  taken_at      timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index idx_measurements_customer on public.measurement_sets(customer_id, taken_at desc);
create trigger trg_measurements_immutable before update or delete on public.measurement_sets
  for each row execute function app.forbid_change();

-- Workers: tailors / embroiderers who may not have logins.
create table public.workers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  phone        text,
  skills       text,
  member_id    uuid references public.business_members(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_workers_touch before update on public.workers
  for each row execute function app.touch_updated_at();

-- Service catalogue
create table public.service_categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  sort         int not null default 0,
  unique (business_id, name)
);

create table public.services (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id) on delete cascade,
  category_id             uuid references public.service_categories(id) on delete set null,
  name                    text not null check (length(trim(name)) between 1 and 120),
  description             text,
  default_price           numeric(12,2) not null default 0 check (default_price >= 0),
  unit                    public.unit_kind not null default 'pcs',
  standard_cost_estimate  numeric(12,2) check (standard_cost_estimate is null or standard_cost_estimate >= 0),
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (business_id, name)
);
create trigger trg_services_touch before update on public.services
  for each row execute function app.touch_updated_at();
create trigger trg_services_audit after update on public.services
  for each row execute function app.audit_row();
