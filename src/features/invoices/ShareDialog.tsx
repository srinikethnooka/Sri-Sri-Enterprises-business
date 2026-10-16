import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, Download, Link2, MessageCircle, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadInvoicePdf } from '@/lib/pdf';
import { prettyPhone, toE164 } from '@/lib/phone';
import { DEFAULT_TEMPLATE, READY_TEMPLATE, REMINDER_TEMPLATE, manualWhatsApp, renderTemplate } from '@/lib/whatsapp';
import { useBusinessId, useSession } from '@/app/session';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorBox } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Customer, Invoice, Order } from '@/types/models';

export type SharePurpose = 'invoice' | 'order_ready' | 'payment_reminder';

/**
 * Manual WhatsApp sharing. Opens WhatsApp with a prefilled message for the owner
 * to review and send. The PDF is downloaded separately and attached by hand.
 * We record the attempt only — never claim the message was delivered.
 */
export function ShareDialog({
  open, onClose, order, customer, invoice, paid, purpose = 'invoice',
}: {
  open: boolean; onClose: () => void; order: Order; customer: Customer; invoice: Invoice | null; paid: number; purpose?: SharePurpose;
}) {
  const bid = useBusinessId();
  const { business, can } = useSession();
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = invoice ? Number(invoice.total) : Number(order.total);
  const template = purpose === 'order_ready' ? READY_TEMPLATE : purpose === 'payment_reminder' ? REMINDER_TEMPLATE
    : business?.whatsapp_template || DEFAULT_TEMPLATE;

  const generated = useMemo(() => renderTemplate(template, {
    name: customer.full_name.split(' ')[0],
    business: business?.name ?? '',
    order_no: order.order_no,
    invoice_no: invoice?.invoice_no,
    total, paid, balance: total - paid,
    due_at: order.due_at,
    link,
    delivery_note: order.delivery_method === 'pickup' ? ' for collection at the boutique' : ' and will be sent to you soon',
  }), [template, customer, business, order, invoice, total, paid, link]);

  useEffect(() => {
    if (!open) return;
    setLink(null); setErr(null); setEdited(false); setOpened(false); setCopied(false);
    setPhone(customer.whatsapp_e164 ?? customer.phone_e164);
  }, [open, customer]);
  useEffect(() => { if (!edited) setText(generated); }, [generated, edited]);

  const makeLink = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_share_link', { p_invoice_id: invoice!.id });
      if (error) throw error;
      return `${window.location.origin}/i/${data as string}`;
    },
    onSuccess: (url) => setLink(url),
    onError: (e) => setErr(errorMessage(e)),
  });

  const phoneE164 = toE164(phone);

  const log = (channel: 'whatsapp_manual' | 'copy') =>
    supabase.rpc('log_message_share', {
      p_business_id: bid, p_purpose: purpose, p_message: text, p_phone: phoneE164,
      p_order_id: order.id, p_invoice_id: invoice?.id ?? null, p_channel: channel,
    });

  return (
    <Dialog open={open} onClose={onClose} size="lg"
      title={purpose === 'invoice' ? 'Share invoice' : purpose === 'order_ready' ? 'Tell the customer it is ready' : 'Payment reminder'}
      description={`${customer.full_name} · ${prettyPhone(customer.whatsapp_e164 ?? customer.phone_e164)}`}>
      <div className="space-y-4">
        {invoice && purpose !== 'order_ready' && can('invoices.manage') && !link && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cream-300 bg-cream-50 p-3 text-sm">
            <span>Add a secure link so the customer can open the invoice online.</span>
            <Button size="sm" variant="secondary" icon={<Link2 className="h-4 w-4" />} loading={makeLink.isPending} onClick={() => makeLink.mutate()}>Create secure link</Button>
          </div>
        )}
        {link && <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">Secure link added. It expires in {business?.share_link_days ?? 30} days and can be revoked from the order.</p>}

        <TextField label="WhatsApp number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          error={phone && !phoneE164 ? 'Enter a valid WhatsApp number' : undefined} />
        <TextAreaField label="Message" rows={10} value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} />
        {edited && <button className="text-xs font-medium text-burgundy-700" onClick={() => setEdited(false)}>Reset message</button>}

        <div className="flex flex-wrap gap-2">
          <Button variant="gold" icon={<MessageCircle className="h-4 w-4" />} disabled={!phoneE164 || !text.trim()}
            onClick={async () => {
              await manualWhatsApp.send({ phoneE164: phoneE164!, text });
              setOpened(true);
              const r = await log('whatsapp_manual');
              if (r.error) toast.error(errorMessage(r.error));
            }}>
            Open WhatsApp
          </Button>
          {invoice && (
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={pdfBusy}
              onClick={async () => {
                setPdfBusy(true);
                try { await downloadInvoicePdf(invoice.id); } catch (e) { setErr((e as Error).message); }
                setPdfBusy(false);
              }}>
              Download PDF
            </Button>
          )}
          <Button variant="secondary" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); log('copy'); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? 'Copied' : 'Copy message'}
          </Button>
        </div>

        <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {opened ? (
              <p><b>WhatsApp was opened.</b> Check the message, attach the PDF if you want to send it, and press Send. This app cannot see whether it was sent or delivered.</p>
            ) : (
              <p>WhatsApp opens with this message filled in. <b>The PDF is not attached automatically</b> — download it first, then attach it in WhatsApp (📎 → Document). You press Send yourself.</p>
            )}
          </div>
        </div>
        {err && <ErrorBox message={err} />}
      </div>
    </Dialog>
  );
}
