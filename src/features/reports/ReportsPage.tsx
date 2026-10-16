import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { fmtDate, fmtDateTime, rupees, toNum } from '@/lib/format';
import { periodFor, type Period } from '@/lib/periods';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorBox, PageHeader } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { PeriodPicker } from '@/components/PeriodPicker';
import type { Permission } from '@/types/models';

const REPORTS: { key: string; label: string; perms: Permission[] }[] = [
  { key: 'summary', label: 'Profit & loss summary', perms: ['finance.view'] },
  { key: 'monthly_profit', label: 'Monthly profitability', perms: ['finance.view'] },
  { key: 'sales_by_day', label: 'Sales by day', perms: ['finance.view'] },
  { key: 'order_profit', label: 'Profit per order', perms: ['finance.view'] },
  { key: 'collections', label: 'Collections (payments & refunds)', perms: ['payments.record', 'finance.view'] },
  { key: 'outstanding', label: 'Outstanding customer balances', perms: ['payments.record', 'finance.view'] },
  { key: 'expenses', label: 'Expenses', perms: ['finance.view'] },
  { key: 'purchases', label: 'Purchases', perms: ['finance.view'] },
  { key: 'supplier_balances', label: 'Supplier balances', perms: ['finance.view'] },
  { key: 'stock_valuation', label: 'Stock valuation', perms: ['inventory.manage', 'finance.view'] },
  { key: 'stock_movements', label: 'Stock movements', perms: ['inventory.manage', 'finance.view'] },
  { key: 'materials_by_order', label: 'Materials used by order', perms: ['finance.view'] },
  { key: 'orders_status', label: 'Orders (pending, overdue, completed)', perms: ['orders.manage'] },
  { key: 'service_performance', label: 'Service performance', perms: ['finance.view'] },
  { key: 'repeat_customers', label: 'Repeat customers', perms: ['customers.manage', 'finance.view'] },
  { key: 'worker_workload', label: 'Worker workload', perms: ['orders.manage'] },
];

const MONEY = /(amount|total|sales|cost|value|paid|balance|purchased|contribution|profit|expenses|collections|invoiced)$/;

function cell(k: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (MONEY.test(k) && (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)))) return rupees(v as number);
  if (/_at$/.test(k)) return fmtDateTime(String(v));
  if (/(date|day|month|last_order)$/.test(k)) return fmtDate(String(v));
  return String(v);
}

export function ReportsPage() {
  const bid = useBusinessId();
  const { canAny, can } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const allowed = REPORTS.filter((r) => canAny(...r.perms));
  const key = allowed.find((r) => r.key === sp.get('r'))?.key ?? allowed[0]?.key;
  const [period, setPeriod] = useState<Period>(periodFor('month'));

  const q = useQuery({
    queryKey: ['report', bid, key, period.from, period.to],
    enabled: !!key,
    queryFn: async () => {
      if (key === 'summary') {
        const { data, error } = await supabase.rpc('report_summary', { p_business_id: bid, p_from: period.from, p_to: period.to });
        if (error) throw error;
        return { summary: data as Record<string, number | boolean>, rows: [] as Record<string, unknown>[] };
      }
      const { data, error } = await supabase.rpc('run_report', { p_business_id: bid, p_name: key, p_from: period.from, p_to: period.to });
      if (error) throw error;
      return { summary: null, rows: data as Record<string, unknown>[] };
    },
  });

  const exp = useMutation({
    mutationFn: async () => {
      if (key === 'summary') {
        const s = q.data?.summary ?? {};
        return [Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== 'object'))];
      }
      const { data, error } = await supabase.rpc('export_report', { p_business_id: bid, p_name: key, p_from: period.from, p_to: period.to });
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
    onSuccess: (rows) => {
      if (!rows.length) return toast.error('Nothing to export');
      downloadCsv(`sri-sri-boutique_${key}_${period.from}_${period.to}.csv`, rows);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!allowed.length) return <EmptyState title="No reports available for your role" />;

  return (
    <div>
      <PageHeader title="Reports" actions={can('reports.export') && (
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={exp.isPending} onClick={() => exp.mutate()}>Export CSV</Button>
      )} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="rkey">Report</label>
          <select id="rkey" className="input" value={key} onChange={(e) => setSp({ r: e.target.value }, { replace: true })}>
            {allowed.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        {!['outstanding', 'supplier_balances', 'stock_valuation', 'worker_workload'].includes(key!) && <PeriodPicker value={period} onChange={setPeriod} />}
      </div>
      {q.isLoading && <PageLoader />}
      {q.error && <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.summary && <SummaryView s={q.data.summary} />}
      {q.data && !q.data.summary && (
        <Card padded={false}>
          {!q.data.rows.length ? <EmptyState title="No records for this period" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="table-head border-b border-cream-200 bg-cream-50">
                  <tr>{Object.keys(q.data.rows[0]).filter((k) => !k.endsWith('_id')).map((k) => <th key={k} className="capitalize">{k.replace(/_/g, ' ')}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-cream-200">
                  {q.data.rows.map((r, i) => (
                    <tr key={i} className="table-row">
                      {Object.entries(r).filter(([k]) => !k.endsWith('_id')).map(([k, v]) => (
                        <td key={k} className={MONEY.test(k) ? 'num whitespace-nowrap text-right' : ''}>{cell(k, v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <ReportTotals rows={q.data.rows} />
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ReportTotals({ rows }: { rows: Record<string, unknown>[] }) {
  const keys = Object.keys(rows[0]).filter((k) => !k.endsWith('_id'));
  const sums = keys.map((k) => (MONEY.test(k) && !/(avg_cost|unit_cost)$/.test(k) ? rows.reduce((a, r) => a + toNum(r[k] as number), 0) : null));
  if (sums.every((s) => s === null)) return null;
  return (
    <tfoot className="border-t-2 border-gold-300 bg-cream-50 font-semibold">
      <tr className="table-row">{sums.map((s, i) => <td key={i} className="num whitespace-nowrap text-right">{i === 0 ? 'Total' : s === null ? '' : rupees(s)}</td>)}</tr>
    </tfoot>
  );
}

function SummaryView({ s }: { s: Record<string, number | boolean> }) {
  const r = (k: string) => rupees(s[k] as number);
  const Row = ({ k, label, minus, strong, hint }: { k: string; label: string; minus?: boolean; strong?: boolean; hint?: string }) => (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? 'border-t border-cream-300 font-semibold' : ''}`}>
      <dt>{label}{hint && <span className="block text-xs font-normal text-ink-500">{hint}</span>}</dt>
      <dd className="num">{minus ? rupees(-toNum(s[k] as number)) : r(k)}</dd>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2">Profit & loss {!s.profit_is_complete && <Badge tone="warn">Incomplete</Badge>}</span>}>
        {!s.profit_is_complete && (
          <div className="mb-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {String(s.cost_incomplete_lines)} invoiced item(s) do not have confirmed costs yet. Profit below is an estimate, not actual profit.
          </div>
        )}
        <dl className="text-sm">
          <Row k="gross_sales" label="Gross sales" hint={`${s.invoice_count} issued invoice(s), before discounts`} />
          <Row k="line_discounts" label="Item discounts" minus />
          <Row k="order_discounts" label="Order discounts" minus />
          <Row k="net_sales" label="Net sales" strong />
          <Row k="materials_cost_of_sales" label="Materials used on these orders" minus />
          <Row k="labour_cost" label="Direct labour" minus />
          <Row k="other_direct_cost" label="Other direct costs" minus />
          <Row k="gross_profit" label="Gross profit" strong />
          <Row k="delivery_income" label="Delivery charges billed" />
          <Row k="operating_expenses" label="Operating expenses" minus />
          <Row k="delivery_costs" label="Delivery costs paid" minus />
          <Row k="stock_losses" label="Stock written off (waste, corrections)" minus />
          <div className="flex justify-between border-t-2 border-gold-500 py-2 text-base font-semibold text-burgundy-700"><dt>Net operating profit</dt><dd className="num">{r('net_operating_profit')}</dd></div>
        </dl>
      </Card>
      <div className="space-y-4">
        <Card title="Cash & balances (not profit)">
          <dl className="text-sm">
            <Row k="invoiced_total" label="Total invoiced (incl. tax & delivery)" />
            <Row k="collections" label="Money collected (payments − refunds)" />
            <Row k="refunds" label="Refunds paid" />
            <Row k="receivables_now" label="Customers owe now" hint="All open invoices, any date" />
            <Row k="tax_collected" label="Tax collected" />
            <Row k="inventory_purchases" label="Stock purchased" hint="Becomes cost only when used on an order" />
            <Row k="materials_consumed_by_date" label="Materials used in this period" hint="By date used; P&L uses materials on invoiced orders" />
          </dl>
        </Card>
        <Card title="How these numbers work">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
            <li>Sales count on the invoice date. Cancelled invoices are excluded.</li>
            <li>Costs are matched to the orders invoiced in the period (materials at weighted-average cost, labour and other costs entered per item).</li>
            <li>Buying stock is not an expense; it becomes cost when used.</li>
            <li>Collections are cash in hand, which differs from profit when customers pay later or in advance.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
