-- Sri Sri Boutique — 0007 Business logic RPCs
-- Every function: SECURITY DEFINER, fixed search_path, permission check first,
-- runs in the caller's single transaction, writes audit entries for money/stock.

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function app.new_token() returns text
language sql volatile as $$
  select replace(replace(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_')
$$;

create or replace function app.hash_token(t text) returns bytea
language sql immutable as $$ select extensions.digest(t, 'sha256') $$;

create or replace function app.money(v jsonb, field text, dflt numeric default 0) returns numeric
language plpgsql immutable as $$
declare r numeric;
begin
  if v ? field and jsonb_typeof(v->field) <> 'null' then
    r := (v->>field)::numeric;
  else
    r := dflt;
  end if;
  if r < 0 then
    raise exception '% cannot be negative', field using errcode = '22023';
  end if;
  return round(r, 2);
end $$;

-- ---------------------------------------------------------------------------
-- Business setup
-- ---------------------------------------------------------------------------
create or replace function public.create_business(p_name text, p_owner_name text default null,
  p_phone text default null, p_whatsapp text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_b uuid;
  v_cat uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from business_members where user_id = auth.uid() and role = 'owner') then
    raise exception 'You already own a business' using errcode = '23505';
  end if;

  insert into businesses (name, phone, whatsapp_e164, address)
  values (trim(p_name), nullif(trim(p_phone), ''), nullif(trim(p_whatsapp), ''), nullif(trim(p_address), ''))
  returning id into v_b;
  insert into business_members (business_id, user_id, role, display_name)
    values (v_b, auth.uid(), 'owner', p_owner_name);
  if p_owner_name is not null then
    update profiles set full_name = p_owner_name where id = auth.uid();
  end if;

  -- Starter catalogue (prices are suggestions; the owner edits them).
  insert into service_categories (business_id, name, sort) values
    (v_b, 'Stitching', 1), (v_b, 'Embroidery', 2), (v_b, 'Printing', 3),
    (v_b, 'Alterations', 4), (v_b, 'Materials', 5), (v_b, 'Other', 6);

  select id into v_cat from service_categories where business_id = v_b and name = 'Stitching';
  insert into services (business_id, category_id, name, default_price, unit) values
    (v_b, v_cat, 'Blouse stitching', 0, 'pcs'),
    (v_b, v_cat, 'Lining blouse stitching', 0, 'pcs'),
    (v_b, v_cat, 'Saree fall & pico', 0, 'pcs'),
    (v_b, v_cat, 'Lehenga stitching', 0, 'pcs'),
    (v_b, v_cat, 'Custom tailoring', 0, 'pcs');
  select id into v_cat from service_categories where business_id = v_b and name = 'Embroidery';
  insert into services (business_id, category_id, name, default_price, unit) values
    (v_b, v_cat, 'Maggam / Aari work', 0, 'pcs'),
    (v_b, v_cat, 'Mugam work', 0, 'pcs');
  select id into v_cat from service_categories where business_id = v_b and name = 'Printing';
  insert into services (business_id, category_id, name, default_price, unit) values
    (v_b, v_cat, 'DDF / DTF printing', 0, 'pcs');
  select id into v_cat from service_categories where business_id = v_b and name = 'Alterations';
  insert into services (business_id, category_id, name, default_price, unit) values
    (v_b, v_cat, 'Alteration', 0, 'pcs');
  select id into v_cat from service_categories where business_id = v_b and name = 'Materials';
  insert into services (business_id, category_id, name, default_price, unit) values
    (v_b, v_cat, 'Fabric / material sale', 0, 'm');

  insert into expense_categories (business_id, name) values
    (v_b, 'Rent'), (v_b, 'Electricity'), (v_b, 'Machine repairs'), (v_b, 'Transport & delivery'),
    (v_b, 'Packaging'), (v_b, 'Phone & internet'), (v_b, 'Salaries'), (v_b, 'Other');

  perform app.audit(v_b, 'create', 'businesses', v_b::text, null, jsonb_build_object('name', p_name));
  return v_b;
end $$;

-- ---------------------------------------------------------------------------
-- Staff permissions
-- ---------------------------------------------------------------------------
create or replace function public.set_member_permissions(p_member_id uuid, p_perms public.permission_key[])
returns void language plpgsql security definer set search_path = public, app as $$
declare
  m business_members%rowtype;
  v_before jsonb;
begin
  select * into m from business_members where id = p_member_id;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform app.require_perm(m.business_id, 'staff.manage');
  if m.role <> 'staff' then
    raise exception 'Permissions can only be set for staff' using errcode = '22023';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'You cannot change your own permissions' using errcode = '42501';
  end if;
  if ('finance.view' = any(p_perms) or 'staff.manage' = any(p_perms)
      or exists (select 1 from member_permissions where member_id = m.id
                 and permission in ('finance.view', 'staff.manage')))
     and not app.is_owner(m.business_id) then
    raise exception 'Only the owner can grant or remove finance.view or staff.manage' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(permission order by permission), '[]') into v_before
    from member_permissions where member_id = m.id;
  delete from member_permissions where member_id = m.id;
  insert into member_permissions (member_id, permission, granted_by)
    select m.id, p, auth.uid() from unnest(p_perms) as p group by p;
  perform app.audit(m.business_id, 'set_permissions', 'business_members', m.id::text,
    jsonb_build_object('permissions', v_before), jsonb_build_object('permissions', to_jsonb(p_perms)));
end $$;

create or replace function public.set_member_active(p_member_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, app as $$
declare m business_members%rowtype;
begin
  select * into m from business_members where id = p_member_id;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform app.require_perm(m.business_id, 'staff.manage');
  if m.role = 'owner' then raise exception 'The owner account cannot be deactivated' using errcode = '42501'; end if;
  update business_members set active = p_active where id = m.id;
  perform app.audit(m.business_id, case when p_active then 'activate' else 'deactivate' end,
    'business_members', m.id::text, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Invites (staff and customer portal). Returns the raw token ONCE.
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(
  p_business_id uuid, p_kind text, p_email text default null, p_display_name text default null,
  p_permissions public.permission_key[] default '{}', p_customer_id uuid default null, p_days int default 7)
returns text language plpgsql security definer set search_path = public, app as $$
declare v_token text := app.new_token();
begin
  if p_kind = 'staff' then
    perform app.require_perm(p_business_id, 'staff.manage');
    if ('finance.view' = any(p_permissions) or 'staff.manage' = any(p_permissions))
       and not app.is_owner(p_business_id) then
      raise exception 'Only the owner can grant finance.view or staff.manage' using errcode = '42501';
    end if;
  elsif p_kind = 'customer' then
    perform app.require_perm(p_business_id, 'customers.manage');
    if not exists (select 1 from customers where id = p_customer_id and business_id = p_business_id) then
      raise exception 'Customer not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from customers where id = p_customer_id and user_id is not null) then
      raise exception 'This customer already has a portal login' using errcode = '23505';
    end if;
    -- Revoke older open invites for the same customer.
    update invites set revoked_at = now()
     where customer_id = p_customer_id and accepted_at is null and revoked_at is null;
  else
    raise exception 'Unknown invite kind' using errcode = '22023';
  end if;

  insert into invites (business_id, kind, customer_id, email, display_name, permissions, token_hash, expires_at)
  values (p_business_id, p_kind, p_customer_id, lower(p_email), p_display_name,
          case when p_kind = 'staff' then p_permissions else '{}' end,
          app.hash_token(v_token), now() + make_interval(days => greatest(1, least(p_days, 30))));
  perform app.audit(p_business_id, 'create_invite', 'invites', p_kind, null,
    jsonb_build_object('email', p_email, 'customer_id', p_customer_id));
  return v_token;
end $$;

-- The signed-in user redeems an invite. Links customer logins only through
-- a server-issued token — never by a phone number the browser supplies.
create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  i invites%rowtype;
  v_member uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into i from invites where token_hash = app.hash_token(p_token) for update;
  if not found or i.revoked_at is not null or i.accepted_at is not null or i.expires_at < now() then
    raise exception 'This invite link is invalid or has expired. Ask the boutique for a new one.'
      using errcode = '42501';
  end if;
  if exists (select 1 from business_members where business_id = i.business_id and user_id = auth.uid()) then
    raise exception 'This account is already part of this boutique' using errcode = '23505';
  end if;

  insert into business_members (business_id, user_id, role, display_name)
  values (i.business_id, auth.uid(), i.kind::member_role, i.display_name)
  returning id into v_member;

  if i.kind = 'staff' then
    insert into member_permissions (member_id, permission, granted_by)
      select v_member, p, i.created_by from unnest(i.permissions) p group by p;
  else
    perform set_config('app.linking', 'on', true);
    update customers set user_id = auth.uid() where id = i.customer_id and user_id is null;
    if not found then
      raise exception 'This customer already has a portal login' using errcode = '23505';
    end if;
    perform set_config('app.linking', 'off', true);
  end if;

  update invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  perform app.audit(i.business_id, 'accept_invite', 'invites', i.id::text, null,
    jsonb_build_object('kind', i.kind, 'user', auth.uid()));
  return jsonb_build_object('business_id', i.business_id, 'role', i.kind);
end $$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create or replace function public.save_order(p jsonb)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_b uuid := (p->>'business_id')::uuid;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_customer uuid := (p->>'customer_id')::uuid;
  v_ms uuid := nullif(p->>'measurement_set_id', '')::uuid;
  v_worker uuid := nullif(p->>'assigned_worker_id', '')::uuid;
  o orders%rowtype;
  l jsonb;
  v_keep uuid[] := '{}';
  v_line_id uuid;
  v_pos int := 0;
  v_year text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  v_qty numeric; v_price numeric; v_disc numeric;
begin
  perform app.require_perm(v_b, 'orders.manage');

  if v_id is null and v_idem is not null then
    select id into v_id from orders where idempotency_key = v_idem and business_id = v_b;
    if v_id is not null then return v_id; end if;   -- duplicate submit
  end if;

  if not exists (select 1 from customers where id = v_customer and business_id = v_b) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  if v_ms is not null and not exists (
      select 1 from measurement_sets where id = v_ms and customer_id = v_customer) then
    raise exception 'Measurements do not belong to this customer' using errcode = '22023';
  end if;
  if v_worker is not null and not exists (select 1 from workers where id = v_worker and business_id = v_b) then
    raise exception 'Worker not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'Add at least one item' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'lines') > 100 then
    raise exception 'Too many items in one order (max 100)' using errcode = '22023';
  end if;

  if v_id is null then
    insert into orders (business_id, order_no, customer_id, idempotency_key)
    values (v_b, 'ORD-' || v_year || '-' || lpad(app.next_number(v_b, 'order', v_year)::text, 4, '0'),
            v_customer, v_idem)
    returning * into o;
    insert into order_internal (order_id, business_id) values (o.id, v_b);
    insert into order_status_history (business_id, order_id, from_status, to_status, note)
    values (v_b, o.id, null, 'draft', 'Order created');
  else
    select * into o from orders where id = v_id and business_id = v_b for update;
    if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
    if o.status in ('delivered', 'cancelled') then
      raise exception 'A % order cannot be edited', o.status using errcode = '42501';
    end if;
    if exists (select 1 from invoices where order_id = o.id and status = 'issued') then
      raise exception 'This order has an issued invoice. Cancel the invoice before editing.' using errcode = '42501';
    end if;
    if o.customer_id <> v_customer and exists (select 1 from payments where order_id = o.id) then
      raise exception 'Customer cannot change after payments are recorded' using errcode = '42501';
    end if;
  end if;

  update orders set
    customer_id        = v_customer,
    due_at             = nullif(p->>'due_at', '')::timestamptz,
    delivery_method    = coalesce(nullif(p->>'delivery_method', '')::delivery_method, 'pickup'),
    delivery_address   = nullif(p->>'delivery_address', ''),
    measurement_set_id = v_ms,
    assigned_worker_id = v_worker,
    customer_notes     = nullif(p->>'customer_notes', ''),
    order_discount     = app.money(p, 'order_discount'),
    delivery_charge    = app.money(p, 'delivery_charge')
  where id = o.id;

  update order_internal set
    priority       = coalesce(nullif(p->>'priority', '')::order_priority, 'normal'),
    internal_notes = nullif(p->>'internal_notes', ''),
    updated_at     = now()
  where order_id = o.id;

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_pos := v_pos + 1;
    v_qty := (l->>'qty')::numeric;
    v_price := app.money(l, 'unit_price');
    v_disc := app.money(l, 'line_discount');
    if v_qty is null or v_qty <= 0 then
      raise exception 'Item %: quantity must be more than 0', v_pos using errcode = '22023';
    end if;
    if v_disc > round(v_qty * v_price, 2) then
      raise exception 'Item %: discount is more than the item amount', v_pos using errcode = '22023';
    end if;
    if nullif(l->>'service_id', '') is not null and not exists (
        select 1 from services where id = (l->>'service_id')::uuid and business_id = v_b) then
      raise exception 'Item %: unknown service', v_pos using errcode = '22023';
    end if;

    v_line_id := nullif(l->>'id', '')::uuid;
    if v_line_id is not null then
      update order_lines set
        position = v_pos,
        service_id = nullif(l->>'service_id', '')::uuid,
        description = trim(l->>'description'),
        customer_description = nullif(l->>'customer_description', ''),
        garment_details = nullif(l->>'garment_details', ''),
        qty = v_qty,
        unit = coalesce(nullif(l->>'unit', '')::unit_kind, 'pcs'),
        unit_price = v_price,
        line_discount = v_disc,
        internal_notes = nullif(l->>'internal_notes', '')
      where id = v_line_id and order_id = o.id;
      if not found then raise exception 'Item %: line not found on this order', v_pos using errcode = 'P0002'; end if;
    else
      insert into order_lines (business_id, order_id, position, service_id, description,
        customer_description, garment_details, qty, unit, unit_price, line_discount, internal_notes)
      values (v_b, o.id, v_pos, nullif(l->>'service_id', '')::uuid, trim(l->>'description'),
        nullif(l->>'customer_description', ''), nullif(l->>'garment_details', ''), v_qty,
        coalesce(nullif(l->>'unit', '')::unit_kind, 'pcs'), v_price, v_disc,
        nullif(l->>'internal_notes', ''))
      returning id into v_line_id;
      insert into order_line_costs (line_id, business_id) values (v_line_id, v_b);
    end if;
    v_keep := v_keep || v_line_id;
  end loop;

  begin
    delete from order_lines where order_id = o.id and id <> all(v_keep);
  exception when foreign_key_violation then
    raise exception 'An item you removed already has materials used against it. Return the materials first.'
      using errcode = '42501';
  end;

  perform app.recalc_order(o.id);
  perform app.audit(v_b, case when v_id is null then 'create' else 'update' end, 'orders', o.id::text,
    null, (select to_jsonb(x) from orders x where x.id = o.id));
  return o.id;
end $$;

create or replace function public.change_order_status(p_order_id uuid, p_to public.order_status, p_note text default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;

  -- Delivery staff may move orders through dispatch/delivery; everything else needs orders.manage.
  if p_to in ('out_for_delivery', 'delivered') then
    if not app.has_any_perm(o.business_id, array['orders.manage', 'delivery.manage']::permission_key[]) then
      raise exception 'You do not have permission to update delivery status' using errcode = '42501';
    end if;
  else
    perform app.require_perm(o.business_id, 'orders.manage');
  end if;

  if not app.status_transition_ok(o.status, p_to) then
    raise exception 'Cannot move an order from % to %', o.status, p_to using errcode = '22023';
  end if;
  if p_to = 'confirmed' and not exists (select 1 from order_lines where order_id = o.id) then
    raise exception 'Add at least one item before confirming' using errcode = '22023';
  end if;
  if p_to = 'cancelled' then
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Give a reason for cancelling' using errcode = '22023';
    end if;
    if exists (select 1 from invoices where order_id = o.id and status = 'issued') then
      raise exception 'Cancel the invoice first, then cancel the order' using errcode = '42501';
    end if;
    update orders set cancelled_reason = p_note where id = o.id;
  end if;

  update orders set status = p_to where id = o.id;
  insert into order_status_history (business_id, order_id, from_status, to_status, note)
  values (o.business_id, o.id, o.status, p_to, p_note);
end $$;

create or replace function public.set_line_costs(p_line_id uuid, p_labour numeric, p_other numeric, p_complete boolean)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_b uuid; v_before jsonb;
begin
  select business_id into v_b from order_lines where id = p_line_id;
  if v_b is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  perform app.require_perm(v_b, 'finance.view');
  if p_labour < 0 or p_other < 0 then raise exception 'Costs cannot be negative' using errcode = '22023'; end if;

  insert into order_line_costs (line_id, business_id) values (p_line_id, v_b) on conflict do nothing;
  select to_jsonb(c) into v_before from order_line_costs c where line_id = p_line_id;
  update order_line_costs set labour_cost = round(p_labour, 2), other_cost = round(p_other, 2),
    costs_complete = p_complete, updated_by = auth.uid(), updated_at = now()
  where line_id = p_line_id;
  perform app.audit(v_b, 'set_costs', 'order_line_costs', p_line_id::text, v_before,
    (select to_jsonb(c) from order_line_costs c where line_id = p_line_id));
end $$;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(p_order_id uuid, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  o orders%rowtype;
  b businesses%rowtype;
  c customers%rowtype;
  v_inv uuid;
  v_no text;
  v_fy text;
  v_prev uuid;
  v_snapshot jsonb;
begin
  select id into v_inv from invoices where idempotency_key = p_idempotency_key;
  if v_inv is not null then return v_inv; end if;

  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_perm(o.business_id, 'invoices.manage');
  select id into v_inv from invoices where idempotency_key = p_idempotency_key;
  if v_inv is not null then return v_inv; end if;

  if o.status in ('draft', 'cancelled') then
    raise exception 'Confirm the order before issuing an invoice' using errcode = '22023';
  end if;
  if exists (select 1 from invoices where order_id = o.id and status = 'issued') then
    raise exception 'This order already has an issued invoice' using errcode = '23505';
  end if;

  perform app.recalc_order(o.id);           -- never trust stale totals
  select * into o from orders where id = p_order_id;
  select * into b from businesses where id = o.business_id;
  select * into c from customers where id = o.customer_id;

  v_fy := app.fy_label(now(), b.timezone);
  v_no := b.invoice_prefix || '/' || v_fy || '/' || lpad(app.next_number(b.id, 'invoice', v_fy)::text, 4, '0');

  select id into v_prev from invoices where order_id = o.id and status = 'cancelled'
    order by cancelled_at desc limit 1;

  v_snapshot := jsonb_build_object(
    'business', jsonb_build_object('name', b.name, 'address', b.address, 'phone', b.phone,
       'whatsapp', b.whatsapp_e164,
       'email', b.email, 'gstin', b.gstin, 'logo_path', b.logo_path,
       'payment_instructions', b.payment_instructions, 'footer', b.invoice_footer),
    'customer', jsonb_build_object('name', c.full_name, 'code', c.customer_code,
       'phone', c.phone_e164, 'address', c.address),
    'order', jsonb_build_object('order_no', o.order_no, 'order_date', o.order_date,
       'due_at', o.due_at, 'delivery_method', o.delivery_method, 'notes', o.customer_notes)
  );

  insert into invoices (business_id, invoice_no, order_id, customer_id, items_subtotal, order_discount,
    delivery_charge, taxable_amount, tax_label, tax_rate, tax_amount, round_off, total, snapshot,
    replaces_invoice_id, idempotency_key)
  values (b.id, v_no, o.id, o.customer_id, o.items_subtotal, o.order_discount, o.delivery_charge,
    o.taxable_amount, case when b.tax_enabled then b.tax_label end, o.tax_rate, o.tax_amount,
    o.round_off, o.total, v_snapshot, v_prev, p_idempotency_key)
  returning id into v_inv;

  insert into invoice_lines (business_id, invoice_id, order_line_id, position, description, qty, unit,
    unit_price, line_discount, line_subtotal)
  select b.id, v_inv, l.id, l.position, coalesce(nullif(l.customer_description, ''), l.description),
    l.qty, l.unit, l.unit_price, l.line_discount, l.line_subtotal
  from order_lines l where l.order_id = o.id order by l.position;

  -- Payments are append-only and linked by order_id, so advances taken before
  -- the invoice automatically count towards it.
  return v_inv;
end $$;

create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare i invoices%rowtype;
begin
  select * into i from invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_perm(i.business_id, 'invoices.manage');
  if i.status = 'cancelled' then raise exception 'Invoice is already cancelled' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling' using errcode = '22023'; end if;
  update invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = p_reason where id = i.id;
  update invoice_share_links set revoked_at = now() where invoice_id = i.id and revoked_at is null;
end $$;

create or replace function public.set_invoice_pdf_path(p_invoice_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public, app as $$
declare i invoices%rowtype;
begin
  select * into i from invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_perm(i.business_id, 'invoices.manage');
  if split_part(p_path, '/', 1) <> i.business_id::text then
    raise exception 'Invalid path' using errcode = '22023';
  end if;
  update invoices set pdf_path = p_path where id = i.id;
end $$;

-- ---------------------------------------------------------------------------
-- Share links
-- ---------------------------------------------------------------------------
create or replace function public.create_share_link(p_invoice_id uuid, p_days int default null)
returns text language plpgsql security definer set search_path = public, app as $$
declare
  i invoices%rowtype;
  v_token text := app.new_token();
  v_days int;
begin
  select * into i from invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_perm(i.business_id, 'invoices.manage');
  if i.status <> 'issued' then raise exception 'Cancelled invoices cannot be shared' using errcode = '22023'; end if;
  select coalesce(p_days, share_link_days) into v_days from businesses where id = i.business_id;
  insert into invoice_share_links (business_id, invoice_id, token_hash, expires_at)
  values (i.business_id, i.id, app.hash_token(v_token), now() + make_interval(days => greatest(1, least(v_days, 365))));
  return v_token;
end $$;

create or replace function public.revoke_share_link(p_link_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_b uuid;
begin
  select business_id into v_b from invoice_share_links where id = p_link_id;
  if v_b is null then raise exception 'Link not found' using errcode = 'P0002'; end if;
  perform app.require_perm(v_b, 'invoices.manage');
  update invoice_share_links set revoked_at = now() where id = p_link_id and revoked_at is null;
end $$;

-- Called ONLY by the open-share-link Edge Function (service_role).
create or replace function app.customer_invoice_payload(p_invoice_id uuid)
returns jsonb language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', i.id, 'invoice_no', i.invoice_no, 'status', i.status, 'issued_at', i.issued_at,
      'items_subtotal', i.items_subtotal, 'order_discount', i.order_discount,
      'delivery_charge', i.delivery_charge, 'taxable_amount', i.taxable_amount,
      'tax_label', i.tax_label, 'tax_rate', i.tax_rate, 'tax_amount', i.tax_amount,
      'round_off', i.round_off, 'total', i.total, 'snapshot', i.snapshot, 'pdf_path', i.pdf_path),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'description', il.description, 'qty', il.qty, 'unit', il.unit, 'unit_price', il.unit_price,
        'line_discount', il.line_discount, 'line_subtotal', il.line_subtotal) order by il.position)
      from invoice_lines il where il.invoice_id = i.id), '[]'),
    'paid', coalesce((select sum(signed_amount) from payments p where p.order_id = i.order_id), 0),
    'balance', i.total - coalesce((select sum(signed_amount) from payments p where p.order_id = i.order_id), 0),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', p.kind, 'amount', p.signed_amount, 'method', p.method, 'received_at', p.received_at)
        order by p.received_at) from payments p where p.order_id = i.order_id), '[]'),
    'business_id', i.business_id,
    'order_status', (select status from orders where id = i.order_id),
    'due_at', (select due_at from orders where id = i.order_id)
  )
  from invoices i where i.id = p_invoice_id
$$;

create or replace function public.open_shared_invoice(p_token text)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare s invoice_share_links%rowtype;
begin
  select * into s from invoice_share_links where token_hash = app.hash_token(p_token) for update;
  if not found or s.revoked_at is not null or s.expires_at < now() then
    return null;    -- same answer for unknown, revoked and expired: reveals nothing
  end if;
  if (select status from invoices where id = s.invoice_id) <> 'issued' then
    return null;
  end if;
  update invoice_share_links set open_count = open_count + 1, last_opened_at = now() where id = s.id;
  return app.customer_invoice_payload(s.invoice_id);
end $$;

-- Fixed-window rate limiter used by Edge Functions.
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;
  delete from rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_order_id uuid, p_kind public.payment_kind, p_amount numeric, p_method public.payment_method,
  p_idempotency_key uuid, p_reference_no text default null, p_received_at timestamptz default null,
  p_note text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  o orders%rowtype;
  v_existing payments%rowtype;
  v_paid numeric;
  v_inv uuid;
  v_id uuid;
  v_amt numeric := round(p_amount, 2);
begin
  select * into v_existing from payments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id <> p_order_id then
      raise exception 'Duplicate request key' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_perm(o.business_id, 'payments.record');

  if p_kind = 'reversal' then raise exception 'Use reverse_payment for reversals' using errcode = '22023'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be more than 0' using errcode = '22023'; end if;
  if v_amt > 10000000 then raise exception 'Amount is too large' using errcode = '22023'; end if;
  if p_received_at is not null and p_received_at > now() + interval '1 day' then
    raise exception 'Payment date cannot be in the future' using errcode = '22023';
  end if;

  select coalesce(sum(signed_amount), 0) into v_paid from payments where order_id = o.id;

  if p_kind = 'payment' then
    if o.status = 'cancelled' then
      raise exception 'Cannot take payment on a cancelled order' using errcode = '22023';
    end if;
    if v_paid + v_amt > o.total then
      raise exception 'This is more than the balance due (₹%)', o.total - v_paid using errcode = '22023';
    end if;
  elsif p_kind = 'refund' then
    if v_amt > v_paid then
      raise exception 'Refund is more than the amount collected (₹%)', v_paid using errcode = '22023';
    end if;
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Give a reason for the refund' using errcode = '22023';
    end if;
  end if;

  -- Re-check after taking the order lock: a parallel double-tap may have just committed.
  select id into v_id from payments where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  select id into v_inv from invoices where order_id = o.id and status = 'issued';
  insert into payments (business_id, order_id, invoice_id, customer_id, kind, amount, signed_amount,
    method, reference_no, received_at, note, idempotency_key)
  values (o.business_id, o.id, v_inv, o.customer_id, p_kind, v_amt,
    case when p_kind = 'payment' then v_amt else -v_amt end,
    p_method, nullif(trim(p_reference_no), ''), coalesce(p_received_at, now()), p_note, p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.reverse_payment(p_payment_id uuid, p_reason text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  p payments%rowtype;
  v_id uuid;
begin
  select id into v_id from payments where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  select * into p from payments where id = p_payment_id;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  perform app.require_perm(p.business_id, 'payments.record');
  perform 1 from orders where id = p.order_id for update;
  if p.kind = 'reversal' then raise exception 'A reversal cannot be reversed' using errcode = '22023'; end if;
  if exists (select 1 from payments where reverses_payment_id = p.id) then
    raise exception 'This entry is already reversed' using errcode = '23505';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason' using errcode = '22023'; end if;

  insert into payments (business_id, order_id, invoice_id, customer_id, kind, amount, signed_amount,
    method, reference_no, received_at, note, reverses_payment_id, idempotency_key)
  values (p.business_id, p.order_id, p.invoice_id, p.customer_id, 'reversal', p.amount, -p.signed_amount,
    p.method, p.reference_no, now(), p_reason, p.id, p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
create or replace function public.receive_purchase(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  pu purchases%rowtype;
  pl purchase_lines%rowtype;
  v_factor numeric;
begin
  select * into pu from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found' using errcode = 'P0002'; end if;
  perform app.require_perm(pu.business_id, 'purchasing.manage');
  if pu.status = 'received' then return; end if;   -- idempotent: already received, do nothing
  if pu.status <> 'draft' then raise exception 'Purchase is cancelled' using errcode = '22023'; end if;
  if not exists (select 1 from purchase_lines where purchase_id = pu.id) then
    raise exception 'Add at least one item to the purchase' using errcode = '22023';
  end if;

  -- Landed cost: spread discount and other charges over lines by value.
  v_factor := case when pu.lines_total > 0
                   then (pu.lines_total - pu.discount + pu.other_charges) / pu.lines_total
                   else 1 end;

  for pl in select * from purchase_lines where purchase_id = pu.id loop
    insert into stock_movements (business_id, material_id, type, qty, unit_cost, purchase_line_id,
      reason, idempotency_key)
    values (pu.business_id, pl.material_id, 'receipt', pl.qty, round(pl.unit_cost * v_factor, 4), pl.id,
      'Purchase ' || pu.purchase_no, gen_random_uuid());
  end loop;

  perform set_config('app.stock_write', 'on', true);
  update purchases set status = 'received', received_at = now() where id = pu.id;
  perform set_config('app.stock_write', 'off', true);
  perform app.audit(pu.business_id, 'receive', 'purchases', pu.id::text, null, jsonb_build_object('total', pu.total));
end $$;

create or replace function public.cancel_purchase(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare pu purchases%rowtype;
begin
  select * into pu from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found' using errcode = 'P0002'; end if;
  perform app.require_perm(pu.business_id, 'purchasing.manage');
  if pu.status <> 'draft' then
    raise exception 'Only draft purchases can be cancelled. Record a stock return instead.' using errcode = '22023';
  end if;
  perform set_config('app.stock_write', 'on', true);
  update purchases set status = 'cancelled' where id = pu.id;
  perform set_config('app.stock_write', 'off', true);
end $$;

create or replace function public.consume_material(
  p_order_line_id uuid, p_material_id uuid, p_qty numeric, p_idempotency_key uuid,
  p_override boolean default false, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_b uuid;
  v_status order_status;
  v_mode text;
  v_id uuid;
begin
  select id into v_id from stock_movements where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  select l.business_id, o.status into v_b, v_status
    from order_lines l join orders o on o.id = l.order_id where l.id = p_order_line_id;
  if v_b is null then raise exception 'Order item not found' using errcode = 'P0002'; end if;
  perform app.require_perm(v_b, 'inventory.manage');
  if v_status = 'cancelled' then raise exception 'Order is cancelled' using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than 0' using errcode = '22023'; end if;
  if not exists (select 1 from materials where id = p_material_id and business_id = v_b and active) then
    raise exception 'Material not found' using errcode = 'P0002';
  end if;

  select stock_shortage_mode into v_mode from businesses where id = v_b;
  if p_override and (v_mode = 'block' or not app.is_owner(v_b)) then
    raise exception 'Only the owner can approve using more than the stock on hand' using errcode = '42501';
  end if;

  insert into stock_movements (business_id, material_id, type, qty, order_line_id, reason,
    override_negative, idempotency_key)
  values (v_b, p_material_id, 'consumption', -p_qty, p_order_line_id, p_reason, p_override, p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

-- Waste, adjustments and returns. For return_in with an order line, cost flows back off the order.
create or replace function public.adjust_stock(
  p_material_id uuid, p_type public.stock_movement_type, p_qty numeric, p_reason text,
  p_idempotency_key uuid, p_unit_cost numeric default null, p_order_line_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_b uuid;
  v_id uuid;
  v_signed numeric;
begin
  select id into v_id from stock_movements where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  select business_id into v_b from materials where id = p_material_id;
  if v_b is null then raise exception 'Material not found' using errcode = 'P0002'; end if;
  perform app.require_perm(v_b, 'inventory.manage');
  if p_type in ('receipt', 'consumption') then
    raise exception 'Use Receive purchase or Use material for this' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason' using errcode = '22023'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'Quantity cannot be 0' using errcode = '22023'; end if;
  if p_unit_cost is not null and p_unit_cost < 0 then raise exception 'Cost cannot be negative' using errcode = '22023'; end if;
  if p_order_line_id is not null and not exists (
      select 1 from order_lines where id = p_order_line_id and business_id = v_b) then
    raise exception 'Order item not found' using errcode = 'P0002';
  end if;
  if p_order_line_id is not null and p_type = 'return_in' and abs(p_qty) > coalesce((
      select -sum(qty) from stock_movements
      where order_line_id = p_order_line_id and material_id = p_material_id), 0) then
    raise exception 'Cannot return more than was used on this item' using errcode = '22023';
  end if;

  v_signed := case
    when p_type = 'return_in' then abs(p_qty)
    when p_type in ('return_out', 'waste') then -abs(p_qty)
    else p_qty end;

  insert into stock_movements (business_id, material_id, type, qty, unit_cost, order_line_id, reason, idempotency_key)
  values (v_b, p_material_id, p_type, v_signed,
          case when p_type in ('adjustment') and v_signed > 0 then p_unit_cost end,
          p_order_line_id, p_reason, p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.record_supplier_payment(
  p_supplier_id uuid, p_amount numeric, p_method public.payment_method, p_idempotency_key uuid,
  p_purchase_id uuid default null, p_reference_no text default null, p_paid_at timestamptz default null,
  p_note text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_b uuid; v_id uuid;
begin
  select id into v_id from supplier_payments where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;
  select business_id into v_b from suppliers where id = p_supplier_id;
  if v_b is null then raise exception 'Supplier not found' using errcode = 'P0002'; end if;
  perform app.require_perm(v_b, 'purchasing.manage');
  if p_amount is null or p_amount = 0 then raise exception 'Amount cannot be 0' using errcode = '22023'; end if;
  if p_amount < 0 and coalesce(trim(p_note), '') = '' then
    raise exception 'Give a reason for a negative (reversal) entry' using errcode = '22023';
  end if;
  if p_purchase_id is not null and not exists (
      select 1 from purchases where id = p_purchase_id and supplier_id = p_supplier_id) then
    raise exception 'Purchase does not belong to this supplier' using errcode = '22023';
  end if;
  insert into supplier_payments (business_id, supplier_id, purchase_id, amount, method, reference_no,
    paid_at, note, idempotency_key)
  values (v_b, p_supplier_id, p_purchase_id, round(p_amount, 2), p_method, p_reference_no,
    coalesce(p_paid_at, now()), p_note, p_idempotency_key)
  returning id into v_id;
  perform app.audit(v_b, 'create', 'supplier_payments', v_id::text, null,
    jsonb_build_object('amount', p_amount, 'supplier', p_supplier_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Expenses: void instead of delete
-- ---------------------------------------------------------------------------
create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_b uuid;
begin
  select business_id into v_b from expenses where id = p_expense_id;
  if v_b is null then raise exception 'Expense not found' using errcode = 'P0002'; end if;
  perform app.require_perm(v_b, 'expenses.manage');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason' using errcode = '22023'; end if;
  update expenses set voided_at = now(), void_reason = p_reason where id = p_expense_id and voided_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- WhatsApp share log (an attempt, never a delivery)
-- ---------------------------------------------------------------------------
create or replace function public.log_message_share(
  p_business_id uuid, p_purpose text, p_message text, p_phone text,
  p_order_id uuid default null, p_invoice_id uuid default null, p_channel text default 'whatsapp_manual')
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_customer uuid;
begin
  if not app.has_any_perm(p_business_id, array['orders.manage', 'invoices.manage', 'delivery.manage']::permission_key[]) then
    raise exception 'No permission' using errcode = '42501';
  end if;
  if p_order_id is not null then
    select customer_id into v_customer from orders where id = p_order_id and business_id = p_business_id;
    if v_customer is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  end if;
  if p_invoice_id is not null and not exists (
      select 1 from invoices where id = p_invoice_id and business_id = p_business_id) then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  insert into message_shares (business_id, channel, purpose, order_id, invoice_id, customer_id, phone_e164, message_text)
  values (p_business_id, p_channel, p_purpose, p_order_id, p_invoice_id, v_customer, p_phone, left(p_message, 4000))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications: generate in-app alerts (deduplicated). Safe to call often.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_notifications(p_business_id uuid)
returns int language plpgsql security definer set search_path = public, app as $$
declare
  v_count int := 0;
  v_n int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not app.is_team(p_business_id) then raise exception 'No permission' using errcode = '42501'; end if;

  insert into notifications (business_id, type, title, body, entity_type, entity_id, audience, dedupe_key)
  select o.business_id, 'order_overdue', 'Overdue: ' || o.order_no,
         c.full_name || ' — was due ' || to_char(o.due_at at time zone 'Asia/Kolkata', 'DD Mon'),
         'order', o.id, 'team', 'overdue:' || o.id
  from orders o join customers c on c.id = o.customer_id
  where o.business_id = p_business_id and o.due_at < now()
    and o.status not in ('ready', 'out_for_delivery', 'delivered', 'cancelled', 'draft')
  on conflict do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  insert into notifications (business_id, type, title, body, entity_type, entity_id, audience, dedupe_key)
  select o.business_id, 'order_due_soon', 'Due soon: ' || o.order_no,
         c.full_name || ' — due ' || to_char(o.due_at at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM'),
         'order', o.id, 'team', 'duesoon:' || o.id || ':' || v_today
  from orders o join customers c on c.id = o.customer_id
  where o.business_id = p_business_id and o.due_at between now() and now() + interval '2 days'
    and o.status not in ('ready', 'out_for_delivery', 'delivered', 'cancelled', 'draft')
  on conflict do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  insert into notifications (business_id, type, title, body, entity_type, entity_id, audience, dedupe_key)
  select m.business_id, 'low_stock', 'Low stock: ' || m.name,
         m.on_hand || ' ' || m.unit || ' left (reorder at ' || m.reorder_level || ')',
         'material', m.id, 'team', 'lowstock:' || m.id || ':' || v_today
  from materials m
  where m.business_id = p_business_id and m.active and m.reorder_level > 0 and m.on_hand <= m.reorder_level
  on conflict do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  insert into notifications (business_id, type, title, body, entity_type, entity_id, audience, dedupe_key)
  select pu.business_id, 'supplier_due', 'Supplier payment due: ' || s.name,
         pu.purchase_no || ' due ' || to_char(pu.due_date, 'DD Mon'),
         'purchase', pu.id, 'finance', 'supplierdue:' || pu.id
  from purchases pu join suppliers s on s.id = pu.supplier_id
  where pu.business_id = p_business_id and pu.status = 'received' and pu.due_date <= v_today + 3
    and pu.total > coalesce((select sum(amount) from supplier_payments sp where sp.purchase_id = pu.id), 0)
  on conflict do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  return v_count;
end $$;
