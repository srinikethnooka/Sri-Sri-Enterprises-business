import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarClock, PackageX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBusinessId, useSession } from '@/app/session';
import { periodFor, type Period } from '@/lib/periods';
import { fmtDateTime, rupees, toNum } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { PeriodPicker } from '@/components/PeriodPicker';
import { Card, EmptyState, ErrorBox, PageHeader, Stat, StatusBadge, Badge } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';

interface Summary {
  gross_sales: number; net_sales: number; collections: number; receivables_now: number;
  inventory_purchases: number; materials_cost_of_sales: number; labour_cost: number; other_direct_cost: number;
  gross_profit: number; operating_expenses: number; net_operating_profit: number;
  profit_is_complete: boolean; cost_incomplete_lines: number; invoiced_total: number; refunds: number;
}
interface Dash {
  permissions: { orders: boolean; money: boolean; finance: boolean; inventory: boolean };
  orders_today?: number; in_progress?: number; waiting_materials?: number; ready?: number; due_today?: number; overdue?: number;
  upcoming?: { id: string; order_no: string; customer: string; due_at: string; status: string; is_late: boolean }[];
  collections_today?: number; collections_period?: number; invoiced_period?: number; outstanding?: number;
  low_stock?: { id: string; name: string; on_hand: number; unit: string; reorder_level: number }[];
  summary?: Summary;
  trend?: { month: string; net_sales: number; collections: number; operating_expenses: number; gross_profit: number; profit_is_complete: boolean }[];
  recent_purchases?: { purchase_no: string; supplier: string; total: number; purchase_date: string; status: string }[];
  recent_expenses?: { description: string; category: string; amount: number; expense_date: string }[];
}

export function DashboardPage() {
  const bid = useBusinessId();
  const { current } = useSession();
  const [period, setPeriod] = useState<Period>(periodFor('month'));
  const q = useQuery({
    queryKey: ['dashboard', bid, period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_summary', { p_business_id: bid, p_from: period.from, p_to: period.to });
      if (error) throw error;
      return data as Dash;
    },
  });

  return (
    <div>
      <PageHeader
        title={`Namaste${current?.display_name ? `, ${current.display_name.split(' ')[0]}` : ''}`}
        subtitle={`Here is how ${current?.business.name ?? 'the boutique'} is doing.`}
      />
      <div className="mb-5"><PeriodPicker value={period} onChange={setPeriod} /></div>
      {q.isLoading && <PageLoader />}
      {q.error && <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && <DashboardBody d={q.data} />}
    </div>
  );
}

function DashboardBody({ d }: { d: Dash }) {
  const s = d.summary;
  return (
    <div className="space-y-6">
      {d.permissions.orders && (
        <section aria-label="Orders">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Received today" value={d.orders_today ?? 0} to="/orders" />
            <Stat label="In progress" value={d.in_progress ?? 0} to="/orders?status=in_progress" />
            <Stat label="Waiting materials" value={d.waiting_materials ?? 0} tone={d.waiting_materials ? 'warn' : undefined} to="/orders?status=waiting_materials" />
            <Stat label="Ready to collect" value={d.ready ?? 0} tone={d.ready ? 'good' : undefined} to="/orders?status=ready" />
            <Stat label="Due today" value={d.due_today ?? 0} tone={d.due_today ? 'warn' : undefined} to="/orders?due=today" />
            <Stat label="Overdue" value={d.overdue ?? 0} tone={d.overdue ? 'danger' : undefined} to="/orders?due=overdue" />
          </div>
        </section>
      )}

      {d.permissions.money && (
        <section aria-label="Money" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Collected today" value={rupees(d.collections_today, { whole: true })} hint="Payments minus refunds" />
          <Stat label="Collected in period" value={rupees(d.collections_period, { whole: true })} />
          <Stat label="Invoiced in period" value={rupees(d.invoiced_period, { whole: true })} hint="Sales billed, paid or not" />
          <Stat label="Customers owe" value={rupees(d.outstanding, { whole: true })} tone={toNum(d.outstanding) > 0 ? 'warn' : undefined} hint="All open invoices" to="/reports?r=outstanding" />
        </section>
      )}

      {s && (
        <section aria-label="Profit" className="grid gap-4 lg:grid-cols-3">
          <Card title="Profit for the period" className="lg:col-span-1">
            {!s.profit_is_complete && (
              <div className="mb-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Incomplete — {s.cost_incomplete_lines} item(s) have no confirmed costs, so profit is an estimate.</span>
              </div>
            )}
            <dl className="space-y-1.5 text-sm">
              {[
                ['Net sales', s.net_sales],
                ['Materials used', -toNum(s.materials_cost_of_sales)],
                ['Labour', -toNum(s.labour_cost)],
                ['Other direct costs', -toNum(s.other_direct_cost)],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-ink-500">{k}</dt><dd className="num">{rupees(v as number)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-cream-200 pt-1.5 font-semibold"><dt>Gross profit</dt><dd className="num">{rupees(s.gross_profit)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Operating expenses</dt><dd className="num">{rupees(-toNum(s.operating_expenses))}</dd></div>
              <div className="flex justify-between border-t border-cream-200 pt-1.5 text-base font-semibold text-burgundy-700">
                <dt>Net operating profit {s.profit_is_complete ? '' : <Badge tone="warn">Estimate</Badge>}</dt>
                <dd className="num">{rupees(s.net_operating_profit)}</dd>
              </div>
              <div className="flex justify-between pt-2 text-xs text-ink-500"><dt>Stock bought (not an expense)</dt><dd className="num">{rupees(s.inventory_purchases)}</dd></div>
            </dl>
            <Link to="/reports" className="mt-3 inline-block text-sm font-medium text-burgundy-700">Full report →</Link>
          </Card>
          <Card title="Last 6 months" className="lg:col-span-2">
            {d.trend && d.trend.length > 0 ? (
              <div className="h-64" role="img" aria-label="Monthly sales, collections and expenses">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.trend.map((t) => ({
                    month: new Date(t.month + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' }),
                    Sales: toNum(t.net_sales), Collected: toNum(t.collections), Expenses: toNum(t.operating_expenses),
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9DCC1" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} width={48} />
                    <Tooltip formatter={(v) => rupees(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Sales" fill="#731729" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Collected" fill="#B08C45" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Expenses" fill="#8A817A" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState title="No data yet" />}
          </Card>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {d.upcoming && (
          <Card title="Deadlines (next 7 days)" padded={false}>
            {d.upcoming.length === 0 ? (
              <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Nothing due this week" />
            ) : (
              <ul className="divide-y divide-cream-200">
                {d.upcoming.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-cream-50">
                      <div>
                        <p className="font-medium">{o.order_no} · {o.customer}</p>
                        <p className={o.is_late ? 'text-sm font-medium text-burgundy-700' : 'text-sm text-ink-500'}>
                          {o.is_late ? 'Late — was due ' : 'Due '}{fmtDateTime(o.due_at)}
                        </p>
                      </div>
                      <StatusBadge status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {d.low_stock && (
          <Card title="Low stock" padded={false} actions={<Link className="text-sm font-medium text-burgundy-700" to="/inventory?low=1">View all</Link>}>
            {d.low_stock.length === 0 ? (
              <EmptyState icon={<PackageX className="h-6 w-6" />} title="Stock levels are fine" />
            ) : (
              <ul className="divide-y divide-cream-200">
                {d.low_stock.map((m) => (
                  <li key={m.id}>
                    <Link to={`/inventory/${m.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-cream-50">
                      <span className="font-medium">{m.name}</span>
                      <span className="num text-sm text-burgundy-700">{toNum(m.on_hand)} {m.unit} left · reorder at {toNum(m.reorder_level)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {d.recent_purchases && (
          <Card title="Recent purchases" padded={false}>
            {d.recent_purchases.length === 0 ? <EmptyState title="No purchases yet" /> : (
              <ul className="divide-y divide-cream-200 text-sm">
                {d.recent_purchases.map((p) => (
                  <li key={p.purchase_no} className="flex justify-between px-4 py-2.5">
                    <span>{p.purchase_no} · {p.supplier} <span className="text-ink-500">({p.status})</span></span>
                    <span className="num">{rupees(p.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {d.recent_expenses && (
          <Card title="Recent expenses" padded={false}>
            {d.recent_expenses.length === 0 ? <EmptyState title="No expenses yet" /> : (
              <ul className="divide-y divide-cream-200 text-sm">
                {d.recent_expenses.map((e, i) => (
                  <li key={i} className="flex justify-between px-4 py-2.5">
                    <span>{e.description} <span className="text-ink-500">· {e.category}</span></span>
                    <span className="num">{rupees(e.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
