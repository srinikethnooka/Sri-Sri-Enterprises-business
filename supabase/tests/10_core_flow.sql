-- End-to-end business flow: setup → customers → order → invoice → payments →
-- purchase → stock → consumption → costs → profit → invoice correction.
\set ON_ERROR_STOP 1
\set as_owner_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000001''); set role authenticated;'
\set as_staff_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000002''); set role authenticated;'
\set as_cust1 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000003''); set role authenticated;'
\set as_cust2 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000004''); set role authenticated;'
\set as_fin_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000005''); set role authenticated;'
\set as_owner_b 'reset role; select tests.claims(''bbbbbbbb-0000-0000-0000-000000000001''); set role authenticated;'
\o /dev/null

-- ---------------------------------------------------------------- setup
:as_owner_a
select tests.setv('biz_a', public.create_business('Sri Sri Boutique', 'Owner A', '+918919093604', '+918919093604', 'Hanamkonda')::text);
select tests.throws('one business per owner', $$select public.create_business('Another', null)$$, 'already own');
update businesses set phone = '+919876543210', address = 'Hanamkonda, Telangana' where id = tests.u('biz_a');
select tests.throws('whatsapp must be E.164', $$update businesses set whatsapp_e164 = '8919093604' where id = tests.u('biz_a')$$, 'check constraint');

:as_owner_b
select tests.setv('biz_b', public.create_business('Other Boutique', 'Owner B')::text);

-- Staff invite with limited permissions; finance-view accountant invite
:as_owner_a
select tests.setv('staff_token', public.create_invite(tests.u('biz_a'), 'staff', 'staff@a.test', 'Staff A',
  array['customers.manage', 'orders.manage', 'payments.record', 'inventory.manage']::permission_key[]));
select tests.setv('fin_token', public.create_invite(tests.u('biz_a'), 'staff', 'finance@a.test', 'Accountant',
  array['finance.view', 'reports.export']::permission_key[]));
:as_staff_a
select public.accept_invite(tests.v('staff_token'));
select tests.throws('invite single use', $$select public.accept_invite(tests.v('staff_token'))$$, 'invalid or has expired');
:as_fin_a
select public.accept_invite(tests.v('fin_token'));

-- ---------------------------------------------------------------- customers
:as_staff_a
insert into customers (business_id, full_name, phone_e164, whatsapp_e164, customer_code, user_id)
values (tests.u('biz_a'), 'Anjali', '+919900000001', '+919900000001', 'HACKED', 'aaaaaaaa-0000-0000-0000-000000000004');
select tests.setv('c1', (select id from customers where phone_e164 = '+919900000001')::text);
select tests.eq('customer code assigned by server', (select customer_code from customers where id = tests.u('c1')), '1001');
select tests.eq('user_id ignored on insert', (select user_id from customers where id = tests.u('c1')), null::uuid);
insert into customers (business_id, full_name, phone_e164) values (tests.u('biz_a'), 'Bhavya', '+919900000002');
select tests.setv('c2', (select id from customers where phone_e164 = '+919900000002')::text);
select tests.throws('bad phone rejected',
  $$insert into customers (business_id, full_name, phone_e164) values (tests.u('biz_a'), 'X', '98765')$$, 'check constraint');

insert into measurement_sets (business_id, customer_id, values)
values (tests.u('biz_a'), tests.u('c1'), '{"bust": 34, "waist": 30, "blouse_length": 15}');
select tests.setv('ms1', (select id from measurement_sets where customer_id = tests.u('c1'))::text);
select tests.throws('measurements are insert-only',
  $$update measurement_sets set values = '{}' where id = tests.u('ms1')$$, '');

-- Customer portal invites
:as_owner_a
select tests.setv('c1_token', public.create_invite(tests.u('biz_a'), 'customer', null, 'Anjali', '{}', tests.u('c1')));
select tests.setv('c2_token', public.create_invite(tests.u('biz_a'), 'customer', null, 'Bhavya', '{}', tests.u('c2')));
:as_cust1
select public.accept_invite(tests.v('c1_token'));
:as_cust2
select public.accept_invite(tests.v('c2_token'));
reset role;
select tests.eq('c1 linked', (select user_id from customers where id = tests.u('c1')), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);

-- ---------------------------------------------------------------- order
:as_owner_a
update services set default_price = 1200 where business_id = tests.u('biz_a') and name = 'Blouse stitching';
select tests.setv('svc_blouse', (select id from services where business_id = tests.u('biz_a') and name = 'Blouse stitching')::text);
select tests.setv('svc_maggam', (select id from services where business_id = tests.u('biz_a') and name = 'Maggam / Aari work')::text);

:as_staff_a
select tests.setv('idem_o1', gen_random_uuid()::text);
select tests.setv('o1', public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'), 'measurement_set_id', tests.v('ms1'),
  'idempotency_key', tests.v('idem_o1'),
  'due_at', (now() + interval '5 days')::text, 'order_discount', 100, 'delivery_charge', 50,
  'internal_notes', 'VIP customer',
  'lines', jsonb_build_array(
    jsonb_build_object('service_id', tests.v('svc_blouse'), 'description', 'Blouse stitching', 'qty', 2, 'unit_price', 1200, 'line_discount', 200),
    jsonb_build_object('service_id', tests.v('svc_maggam'), 'description', 'Maggam work - peacock', 'qty', 1, 'unit_price', 1449.5)
  )))::text);
-- 2*1200-200 = 2200; + 1449.50 = 3649.50; -100 = 3549.50; +50 = 3599.50 → rounded 3600, round_off +0.50
select tests.eq('items subtotal', (select items_subtotal from orders where id = tests.u('o1')), 3649.50::numeric(12,2));
select tests.eq('total rounded', (select total from orders where id = tests.u('o1')), 3600.00::numeric(12,2));
select tests.eq('round off', (select round_off from orders where id = tests.u('o1')), 0.50::numeric(12,2));
select tests.ok('order number format', (select order_no from orders where id = tests.u('o1')) ~ '^ORD-\d{4}-0001$');
-- Duplicate submit returns the same order
select tests.eq('idempotent save', public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'), 'idempotency_key', tests.v('idem_o1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 1)))), tests.u('o1'));
select tests.eq('one order only', (select count(*) from orders where business_id = tests.u('biz_a')), 1::bigint);
select tests.throws('discount larger than line', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 100, 'line_discount', 101))))$$,
  'discount');
select tests.throws('negative price', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', -5))))$$,
  'negative');
select tests.throws('zero quantity', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 0, 'unit_price', 5))))$$,
  'quantity');
select tests.throws('no direct insert into orders', $$insert into orders (business_id, order_no, customer_id)
  values (tests.u('biz_a'), 'X', tests.u('c1'))$$, 'permission denied');

select public.change_order_status(tests.u('o1'), 'confirmed', null);
select tests.throws('illegal transition', $$select public.change_order_status(tests.u('o1'), 'delivered', null)$$, 'cannot move');
select public.change_order_status(tests.u('o1'), 'in_progress', null);
select tests.eq('history rows', (select count(*) from order_status_history where order_id = tests.u('o1')), 3::bigint);

-- ---------------------------------------------------------------- invoice
select tests.throws('staff without invoices.manage cannot issue',
  $$select public.issue_invoice(tests.u('o1'), gen_random_uuid())$$, 'permission');
:as_owner_a
select tests.setv('idem_i1', gen_random_uuid()::text);
select tests.setv('inv1', public.issue_invoice(tests.u('o1'), tests.u('idem_i1'))::text);
select tests.eq('idempotent issue', public.issue_invoice(tests.u('o1'), tests.u('idem_i1')), tests.u('inv1'));
select tests.throws('second live invoice blocked', $$select public.issue_invoice(tests.u('o1'), gen_random_uuid())$$, 'already has');
select tests.ok('invoice number format', (select invoice_no from invoices where id = tests.u('inv1')) ~ '^SSB/\d{4}-\d{2}/0001$');
select tests.eq('invoice total', (select total from invoices where id = tests.u('inv1')), 3600.00::numeric(12,2));
select tests.eq('invoice lines', (select count(*) from invoice_lines where invoice_id = tests.u('inv1')), 2::bigint);
select tests.eq('whatsapp on invoice', (select snapshot->'business'->>'whatsapp' from invoices where id = tests.u('inv1')), '+918919093604');
select tests.throws('order locked while invoiced', $$select public.save_order(jsonb_build_object(
  'id', tests.v('o1'), 'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 1))))$$, 'cancel the invoice');

-- Catalogue price change must not touch the issued invoice
update services set default_price = 9999 where id = tests.u('svc_blouse');
select tests.eq('invoice line price frozen',
  (select unit_price from invoice_lines where invoice_id = tests.u('inv1') and position = 1), 1200.00::numeric(12,2));
select tests.throws('invoice immutable', $$update invoices set total = 1 where id = tests.u('inv1')$$, 'permission denied');
reset role;
select tests.throws('invoice immutable even for db owner', $$update invoices set total = 1 where id = tests.u('inv1')$$, 'cannot be edited');
select tests.throws('invoice lines immutable', $$update invoice_lines set unit_price = 1 where invoice_id = tests.u('inv1')$$, 'cannot be changed');

-- ---------------------------------------------------------------- payments
:as_staff_a
select tests.setv('idem_p1', gen_random_uuid()::text);
select tests.setv('p1', public.record_payment(tests.u('o1'), 'payment', 1000, 'upi', tests.u('idem_p1'), 'UPI123')::text);
select tests.eq('duplicate payment ignored', public.record_payment(tests.u('o1'), 'payment', 1000, 'upi', tests.u('idem_p1')), tests.u('p1'));
select tests.eq('one payment row', (select count(*) from payments where order_id = tests.u('o1')), 1::bigint);
select tests.throws('overpayment blocked', $$select public.record_payment(tests.u('o1'), 'payment', 2601, 'cash', gen_random_uuid())$$, 'more than the balance');
select tests.throws('negative amount', $$select public.record_payment(tests.u('o1'), 'payment', -5, 'cash', gen_random_uuid())$$, 'more than 0');
select public.record_payment(tests.u('o1'), 'payment', 600, 'cash', gen_random_uuid());
select tests.throws('refund needs reason', $$select public.record_payment(tests.u('o1'), 'refund', 100, 'cash', gen_random_uuid())$$, 'reason');
select tests.throws('refund > collected', $$select public.record_payment(tests.u('o1'), 'refund', 1601, 'cash', gen_random_uuid(), null, null, 'x')$$, 'more than the amount collected');
select public.record_payment(tests.u('o1'), 'refund', 100, 'cash', gen_random_uuid(), null, null, 'Button issue');
select public.reverse_payment(tests.u('p1'), 'Entered on wrong order', gen_random_uuid());
select tests.throws('double reversal', $$select public.reverse_payment(tests.u('p1'), 'again', gen_random_uuid())$$, 'already reversed');
select tests.throws('payments append-only', $$delete from payments where id = tests.u('p1')$$, 'permission denied');
-- paid = 1000 + 600 - 100 - 1000 = 500 ; balance = 3100
select tests.eq('paid', (select paid from v_order_balances where order_id = tests.u('o1')), 500.00::numeric);
select tests.eq('balance', (select balance from v_order_balances where order_id = tests.u('o1')), 3100.00::numeric);
select public.record_payment(tests.u('o1'), 'payment', 1000, 'upi', gen_random_uuid());

-- ---------------------------------------------------------------- purchasing & stock
:as_owner_a
insert into suppliers (business_id, name) values (tests.u('biz_a'), 'Lakshmi Threads');
select tests.setv('sup1', (select id from suppliers where business_id = tests.u('biz_a'))::text);
insert into materials (business_id, code, name, unit, reorder_level, on_hand, avg_cost)
values (tests.u('biz_a'), 'THR-GLD', 'Gold zari thread', 'roll', 5, 999, 999);
select tests.eq('opening stock forced to 0', (select on_hand from materials where code = 'THR-GLD'), 0::numeric(12,3));
select tests.setv('mat1', (select id from materials where code = 'THR-GLD')::text);
select tests.throws('stock not editable directly', $$update materials set on_hand = 50 where id = tests.u('mat1')$$, 'stock movements');

insert into purchases (business_id, supplier_id, other_charges, discount, due_date)
values (tests.u('biz_a'), tests.u('sup1'), 60, 0, current_date);
select tests.setv('pur1', (select id from purchases where supplier_id = tests.u('sup1'))::text);
insert into purchase_lines (business_id, purchase_id, material_id, qty, unit_cost)
values (tests.u('biz_a'), tests.u('pur1'), tests.u('mat1'), 10, 120);
-- lines 1200 + charges 60 = 1260 → landed cost 126/roll
select tests.eq('purchase total', (select total from purchases where id = tests.u('pur1')), 1260.00::numeric(12,2));
select public.receive_purchase(tests.u('pur1'));
select public.receive_purchase(tests.u('pur1'));   -- second call is a no-op
select tests.eq('stock received once', (select on_hand from materials where id = tests.u('mat1')), 10.000::numeric(12,3));
select tests.eq('landed avg cost', (select avg_cost from materials where id = tests.u('mat1')), 126.0000::numeric(12,4));
select tests.throws('received purchase locked', $$update purchase_lines set qty = 99 where purchase_id = tests.u('pur1')$$, 'cannot change');

-- second purchase at a different price → weighted average
insert into purchases (business_id, supplier_id) values (tests.u('biz_a'), tests.u('sup1'));
select tests.setv('pur2', (select id from purchases where supplier_id = tests.u('sup1') and id <> tests.u('pur1'))::text);
insert into purchase_lines (business_id, purchase_id, material_id, qty, unit_cost)
values (tests.u('biz_a'), tests.u('pur2'), tests.u('mat1'), 10, 150);
select public.receive_purchase(tests.u('pur2'));
-- (10*126 + 10*150)/20 = 138
select tests.eq('weighted average', (select avg_cost from materials where id = tests.u('mat1')), 138.0000::numeric(12,4));

-- consumption against order line 2 (maggam)
select tests.setv('line2', (select id from order_lines where order_id = tests.u('o1') and position = 2)::text);
:as_staff_a
select tests.setv('idem_c1', gen_random_uuid()::text);
select public.consume_material(tests.u('line2'), tests.u('mat1'), 3, tests.u('idem_c1'));
select public.consume_material(tests.u('line2'), tests.u('mat1'), 3, tests.u('idem_c1'));  -- duplicate
select tests.eq('consumed once', (select on_hand from materials where id = tests.u('mat1')), 17.000::numeric(12,3));
select tests.throws('shortage blocked for staff', $$select public.consume_material(tests.u('line2'), tests.u('mat1'), 50, gen_random_uuid())$$, 'Not enough stock');
select tests.throws('staff cannot override', $$select public.consume_material(tests.u('line2'), tests.u('mat1'), 50, gen_random_uuid(), true)$$, 'Only the owner');
select tests.throws('staff cannot see costs', $$select public.set_line_costs(tests.u('line2'), 1, 1, true)$$, 'permission');
select tests.eq('costs hidden from staff', (select count(*) from order_line_costs), 0::bigint);
:as_owner_a
select tests.eq('line material cost', (select material_cost from order_line_costs where line_id = tests.u('line2')), 414.00::numeric(12,2));
select public.adjust_stock(tests.u('mat1'), 'return_in', 1, 'Leftover returned', gen_random_uuid(), null, tests.u('line2'));
select tests.eq('line cost after return', (select material_cost from order_line_costs where line_id = tests.u('line2')), 276.00::numeric(12,2));
select tests.throws('cannot return more than used', $$select public.adjust_stock(tests.u('mat1'), 'return_in', 5, 'x', gen_random_uuid(), null, tests.u('line2'))$$, 'more than was used');
select public.adjust_stock(tests.u('mat1'), 'waste', 1, 'Tangled roll', gen_random_uuid());
select tests.eq('stock after waste', (select on_hand from materials where id = tests.u('mat1')), 17.000::numeric(12,3));

-- labour costs (owner) — line 1 complete, line 2 complete
select public.set_line_costs((select id from order_lines where order_id = tests.u('o1') and position = 1), 800, 0, true);
select public.set_line_costs(tests.u('line2'), 300, 24, true);

select public.record_supplier_payment(tests.u('sup1'), 1000, 'bank', gen_random_uuid(), tests.u('pur1'));
select tests.eq('supplier balance', (select balance from v_supplier_balances where supplier_id = tests.u('sup1')), 1760.00::numeric);

insert into expenses (business_id, category_id, amount, description)
values (tests.u('biz_a'), (select id from expense_categories where business_id = tests.u('biz_a') and name = 'Electricity'), 450, 'October bill');
insert into expenses (business_id, category_id, amount, description)
values (tests.u('biz_a'), (select id from expense_categories where business_id = tests.u('biz_a') and name = 'Rent'), 5000, 'Mistake');
select public.void_expense((select id from expenses where description = 'Mistake'), 'Duplicate entry');
select tests.throws('expenses not deletable', $$delete from expenses where description = 'October bill'$$, '');

-- ---------------------------------------------------------------- profit
:as_fin_a
select tests.setv('summary', public.report_summary(tests.u('biz_a'), current_date - 1, current_date + 1)::text);
reset role;
select tests.eq('net sales', (tests.v('summary')::jsonb->>'net_sales')::numeric, 3549.50);
select tests.eq('materials cost of sales', (tests.v('summary')::jsonb->>'materials_cost_of_sales')::numeric, 276.00);
select tests.eq('labour', (tests.v('summary')::jsonb->>'labour_cost')::numeric, 1100.00);
-- 3549.50 - 276 - 1100 - 24 = 2149.50
select tests.eq('gross profit', (tests.v('summary')::jsonb->>'gross_profit')::numeric, 2149.50);
select tests.eq('opex excludes voided', (tests.v('summary')::jsonb->>'operating_expenses')::numeric, 450.00);
select tests.eq('purchases not expensed', (tests.v('summary')::jsonb->>'inventory_purchases')::numeric, 2760.00);
-- waste: 1 roll at avg after return. Net op = 2149.50 + 50 delivery income - 450 - 0 - waste
select tests.ok('profit complete', (tests.v('summary')::jsonb->>'profit_is_complete')::boolean);
select tests.eq('collections', (tests.v('summary')::jsonb->>'collections')::numeric, 1500.00);
select tests.eq('receivable', (tests.v('summary')::jsonb->>'receivables_now')::numeric, 2100.00);

-- ---------------------------------------------------------------- correction flow
:as_owner_a
select public.create_share_link(tests.u('inv1'));
select tests.throws('cancel needs reason', $$select public.cancel_invoice(tests.u('inv1'), '')$$, 'reason');
select public.cancel_invoice(tests.u('inv1'), 'Wrong discount');
select tests.eq('share links revoked', (select count(*) from invoice_share_links where invoice_id = tests.u('inv1') and revoked_at is null), 0::bigint);
select public.save_order(jsonb_build_object(
  'id', tests.v('o1'), 'business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'), 'measurement_set_id', tests.v('ms1'),
  'order_discount', 0, 'delivery_charge', 50,
  'lines', (select jsonb_agg(jsonb_build_object('id', id, 'service_id', service_id, 'description', description,
             'qty', qty, 'unit_price', unit_price, 'line_discount', line_discount) order by position)
            from order_lines where order_id = tests.u('o1'))));
select tests.setv('inv2', public.issue_invoice(tests.u('o1'), gen_random_uuid())::text);
select tests.eq('replaces old', (select replaces_invoice_id from invoices where id = tests.u('inv2')), tests.u('inv1'));
select tests.ok('new number', (select invoice_no from invoices where id = tests.u('inv2')) like '%/0002');
select tests.eq('new total', (select total from invoices where id = tests.u('inv2')), 3700.00::numeric(12,2));
select tests.eq('old invoice kept', (select status::text from invoices where id = tests.u('inv1')), 'cancelled');
select tests.eq('line costs kept after edit', (select material_cost from order_line_costs where line_id = tests.u('line2')), 276.00::numeric(12,2));

-- second order for customer 2 (used by security tests)
select tests.setv('o2', public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'Saree fall & pico', 'qty', 1, 'unit_price', 300))))::text);
select public.change_order_status(tests.u('o2'), 'confirmed', null);
select tests.setv('inv_c2', public.issue_invoice(tests.u('o2'), gen_random_uuid())::text);
select tests.setv('share_c2', public.create_share_link(tests.u('inv_c2'), 7));

-- dashboard runs for owner
select tests.ok('dashboard', public.dashboard_summary(tests.u('biz_a'), current_date - 30, current_date) ? 'summary');
select tests.ok('notifications run', public.refresh_notifications(tests.u('biz_a')) >= 0);
select tests.ok('reports run', jsonb_array_length(public.run_report(tests.u('biz_a'), 'order_profit', (now() at time zone 'Asia/Kolkata')::date - 1, (now() at time zone 'Asia/Kolkata')::date)) = 2);
reset role;
\o
select 'core flow ok' as result;
