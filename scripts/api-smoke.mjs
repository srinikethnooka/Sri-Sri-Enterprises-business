// Runs the app's real PostgREST queries (same select strings as the UI) against a
// test database behind PostgREST, as owner, staff and customer. Catches broken
// embeds, wrong column names and RPC signature mismatches before deployment.
// Usage: API_URL=http://localhost:3555 JWT_SECRET=... node scripts/api-smoke.mjs
import { createHmac } from 'node:crypto';
import { PostgrestClient } from '@supabase/postgrest-js';

const URL = process.env.API_URL ?? 'http://localhost:3555';
const SECRET = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub, role = 'authenticated') {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const as = (sub) => new PostgrestClient(URL, { headers: { Authorization: `Bearer ${jwt(sub)}` } });
const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const STAFF = 'aaaaaaaa-0000-0000-0000-000000000002';
const CUST = 'aaaaaaaa-0000-0000-0000-000000000003';

let failed = 0;
async function check(label, p, expect = (r) => !r.error) {
  const r = await p;
  const ok = expect(r);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(r.error ?? r.data).slice(0, 300)}`}`);
  if (!ok) failed++;
  return r;
}

const owner = as(OWNER);
const staff = as(STAFF);
const cust = as(CUST);

const m = await check('memberships with business + permissions', owner.from('business_members')
  .select('id, business_id, role, display_name, business:businesses(*), member_permissions(permission)').eq('user_id', OWNER).eq('active', true),
  (r) => !r.error && r.data.length === 1 && r.data[0].business?.name);
const bid = m.data[0].business_id;
const today = new Date().toISOString().slice(0, 10);

await check('dashboard (owner, with finance)', owner.rpc('dashboard_summary', { p_business_id: bid, p_from: today, p_to: today }), (r) => !r.error && r.data.summary);
await check('dashboard (staff, no finance)', staff.rpc('dashboard_summary', { p_business_id: bid, p_from: today, p_to: today }), (r) => !r.error && !r.data.summary);
await check('notifications refresh', owner.rpc('refresh_notifications', { p_business_id: bid }));
await check('notifications list', owner.from('notifications').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(30));
await check('customers search', owner.from('customers').select('*', { count: 'exact' }).eq('business_id', bid)
  .or('full_name.ilike.*anj*,customer_code.ilike.*anj*').range(0, 24), (r) => !r.error && r.data.length >= 1);
await check('customers phone search', owner.from('customers').select('*').eq('business_id', bid).or('full_name.ilike.*99000*,phone_e164.ilike.*99000*'), (r) => !r.error && r.data.length >= 1);
await check('customer balance view', owner.from('v_customer_balances').select('*').limit(5));
await check('orders list with embeds', owner.from('orders').select('*, customer:customers(full_name, phone_e164), worker:workers(name)', { count: 'exact' })
  .eq('business_id', bid).not('status', 'in', '(delivered,cancelled)').order('created_at', { ascending: false }).range(0, 24), (r) => !r.error && r.data[0]?.customer?.full_name);
await check('orders filtered by customer name (!inner)', owner.from('orders').select('*, customer:customers!inner(full_name, phone_e164), worker:workers(name)')
  .eq('business_id', bid).ilike('customer.full_name', '%anj%'), (r) => !r.error && r.data.length >= 1);
await check('orders overdue filter', owner.from('orders').select('id').eq('business_id', bid).lt('due_at', new Date().toISOString()).not('status', 'in', '("ready","out_for_delivery","delivered","cancelled","draft")'));
const o = await check('order detail', owner.from('orders').select('*, customer:customers!inner(*), worker:workers(id, name)').eq('business_id', bid)
  .eq('customer.user_id', CUST).limit(1).single(), (r) => !r.error && r.data.customer);
const oid = o.data.id;
await check('order lines', owner.from('order_lines').select('*').eq('order_id', oid).order('position'));
await check('order internal', owner.from('order_internal').select('priority, internal_notes').eq('order_id', oid).maybeSingle());
await check('status history', owner.from('order_status_history').select('*').eq('order_id', oid).order('changed_at'));
await check('order costs (owner sees)', owner.from('order_line_costs').select('*').limit(5), (r) => !r.error && r.data.length > 0);
await check('order costs (staff sees none)', staff.from('order_line_costs').select('*').limit(5), (r) => !r.error && r.data.length === 0);
const lines = (await owner.from('order_lines').select('id').eq('order_id', oid)).data.map((l) => l.id);
await check('materials used on order', owner.from('stock_movements').select('id, material_id, type, qty, unit_cost, value, order_line_id, created_at, reason, material:materials(name, unit)').in('order_line_id', lines));
await check('deliveries', owner.from('deliveries').select('*').eq('order_id', oid));
await check('images', owner.from('attachments').select('id, path, visibility, caption, created_by').eq('entity_type', 'order').eq('entity_id', oid).eq('bucket', 'order-images'));
const inv = await check('invoices on order', owner.from('invoices').select('*').eq('order_id', oid).order('issued_at', { ascending: false }), (r) => !r.error && r.data.length > 0);
const live = inv.data.find((i) => i.status === 'issued');
await check('payments on order', owner.from('payments').select('*').eq('order_id', oid).order('received_at'));
await check('share links', owner.from('invoice_share_links').select('id, created_at, expires_at, revoked_at, open_count, last_opened_at').eq('invoice_id', live.id));
await check('staff invoice payload', owner.rpc('staff_invoice_payload', { p_invoice_id: live.id }), (r) => !r.error && r.data.lines.length > 0);
await check('invoices list with customer', owner.from('invoices').select('id, invoice_no, issued_at, status, total, order_id, customer:customers!inner(full_name)', { count: 'exact' }).eq('business_id', bid));
await check('unpaid via balances view', owner.from('v_order_balances').select('order_id, invoice_id, invoice_no, issued_at, customer_name, total, paid, balance').eq('business_id', bid).not('invoice_id', 'is', null).gt('balance', 0));
await check('materials stock view', owner.from('v_material_stock').select('*', { count: 'exact' }).eq('business_id', bid).or('name.ilike.*zari*,code.ilike.*zari*'), (r) => !r.error && r.data.length === 1);
await check('material detail with supplier', owner.from('materials').select('*, supplier:suppliers(name)').eq('business_id', bid).limit(1).single());
await check('material movements with order link', owner.from('stock_movements').select('id, type, qty, unit_cost, value, reason, created_at, order_line:order_lines(order_id, order:orders(order_no))').limit(5));
await check('purchases list', owner.from('purchases').select('*, supplier:suppliers(name)', { count: 'exact' }).eq('business_id', bid));
await check('purchase lines with material', owner.from('purchase_lines').select('*, material:materials(name, unit)').limit(5));
await check('supplier balances', owner.from('v_supplier_balances').select('supplier_id, purchased, paid, balance').eq('business_id', bid));
await check('expenses with category', owner.from('expenses').select('*, category:expense_categories(name)', { count: 'exact' }).eq('business_id', bid));
await check('ready orders', owner.from('orders').select('id, order_no, status, due_at, delivery_method, delivery_address, customer:customers(full_name, phone_e164)').eq('business_id', bid).in('status', ['ready', 'out_for_delivery']));
await check('delivery log', owner.from('deliveries').select('id, status, provider, booking_ref, dispatched_at, delivered_at, method, order:orders(id, order_no, customer:customers(full_name))').eq('business_id', bid));
for (const r of ['sales_by_day', 'collections', 'outstanding', 'expenses', 'purchases', 'supplier_balances', 'stock_valuation', 'stock_movements', 'materials_by_order', 'order_profit', 'monthly_profit', 'orders_status', 'service_performance', 'repeat_customers', 'worker_workload']) {
  await check(`report ${r}`, owner.rpc('run_report', { p_business_id: bid, p_name: r, p_from: '2026-04-01', p_to: today }), (x) => !x.error && Array.isArray(x.data));
}
await check('report summary', owner.rpc('report_summary', { p_business_id: bid, p_from: '2026-04-01', p_to: today }));
await check('staff list', owner.from('business_members').select('id, user_id, role, display_name, active, member_permissions(permission)').eq('business_id', bid).in('role', ['owner', 'staff']), (r) => !r.error && r.data.length >= 2);
await check('services + categories', owner.from('services').select('*').eq('business_id', bid).order('name'));
await check('portal overview (customer)', cust.rpc('portal_overview'), (r) => !r.error && r.data[0].orders.length >= 1 && !JSON.stringify(r.data).includes('internal'));
await check('portal invoice (customer)', cust.rpc('portal_invoice', { p_invoice_id: live.id }), (r) => !r.error && r.data.invoice);
const other = (await owner.from('invoices').select('id, customer:customers!inner(user_id)').eq('status', 'issued').neq('customer.user_id', CUST).limit(1).single()).data;
await check('customer cannot open another customer invoice', cust.rpc('portal_invoice', { p_invoice_id: other.id }), (r) => !!r.error);
await check('customer cannot list orders', cust.from('orders').select('id'), (r) => !r.error && r.data.length === 0);
await check('anon is blocked', new PostgrestClient(URL).from('customers').select('id'), (r) => !!r.error);
await check('customer cannot open shared-invoice RPC', cust.rpc('open_shared_invoice', { p_token: 'x' }), (r) => !!r.error);

// ---- Writes the UI makes directly (RLS-checked, not via RPC)
const newCust = await check('insert customer + return row', staff.from('customers').insert({ business_id: bid, full_name: 'Smoke Test', phone_e164: '+919812345678' }).select().single(),
  (r) => !r.error && /^\d{4,}$/.test(r.data.customer_code));
await check('update customer', owner.from('customers').update({ notes: 'VIP' }).eq('id', newCust.data.id));
await check('insert measurements', staff.from('measurement_sets').insert({ business_id: bid, customer_id: newCust.data.id, values: { bust: 34 } }));
await check('save order via RPC (UI payload shape)', staff.rpc('save_order', { p: { business_id: bid, customer_id: newCust.data.id, idempotency_key: crypto.randomUUID(),
  due_at: null, delivery_method: 'pickup', delivery_address: null, measurement_set_id: null, assigned_worker_id: null, priority: 'normal',
  order_discount: 0, delivery_charge: 0, customer_notes: null, internal_notes: null,
  lines: [{ service_id: null, description: 'Smoke item', customer_description: null, garment_details: null, qty: 1, unit: 'pcs', unit_price: 500, line_discount: 0, internal_notes: null }] } }));
await check('business settings update', owner.from('businesses').update({ payment_instructions: 'UPI: test@upi' }).eq('id', bid));
await check('staff cannot update settings (0 rows)', staff.from('businesses').update({ name: 'Hacked' }).eq('id', bid).select(), (r) => !r.error && r.data.length === 0);
await check('insert worker', owner.from('workers').insert({ business_id: bid, name: 'Lakshmi' }));
const sup = await check('insert supplier', owner.from('suppliers').insert({ business_id: bid, name: 'Smoke Supplier' }).select('id').single());
const mat = await check('insert material', owner.from('materials').insert({ business_id: bid, code: 'SMK', name: 'Smoke Thread', unit: 'roll', reorder_level: 2 }).select('id').single());
const pur = await check('insert purchase', owner.from('purchases').insert({ business_id: bid, supplier_id: sup.data.id, other_charges: 0, discount: 0 }).select('id').single());
await check('insert purchase line', owner.from('purchase_lines').insert({ business_id: bid, purchase_id: pur.data.id, material_id: mat.data.id, qty: 5, unit_cost: 40 }));
await check('receive purchase', owner.rpc('receive_purchase', { p_purchase_id: pur.data.id }));
await check('stock is 5', owner.from('materials').select('on_hand').eq('id', mat.data.id).single(), (r) => Number(r.data.on_hand) === 5);
const cat = (await owner.from('expense_categories').select('id').eq('business_id', bid).limit(1).single()).data;
const exp = await check('insert expense', owner.from('expenses').insert({ business_id: bid, category_id: cat.id, amount: 120, description: 'Tea' }).select('id').single());
await check('edit expense', owner.from('expenses').update({ amount: 130 }).eq('id', exp.data.id));
await check('void expense', owner.rpc('void_expense', { p_expense_id: exp.data.id, p_reason: 'test' }));
await check('insert delivery', owner.from('deliveries').insert({ business_id: bid, order_id: oid, method: 'rapido', status: 'booked', provider: 'Rapido', charge_to_shop: 60 }));
await check('insert attachment row', owner.from('attachments').insert({ business_id: bid, bucket: 'order-images', path: `${bid}/${oid}/x.jpg`, entity_type: 'order', entity_id: oid }));
await check('attachment with wrong path prefix rejected', owner.from('attachments').insert({ business_id: bid, bucket: 'order-images', path: `other/${oid}/y.jpg`, entity_type: 'order', entity_id: oid }), (r) => !!r.error);
const note = (await owner.from('notifications').select('id').eq('business_id', bid).limit(1).maybeSingle()).data;
if (note) await check('mark notification read', owner.from('notification_reads').upsert([{ notification_id: note.id, user_id: OWNER }], { ignoreDuplicates: true }));
await check('log WhatsApp share', owner.rpc('log_message_share', { p_business_id: bid, p_purpose: 'invoice', p_message: 'hi', p_phone: '+919900000001', p_order_id: oid, p_invoice_id: live.id, p_channel: 'whatsapp_manual' }));
await check('create customer invite', owner.rpc('create_invite', { p_business_id: bid, p_kind: 'customer', p_customer_id: newCust.data.id, p_display_name: 'Smoke' }), (r) => !r.error && r.data.length > 30);
await check('export needs reports.export (staff)', staff.rpc('export_report', { p_business_id: bid, p_name: 'collections', p_from: '2026-01-01', p_to: today }), (r) => !!r.error);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll API checks passed');
process.exit(failed ? 1 : 0);
