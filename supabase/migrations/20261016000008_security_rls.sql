-- Sri Sri Boutique — 0008 Row Level Security, grants, and protective triggers
-- Deny by default: RLS is enabled on every table; anything without a policy is blocked.

-- ---------------------------------------------------------------------------
-- Protective triggers for columns RLS cannot protect
-- ---------------------------------------------------------------------------
create or replace function app.customers_guard() returns trigger
language plpgsql as $$
begin
  if new.customer_code is distinct from old.customer_code then
    raise exception 'Customer ID cannot change' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id
     and coalesce(current_setting('app.linking', true), '') <> 'on' then
    raise exception 'Portal logins are linked only through an invite' using errcode = '42501';
  end if;
  if new.business_id <> old.business_id then
    raise exception 'Cannot move records between businesses' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_customers_guard before update on public.customers
  for each row execute function app.customers_guard();

create or replace function app.materials_before_insert() returns trigger
language plpgsql as $$
begin
  new.on_hand := 0;     -- opening stock must be entered as a movement
  new.avg_cost := 0;
  return new;
end $$;
create trigger trg_materials_bi before insert on public.materials
  for each row execute function app.materials_before_insert();

-- business_id must never be changed on any tenant row.
create or replace function app.freeze_business_id() returns trigger
language plpgsql as $$
begin
  if new.business_id <> old.business_id then
    raise exception 'Cannot move records between businesses' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['workers', 'service_categories', 'services', 'suppliers', 'materials',
    'purchases', 'purchase_lines', 'expense_categories', 'expenses', 'deliveries', 'attachments']
  loop
    execute format('create trigger trg_%s_freeze_b before update on public.%I
                    for each row execute function app.freeze_business_id()', t, t);
  end loop;
end $$;

-- Child rows must belong to the same business as their parent.
create or replace function app.check_same_business() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_parent uuid;
begin
  case tg_table_name
    when 'measurement_sets' then select business_id into v_parent from customers where id = new.customer_id;
    when 'purchase_lines' then
      select business_id into v_parent from purchases where id = new.purchase_id;
      if (select business_id from materials where id = new.material_id) <> v_parent then
        raise exception 'Material belongs to another business' using errcode = '42501';
      end if;
    when 'purchases' then select business_id into v_parent from suppliers where id = new.supplier_id;
    when 'expenses' then select business_id into v_parent from expense_categories where id = new.category_id;
    when 'deliveries' then select business_id into v_parent from orders where id = new.order_id;
    when 'services' then
      v_parent := coalesce((select business_id from service_categories where id = new.category_id), new.business_id);
    else v_parent := new.business_id;
  end case;
  if v_parent is distinct from new.business_id then
    raise exception 'Linked record belongs to another business' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['measurement_sets', 'purchase_lines', 'purchases', 'expenses', 'deliveries', 'services']
  loop
    execute format('create trigger trg_%s_same_b before insert or update on public.%I
                    for each row execute function app.check_same_business()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Shorthand used below
-- T(b)   = owner or staff of b
-- P(b,x) = owner, or staff holding permission x

-- businesses -----------------------------------------------------------------
create policy businesses_select on public.businesses for select to authenticated
  using (app.role_in(id) is not null);
create policy businesses_update on public.businesses for update to authenticated
  using (app.has_perm(id, 'settings.manage')) with check (app.has_perm(id, 'settings.manage'));

-- profiles -------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.business_members m
    where m.user_id = profiles.id and m.role in ('owner', 'staff') and app.is_team(m.business_id)));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- membership -----------------------------------------------------------------
create policy members_select on public.business_members for select to authenticated
  using (user_id = auth.uid()
         or (role in ('owner', 'staff') and app.is_team(business_id))
         or app.has_any_perm(business_id, array['staff.manage', 'customers.manage']::permission_key[]));
create policy member_perms_select on public.member_permissions for select to authenticated
  using (exists (select 1 from public.business_members m where m.id = member_id
                 and (m.user_id = auth.uid() or app.has_perm(m.business_id, 'staff.manage'))));

-- customers ------------------------------------------------------------------
create policy customers_select on public.customers for select to authenticated
  using (user_id = auth.uid() or app.has_any_perm(business_id, array[
    'customers.manage', 'orders.manage', 'invoices.manage', 'payments.record', 'delivery.manage']::permission_key[]));
create policy customers_insert on public.customers for insert to authenticated
  with check (app.has_any_perm(business_id, array['customers.manage', 'orders.manage']::permission_key[]));
create policy customers_update on public.customers for update to authenticated
  using (app.has_perm(business_id, 'customers.manage')) with check (app.has_perm(business_id, 'customers.manage'));

create policy measurements_select on public.measurement_sets for select to authenticated
  using (app.has_any_perm(business_id, array['customers.manage', 'orders.manage']::permission_key[])
         or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = auth.uid()));
create policy measurements_insert on public.measurement_sets for insert to authenticated
  with check (app.has_any_perm(business_id, array['customers.manage', 'orders.manage']::permission_key[]));

-- workers & catalogue --------------------------------------------------------
create policy workers_select on public.workers for select to authenticated using (app.is_team(business_id));
create policy workers_write on public.workers for insert to authenticated
  with check (app.has_any_perm(business_id, array['orders.manage', 'settings.manage']::permission_key[]));
create policy workers_update on public.workers for update to authenticated
  using (app.has_any_perm(business_id, array['orders.manage', 'settings.manage']::permission_key[]))
  with check (app.has_any_perm(business_id, array['orders.manage', 'settings.manage']::permission_key[]));

create policy categories_select on public.service_categories for select to authenticated using (app.is_team(business_id));
create policy categories_insert on public.service_categories for insert to authenticated with check (app.has_perm(business_id, 'settings.manage'));
create policy categories_update on public.service_categories for update to authenticated
  using (app.has_perm(business_id, 'settings.manage')) with check (app.has_perm(business_id, 'settings.manage'));

create policy services_select on public.services for select to authenticated using (app.is_team(business_id));
create policy services_insert on public.services for insert to authenticated with check (app.has_perm(business_id, 'settings.manage'));
create policy services_update on public.services for update to authenticated
  using (app.has_perm(business_id, 'settings.manage')) with check (app.has_perm(business_id, 'settings.manage'));

-- orders (writes only through RPCs) -------------------------------------------
create policy orders_select on public.orders for select to authenticated
  using (app.has_any_perm(business_id, array['orders.manage', 'invoices.manage', 'payments.record',
    'delivery.manage', 'inventory.manage']::permission_key[]));
create policy order_lines_select on public.order_lines for select to authenticated
  using (app.has_any_perm(business_id, array['orders.manage', 'invoices.manage', 'payments.record',
    'delivery.manage', 'inventory.manage']::permission_key[]));
create policy order_history_select on public.order_status_history for select to authenticated
  using (app.has_any_perm(business_id, array['orders.manage', 'invoices.manage', 'delivery.manage']::permission_key[]));
create policy order_internal_select on public.order_internal for select to authenticated
  using (app.has_perm(business_id, 'orders.manage'));
create policy order_costs_select on public.order_line_costs for select to authenticated
  using (app.has_perm(business_id, 'finance.view'));

-- invoices & payments (writes only through RPCs) ------------------------------
create policy invoices_select on public.invoices for select to authenticated
  using (app.has_any_perm(business_id, array['invoices.manage', 'payments.record', 'orders.manage']::permission_key[]));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (app.has_any_perm(business_id, array['invoices.manage', 'payments.record', 'orders.manage']::permission_key[]));
create policy payments_select on public.payments for select to authenticated
  using (app.has_any_perm(business_id, array['payments.record', 'invoices.manage', 'finance.view']::permission_key[]));
create policy share_links_select on public.invoice_share_links for select to authenticated
  using (app.has_perm(business_id, 'invoices.manage'));

-- suppliers, materials, purchases ---------------------------------------------
create policy suppliers_select on public.suppliers for select to authenticated
  using (app.has_any_perm(business_id, array['purchasing.manage', 'inventory.manage', 'expenses.manage', 'finance.view']::permission_key[]));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (app.has_perm(business_id, 'purchasing.manage'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (app.has_perm(business_id, 'purchasing.manage')) with check (app.has_perm(business_id, 'purchasing.manage'));

create policy materials_select on public.materials for select to authenticated
  using (app.has_any_perm(business_id, array['inventory.manage', 'purchasing.manage', 'finance.view']::permission_key[]));
create policy materials_insert on public.materials for insert to authenticated
  with check (app.has_any_perm(business_id, array['inventory.manage', 'purchasing.manage']::permission_key[]));
create policy materials_update on public.materials for update to authenticated
  using (app.has_any_perm(business_id, array['inventory.manage', 'purchasing.manage']::permission_key[]))
  with check (app.has_any_perm(business_id, array['inventory.manage', 'purchasing.manage']::permission_key[]));

create policy purchases_select on public.purchases for select to authenticated
  using (app.has_any_perm(business_id, array['purchasing.manage', 'finance.view']::permission_key[]));
create policy purchases_insert on public.purchases for insert to authenticated
  with check (app.has_perm(business_id, 'purchasing.manage'));
create policy purchases_update on public.purchases for update to authenticated
  using (app.has_perm(business_id, 'purchasing.manage')) with check (app.has_perm(business_id, 'purchasing.manage'));
create policy purchases_delete on public.purchases for delete to authenticated
  using (app.has_perm(business_id, 'purchasing.manage'));

create policy purchase_lines_select on public.purchase_lines for select to authenticated
  using (app.has_any_perm(business_id, array['purchasing.manage', 'finance.view']::permission_key[]));
create policy purchase_lines_insert on public.purchase_lines for insert to authenticated
  with check (app.has_perm(business_id, 'purchasing.manage'));
create policy purchase_lines_update on public.purchase_lines for update to authenticated
  using (app.has_perm(business_id, 'purchasing.manage')) with check (app.has_perm(business_id, 'purchasing.manage'));
create policy purchase_lines_delete on public.purchase_lines for delete to authenticated
  using (app.has_perm(business_id, 'purchasing.manage'));

create policy supplier_payments_select on public.supplier_payments for select to authenticated
  using (app.has_any_perm(business_id, array['purchasing.manage', 'finance.view']::permission_key[]));
create policy stock_moves_select on public.stock_movements for select to authenticated
  using (app.has_any_perm(business_id, array['inventory.manage', 'purchasing.manage', 'finance.view']::permission_key[]));

-- expenses ---------------------------------------------------------------------
create policy expense_cats_select on public.expense_categories for select to authenticated
  using (app.has_any_perm(business_id, array['expenses.manage', 'finance.view']::permission_key[]));
create policy expense_cats_insert on public.expense_categories for insert to authenticated
  with check (app.has_perm(business_id, 'expenses.manage'));
create policy expenses_select on public.expenses for select to authenticated
  using (app.has_any_perm(business_id, array['expenses.manage', 'finance.view']::permission_key[]));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (app.has_perm(business_id, 'expenses.manage') and voided_at is null);
create policy expenses_update on public.expenses for update to authenticated
  using (app.has_perm(business_id, 'expenses.manage') and voided_at is null)
  with check (app.has_perm(business_id, 'expenses.manage'));

-- deliveries -------------------------------------------------------------------
create policy deliveries_select on public.deliveries for select to authenticated
  using (app.has_any_perm(business_id, array['delivery.manage', 'orders.manage']::permission_key[]));
create policy deliveries_insert on public.deliveries for insert to authenticated
  with check (app.has_any_perm(business_id, array['delivery.manage', 'orders.manage']::permission_key[]));
create policy deliveries_update on public.deliveries for update to authenticated
  using (app.has_any_perm(business_id, array['delivery.manage', 'orders.manage']::permission_key[]))
  with check (app.has_any_perm(business_id, array['delivery.manage', 'orders.manage']::permission_key[]));

-- attachments -------------------------------------------------------------------
create policy attachments_select on public.attachments for select to authenticated
  using (app.is_team(business_id) and (bucket <> 'receipts' or app.has_any_perm(business_id,
    array['finance.view', 'expenses.manage', 'purchasing.manage']::permission_key[])));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (app.is_team(business_id) and (bucket <> 'receipts' or app.has_any_perm(business_id,
    array['expenses.manage', 'purchasing.manage']::permission_key[])) and bucket <> 'invoices');
create policy attachments_update on public.attachments for update to authenticated
  using (app.has_perm(business_id, 'orders.manage')) with check (app.has_perm(business_id, 'orders.manage'));
create policy attachments_delete on public.attachments for delete to authenticated
  using (created_by = auth.uid() or app.is_owner(business_id));

-- notifications ---------------------------------------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (app.is_team(business_id) and (audience = 'team'
    or (audience = 'finance' and app.has_perm(business_id, 'finance.view'))
    or (audience = 'owner' and app.is_owner(business_id))));
create policy notification_reads_select on public.notification_reads for select to authenticated
  using (user_id = auth.uid());
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (user_id = auth.uid());

create policy message_shares_select on public.message_shares for select to authenticated
  using (app.has_any_perm(business_id, array['orders.manage', 'invoices.manage']::permission_key[]));
create policy invites_select on public.invites for select to authenticated
  using (app.has_perm(business_id, 'staff.manage')
         or (kind = 'customer' and app.has_perm(business_id, 'customers.manage')));
create policy audit_select on public.audit_log for select to authenticated
  using (app.is_owner(business_id));

-- ---------------------------------------------------------------------------
-- Grants (defence in depth on top of RLS)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke insert, update, delete on
  public.businesses, public.business_members, public.member_permissions, public.number_sequences,
  public.orders, public.order_lines, public.order_internal, public.order_line_costs, public.order_status_history,
  public.invoices, public.invoice_lines, public.payments, public.invoice_share_links, public.rate_limits,
  public.stock_movements, public.supplier_payments, public.audit_log, public.message_shares, public.invites,
  public.notifications
from authenticated;
grant update on public.businesses to authenticated;   -- settings page, still RLS-checked
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke update on public.measurement_sets from authenticated;
revoke delete on public.expenses, public.customers, public.measurement_sets from authenticated;
revoke all on public.rate_limits, public.number_sequences from authenticated;

-- Functions: nothing is executable by anon; app.* is internal except RLS helpers.
revoke all on all functions in schema app from public;
grant execute on function app.uid(), app.role_in(uuid), app.is_team(uuid), app.is_owner(uuid),
  app.has_perm(uuid, public.permission_key), app.has_any_perm(uuid, public.permission_key[])
  to authenticated, service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- Share-link opening and rate limiting are for the Edge Function only.
revoke execute on function public.open_shared_invoice(text) from authenticated;
revoke execute on function public.rate_limit_hit(text, int, int) from authenticated;
grant execute on function app.customer_invoice_payload(uuid) to service_role;
