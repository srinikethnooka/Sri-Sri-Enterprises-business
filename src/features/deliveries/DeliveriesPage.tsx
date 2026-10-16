import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { DELIVERY_LABEL, fmtDateTime } from '@/lib/format';
import { useBusinessId } from '@/app/session';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Pagination, StatusBadge } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';

const PAGE = 25;

/** Orders ready to go out, plus recorded delivery bookings. */
export function DeliveriesPage() {
  const bid = useBusinessId();
  const [page, setPage] = useState(0);
  const ready = useQuery({
    queryKey: ['ready-orders', bid],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders')
        .select('id, order_no, status, due_at, delivery_method, delivery_address, customer:customers(full_name, phone_e164)')
        .eq('business_id', bid).in('status', ['ready', 'out_for_delivery']).order('due_at', { ascending: true, nullsFirst: false }).limit(100);
      if (error) throw error;
      return data as unknown as { id: string; order_no: string; status: string; due_at: string | null; delivery_method: string; delivery_address: string | null; customer: { full_name: string } }[];
    },
  });
  const log = useQuery({
    queryKey: ['deliveries', bid, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase.from('deliveries')
        .select('id, status, provider, booking_ref, dispatched_at, delivered_at, method, order:orders(id, order_no, customer:customers(full_name))', { count: 'exact' })
        .eq('business_id', bid).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as { id: string; status: string; provider: string | null; booking_ref: string | null; dispatched_at: string | null; delivered_at: string | null; method: string; order: { id: string; order_no: string; customer: { full_name: string } } }[], total: count ?? 0 };
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Deliveries" subtitle="Book Rapido or courier yourself, then record the reference on the order." />
      {(ready.error || log.error) && <ErrorBox message={errorMessage(ready.error ?? log.error)} />}
      <Card title="Ready to collect or send" padded={false}>
        {ready.isLoading ? <PageLoader /> : !ready.data?.length ? <EmptyState icon={<Truck className="h-6 w-6" />} title="Nothing waiting" /> : (
          <ul className="divide-y divide-cream-200">
            {ready.data.map((o) => (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream-50">
                  <div>
                    <p className="font-medium">{o.order_no} · {o.customer.full_name}</p>
                    <p className="text-sm text-ink-500">{DELIVERY_LABEL[o.delivery_method]}{o.delivery_address ? ` · ${o.delivery_address}` : ''}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Delivery log" padded={false}>
        {!log.data?.rows.length ? <EmptyState title="No deliveries recorded" /> : (
          <>
            <ul className="divide-y divide-cream-200 text-sm">
              {log.data.rows.map((d) => (
                <li key={d.id}>
                  <Link to={`/orders/${d.order.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream-50">
                    <div>
                      <p className="font-medium">{d.order.order_no} · {d.order.customer.full_name}</p>
                      <p className="text-ink-500">{d.provider || DELIVERY_LABEL[d.method]}{d.booking_ref ? ` · Ref ${d.booking_ref}` : ''}
                        {d.delivered_at ? ` · delivered ${fmtDateTime(d.delivered_at)}` : d.dispatched_at ? ` · sent ${fmtDateTime(d.dispatched_at)}` : ''}</p>
                    </div>
                    <Badge tone={d.status === 'delivered' ? 'good' : d.status === 'failed' ? 'danger' : 'neutral'}>{d.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={log.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
