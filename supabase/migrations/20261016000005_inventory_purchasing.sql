-- Sri Sri Boutique — 0005 Suppliers, materials, purchases, stock movements
-- Costing method: weighted average. See docs/ACCOUNTING.md.

create table public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  phone        text,
  address      text,
  gstin        text,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, name)
);
create trigger trg_suppliers_touch before update on public.suppliers
  for each row execute function app.touch_updated_at();

create table public.materials (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  code                 text not null,
  name                 text not null check (length(trim(name)) between 1 and 120),
  category             text,
  unit                 public.unit_kind not null,
  reorder_level        numeric(12,3) not null default 0 check (reorder_level >= 0),
  default_supplier_id  uuid references public.suppliers(id) on delete set null,
  -- Maintained only by the stock movement trigger.
  on_hand              numeric(12,3) not null default 0,
  avg_cost             numeric(12,4) not null default 0 check (avg_cost >= 0),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, name)
);
create index idx_materials_low on public.materials(business_id) where active and on_hand <= reorder_level;
create trigger trg_materials_touch before update on public.materials
  for each row execute function app.touch_updated_at();

-- Stock and cost may only be changed by the movement trigger.
create or replace function app.materials_guard() returns trigger
language plpgsql as $$
begin
  if (new.on_hand, new.avg_cost, new.unit) is distinct from (old.on_hand, old.avg_cost, old.unit)
     and coalesce(current_setting('app.stock_write', true), '') <> 'on' then
    raise exception 'Stock and cost change only through stock movements.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_materials_guard before update on public.materials
  for each row execute function app.materials_guard();

create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  purchase_no     text not null,
  supplier_id     uuid not null references public.suppliers(id) on delete restrict,
  purchase_date   date not null default (now() at time zone 'Asia/Kolkata')::date,
  supplier_bill_no text,
  status          public.purchase_status not null default 'draft',
  lines_total     numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0 check (discount >= 0),
  other_charges   numeric(12,2) not null default 0 check (other_charges >= 0),
  total           numeric(12,2) not null default 0 check (total >= 0),
  due_date        date,
  notes           text,
  received_at     timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, purchase_no)
);
create index idx_purchases_business_date on public.purchases(business_id, purchase_date desc);
create index idx_purchases_supplier on public.purchases(supplier_id);
create trigger trg_purchases_touch before update on public.purchases
  for each row execute function app.touch_updated_at();

create table public.purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  purchase_id  uuid not null references public.purchases(id) on delete cascade,
  material_id  uuid not null references public.materials(id) on delete restrict,
  qty          numeric(12,3) not null check (qty > 0),
  unit_cost    numeric(12,4) not null check (unit_cost >= 0),
  line_total   numeric(12,2) generated always as (round(qty * unit_cost, 2)) stored,
  batch_no     text
);
create index idx_purchase_lines_purchase on public.purchase_lines(purchase_id);

-- Purchase number on insert; lock lines and header once received.
create or replace function app.purchases_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    new.purchase_no := 'PUR-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
      lpad(app.next_number(new.business_id, 'purchase',
           to_char(now() at time zone 'Asia/Kolkata', 'YYYY'))::text, 4, '0');
    new.status := 'draft';
    new.received_at := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft purchases can be deleted.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and coalesce(current_setting('app.stock_write', true), '') <> 'on' then
    raise exception 'A received or cancelled purchase cannot be edited.' using errcode = '42501';
  end if;
  if new.status <> old.status and coalesce(current_setting('app.stock_write', true), '') <> 'on' then
    raise exception 'Use Receive purchase to change its status.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_purchases_before before insert or update or delete on public.purchases
  for each row execute function app.purchases_before();

create or replace function app.purchase_lines_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_pid uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  if (select status from public.purchases where id = v_pid) <> 'draft' then
    raise exception 'Lines of a received purchase cannot change.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and (select unit from public.materials where id = new.material_id) is null then
    raise exception 'Unknown material' using errcode = '23503';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_purchase_lines_guard before insert or update or delete on public.purchase_lines
  for each row execute function app.purchase_lines_guard();

-- Keep purchase totals in sync with lines.
create or replace function app.purchase_recalc() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_pid uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  update public.purchases p
     set lines_total = coalesce((select sum(line_total) from public.purchase_lines where purchase_id = v_pid), 0)
   where p.id = v_pid;
  return null;
end $$;
create trigger trg_purchase_lines_recalc after insert or update or delete on public.purchase_lines
  for each row execute function app.purchase_recalc();

create or replace function app.purchase_total() returns trigger
language plpgsql as $$
begin
  if new.discount > new.lines_total + new.other_charges then
    raise exception 'Purchase discount is larger than the bill.' using errcode = '22023';
  end if;
  new.total := new.lines_total - new.discount + new.other_charges;
  return new;
end $$;
create trigger trg_purchases_total before insert or update on public.purchases
  for each row execute function app.purchase_total();

create table public.supplier_payments (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  supplier_id      uuid not null references public.suppliers(id) on delete restrict,
  purchase_id      uuid references public.purchases(id) on delete restrict,
  amount           numeric(12,2) not null check (amount <> 0),  -- negative = reversal / refund from supplier
  method           public.payment_method not null,
  reference_no     text,
  paid_at          timestamptz not null default now(),
  note             text,
  idempotency_key  uuid not null unique,
  recorded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index idx_supplier_payments_supplier on public.supplier_payments(supplier_id);
create trigger trg_supplier_payments_immutable before update or delete on public.supplier_payments
  for each row execute function app.forbid_change();

-- ---------------------------------------------------------------------------
-- Stock movements: the single source of truth for stock. Append-only.
-- qty is signed in the material's own unit: + in, - out.
-- unit_cost and value are frozen at the time of the movement.
-- ---------------------------------------------------------------------------
create table public.stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  material_id        uuid not null references public.materials(id) on delete restrict,
  type               public.stock_movement_type not null,
  qty                numeric(12,3) not null check (qty <> 0),
  unit_cost          numeric(12,4),
  value              numeric(14,2),
  purchase_line_id   uuid unique references public.purchase_lines(id) on delete restrict,
  order_line_id      uuid references public.order_lines(id) on delete restrict,
  reason             text,
  override_negative  boolean not null default false,
  idempotency_key    uuid not null unique,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  constraint chk_direction check (
    (type in ('receipt', 'return_in') and qty > 0) or
    (type in ('consumption', 'return_out', 'waste') and qty < 0) or
    (type = 'adjustment')
  ),
  constraint chk_receipt_line check ((type = 'receipt') = (purchase_line_id is not null)),
  constraint chk_consumption_line check (type <> 'consumption' or order_line_id is not null)
);
create index idx_stock_moves_material on public.stock_movements(material_id, created_at desc);
create index idx_stock_moves_order_line on public.stock_movements(order_line_id) where order_line_id is not null;
create index idx_stock_moves_business_date on public.stock_movements(business_id, created_at desc);
create trigger trg_stock_moves_immutable before update or delete on public.stock_movements
  for each row execute function app.forbid_change();

-- Applies a movement: updates on_hand and weighted-average cost, freezes cost,
-- and rolls material cost into the order line's cost record.
create or replace function app.stock_apply() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  m public.materials%rowtype;
  v_new_qty numeric(12,3);
  v_new_avg numeric(12,4);
begin
  select * into m from public.materials where id = new.material_id for update;
  if m.business_id <> new.business_id then
    raise exception 'Material belongs to another business' using errcode = '42501';
  end if;

  v_new_qty := m.on_hand + new.qty;
  if v_new_qty < 0 and not new.override_negative then
    raise exception 'Not enough stock of %: % % on hand, % needed',
      m.name, m.on_hand, m.unit, abs(new.qty) using errcode = 'P0001';
  end if;

  if new.qty > 0 and new.unit_cost is not null and new.type in ('receipt', 'return_in', 'adjustment') then
    -- Weighted average on incoming stock that carries a cost.
    if m.on_hand <= 0 then
      v_new_avg := new.unit_cost;
    else
      v_new_avg := round((m.on_hand * m.avg_cost + new.qty * new.unit_cost) / v_new_qty, 4);
    end if;
  else
    -- Outgoing (or cost-less incoming) stock moves at the current average.
    new.unit_cost := m.avg_cost;
    v_new_avg := m.avg_cost;
  end if;
  new.value := round(new.qty * new.unit_cost, 2);

  perform set_config('app.stock_write', 'on', true);
  update public.materials set on_hand = v_new_qty, avg_cost = v_new_avg where id = m.id;
  perform set_config('app.stock_write', 'off', true);

  if new.order_line_id is not null then
    insert into public.order_line_costs (line_id, business_id)
    values (new.order_line_id, new.business_id)
    on conflict (line_id) do nothing;
    -- Consumption has negative qty → negative value → adds cost.
    update public.order_line_costs
       set material_cost = material_cost - new.value, updated_at = now()
     where line_id = new.order_line_id;
  end if;
  return new;
end $$;
create trigger trg_stock_apply before insert on public.stock_movements
  for each row execute function app.stock_apply();
