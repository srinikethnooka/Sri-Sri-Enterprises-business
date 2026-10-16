-- Sri Sri Boutique — 0003 Orders, lines, internal notes, costs, status history

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  order_no            text not null,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  status              public.order_status not null default 'draft',
  order_date          date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_at              timestamptz,
  delivery_method     public.delivery_method not null default 'pickup',
  delivery_address    text,
  measurement_set_id  uuid references public.measurement_sets(id) on delete restrict,
  assigned_worker_id  uuid references public.workers(id) on delete set null,
  customer_notes      text,                -- shown to the customer
  -- Totals: written only by app.recalc_order(). Never accepted from the client.
  items_subtotal      numeric(12,2) not null default 0,
  order_discount      numeric(12,2) not null default 0 check (order_discount >= 0),
  delivery_charge     numeric(12,2) not null default 0 check (delivery_charge >= 0),
  taxable_amount      numeric(12,2) not null default 0,
  tax_rate            numeric(5,2) not null default 0,
  tax_amount          numeric(12,2) not null default 0,
  round_off           numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0 check (total >= 0),
  cancelled_reason    text,
  idempotency_key     uuid unique,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, order_no)
);
create index idx_orders_business_status on public.orders(business_id, status);
create index idx_orders_business_due on public.orders(business_id, due_at) where status not in ('delivered', 'cancelled');
create index idx_orders_customer on public.orders(customer_id, created_at desc);
create index idx_orders_business_date on public.orders(business_id, order_date desc);
create index idx_orders_worker on public.orders(assigned_worker_id) where assigned_worker_id is not null;
create trigger trg_orders_touch before update on public.orders
  for each row execute function app.touch_updated_at();

-- Internal-only order fields (separate table so RLS can hide them).
create table public.order_internal (
  order_id        uuid primary key references public.orders(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  priority        public.order_priority not null default 'normal',
  internal_notes  text,
  updated_at      timestamptz not null default now()
);

create table public.order_lines (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  order_id              uuid not null references public.orders(id) on delete cascade,
  position              int not null default 0,
  service_id            uuid references public.services(id) on delete set null,
  description           text not null check (length(trim(description)) between 1 and 300),
  customer_description  text,
  garment_details       text,
  qty                   numeric(12,3) not null check (qty > 0),
  unit                  public.unit_kind not null default 'pcs',
  unit_price            numeric(12,2) not null check (unit_price >= 0),
  line_discount         numeric(12,2) not null default 0 check (line_discount >= 0),
  line_subtotal         numeric(12,2) generated always as (round(qty * unit_price - line_discount, 2)) stored,
  internal_notes        text,
  created_at            timestamptz not null default now(),
  constraint chk_line_discount check (line_discount <= round(qty * unit_price, 2))
);
create index idx_order_lines_order on public.order_lines(order_id, position);

-- Internal cost record per line (finance.view only).
create table public.order_line_costs (
  line_id        uuid primary key references public.order_lines(id) on delete cascade,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  material_cost  numeric(12,2) not null default 0,   -- maintained by stock movement trigger
  labour_cost    numeric(12,2) not null default 0 check (labour_cost >= 0),
  other_cost     numeric(12,2) not null default 0 check (other_cost >= 0),
  costs_complete boolean not null default false,
  updated_by     uuid,
  updated_at     timestamptz not null default now()
);

create table public.order_status_history (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  order_id     uuid not null references public.orders(id) on delete cascade,
  from_status  public.order_status,
  to_status    public.order_status not null,
  note         text,
  changed_by   uuid default auth.uid(),
  changed_at   timestamptz not null default now()
);
create index idx_status_history_order on public.order_status_history(order_id, changed_at);
create trigger trg_status_history_immutable before update or delete on public.order_status_history
  for each row execute function app.forbid_change();

-- ---------------------------------------------------------------------------
-- Recalculate order totals from lines + business tax/rounding settings.
-- ---------------------------------------------------------------------------
create or replace function app.recalc_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  o public.orders%rowtype;
  b public.businesses%rowtype;
  v_items numeric(12,2);
  v_taxable numeric(12,2);
  v_tax numeric(12,2);
  v_raw numeric(12,2);
  v_total numeric(12,2);
begin
  select * into o from public.orders where id = p_order_id for update;
  select * into b from public.businesses where id = o.business_id;

  select coalesce(sum(line_subtotal), 0) into v_items
    from public.order_lines where order_id = p_order_id;

  if o.order_discount > v_items then
    raise exception 'Order discount (₹%) is more than the items total (₹%)', o.order_discount, v_items
      using errcode = '22023';
  end if;

  v_taxable := v_items - o.order_discount;
  v_tax := case when b.tax_enabled then round(v_taxable * b.tax_rate / 100, 2) else 0 end;
  v_raw := v_taxable + v_tax + o.delivery_charge;
  v_total := case when b.rounding_rule = 'rupee' then round(v_raw, 0) else v_raw end;

  update public.orders set
    items_subtotal = v_items,
    taxable_amount = v_taxable,
    tax_rate       = case when b.tax_enabled then b.tax_rate else 0 end,
    tax_amount     = v_tax,
    round_off      = v_total - v_raw,
    total          = v_total
  where id = p_order_id;
end $$;

-- Allowed status transitions.
create or replace function app.status_transition_ok(f public.order_status, t public.order_status) returns boolean
language sql immutable as $$
  select case
    when f = t then false
    when t = 'cancelled' then f not in ('delivered', 'cancelled')
    when f = 'draft' then t = 'confirmed'
    when f = 'confirmed' then t in ('in_progress', 'waiting_materials')
    when f = 'in_progress' then t in ('waiting_materials', 'quality_check', 'ready')
    when f = 'waiting_materials' then t in ('in_progress')
    when f = 'quality_check' then t in ('in_progress', 'ready')
    when f = 'ready' then t in ('out_for_delivery', 'delivered', 'quality_check')
    when f = 'out_for_delivery' then t in ('delivered', 'ready')
    else false
  end
$$;
