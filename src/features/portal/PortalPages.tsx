import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, LogOut, MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadInvoicePdf } from '@/lib/pdf';
import { DELIVERY_LABEL, fmtDate, fmtDateTime, qtyText, rupees, toNum } from '@/lib/format';
import { prettyPhone, waDigits } from '@/lib/phone';
import { useSession } from '@/app/session';
import { Brand } from '@/app/Brand';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBox, Money, StatusBadge } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { InvoiceDocument } from '@/features/invoices/InvoiceDocument';
import type { InvoicePayload, OrderStatus } from '@/types/models';

interface PortalOrder {
  id: string; order_no: string; status: OrderStatus; order_date: string; due_at: string | null; delivery_method: string; notes: string | null;
  total: number; paid: number; balance: number;
  items: { description: string; qty: number; unit: string; unit_price: number; line_discount: number; line_subtotal: number }[];
  invoice: { id: string; invoice_no: string; issued_at: string } | null;
  delivery: { status: string; provider: string | null; dispatched_at: string | null; delivered_at: string | null } | null;
  images: { id: string; caption: string | null }[];
}
interface PortalEntry {
  customer: { id: string; name: string; code: string };
  business: { name: string; phone: string | null; whatsapp: string | null; address: string | null; logo_path: string | null };
  orders: PortalOrder[];
}

function PortalShell({ children, business }: { children: React.ReactNode; business?: PortalEntry['business'] }) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-cream-100">
      <header className="border-b border-cream-300 bg-cream-50">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Brand name={business?.name} logoPath={business?.logo_path} />
          <button className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-cream-200" onClick={async () => { await signOut(); navigate('/login'); }}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}

export function WhatsAppChat({ number, label = 'Chat with us on WhatsApp' }: { number: string | null | undefined; label?: string }) {
  if (!number) return null;
  return (
    <a href={`https://wa.me/${waDigits(number)}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#1f8f4e] px-4 text-sm font-medium text-white hover:bg-[#18733e]">
      <MessageCircle className="h-4 w-4" /> {label}<span className="hidden sm:inline"> · {prettyPhone(number)}</span>
    </a>
  );
}

const TRACK: OrderStatus[] = ['confirmed', 'in_progress', 'quality_check', 'ready', 'delivered'];
function Progress({ status }: { status: OrderStatus }) {
  if (status === 'cancelled') return null;
  const idx = Math.max(0, TRACK.indexOf(status === 'waiting_materials' ? 'in_progress' : status === 'out_for_delivery' ? 'ready' : status));
  return (
    <ol className="mt-3 flex items-center gap-1" aria-label="Progress">
      {['Confirmed', 'Stitching', 'Checking', 'Ready', 'Delivered'].map((l, i) => (
        <li key={l} className="flex flex-1 flex-col items-center gap-1">
          <span className={`h-1.5 w-full rounded-full ${i <= idx ? 'bg-burgundy-700' : 'bg-cream-300'}`} />
          <span className={`text-[10px] ${i <= idx ? 'font-medium text-burgundy-700' : 'text-ink-400'}`}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

function OrderImages({ images }: { images: PortalOrder['images'] }) {
  const q = useQuery({
    queryKey: ['portal-images', images.map((i) => i.id).join(',')],
    enabled: images.length > 0,
    queryFn: async () => {
      const out: { id: string; url: string; caption: string | null }[] = [];
      for (const img of images.slice(0, 12)) {
        const { data: path } = await supabase.rpc('portal_image_path', { p_attachment_id: img.id });
        if (!path) continue;
        const s = await supabase.storage.from('order-images').createSignedUrl(path as string, 600);
        if (s.data) out.push({ id: img.id, url: s.data.signedUrl, caption: img.caption });
      }
      return out;
    },
  });
  if (!q.data?.length) return null;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {q.data.map((i) => <a key={i.id} href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt={i.caption ?? 'Your order'} className="aspect-square w-full rounded-lg object-cover" loading="lazy" /></a>)}
    </div>
  );
}

export function PortalHome() {
  const q = useQuery({
    queryKey: ['portal'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_overview');
      if (error) throw error;
      return data as PortalEntry[];
    },
  });
  const entry = q.data?.[0];
  if (q.isLoading) return <PortalShell><PageLoader /></PortalShell>;
  if (q.error) return <PortalShell><ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} /></PortalShell>;
  if (!entry) return <PortalShell><EmptyState title="Your account isn't linked to a boutique yet" body="Ask the boutique to send you an invite link." /></PortalShell>;

  return (
    <PortalShell business={entry.business}>
      {q.data!.map((e) => (
        <div key={e.customer.id} className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Namaste, {e.customer.name.split(' ')[0]}</h1>
              <p className="text-sm text-ink-500">Your orders at {e.business.name} · Customer ID {e.customer.code}</p>
            </div>
            <WhatsAppChat number={e.business.whatsapp ?? e.business.phone} />
          </div>
          {e.orders.length === 0 && <Card><EmptyState title="No orders yet" /></Card>}
          {e.orders.map((o) => (
            <Card key={o.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{o.order_no}</p>
                  <p className="text-sm text-ink-500">Ordered {fmtDate(o.order_date)}{o.due_at && ` · Expected ${fmtDateTime(o.due_at)}`}</p>
                </div>
                <StatusBadge status={o.status} />
              </div>
              <Progress status={o.status} />
              <ul className="mt-3 divide-y divide-cream-200 text-sm">
                {o.items.map((it, i) => (
                  <li key={i} className="flex justify-between gap-2 py-1.5">
                    <span>{it.description} <span className="text-ink-500">× {qtyText(it.qty, it.unit)}</span></span>
                    <span className="num">{rupees(it.line_subtotal)}</span>
                  </li>
                ))}
              </ul>
              {o.notes && <p className="mt-2 text-sm text-ink-700">{o.notes}</p>}
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-cream-50 p-3 text-center text-sm">
                <div><p className="text-xs text-ink-500">Total</p><Money value={o.total} strong /></div>
                <div><p className="text-xs text-ink-500">Paid</p><Money value={o.paid} strong /></div>
                <div><p className="text-xs text-ink-500">Balance</p><Money value={o.balance} strong className={toNum(o.balance) > 0 ? 'text-burgundy-700' : ''} /></div>
              </div>
              <p className="mt-2 text-sm text-ink-500">
                {DELIVERY_LABEL[o.delivery_method]}
                {o.delivery && ` · ${o.delivery.provider ?? 'Delivery'} ${o.delivery.status}${o.delivery.delivered_at ? ` ${fmtDateTime(o.delivery.delivered_at)}` : ''}`}
              </p>
              <OrderImages images={o.images} />
              {o.invoice && (
                <Link to={`/portal/invoices/${o.invoice.id}`} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-burgundy-700">
                  <FileText className="h-4 w-4" /> Invoice {o.invoice.invoice_no}
                </Link>
              )}
            </Card>
          ))}
        </div>
      ))}
    </PortalShell>
  );
}

export function PortalInvoicePage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['portal-invoice', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_invoice', { p_invoice_id: id });
      if (error) throw error;
      return data as InvoicePayload;
    },
  });
  return (
    <PortalShell>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> My orders</Link>
        {q.data && (
          <Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={async () => {
            setBusy(true);
            try { await downloadInvoicePdf(id); } catch (e) { toast.error((e as Error).message); }
            setBusy(false);
          }}>Download PDF</Button>
        )}
      </div>
      {q.isLoading && <PageLoader />}
      {q.error && <ErrorBox message="This invoice could not be found." />}
      {q.data && <InvoiceDocument p={q.data} />}
    </PortalShell>
  );
}

/** Public page behind a secure link: /i/:token. No login; reveals one invoice only. */
export function SharedInvoicePage() {
  const { token = '' } = useParams();
  const q = useQuery({
    queryKey: ['shared-invoice', token],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('shared-invoice', { body: { token } });
      if (error) {
        const status = (error as { context?: Response }).context?.status;
        throw new Error(status === 429 ? 'Too many attempts. Please wait a minute and try again.' : 'This link is not valid or has expired. Please ask the boutique for a new one.');
      }
      return data as InvoicePayload & { pdf_url: string; file_name: string };
    },
  });
  return (
    <div className="min-h-screen bg-cream-100 px-3 py-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {q.isLoading && <PageLoader label="Opening your invoice…" />}
        {q.error && (
          <div className="card p-6 text-center">
            <div className="mb-3 flex justify-center"><Brand /></div>
            <p className="text-ink-700">{(q.error as Error).message}</p>
          </div>
        )}
        {q.data && (
          <>
            <div className="no-print flex flex-wrap justify-end gap-2">
              <WhatsAppChat number={q.data.invoice.snapshot.business.whatsapp ?? q.data.invoice.snapshot.business.phone} label="Chat with the boutique" />
              <a href={q.data.pdf_url} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-burgundy-700 px-4 text-sm font-medium text-white hover:bg-burgundy-800" rel="noreferrer">
                <Download className="h-4 w-4" /> Download PDF
              </a>
            </div>
            <InvoiceDocument p={q.data} />
            <p className="no-print text-center text-xs text-ink-500">This private link shows one invoice only. Do not forward it to others.</p>
          </>
        )}
      </div>
    </div>
  );
}
