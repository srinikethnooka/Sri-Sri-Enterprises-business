-- Sri Sri Boutique — 0004 Invoices, invoice lines, payments, share links

create table public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  invoice_no           text not null,
  order_id             uuid not null references public.orders(id) on delete restrict,
  customer_id          uuid not null references public.customers(id) on delete restrict,
  status               public.invoice_status not null default 'issued',
  issued_at            timestamptz not null default now(),
  items_subtotal       numeric(12,2) not null,
  order_discount       numeric(12,2) not null,
  delivery_charge      numeric(12,2) not null,
  taxable_amount       numeric(12,2) not null,
  tax_label            text,
  tax_rate             numeric(5,2) not null,
  tax_amount           numeric(12,2) not null,
  round_off            numeric(12,2) not null,
  total                numeric(12,2) not null check (total >= 0),
  -- Frozen copy of business, customer and order details exactly as issued.
  snapshot             jsonb not null,
  pdf_path             text,
  replaces_invoice_id  uuid references public.invoices(id),
  cancelled_at         timestamptz,
  cancelled_by         uuid,
  cancel_reason        text,
  idempotency_key      uuid unique,
  issued_by            uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  unique (business_id, invoice_no)
);
-- At most one live invoice per order.
create unique index uq_invoice_live_per_order on public.invoices(order_id) where status = 'issued';
create index idx_invoices_business_issued on public.invoices(business_id, issued_at desc);
create index idx_invoices_customer on public.invoices(customer_id, issued_at desc);

create table public.invoice_lines (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  invoice_id            uuid not null references public.invoices(id) on delete cascade,
  order_line_id         uuid references public.order_lines(id) on delete set null,
  position              int not null,
  description           text not null,
  qty                   numeric(12,3) not null,
  unit                  public.unit_kind not null,
  unit_price            numeric(12,2) not null,
  line_discount         numeric(12,2) not null,
  line_subtotal         numeric(12,2) not null
);
create index idx_invoice_lines_invoice on public.invoice_lines(invoice_id, position);
create trigger trg_invoice_lines_immutable before update or delete on public.invoice_lines
  for each row execute function app.forbid_change();

-- Issued invoices: only cancellation fields and pdf_path may change.
create or replace function app.invoices_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Invoices cannot be deleted. Cancel and reissue instead.' using errcode = '42501';
  end if;
  if (new.invoice_no, new.order_id, new.customer_id, new.issued_at, new.items_subtotal,
      new.order_discount, new.delivery_charge, new.taxable_amount, new.tax_rate,
      new.tax_amount, new.round_off, new.total, new.snapshot)
     is distinct from
     (old.invoice_no, old.order_id, old.customer_id, old.issued_at, old.items_subtotal,
      old.order_discount, old.delivery_charge, old.taxable_amount, old.tax_rate,
      old.tax_amount, old.round_off, old.total, old.snapshot) then
    raise exception 'Issued invoice amounts and details cannot be edited.' using errcode = '42501';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'A cancelled invoice cannot be reopened.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_invoices_guard before update or delete on public.invoices
  for each row execute function app.invoices_guard();
create trigger trg_invoices_audit after insert or update on public.invoices
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Payments: payments, refunds and reversals. Append-only.
-- signed_amount: +money received, -money returned. Balance uses signed_amount.
-- ---------------------------------------------------------------------------
create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  order_id             uuid not null references public.orders(id) on delete restrict,
  invoice_id           uuid references public.invoices(id) on delete restrict,
  customer_id          uuid not null references public.customers(id) on delete restrict,
  kind                 public.payment_kind not null,
  amount               numeric(12,2) not null check (amount > 0),
  signed_amount        numeric(12,2) not null,
  method               public.payment_method not null,
  reference_no         text,
  received_at          timestamptz not null default now(),
  note                 text,
  reverses_payment_id  uuid unique references public.payments(id),
  idempotency_key      uuid not null unique,
  recorded_by          uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  constraint chk_signed check (abs(signed_amount) = amount),
  constraint chk_reversal check ((kind = 'reversal') = (reverses_payment_id is not null))
);
create index idx_payments_order on public.payments(order_id);
create index idx_payments_business_received on public.payments(business_id, received_at desc);
create index idx_payments_customer on public.payments(customer_id);
create trigger trg_payments_immutable before update or delete on public.payments
  for each row execute function app.forbid_change();
create trigger trg_payments_audit after insert on public.payments
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Secure share links. Only a SHA-256 hash of the token is stored.
-- ---------------------------------------------------------------------------
create table public.invoice_share_links (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  token_hash      bytea not null unique,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  open_count      int not null default 0,
  last_opened_at  timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index idx_share_links_invoice on public.invoice_share_links(invoice_id);

-- Simple fixed-window rate limit store used by the share-link Edge Function.
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);
