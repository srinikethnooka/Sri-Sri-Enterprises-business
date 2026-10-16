import { supabase } from '@/lib/supabase';
import { addDays, todayIST } from '@/lib/format';
import { safeSearch } from '@/features/customers/api';
import type { Customer, Invoice, Order, OrderLine, OrderStatus, Payment } from '@/types/models';

export interface OrderListRow extends Order {
  customer: Pick<Customer, 'full_name' | 'phone_e164'>;
  worker: { name: string } | null;
}

export interface OrderFilters {
  status?: OrderStatus | 'open' | '';
  due?: 'today' | 'overdue' | 'week' | '';
  term?: string;
  workerId?: string;
  from?: string;
  to?: string;
  customerId?: string;
}

const CLOSED: OrderStatus[] = ['delivered', 'cancelled'];
const DONE_FOR_DEADLINE = '("ready","out_for_delivery","delivered","cancelled","draft")';

export async function listOrders(bid: string, f: OrderFilters, page: number, pageSize: number) {
  const term = safeSearch(f.term ?? '');
  const byCustomer = term && !/^ord/i.test(term) && !/^\d/.test(term);
  let q = supabase
    .from('orders')
    .select(`*, customer:customers${byCustomer ? '!inner' : ''}(full_name, phone_e164), worker:workers(name)`, { count: 'exact' })
    .eq('business_id', bid);

  if (f.status === 'open') q = q.not('status', 'in', `(${CLOSED.join(',')})`);
  else if (f.status) q = q.eq('status', f.status);
  if (f.customerId) q = q.eq('customer_id', f.customerId);
  if (f.workerId) q = q.eq('assigned_worker_id', f.workerId);
  if (f.from) q = q.gte('order_date', f.from);
  if (f.to) q = q.lte('order_date', f.to);

  const today = todayIST();
  if (f.due === 'today') {
    q = q.gte('due_at', `${today}T00:00:00+05:30`).lt('due_at', `${addDays(today, 1)}T00:00:00+05:30`).not('status', 'in', '(delivered,cancelled)');
  } else if (f.due === 'overdue') {
    q = q.lt('due_at', new Date().toISOString()).not('status', 'in', DONE_FOR_DEADLINE);
  } else if (f.due === 'week') {
    q = q.lt('due_at', `${addDays(today, 7)}T23:59:59+05:30`).not('status', 'in', '(delivered,cancelled)');
  }

  if (term) {
    if (byCustomer) q = q.ilike('customer.full_name', `%${term}%`);
    else q = q.ilike('order_no', `%${term}%`);
  }

  q = f.due ? q.order('due_at', { ascending: true, nullsFirst: false }) : q.order('created_at', { ascending: false });
  const { data, error, count } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as OrderListRow[], total: count ?? 0 };
}

export interface OrderFull {
  order: Order;
  customer: Customer;
  lines: OrderLine[];
  internal: { priority: 'normal' | 'high' | 'urgent'; internal_notes: string | null } | null;
  history: { id: number; from_status: OrderStatus | null; to_status: OrderStatus; note: string | null; changed_at: string; changed_by: string | null }[];
  invoices: Invoice[];
  payments: Payment[];
  worker: { id: string; name: string } | null;
}

export async function getOrderFull(id: string): Promise<OrderFull> {
  const o = await supabase.from('orders').select('*, customer:customers(*), worker:workers(id, name)').eq('id', id).single();
  if (o.error) throw o.error;
  const [lines, internal, history, invoices, payments] = await Promise.all([
    supabase.from('order_lines').select('*').eq('order_id', id).order('position'),
    supabase.from('order_internal').select('priority, internal_notes').eq('order_id', id).maybeSingle(),
    supabase.from('order_status_history').select('*').eq('order_id', id).order('changed_at'),
    supabase.from('invoices').select('*').eq('order_id', id).order('issued_at', { ascending: false }),
    supabase.from('payments').select('*').eq('order_id', id).order('received_at'),
  ]);
  const { customer, worker, ...order } = o.data as Order & { customer: Customer; worker: { id: string; name: string } | null };
  return {
    order,
    customer,
    worker,
    lines: (lines.data ?? []) as OrderLine[],
    internal: internal.data ?? null,
    history: history.data ?? [],
    invoices: (invoices.data ?? []) as Invoice[],
    payments: (payments.data ?? []) as Payment[],
  };
}

export function paidTotal(payments: Payment[]): number {
  return payments.reduce((a, p) => a + Number(p.signed_amount), 0);
}
