-- Importing old bills from the paper book: past dates, book bill numbers, no duplicates.
\set ON_ERROR_STOP 1
\set as_owner_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000001''); set role authenticated;'
\set as_staff_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000002''); set role authenticated;'
\set as_cust1 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000003''); set role authenticated;'
\o /dev/null

:as_staff_a
select tests.setv('imp1', public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'), 'idempotency_key', gen_random_uuid(),
  'order_date', ((now() at time zone 'Asia/Kolkata')::date - 40)::text, 'source_ref', 'Book 3 / 247',
  'lines', jsonb_build_array(jsonb_build_object('description', 'Blouse stitching', 'qty', 2, 'unit_price', 650))))::text);
select tests.eq('old bill keeps its date', (select order_date from orders where id = tests.u('imp1')), (now() at time zone 'Asia/Kolkata')::date - 40);
select tests.eq('book bill number kept', (select source_ref from orders where id = tests.u('imp1')), 'Book 3 / 247');
select tests.eq('totals still computed by server', (select total from orders where id = tests.u('imp1')), 1300.00::numeric(12,2));
select tests.throws('same book bill twice', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'), 'source_ref', 'book 3 / 247',
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 1))))$$, 'already entered');
select tests.throws('future bill date', $$select public.save_order(jsonb_build_object(
  'business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'), 'order_date', '2099-01-01',
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 1))))$$, 'future');
-- a retry of the same submission returns the same order instead of a duplicate error
select tests.setv('imp_key', gen_random_uuid()::text);
select tests.setv('imp2', public.save_order(jsonb_build_object('business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'),
  'idempotency_key', tests.v('imp_key'), 'source_ref', 'Book 3 / 248', 'order_date', ((now() at time zone 'Asia/Kolkata')::date - 5)::text,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Fall & pico', 'qty', 1, 'unit_price', 250))))::text);
select tests.eq('retry is safe', public.save_order(jsonb_build_object('business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'),
  'idempotency_key', tests.v('imp_key'), 'source_ref', 'Book 3 / 248',
  'lines', jsonb_build_array(jsonb_build_object('description', 'Fall & pico', 'qty', 1, 'unit_price', 250)))), tests.u('imp2'));
-- editing the same order keeps its own source_ref without a duplicate error
select public.save_order(jsonb_build_object('id', tests.v('imp1'), 'business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'),
  'source_ref', 'Book 3 / 247', 'lines', (select jsonb_agg(jsonb_build_object('id', id, 'description', description, 'qty', qty, 'unit_price', unit_price)) from order_lines where order_id = tests.u('imp1'))));
-- advance recorded on the bill date
select public.change_order_status(tests.u('imp1'), 'confirmed', 'Imported from bill book');
select public.record_payment(tests.u('imp1'), 'payment', 500, 'cash', gen_random_uuid(), null,
  (((now() at time zone 'Asia/Kolkata')::date - 40)::timestamp at time zone 'Asia/Kolkata'), 'Advance from bill book');
select tests.ok('payment dated on bill date', (select min(received_at) from payments where order_id = tests.u('imp1')) < now() - interval '39 days');
select tests.ok('staff may scan (has orders.manage)', public.has_permission(tests.u('biz_a'), 'orders.manage'));
select tests.ok('staff lacks finance', not public.has_permission(tests.u('biz_a'), 'finance.view'));
select tests.throws('core function not callable directly', $$select public.save_order_core('{}'::jsonb)$$, 'permission denied');
select tests.throws('scan log not writable by users', $$select public.log_bill_scan(tests.u('biz_a'), auth.uid(), 'ok', 'x', null)$$, 'permission denied');
:as_cust1
select tests.ok('customer has no orders permission', not public.has_permission(tests.u('biz_a'), 'orders.manage'));
select tests.throws('customer cannot import', $$select public.save_order(jsonb_build_object('business_id', tests.v('biz_a'), 'customer_id', tests.v('c1'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price', 1))))$$, 'permission');
reset role;
\o
select 'bill import ok' as result;
