import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus, ScanText } from 'lucide-react';
import clsx from 'clsx';
import { useBusinessId, useSession } from '@/app/session';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtDateTime, STATUS_LABEL } from '@/lib/format';
import { ButtonLink } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBox, Money, PageHeader, Pagination, SearchBox, StatusBadge } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useDebounced } from '@/features/customers/CustomersPage';
import { listOrders, type OrderFilters } from './api';

const PAGE = 25;
const LATE_EXEMPT = ['ready', 'out_for_delivery', 'delivered', 'cancelled', 'draft'];

export function OrdersPage() {
  const bid = useBusinessId();
  const { can } = useSession();
  const [sp, setSp] = useSearchParams();
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const [page, setPage] = useState(0);
  const t = useDebounced(term);

  const f: OrderFilters = {
    status: sp.get('status') === 'all' ? '' : ((sp.get('status') as OrderFilters['status']) ?? 'open'),
    due: (sp.get('due') as OrderFilters['due']) ?? '',
    workerId: sp.get('worker') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    term: t,
  };
  const setF = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
    setPage(0);
  };
  useEffect(() => setPage(0), [t]);

  const workers = useQuery({
    queryKey: ['workers', bid],
    queryFn: async () => (await supabase.from('workers').select('id, name').eq('business_id', bid).eq('active', true).order('name')).data ?? [],
  });
  const q = useQuery({
    queryKey: ['orders', bid, f, page],
    queryFn: () => listOrders(bid, f, page, PAGE),
    placeholderData: keepPreviousData,
  });
  const now = Date.now();

  return (
    <div>
      <PageHeader title="Orders" actions={can('orders.manage') && <>
        <ButtonLink to="/orders/scan" variant="secondary" icon={<ScanText className="h-4 w-4" />}>Scan bill book</ButtonLink>
        <ButtonLink to="/orders/new" icon={<Plus className="h-4 w-4" />}>New order</ButtonLink>
      </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="label" htmlFor="osearch">Search</label>
          <SearchBox value={term} onChange={setTerm} placeholder="Customer name or ORD number" />
        </div>
        <div>
          <label className="label" htmlFor="ostatus">Status</label>
          <select id="ostatus" className="input" value={sp.get('status') ?? 'open'} onChange={(e) => setF('status', e.target.value === 'open' ? '' : e.target.value)}>
            <option value="open">All open orders</option>
            <option value="all">All orders</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="odue">Deadline</label>
          <select id="odue" className="input" value={f.due} onChange={(e) => setF('due', e.target.value)}>
            <option value="">Any</option>
            <option value="today">Due today</option>
            <option value="week">Due within 7 days</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="oworker">Worker</label>
          <select id="oworker" className="input" value={f.workerId} onChange={(e) => setF('worker', e.target.value)}>
            <option value="">Anyone</option>
            {workers.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="ofrom">From</label><input id="ofrom" type="date" className="input" value={f.from} onChange={(e) => setF('from', e.target.value)} /></div>
          <div><label className="label" htmlFor="oto">To</label><input id="oto" type="date" className="input" value={f.to} onChange={(e) => setF('to', e.target.value)} /></div>
        </div>
      </div>

      {q.error && <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : !q.data?.rows.length ? (
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No orders found" body="Try changing the filters." />
        ) : (
          <>
            <ul className="divide-y divide-cream-200">
              {q.data.rows.map((o) => {
                const late = o.due_at && new Date(o.due_at).getTime() < now && !LATE_EXEMPT.includes(o.status);
                const atRisk = !late && o.due_at && new Date(o.due_at).getTime() - now < 36 * 3600_000 && ['confirmed', 'waiting_materials'].includes(o.status);
                return (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 hover:bg-cream-50 sm:grid-cols-[10rem_1fr_9rem_8rem_10rem]">
                      <span className="font-medium text-burgundy-700">{o.order_no}</span>
                      <span className="text-right sm:order-last sm:text-left"><StatusBadge status={o.status} /></span>
                      <span className="text-sm">{o.customer?.full_name}{o.worker && <span className="text-ink-500"> · {o.worker.name}</span>}</span>
                      <span className={clsx('text-sm', late ? 'font-medium text-burgundy-700' : atRisk ? 'font-medium text-amber-700' : 'text-ink-500')}>
                        {o.due_at ? `${late ? 'Late · ' : atRisk ? 'At risk · ' : ''}${fmtDateTime(o.due_at)}` : `Ordered ${fmtDate(o.order_date)}`}
                      </span>
                      <span className="text-right text-sm sm:text-left"><Money value={o.total} /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
