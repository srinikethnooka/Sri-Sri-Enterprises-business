-- Sri Sri Boutique — 0009 Views, dashboard, reports, exports, customer portal, storage
-- Accounting definitions are documented in docs/ACCOUNTING.md and mirrored in comments here.

-- ---------------------------------------------------------------------------
-- Staff views (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create view public.v_order_balances with (security_invoker = true) as
select o.id as order_id, o.business_id, o.order_no, o.customer_id, c.full_name as customer_name, o.status, o.total,
       coalesce(p.paid, 0) as paid,
       o.total - coalesce(p.paid, 0) as balance,
       i.id as invoice_id, i.invoice_no, i.issued_at
from public.orders o
join public.customers c on c.id = o.customer_id
left join (select order_id, sum(signed_amount) as paid from public.payments group by order_id) p on p.order_id = o.id
left join public.invoices i on i.order_id = o.id and i.status = 'issued';

create view public.v_customer_balances with (security_invoker = true) as
select c.id as customer_id, c.business_id, c.customer_code, c.full_name, c.phone_e164,
       coalesce(inv.invoiced, 0) as invoiced,
       coalesce(pay.paid, 0) as paid,
       coalesce(inv.outstanding, 0) as outstanding,
       coalesce(inv.invoice_count, 0) as invoice_count
from public.customers c
left join (
  select i.customer_id, sum(i.total) as invoiced, count(*) as invoice_count,
         sum(i.total - coalesce(op.paid, 0)) as outstanding
  from public.invoices i
  left join (select order_id, sum(signed_amount) as paid from public.payments group by order_id) op
    on op.order_id = i.order_id
  where i.status = 'issued'
  group by i.customer_id) inv on inv.customer_id = c.id
left join (select customer_id, sum(signed_amount) as paid from public.payments group by customer_id) pay
  on pay.customer_id = c.id;

create view public.v_material_stock with (security_invoker = true) as
select m.id, m.business_id, m.code, m.name, m.category, m.unit, m.on_hand, m.reorder_level, m.avg_cost,
       round(greatest(m.on_hand, 0) * m.avg_cost, 2) as stock_value,
       (m.reorder_level > 0 and m.on_hand <= m.reorder_level) as is_low,
       greatest(m.reorder_level * 2 - m.on_hand, 0) as suggested_reorder_qty,
       s.name as default_supplier
from public.materials m
left join public.suppliers s on s.id = m.default_supplier_id
where m.active;

create view public.v_supplier_balances with (security_invoker = true) as
select s.id as supplier_id, s.business_id, s.name,
       coalesce((select sum(total) from public.purchases p where p.supplier_id = s.id and p.status = 'received'), 0) as purchased,
       coalesce((select sum(amount) from public.supplier_payments sp where sp.supplier_id = s.id), 0) as paid,
       coalesce((select sum(total) from public.purchases p where p.supplier_id = s.id and p.status = 'received'), 0)
       - coalesce((select sum(amount) from public.supplier_payments sp where sp.supplier_id = s.id), 0) as balance
from public.suppliers s;

grant select on public.v_order_balances, public.v_customer_balances, public.v_material_stock,
  public.v_supplier_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard (role-aware: money only for those allowed to see it)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_business_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  r jsonb := '{}'::jsonb;
  v_orders boolean := app.has_any_perm(p_business_id, array['orders.manage', 'invoices.manage', 'delivery.manage', 'payments.record']::permission_key[]);
  v_money boolean := app.has_any_perm(p_business_id, array['payments.record', 'invoices.manage', 'finance.view']::permission_key[]);
  v_fin boolean := app.has_perm(p_business_id, 'finance.view');
  v_inv boolean := app.has_any_perm(p_business_id, array['inventory.manage', 'purchasing.manage', 'finance.view']::permission_key[]);
begin
  if not app.is_team(p_business_id) then raise exception 'No permission' using errcode = '42501'; end if;
  if p_to < p_from then raise exception 'End date is before start date' using errcode = '22023'; end if;

  r := jsonb_build_object('permissions', jsonb_build_object('orders', v_orders, 'money', v_money,
                           'finance', v_fin, 'inventory', v_inv));

  if v_orders then
    r := r || jsonb_build_object(
      'orders_today', (select count(*) from orders where business_id = p_business_id and order_date = v_today and status <> 'cancelled'),
      'in_progress', (select count(*) from orders where business_id = p_business_id and status in ('confirmed', 'in_progress', 'quality_check')),
      'waiting_materials', (select count(*) from orders where business_id = p_business_id and status = 'waiting_materials'),
      'ready', (select count(*) from orders where business_id = p_business_id and status = 'ready'),
      'due_today', (select count(*) from orders where business_id = p_business_id
                      and (due_at at time zone 'Asia/Kolkata')::date = v_today
                      and status not in ('delivered', 'cancelled')),
      'overdue', (select count(*) from orders where business_id = p_business_id and due_at < now()
                    and status not in ('ready', 'out_for_delivery', 'delivered', 'cancelled', 'draft')),
      'upcoming', coalesce((select jsonb_agg(x) from (
          select o.id, o.order_no, c.full_name as customer, o.due_at, o.status,
                 (o.due_at < now()) as is_late
          from orders o join customers c on c.id = o.customer_id
          where o.business_id = p_business_id and o.due_at is not null
            and o.status not in ('delivered', 'cancelled', 'draft')
            and o.due_at < now() + interval '7 days'
          order by o.due_at limit 12) x), '[]'));
  end if;

  if v_money then
    r := r || jsonb_build_object(
      'collections_today', (select coalesce(sum(signed_amount), 0) from payments
                              where business_id = p_business_id
                                and (received_at at time zone 'Asia/Kolkata')::date = v_today),
      'collections_period', (select coalesce(sum(signed_amount), 0) from payments
                               where business_id = p_business_id and received_at >= v_from and received_at < v_to),
      'invoiced_period', (select coalesce(sum(total), 0) from invoices
                            where business_id = p_business_id and status = 'issued'
                              and issued_at >= v_from and issued_at < v_to),
      'outstanding', (select coalesce(sum(balance), 0) from (
                        select i.total - coalesce((select sum(signed_amount) from payments p where p.order_id = i.order_id), 0) as balance
                        from invoices i where i.business_id = p_business_id and i.status = 'issued') b where balance > 0));
  end if;

  if v_inv then
    r := r || jsonb_build_object(
      'low_stock', coalesce((select jsonb_agg(x) from (
          select id, name, on_hand, unit, reorder_level from materials
          where business_id = p_business_id and active and reorder_level > 0 and on_hand <= reorder_level
          order by on_hand / nullif(reorder_level, 0) limit 10) x), '[]'));
  end if;

  if v_fin then
    r := r || jsonb_build_object(
      'summary', public.report_summary(p_business_id, p_from, p_to),
      'trend', coalesce((select jsonb_agg(t order by t.month) from public.report_monthly(p_business_id,
                 (date_trunc('month', p_to) - interval '5 months')::date, p_to) t), '[]'),
      'recent_purchases', coalesce((select jsonb_agg(x) from (
          select p.purchase_no, s.name as supplier, p.total, p.purchase_date, p.status
          from purchases p join suppliers s on s.id = p.supplier_id
          where p.business_id = p_business_id order by p.created_at desc limit 5) x), '[]'),
      'recent_expenses', coalesce((select jsonb_agg(x) from (
          select e.description, ec.name as category, e.amount, e.expense_date
          from expenses e join expense_categories ec on ec.id = e.category_id
          where e.business_id = p_business_id and e.voided_at is null
          order by e.expense_date desc, e.created_at desc limit 5) x), '[]'));
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Profit & loss summary for a period. finance.view only.
--
-- Revenue recognised on invoice issue date (accrual); cancelled invoices excluded.
-- Direct costs are matched to the revenue: costs of order lines whose invoice
-- falls in the period. Inventory purchases are NOT expenses.
-- ---------------------------------------------------------------------------
create or replace function public.report_summary(p_business_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
#variable_conflict use_column
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  v jsonb;
  gross numeric; line_disc numeric; order_disc numeric; delivery_income numeric; tax numeric;
  round_off numeric; invoiced numeric; collections numeric; refunds numeric; receivables numeric;
  purchases_total numeric; consumed_by_date numeric; mat numeric; lab numeric; oth numeric;
  opex numeric; delivery_cost numeric; stock_loss numeric; incomplete int; invoice_count int;
  net_sales numeric; gross_profit numeric;
begin
  perform app.require_perm(p_business_id, 'finance.view');

  select coalesce(sum(il.qty * il.unit_price), 0), coalesce(sum(il.line_discount), 0)
    into gross, line_disc
  from invoice_lines il join invoices i on i.id = il.invoice_id
  where i.business_id = p_business_id and i.status = 'issued' and i.issued_at >= v_from and i.issued_at < v_to;

  select coalesce(sum(order_discount), 0), coalesce(sum(delivery_charge), 0), coalesce(sum(tax_amount), 0),
         coalesce(sum(round_off), 0), coalesce(sum(total), 0), count(*)
    into order_disc, delivery_income, tax, round_off, invoiced, invoice_count
  from invoices where business_id = p_business_id and status = 'issued' and issued_at >= v_from and issued_at < v_to;

  select coalesce(sum(signed_amount), 0), coalesce(-sum(signed_amount) filter (where kind = 'refund'), 0)
    into collections, refunds
  from payments where business_id = p_business_id and received_at >= v_from and received_at < v_to;

  select coalesce(sum(greatest(i.total - coalesce((select sum(signed_amount) from payments p where p.order_id = i.order_id), 0), 0)), 0)
    into receivables
  from invoices i where i.business_id = p_business_id and i.status = 'issued';

  select coalesce(sum(total), 0) into purchases_total
  from purchases where business_id = p_business_id and status = 'received' and received_at >= v_from and received_at < v_to;

  select coalesce(-sum(value), 0) into consumed_by_date
  from stock_movements where business_id = p_business_id and order_line_id is not null
    and created_at >= v_from and created_at < v_to;

  select coalesce(sum(c.material_cost), 0), coalesce(sum(c.labour_cost), 0), coalesce(sum(c.other_cost), 0),
         count(*) filter (where not coalesce(c.costs_complete, false))
    into mat, lab, oth, incomplete
  from invoice_lines il
  join invoices i on i.id = il.invoice_id
  left join order_line_costs c on c.line_id = il.order_line_id
  where i.business_id = p_business_id and i.status = 'issued' and i.issued_at >= v_from and i.issued_at < v_to;

  select coalesce(sum(amount), 0) into opex
  from expenses where business_id = p_business_id and voided_at is null
    and expense_date between p_from and p_to;

  select coalesce(sum(charge_to_shop), 0) into delivery_cost
  from deliveries where business_id = p_business_id and status <> 'cancelled'
    and created_at >= v_from and created_at < v_to;

  select coalesce(-sum(value), 0) into stock_loss
  from stock_movements where business_id = p_business_id and order_line_id is null
    and type in ('waste', 'adjustment') and created_at >= v_from and created_at < v_to;

  net_sales := gross - line_disc - order_disc;
  gross_profit := net_sales - mat - lab - oth;

  v := jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'invoice_count', invoice_count,
    'gross_sales', gross,
    'line_discounts', line_disc,
    'order_discounts', order_disc,
    'net_sales', net_sales,
    'delivery_income', delivery_income,
    'tax_collected', tax,
    'round_off', round_off,
    'invoiced_total', invoiced,
    'collections', collections,
    'refunds', refunds,
    'receivables_now', receivables,
    'inventory_purchases', purchases_total,
    'materials_consumed_by_date', consumed_by_date,
    'materials_cost_of_sales', mat,
    'labour_cost', lab,
    'other_direct_cost', oth,
    'gross_profit', gross_profit,
    'operating_expenses', opex,
    'delivery_costs', delivery_cost,
    'stock_losses', stock_loss,
    'net_operating_profit', gross_profit + delivery_income - opex - delivery_cost - stock_loss,
    'cost_incomplete_lines', incomplete,
    'profit_is_complete', incomplete = 0
  );
  return v;
end $$;

create or replace function public.report_monthly(p_business_id uuid, p_from date, p_to date)
returns table (month date, net_sales numeric, collections numeric, operating_expenses numeric,
               gross_profit numeric, net_operating_profit numeric, profit_is_complete boolean)
language plpgsql stable security definer set search_path = public, app as $$
declare m date; s jsonb;
begin
  perform app.require_perm(p_business_id, 'finance.view');
  if p_to - p_from > 3700 then raise exception 'Period too long' using errcode = '22023'; end if;
  m := date_trunc('month', p_from)::date;
  while m <= p_to loop
    s := public.report_summary(p_business_id, greatest(m, p_from), least((m + interval '1 month - 1 day')::date, p_to));
    month := m;
    net_sales := (s->>'net_sales')::numeric;
    collections := (s->>'collections')::numeric;
    operating_expenses := (s->>'operating_expenses')::numeric;
    gross_profit := (s->>'gross_profit')::numeric;
    net_operating_profit := (s->>'net_operating_profit')::numeric;
    profit_is_complete := (s->>'profit_is_complete')::boolean;
    return next;
    m := (m + interval '1 month')::date;
  end loop;
end $$;

create or replace function public.report_order_profit(p_business_id uuid, p_from date, p_to date)
returns table (order_id uuid, order_no text, invoice_no text, issued_at timestamptz, customer text,
               net_sales numeric, material_cost numeric, labour_cost numeric, other_cost numeric,
               contribution numeric, costs_complete boolean)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_perm(p_business_id, 'finance.view');
  return query
  select o.id, o.order_no, i.invoice_no, i.issued_at, c.full_name,
         i.items_subtotal - i.order_discount,
         coalesce(sum(lc.material_cost), 0), coalesce(sum(lc.labour_cost), 0), coalesce(sum(lc.other_cost), 0),
         i.items_subtotal - i.order_discount - coalesce(sum(lc.material_cost + lc.labour_cost + lc.other_cost), 0),
         bool_and(coalesce(lc.costs_complete, false))
  from invoices i
  join orders o on o.id = i.order_id
  join customers c on c.id = o.customer_id
  join invoice_lines il on il.invoice_id = i.id
  left join order_line_costs lc on lc.line_id = il.order_line_id
  where i.business_id = p_business_id and i.status = 'issued'
    and i.issued_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
    and i.issued_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
  group by o.id, o.order_no, i.invoice_no, i.issued_at, c.full_name, i.items_subtotal, i.order_discount
  order by i.issued_at desc;
end $$;

-- Generic tabular reports for screens and CSV export.
create or replace function public.run_report(p_business_id uuid, p_name text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  r jsonb;
begin
  case p_name
  when 'sales_by_day' then
    perform app.require_perm(p_business_id, 'finance.view');
    select jsonb_agg(x order by x.day) into r from (
      select (issued_at at time zone 'Asia/Kolkata')::date as day, count(*) as invoices,
             sum(items_subtotal - order_discount) as net_sales, sum(total) as invoiced_total
      from invoices where business_id = p_business_id and status = 'issued' and issued_at >= v_from and issued_at < v_to
      group by 1) x;
  when 'collections' then
    if not app.has_any_perm(p_business_id, array['payments.record', 'finance.view']::permission_key[]) then
      raise exception 'No permission' using errcode = '42501'; end if;
    select jsonb_agg(x order by x.received_at) into r from (
      select p.received_at, o.order_no, c.full_name as customer, p.kind, p.method, p.reference_no,
             p.signed_amount as amount, p.note
      from payments p join orders o on o.id = p.order_id join customers c on c.id = p.customer_id
      where p.business_id = p_business_id and p.received_at >= v_from and p.received_at < v_to) x;
  when 'outstanding' then
    if not app.has_any_perm(p_business_id, array['payments.record', 'finance.view']::permission_key[]) then
      raise exception 'No permission' using errcode = '42501'; end if;
    select jsonb_agg(x order by x.balance desc) into r from (
      select c.customer_code, c.full_name as customer, c.phone_e164 as phone, i.invoice_no, o.order_no,
             i.issued_at, i.total,
             coalesce((select sum(signed_amount) from payments p where p.order_id = i.order_id), 0) as paid,
             i.total - coalesce((select sum(signed_amount) from payments p where p.order_id = i.order_id), 0) as balance,
             (now()::date - (i.issued_at at time zone 'Asia/Kolkata')::date) as days_since_invoice
      from invoices i join orders o on o.id = i.order_id join customers c on c.id = i.customer_id
      where i.business_id = p_business_id and i.status = 'issued') x where x.balance > 0;
  when 'expenses' then
    perform app.require_perm(p_business_id, 'finance.view');
    select jsonb_agg(x order by x.expense_date) into r from (
      select e.expense_date, ec.name as category, e.description, e.amount, e.method, e.voided_at is not null as voided
      from expenses e join expense_categories ec on ec.id = e.category_id
      where e.business_id = p_business_id and e.expense_date between p_from and p_to) x;
  when 'purchases' then
    perform app.require_perm(p_business_id, 'finance.view');
    select jsonb_agg(x order by x.purchase_date) into r from (
      select p.purchase_no, p.purchase_date, s.name as supplier, p.status, p.total,
             coalesce((select sum(amount) from supplier_payments sp where sp.purchase_id = p.id), 0) as paid
      from purchases p join suppliers s on s.id = p.supplier_id
      where p.business_id = p_business_id and p.purchase_date between p_from and p_to) x;
  when 'supplier_balances' then
    perform app.require_perm(p_business_id, 'finance.view');
    select jsonb_agg(x order by x.balance desc) into r from (
      select name as supplier, purchased, paid, balance from v_supplier_balances where business_id = p_business_id) x;
  when 'stock_valuation' then
    if not app.has_any_perm(p_business_id, array['inventory.manage', 'finance.view']::permission_key[]) then
      raise exception 'No permission' using errcode = '42501'; end if;
    select jsonb_agg(x order by x.name) into r from (
      select code, name, category, unit, on_hand, avg_cost, stock_value, is_low
      from v_material_stock where business_id = p_business_id) x;
  when 'stock_movements' then
    if not app.has_any_perm(p_business_id, array['inventory.manage', 'finance.view']::permission_key[]) then
      raise exception 'No permission' using errcode = '42501'; end if;
    select jsonb_agg(x order by x.created_at) into r from (
      select sm.created_at, m.name as material, sm.type, sm.qty, m.unit, sm.unit_cost, sm.value,
             o.order_no, sm.reason
      from stock_movements sm join materials m on m.id = sm.material_id
      left join order_lines ol on ol.id = sm.order_line_id left join orders o on o.id = ol.order_id
      where sm.business_id = p_business_id and sm.created_at >= v_from and sm.created_at < v_to) x;
  when 'materials_by_order' then
    perform app.require_perm(p_business_id, 'finance.view');
    select jsonb_agg(x order by x.order_no) into r from (
      select o.order_no, ol.description as item, m.name as material, -sum(sm.qty) as qty_used, m.unit,
             -sum(sm.value) as cost
      from stock_movements sm join order_lines ol on ol.id = sm.order_line_id
      join orders o on o.id = ol.order_id join materials m on m.id = sm.material_id
      where sm.business_id = p_business_id and sm.created_at >= v_from and sm.created_at < v_to
      group by o.order_no, ol.description, m.name, m.unit) x;
  when 'order_profit' then
    select jsonb_agg(x) into r from public.report_order_profit(p_business_id, p_from, p_to) x;
  when 'monthly_profit' then
    select jsonb_agg(x) into r from public.report_monthly(p_business_id, p_from, p_to) x;
  when 'orders_status' then
    if not app.has_perm(p_business_id, 'orders.manage') then raise exception 'No permission' using errcode = '42501'; end if;
    select jsonb_agg(x order by x.due_at nulls last) into r from (
      select o.order_no, c.full_name as customer, o.status, o.order_date, o.due_at,
             (o.due_at < now() and o.status not in ('ready', 'out_for_delivery', 'delivered', 'cancelled')) as overdue,
             w.name as worker
      from orders o join customers c on c.id = o.customer_id left join workers w on w.id = o.assigned_worker_id
      where o.business_id = p_business_id and o.order_date between p_from and p_to) x;
  when 'service_performance' then
    perform app.require_perm(p_business_id, 'finance.view');
    select jsonb_agg(x order by x.net_sales desc) into r from (
      select coalesce(s.name, 'Custom items') as service, sum(il.qty) as qty,
             sum(il.line_subtotal) as net_sales, count(distinct i.id) as invoices
      from invoice_lines il join invoices i on i.id = il.invoice_id
      left join order_lines ol on ol.id = il.order_line_id left join services s on s.id = ol.service_id
      where i.business_id = p_business_id and i.status = 'issued' and i.issued_at >= v_from and i.issued_at < v_to
      group by 1) x;
  when 'repeat_customers' then
    if not app.has_any_perm(p_business_id, array['customers.manage', 'finance.view']::permission_key[]) then
      raise exception 'No permission' using errcode = '42501'; end if;
    select jsonb_agg(x order by x.orders desc) into r from (
      select c.customer_code, c.full_name as customer, c.phone_e164 as phone, count(o.id) as orders,
             max(o.order_date) as last_order
      from customers c join orders o on o.customer_id = c.id and o.status <> 'cancelled'
      where c.business_id = p_business_id and o.order_date between p_from and p_to
      group by c.id having count(o.id) >= 2) x;
  when 'worker_workload' then
    if not app.has_perm(p_business_id, 'orders.manage') then raise exception 'No permission' using errcode = '42501'; end if;
    select jsonb_agg(x order by x.open_orders desc) into r from (
      select coalesce(w.name, 'Unassigned') as worker,
             count(*) filter (where o.status not in ('delivered', 'cancelled')) as open_orders,
             count(*) filter (where o.due_at < now() and o.status not in ('ready', 'out_for_delivery', 'delivered', 'cancelled')) as overdue,
             count(*) filter (where o.status = 'delivered' and o.order_date between p_from and p_to) as delivered_in_period
      from orders o left join workers w on w.id = o.assigned_worker_id
      where o.business_id = p_business_id and o.status <> 'draft'
      group by 1) x;
  else
    raise exception 'Unknown report' using errcode = '22023';
  end case;
  return coalesce(r, '[]'::jsonb);
end $$;

create or replace function public.export_report(p_business_id uuid, p_name text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_perm(p_business_id, 'reports.export');
  return public.run_report(p_business_id, p_name, p_from, p_to);
end $$;

-- ---------------------------------------------------------------------------
-- Customer portal. Customers never touch base tables; these functions return
-- only customer-safe fields for records linked to auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.portal_overview()
returns jsonb language sql stable security definer set search_path = public, app as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', c.full_name, 'code', c.customer_code),
    'business', jsonb_build_object('name', b.name, 'phone', b.phone, 'whatsapp', b.whatsapp_e164,
                                   'address', b.address, 'logo_path', b.logo_path),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status, 'order_date', o.order_date,
        'due_at', o.due_at, 'delivery_method', o.delivery_method, 'notes', o.customer_notes,
        'total', o.total,
        'paid', coalesce((select sum(signed_amount) from payments p where p.order_id = o.id), 0),
        'balance', o.total - coalesce((select sum(signed_amount) from payments p where p.order_id = o.id), 0),
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'description', coalesce(nullif(l.customer_description, ''), l.description),
            'qty', l.qty, 'unit', l.unit, 'unit_price', l.unit_price, 'line_discount', l.line_discount,
            'line_subtotal', l.line_subtotal) order by l.position)
          from order_lines l where l.order_id = o.id), '[]'),
        'invoice', (select jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'issued_at', i.issued_at)
                    from invoices i where i.order_id = o.id and i.status = 'issued'),
        'delivery', (select jsonb_build_object('status', d.status, 'provider', d.provider,
                       'dispatched_at', d.dispatched_at, 'delivered_at', d.delivered_at)
                     from deliveries d where d.order_id = o.id order by d.created_at desc limit 1),
        'images', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'caption', a.caption))
                   from attachments a where a.entity_type = 'order' and a.entity_id = o.id
                     and a.visibility = 'customer' and a.bucket = 'order-images'), '[]')
      ) order by o.created_at desc)
      from orders o where o.customer_id = c.id and o.status <> 'draft'), '[]')
  )), '[]'::jsonb)
  from customers c join businesses b on b.id = c.business_id
  where c.user_id = auth.uid() and auth.uid() is not null
$$;

create or replace function public.portal_invoice(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not exists (
    select 1 from invoices i join customers c on c.id = i.customer_id
    where i.id = p_invoice_id and i.status = 'issued' and c.user_id = auth.uid() and auth.uid() is not null) then
    raise exception 'Invoice not found' using errcode = 'P0002';   -- same error whether it exists or not
  end if;
  return app.customer_invoice_payload(p_invoice_id);
end $$;

-- Same customer-safe payload for staff (print preview, PDF, WhatsApp message).
create or replace function public.staff_invoice_payload(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare v_b uuid;
begin
  select business_id into v_b from invoices where id = p_invoice_id;
  if v_b is null or not app.has_any_perm(v_b, array['invoices.manage', 'payments.record', 'orders.manage']::permission_key[]) then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  return app.customer_invoice_payload(p_invoice_id);
end $$;

-- Path of a customer-visible image, if the caller may see it (used to sign a URL).
create or replace function public.portal_image_path(p_attachment_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select a.path from attachments a
  join orders o on o.id = a.entity_id and a.entity_type = 'order'
  join customers c on c.id = o.customer_id
  where a.id = p_attachment_id and a.visibility = 'customer' and c.user_id = auth.uid() and auth.uid() is not null
$$;

-- Re-apply function grants for everything created in this migration.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.open_shared_invoice(text) from authenticated;
revoke execute on function public.rate_limit_hit(text, int, int) from authenticated;
