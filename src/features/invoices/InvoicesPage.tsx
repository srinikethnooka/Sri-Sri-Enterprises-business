import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/format';
import { downloadInvoicePdf } from '@/lib/pdf';
import { useBusinessId } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorBox, Money, PageHeader, Pagination, SearchBox } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useDebounced } from '@/features/customers/CustomersPage';
import { safeSearch } from '@/features/customers/api';
import type { InvoicePayload } from '@/types/models';
import { InvoiceDocument } from './InvoiceDocument';

const PAGE = 25;

interface Row { id: string; invoice_no: string; issued_at: string; status: string; total: number; order_id: string; customer: { full_name: string }; bal: { paid: number; balance: number } | null }

export function InvoicesPage() {
  const bid = useBusinessId();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'cancelled'>('all');
  const [page, setPage] = useState(0);
  const t = safeSearch(useDebounced(term));

  const q = useQuery({
    queryKey: ['invoices', bid, t, filter, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (filter === 'unpaid') {
        let v = supabase.from('v_order_balances').select('order_id, invoice_id, invoice_no, issued_at, customer_name, total, paid, balance', { count: 'exact' })
          .eq('business_id', bid).not('invoice_id', 'is', null).gt('balance', 0).order('balance', { ascending: false });
        if (t) v = v.ilike('invoice_no', `%${t}%`);
        const { data, error, count } = await v.range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        return { rows: (data ?? []).map((r) => ({ id: r.invoice_id, invoice_no: r.invoice_no, issued_at: r.issued_at, status: 'issued', total: r.total, order_id: r.order_id,
          customer: { full_name: r.customer_name }, bal: { paid: r.paid, balance: r.balance } })) as Row[], total: count ?? 0 };
      }
      let s = supabase.from('invoices').select('id, invoice_no, issued_at, status, total, order_id, customer:customers!inner(full_name)', { count: 'exact' })
        .eq('business_id', bid).order('issued_at', { ascending: false });
      if (filter === 'cancelled') s = s.eq('status', 'cancelled');
      if (t) s = /^\d|\//.test(t) || /^[A-Z]{2,}/.test(t) ? s.ilike('invoice_no', `%${t}%`) : s.ilike('customer.full_name', `%${t}%`);
      const { data, error, count } = await s.range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []).map((r) => ({ ...r, bal: null })) as unknown as Row[], total: count ?? 0 };
    },
  });

  return (
    <div>
      <PageHeader title="Invoices & payments" subtitle="Open an invoice's order to record payments, share or cancel it." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-full max-w-sm"><SearchBox value={term} onChange={(v) => { setTerm(v); setPage(0); }} placeholder="Invoice number or customer" /></div>
        <select className="input w-auto" value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(0); }} aria-label="Filter">
          <option value="all">All invoices</option>
          <option value="unpaid">With balance due</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      {q.error && <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : !q.data?.rows.length ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No invoices found" /> : (
          <>
            <ul className="divide-y divide-cream-200">
              {q.data.rows.map((r) => (
                <li key={r.id}>
                  <Link to={`/orders/${r.order_id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream-50">
                    <div>
                      <p className="font-medium text-burgundy-700">{r.invoice_no} {r.status === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}</p>
                      <p className="text-sm text-ink-500">{r.customer.full_name}{r.issued_at && ` · ${fmtDate(r.issued_at)}`}</p>
                    </div>
                    <div className="text-right">
                      <Money value={r.total} strong />
                      {r.bal && <p className="text-sm text-burgundy-700">Due <Money value={r.bal.balance} /></p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

/** Staff print / preview of one invoice (same layout the customer sees). */
export function InvoiceViewPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['invoice-payload', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('staff_invoice_payload', { p_invoice_id: id });
      if (error) throw error;
      return data as InvoicePayload & { business_id: string };
    },
  });
  const orderId = useQuery({
    queryKey: ['invoice-order', id],
    queryFn: async () => (await supabase.from('invoices').select('order_id').eq('id', id).single()).data?.order_id as string,
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorBox message={errorMessage(q.error ?? 'Not found')} />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link to={orderId.data ? `/orders/${orderId.data}` : '/invoices'} className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Back to order</Link>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
          <Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={async () => {
            setBusy(true);
            try { await downloadInvoicePdf(id); } catch (e) { toast.error((e as Error).message); }
            setBusy(false);
          }}>Download PDF</Button>
        </div>
      </div>
      <InvoiceDocument p={q.data} />
    </div>
  );
}
