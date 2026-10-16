-- Security: cross-customer, cross-tenant, staff permission and direct-write attacks.
-- Runs after 10_core_flow.sql (uses the data it created).
\set ON_ERROR_STOP 1
\set as_owner_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000001''); set role authenticated;'
\set as_staff_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000002''); set role authenticated;'
\set as_cust1 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000003''); set role authenticated;'
\set as_cust2 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000004''); set role authenticated;'
\set as_fin_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000005''); set role authenticated;'
\set as_owner_b 'reset role; select tests.claims(''bbbbbbbb-0000-0000-0000-000000000001''); set role authenticated;'
\set as_anon 'reset role; select tests.claims(''''); set role anon;'
\o /dev/null

-- ---------------------------------------------------------------- customers (portal)
:as_cust1
select tests.eq('cust1 sees no orders table rows', (select count(*) from orders), 0::bigint);
select tests.eq('cust1 sees no order lines', (select count(*) from order_lines), 0::bigint);
select tests.eq('cust1 sees no invoices table rows', (select count(*) from invoices), 0::bigint);
select tests.eq('cust1 sees no payments', (select count(*) from payments), 0::bigint);
select tests.eq('cust1 sees no costs', (select count(*) from order_line_costs), 0::bigint);
select tests.eq('cust1 sees no internal notes', (select count(*) from order_internal), 0::bigint);
select tests.eq('cust1 sees no materials', (select count(*) from materials), 0::bigint);
select tests.eq('cust1 sees no suppliers', (select count(*) from suppliers), 0::bigint);
select tests.eq('cust1 sees no expenses', (select count(*) from expenses), 0::bigint);
select tests.eq('cust1 sees no audit log', (select count(*) from audit_log), 0::bigint);
select tests.eq('cust1 sees only own customer row', (select count(*) from customers), 1::bigint);
select tests.eq('cust1 own row is c1', (select id from customers), tests.u('c1'));
select tests.eq('cust1 sees no services', (select count(*) from services), 0::bigint);
select tests.eq('cust1 sees no staff list', (select count(*) from business_members where role <> 'customer'), 0::bigint);

select tests.eq('portal: one customer record', jsonb_array_length(public.portal_overview()), 1);
select tests.eq('portal: own order only', jsonb_array_length(public.portal_overview()->0->'orders'), 1);
select tests.eq('portal: correct order', public.portal_overview()->0->'orders'->0->>'id', tests.v('o1'));
select tests.ok('portal: no internal notes leak', public.portal_overview()::text !~* 'VIP customer');
select tests.ok('portal: no cost fields', public.portal_overview()::text !~* 'material_cost|labour|avg_cost');
select tests.ok('portal: own invoice opens', public.portal_invoice(tests.u('inv2')) ? 'lines');
select tests.throws('portal: other customer invoice', $$select public.portal_invoice(tests.u('inv_c2'))$$, 'not found');
select tests.throws('portal: cancelled invoice hidden', $$select public.portal_invoice(tests.u('inv1'))$$, 'not found');
select tests.throws('portal: random id', $$select public.portal_invoice(gen_random_uuid())$$, 'not found');

-- Tampering
update customers set user_id = 'aaaaaaaa-0000-0000-0000-000000000004' where id = tests.u('c1');  -- RLS: 0 rows
select tests.eq('link unchanged', (select user_id from customers where id = tests.u('c1')), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
update customers set full_name = 'Hacked' where id = tests.u('c2');   -- RLS: affects 0 rows
select tests.throws('customer cannot call staff RPCs',
  $$select public.record_payment(tests.u('o1'), 'payment', 1, 'cash', gen_random_uuid())$$, 'permission');
select tests.throws('customer cannot create orders', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 0))))$$, 'permission');
select tests.throws('customer cannot read reports',
  $$select public.report_summary(tests.u('biz_a'), current_date - 30, current_date)$$, 'permission');
select tests.throws('customer cannot run dashboard',
  $$select public.dashboard_summary(tests.u('biz_a'), current_date - 30, current_date)$$, 'permission');
select tests.throws('customer cannot open share link directly', $$select public.open_shared_invoice(tests.v('share_c2'))$$, 'permission denied');
reset role;
select tests.eq('c2 name unchanged', (select full_name from customers where id = tests.u('c2')), 'Bhavya');

:as_cust2
select tests.eq('cust2 portal: own order only', public.portal_overview()->0->'orders'->0->>'id', tests.v('o2'));
select tests.throws('cust2 cannot open cust1 invoice', $$select public.portal_invoice(tests.u('inv2'))$$, 'not found');

-- ---------------------------------------------------------------- staff without finance
:as_staff_a
select tests.eq('staff sees orders', (select count(*) from orders) > 0, true);
select tests.eq('staff: no costs', (select count(*) from order_line_costs), 0::bigint);
select tests.eq('staff: no expenses', (select count(*) from expenses), 0::bigint);
select tests.eq('staff: no audit', (select count(*) from audit_log), 0::bigint);
select tests.eq('staff: no purchases', (select count(*) from purchases), 0::bigint);
select tests.throws('staff: no profit report', $$select public.report_summary(tests.u('biz_a'), current_date - 1, current_date)$$, 'permission');
select tests.throws('staff: no export', $$select public.export_report(tests.u('biz_a'), 'collections', current_date - 1, current_date)$$, 'permission');
select tests.ok('staff dashboard hides finance', not (public.dashboard_summary(tests.u('biz_a'), current_date - 1, current_date) ? 'summary'));
select tests.throws('staff cannot grant self finance',
  $$select public.set_member_permissions((select id from business_members where user_id = auth.uid()), array['finance.view']::permission_key[])$$,
  'permission');
select tests.throws('staff cannot edit settings via RPC-less update',
  $$select public.create_invite(tests.u('biz_a'), 'staff', 'x@y.z', 'X', array['finance.view']::permission_key[])$$, 'permission');
update businesses set name = 'Hacked' where id = tests.u('biz_a');    -- RLS: 0 rows
select tests.throws('staff cannot insert stock directly',
  $$insert into stock_movements (business_id, material_id, type, qty, idempotency_key, reason)
    values (tests.u('biz_a'), tests.u('mat1'), 'adjustment', 100, gen_random_uuid(), 'x')$$, 'permission denied');
select tests.throws('staff cannot insert payments directly',
  $$insert into payments (business_id, order_id, customer_id, kind, amount, signed_amount, method, idempotency_key)
    values (tests.u('biz_a'), tests.u('o1'), tests.u('c1'), 'payment', 1, 1, 'cash', gen_random_uuid())$$, 'permission denied');
select tests.throws('staff cannot change order totals',
  $$update orders set total = 1 where id = tests.u('o1')$$, 'permission denied');
reset role;
select tests.eq('business name unchanged', (select name from businesses where id = tests.u('biz_a')), 'Sri Sri Boutique');

:as_fin_a
select tests.eq('finance sees costs', (select count(*) from order_line_costs) > 0, true);
select tests.ok('finance can export', jsonb_typeof(public.export_report(tests.u('biz_a'), 'collections', current_date - 1, current_date + 1)) = 'array');
select tests.throws('finance cannot take payments', $$select public.record_payment(tests.u('o1'), 'payment', 1, 'cash', gen_random_uuid())$$, 'permission');

-- ---------------------------------------------------------------- other tenant
:as_owner_b
select tests.eq('B sees no A customers', (select count(*) from customers where business_id = tests.u('biz_a')), 0::bigint);
select tests.eq('B sees no A orders', (select count(*) from orders where business_id = tests.u('biz_a')), 0::bigint);
select tests.eq('B sees no A invoices', (select count(*) from invoices where business_id = tests.u('biz_a')), 0::bigint);
select tests.eq('B sees only own business', (select count(*) from businesses), 1::bigint);
select tests.throws('B cannot create order in A', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 0))))$$, 'permission');
select tests.throws('B cannot pay A order', $$select public.record_payment(tests.u('o1'), 'payment', 1, 'cash', gen_random_uuid())$$, 'permission');
select tests.throws('B cannot issue A invoice', $$select public.issue_invoice(tests.u('o2'), gen_random_uuid())$$, 'permission');
select tests.throws('B cannot cancel A invoice', $$select public.cancel_invoice(tests.u('inv2'), 'x')$$, 'permission');
select tests.throws('B cannot insert customer into A',
  $$insert into customers (business_id, full_name, phone_e164) values (tests.u('biz_a'), 'X', '+919000000000')$$, 'row-level security');
select tests.throws('B cannot report on A', $$select public.report_summary(tests.u('biz_a'), current_date - 1, current_date)$$, 'permission');
select tests.throws('B cannot use A invite token', $$select public.accept_invite(tests.v('c1_token'))$$, 'invalid');
-- B's own customer cannot be attached to an A order
insert into customers (business_id, full_name, phone_e164) values (tests.u('biz_b'), 'B cust', '+919111111111');
select tests.setv('cb', (select id from customers where business_id = tests.u('biz_b'))::text);
:as_owner_a
select tests.throws('A cannot use B customer', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('cb'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 0))))$$, 'not found');
select tests.throws('A cannot use B material on A order',
  $$insert into purchase_lines (business_id, purchase_id, material_id, qty, unit_cost)
    values (tests.u('biz_b'), tests.u('pur1'), tests.u('mat1'), 1, 1)$$, '');

-- ---------------------------------------------------------------- anonymous
:as_anon
select tests.throws('anon cannot read customers', $$select count(*) from customers$$, 'permission denied');
select tests.throws('anon cannot call RPCs', $$select public.portal_overview()$$, 'permission denied');
select tests.throws('anon cannot open share links directly', $$select public.open_shared_invoice('x')$$, 'permission denied');

-- ---------------------------------------------------------------- share links (as Edge Function / service_role)
reset role;
set role service_role;
select tests.ok('valid link opens', public.open_shared_invoice(tests.v('share_c2')) ? 'invoice');
select tests.eq('link opens right invoice', public.open_shared_invoice(tests.v('share_c2'))->'invoice'->>'id', tests.v('inv_c2'));
select tests.ok('link payload has no costs', public.open_shared_invoice(tests.v('share_c2'))::text !~* 'material_cost|labour|internal');
select tests.eq('wrong token', public.open_shared_invoice('not-a-real-token'), null::jsonb);
select tests.eq('invoice number is not a token', public.open_shared_invoice((select invoice_no from invoices where id = tests.u('inv_c2'))), null::jsonb);
reset role;
update invoice_share_links set expires_at = now() - interval '1 second'
  where invoice_id = tests.u('inv_c2');
set role service_role;
select tests.eq('expired link', public.open_shared_invoice(tests.v('share_c2')), null::jsonb);
reset role;
update invoice_share_links set expires_at = now() + interval '1 day' where invoice_id = tests.u('inv_c2');
:as_owner_a
select public.revoke_share_link((select id from invoice_share_links where invoice_id = tests.u('inv_c2') limit 1));
reset role;
set role service_role;
select tests.eq('revoked link', public.open_shared_invoice(tests.v('share_c2')), null::jsonb);
select tests.ok('rate limit allows first', public.rate_limit_hit('test-ip', 2, 60));
select tests.ok('rate limit allows second', public.rate_limit_hit('test-ip', 2, 60));
select tests.ok('rate limit blocks third', not public.rate_limit_hit('test-ip', 2, 60));
reset role;

-- ---------------------------------------------------------------- concurrency-safe numbering
select tests.eq('no duplicate invoice numbers',
  (select count(*) from (select invoice_no from invoices group by business_id, invoice_no having count(*) > 1) d), 0::bigint);
\o
select 'security ok' as result;
