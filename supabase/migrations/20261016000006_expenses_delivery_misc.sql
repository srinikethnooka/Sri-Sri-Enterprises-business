-- Sri Sri Boutique — 0006 Expenses, deliveries, attachments, notifications, message shares, invites

create table public.expense_categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  active       boolean not null default true,
  unique (business_id, name)
);

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  expense_date  date not null default (now() at time zone 'Asia/Kolkata')::date,
  category_id   uuid not null references public.expense_categories(id) on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  description   text not null check (length(trim(description)) between 1 and 300),
  method        public.payment_method not null default 'cash',
  supplier_id   uuid references public.suppliers(id) on delete set null,
  notes         text,
  voided_at     timestamptz,
  void_reason   text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_void check ((voided_at is null) = (void_reason is null))
);
create index idx_expenses_business_date on public.expenses(business_id, expense_date desc);
create trigger trg_expenses_touch before update on public.expenses
  for each row execute function app.touch_updated_at();
create trigger trg_expenses_audit after insert or update on public.expenses
  for each row execute function app.audit_row();
create or replace function app.expenses_no_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Expenses cannot be deleted. Void it with a reason instead.' using errcode = '42501';
end $$;
create trigger trg_expenses_no_delete before delete on public.expenses
  for each row execute function app.expenses_no_delete();

create table public.deliveries (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  order_id        uuid not null references public.orders(id) on delete cascade,
  method          public.delivery_method not null,
  status          public.delivery_status not null default 'pending',
  destination     text,
  contact_name    text,
  contact_phone   text,
  provider        text,          -- e.g. Rapido, DTDC; booked manually
  booking_ref     text,
  charge_to_shop  numeric(12,2) not null default 0 check (charge_to_shop >= 0),  -- what the shop pays the provider
  dispatched_at   timestamptz,
  delivered_at    timestamptz,
  notes           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_deliveries_order on public.deliveries(order_id);
create index idx_deliveries_business_status on public.deliveries(business_id, status);
create trigger trg_deliveries_touch before update on public.deliveries
  for each row execute function app.touch_updated_at();

-- Files in private Storage buckets. Path must start with '<business_id>/'.
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  bucket       text not null check (bucket in ('order-images', 'receipts', 'invoices', 'delivery-proofs')),
  path         text not null,
  entity_type  text not null check (entity_type in ('order', 'order_line', 'purchase', 'expense', 'delivery', 'invoice')),
  entity_id    uuid not null,
  visibility   public.attachment_visibility not null default 'internal',
  mime         text,
  size_bytes   bigint check (size_bytes is null or size_bytes <= 10485760),
  caption      text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (bucket, path),
  constraint chk_path_prefix check (split_part(path, '/', 1) = business_id::text)
);
create index idx_attachments_entity on public.attachments(entity_type, entity_id);

-- In-app notifications. dedupe_key prevents duplicate reminders.
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  entity_type  text,
  entity_id    uuid,
  audience     text not null default 'team' check (audience in ('team', 'finance', 'owner')),
  dedupe_key   text not null,
  created_at   timestamptz not null default now(),
  unique (business_id, dedupe_key)
);
create index idx_notifications_business on public.notifications(business_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- WhatsApp (manual) share attempts. Records that the owner OPENED WhatsApp,
-- never that a message was delivered.
create table public.message_shares (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  channel      text not null default 'whatsapp_manual' check (channel in ('whatsapp_manual', 'copy')),
  purpose      text not null check (purpose in ('invoice', 'order_confirmed', 'order_ready', 'payment_reminder', 'other')),
  order_id     uuid references public.orders(id) on delete set null,
  invoice_id   uuid references public.invoices(id) on delete set null,
  customer_id  uuid references public.customers(id) on delete set null,
  phone_e164   text,
  message_text text not null,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index idx_message_shares_order on public.message_shares(order_id);

-- Portal / staff invites (token hashed).
create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          text not null check (kind in ('staff', 'customer')),
  customer_id   uuid references public.customers(id) on delete cascade,
  email         text,
  display_name  text,
  permissions   public.permission_key[] not null default '{}',
  token_hash    bytea not null unique,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid,
  revoked_at    timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint chk_invite_customer check ((kind = 'customer') = (customer_id is not null))
);
