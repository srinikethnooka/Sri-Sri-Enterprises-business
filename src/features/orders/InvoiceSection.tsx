import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Printer, Send, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage, newKey } from '@/lib/errors';
import { downloadInvoicePdf } from '@/lib/pdf';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useSession } from '@/app/session';
import { autoSendMessage, sendInvoiceOnWhatsApp, WA_STATUS_LABEL } from '@/lib/autoWhatsApp';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Badge, Card, EmptyState, Money } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Invoice, Order } from '@/types/models';

export function InvoiceSection({ order, invoices, onShare }: { order: Order; invoices: Invoice[]; onShare: () => void }) {
  const { can, business } = useSession();
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const issueKey = useRef(newKey());
  const [cancelling, setCancelling] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const live = invoices.find((i) => i.status === 'issued') ?? null;
  const old = invoices.filter((i) => i.status === 'cancelled');

  const links = useQuery({
    queryKey: ['share-links', live?.id],
    enabled: !!live && can('invoices.manage'),
    queryFn: async () => (await supabase.from('invoice_share_links').select('id, created_at, expires_at, revoked_at, open_count, last_opened_at')
      .eq('invoice_id', live!.id).order('created_at', { ascending: false })).data ?? [],
  });

  const issue = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('issue_invoice', { p_order_id: order.id, p_idempotency_key: issueKey.current });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (invoiceId) => {
      issueKey.current = newKey();
      qc.invalidateQueries({ queryKey: ['order', order.id] });
      if (business?.whatsapp_auto_send) {
        const r = await sendInvoiceOnWhatsApp(invoiceId);
        if (r.status !== 'not_configured') {
          const m = autoSendMessage(r);
          toast[m.kind](m.text.replace('Saved', 'Invoice issued'));
          qc.invalidateQueries({ queryKey: ['wa-messages', order.id] });
          return;
        }
      }
      toast.success('Invoice issued');
      onShare();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc('cancel_invoice', { p_invoice_id: live!.id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['order', order.id] }); toast.success('Invoice cancelled. Edit the order and issue a corrected invoice.'); setCancelling(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('revoke_share_link', { p_link_id: id });
      if (error) throw error;
    },
    onSuccess: () => { links.refetch(); toast.success('Link revoked'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const messages = useQuery({
    queryKey: ['wa-messages', order.id],
    queryFn: async () => (await supabase.from('whatsapp_messages').select('id, status, phone_e164, error_text, created_at, updated_at')
      .eq('order_id', order.id).order('created_at', { ascending: false }).limit(10)).data ?? [],
    refetchInterval: (q) => ((q.state.data ?? []).some((m) => m.status === 'accepted' || m.status === 'sent') ? 10_000 : false),
  });

  const sendAgain = async () => {
    if (!live) return;
    setSending(true);
    const r = await sendInvoiceOnWhatsApp(live.id);
    setSending(false);
    if (r.status === 'not_configured') return toast.error('Automatic WhatsApp is not set up. Use Share instead.');
    const m = autoSendMessage(r);
    toast[m.kind](m.text.replace('Saved and the bill was sent', 'The bill was sent').replace('Saved. ', ''));
    qc.invalidateQueries({ queryKey: ['wa-messages', order.id] });
  };

  const canIssue = !live && can('invoices.manage') && !['draft', 'cancelled'].includes(order.status);

  return (
    <Card title="Invoice">
      {!live ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title={order.status === 'draft' ? 'Confirm the order to issue an invoice' : 'No invoice yet'}
          action={canIssue && <Button loading={issue.isPending} onClick={() => issue.mutate()}>Issue invoice</Button>}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">{live.invoice_no}</p>
              <p className="text-sm text-ink-500">Issued {fmtDateTime(live.issued_at)}</p>
            </div>
            <Money value={live.total} strong className="text-lg" />
          </div>
          <div className="flex flex-wrap gap-2">
            {business?.whatsapp_auto_send && (
              <Button icon={<Send className="h-4 w-4" />} loading={sending} onClick={sendAgain}>Send on WhatsApp</Button>
            )}
            <Button variant={business?.whatsapp_auto_send ? 'secondary' : 'primary'} icon={<Send className="h-4 w-4" />} onClick={onShare}>Share by hand</Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={pdfBusy} onClick={async () => {
              setPdfBusy(true);
              try { await downloadInvoicePdf(live.id); } catch (e) { toast.error((e as Error).message); }
              setPdfBusy(false);
            }}>PDF</Button>
            <Link to={`/invoices/${live.id}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-cream-300 bg-white px-4 text-sm font-medium hover:bg-cream-50">
              <Printer className="h-4 w-4" /> View / print
            </Link>
            {can('invoices.manage') && (
              <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setCancelling(true)}>Cancel invoice</Button>
            )}
          </div>
          {messages.data && messages.data.length > 0 && (
            <div className="rounded-lg border border-cream-200 p-3 text-sm">
              <p className="mb-2 font-medium">WhatsApp</p>
              <ul className="space-y-1.5">
                {messages.data.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ink-500">{fmtDate(m.created_at)} · {m.phone_e164}{m.error_text && m.status !== 'read' && m.status !== 'delivered' ? ` · ${m.error_text}` : ''}</span>
                    <Badge tone={m.status === 'read' || m.status === 'delivered' ? 'good' : m.status === 'failed' ? 'danger' : m.status === 'not_on_whatsapp' ? 'warn' : 'neutral'}>
                      {WA_STATUS_LABEL[m.status] ?? m.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {links.data && links.data.length > 0 && (
            <div className="rounded-lg border border-cream-200 p-3 text-sm">
              <p className="mb-2 font-medium">Secure links</p>
              <ul className="space-y-1.5">
                {links.data.map((l) => {
                  const dead = l.revoked_at || new Date(l.expires_at) < new Date();
                  return (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-ink-500">
                        Made {fmtDate(l.created_at)} · {dead ? (l.revoked_at ? 'revoked' : 'expired') : `expires ${fmtDate(l.expires_at)}`} · opened {l.open_count}×
                      </span>
                      {!dead && <button className="text-xs font-medium text-burgundy-700" onClick={() => revoke.mutate(l.id)}>Revoke</button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      {old.length > 0 && (
        <div className="mt-4 border-t border-cream-200 pt-3 text-sm">
          <p className="mb-1 font-medium text-ink-500">Cancelled invoices (kept for the record)</p>
          {old.map((i) => (
            <p key={i.id} className="text-ink-500">
              <Link className="underline" to={`/invoices/${i.id}`}>{i.invoice_no}</Link> · <Badge tone="danger">Cancelled</Badge> {fmtDate(i.cancelled_at)} — {i.cancel_reason}
            </p>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${live?.invoice_no}?`}
        message="The invoice stays on record marked CANCELLED and its secure links stop working. Payments stay on the order. You can then edit the order and issue a corrected invoice with a new number."
        requireReason
        confirmLabel="Cancel invoice"
        danger
        loading={cancel.isPending}
        onConfirm={(r) => cancel.mutate(r)}
      />
    </Card>
  );
}
