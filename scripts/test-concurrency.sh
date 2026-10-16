#!/usr/bin/env bash
# Fires parallel requests at the test database to check that invoice numbers,
# duplicate payments and stock deductions stay correct under concurrency.
# Run after scripts/test-db.sh (it reuses that database and its test users).
set -euo pipefail
DB="${TEST_DB:-ssb_test}"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
OWNER="aaaaaaaa-0000-0000-0000-000000000001"
AS_OWNER="select tests.claims('$OWNER'); set role authenticated;"

# 1) 20 confirmed orders, then issue all 20 invoices in parallel.
"${PSQL[@]}" -c "$AS_OWNER
do \$\$
declare i int; o uuid;
begin
  for i in 1..20 loop
    o := public.save_order(jsonb_build_object('business_id', tests.v('biz_a'), 'customer_id', tests.v('c2'),
      'lines', jsonb_build_array(jsonb_build_object('description', 'Concurrency item', 'qty', 1, 'unit_price', 100))));
    perform public.change_order_status(o, 'confirmed', null);
    perform tests.setv('conc_' || i, o::text);
  end loop;
end \$\$;" > /dev/null

for i in $(seq 1 20); do
  "${PSQL[@]}" -c "$AS_OWNER select public.issue_invoice(tests.u('conc_$i'), gen_random_uuid());" > /dev/null &
done
wait

# 2) The same payment submitted 10 times at once (double-tap) → exactly one row.
KEY=$(cat /proc/sys/kernel/random/uuid)
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "$AS_OWNER select public.record_payment(tests.u('conc_1'), 'payment', 50, 'cash', '$KEY');" > /dev/null 2>&1 &
done
wait

# 3) 10 parallel consumptions of 1 roll each → stock drops by exactly 10.
BEFORE=$("${PSQL[@]}" -c "select on_hand from materials where id = tests.u('mat1')")
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "$AS_OWNER select public.consume_material(tests.u('line2'), tests.u('mat1'), 1, gen_random_uuid());" > /dev/null &
done
wait
AFTER=$("${PSQL[@]}" -c "select on_hand from materials where id = tests.u('mat1')")

"${PSQL[@]}" -c "
select tests.eq('20 invoices issued', (select count(*) from invoices i join orders o on o.id = i.order_id
  where o.order_no in (select order_no from orders where id in (select v::uuid from tests.vars where k like 'conc_%'))), 20::bigint);
select tests.eq('invoice numbers unique', (select count(distinct invoice_no) from invoices), (select count(*) from invoices));
select tests.eq('invoice numbers gap-free', (select max(split_part(invoice_no, '/', 3)::int) from invoices
  where business_id = tests.u('biz_a')), (select count(*)::int from invoices where business_id = tests.u('biz_a')));
select tests.eq('double-tap payment recorded once', (select count(*) from payments where idempotency_key = '$KEY'), 1::bigint);
select tests.eq('stock dropped by exactly 10', ($BEFORE - $AFTER)::numeric, 10::numeric);
" > /dev/null
echo "PASS     concurrency"
