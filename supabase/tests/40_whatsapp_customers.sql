-- 4-digit customer IDs, WhatsApp status tracking, customer photos.
\set ON_ERROR_STOP 1
\set as_owner_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000001''); set role authenticated;'
\set as_staff_a 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000002''); set role authenticated;'
\set as_cust1 'reset role; select tests.claims(''aaaaaaaa-0000-0000-0000-000000000003''); set role authenticated;'
\o /dev/null

reset role;
select tests.ok('all customer IDs are 4+ digits', (select bool_and(customer_code ~ '^\d{4,}$') from customers));
select tests.eq('IDs are unique per boutique', (select count(*) from (select business_id, customer_code from customers group by 1, 2 having count(*) > 1) d), 0::bigint);
select tests.eq('first customer of each boutique is 1001', (select count(*) from customers where customer_code = '1001'), (select count(distinct business_id) from customers));

:as_staff_a
insert into customers (business_id, full_name, phone_e164) values (tests.u('biz_a'), 'Revathi', '+919700011122');
select tests.setv('c_wa', (select id from customers where phone_e164 = '+919700011122')::text);
select tests.ok('new customer gets the next 4-digit ID', (select customer_code ~ '^\d{4}$' and customer_code::int > 1001 from customers where id = tests.u('c_wa')));
select tests.eq('status starts unknown', (select whatsapp_status from customers where id = tests.u('c_wa')), 'unknown');
select tests.throws('staff cannot set WhatsApp status by hand', $$update customers set whatsapp_status = 'yes' where id = tests.u('c_wa')$$, 'set from delivery results');
select tests.throws('staff cannot write message log', $$insert into whatsapp_messages (business_id, phone_e164, status) values (tests.u('biz_a'), '+91', 'sent')$$, 'permission denied');
select tests.throws('staff cannot call status update', $$select public.whatsapp_status_update('x', 'read', null, null)$$, 'permission denied');

-- Customer photos
insert into attachments (business_id, bucket, path, entity_type, entity_id)
values (tests.u('biz_a'), 'order-images', tests.v('biz_a') || '/customers/' || tests.v('c_wa') || '/p.jpg', 'customer', tests.u('c_wa'));
select tests.eq('customer photo stored', (select count(*) from attachments where entity_type = 'customer' and entity_id = tests.u('c_wa')), 1::bigint);

-- WhatsApp results as the webhook (service role) reports them
reset role;
insert into whatsapp_messages (business_id, customer_id, phone_e164, wamid, status) values
  (tests.u('biz_a'), tests.u('c_wa'), '+919700011122', 'wamid.1', 'accepted'),
  (tests.u('biz_a'), tests.u('c2'), '+919900000002', 'wamid.2', 'accepted');
set role service_role;
select public.whatsapp_status_update('wamid.1', 'read', null, null);
select public.whatsapp_status_update('wamid.1', 'delivered', null, null);   -- arrives late; must not go backwards
select public.whatsapp_status_update('wamid.2', 'failed', '131026', 'Message undeliverable');
select public.whatsapp_status_update('wamid.unknown', 'read', null, null);  -- ignored
reset role;
select tests.eq('read stays read', (select status from whatsapp_messages where wamid = 'wamid.1'), 'read');
select tests.eq('customer has WhatsApp', (select whatsapp_status from customers where id = tests.u('c_wa')), 'yes');
select tests.eq('undeliverable = not on WhatsApp', (select status from whatsapp_messages where wamid = 'wamid.2'), 'not_on_whatsapp');
select tests.eq('customer marked no WhatsApp', (select whatsapp_status from customers where id = tests.u('c2')), 'no');

:as_owner_a
update customers set whatsapp_e164 = '+919700099999' where id = tests.u('c2');
select tests.eq('new number resets status', (select whatsapp_status from customers where id = tests.u('c2')), 'unknown');
select tests.eq('owner sees message log', (select count(*) from whatsapp_messages where business_id = tests.u('biz_a')), 2::bigint);
:as_cust1
select tests.eq('customer sees no message log', (select count(*) from whatsapp_messages), 0::bigint);
select tests.eq('customer sees no customer photos', (select count(*) from attachments), 0::bigint);
reset role;
\o
select 'whatsapp + customers ok' as result;
