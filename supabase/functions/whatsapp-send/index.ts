// POST { invoice_id } with the user's JWT → sends the invoice PDF to the customer on WhatsApp
// automatically, through the WhatsApp Business Platform (Cloud API).
// POST { check: true, business_id } → tells the app whether automatic sending is set up.
//
// Results returned to the app:
//   sent             WhatsApp accepted the message (delivery is reported later by the webhook)
//   not_on_whatsapp  this number is known not to have WhatsApp; the bill is only saved
//   not_configured   automatic sending is off or not set up; the app falls back to manual sharing
//   failed           WhatsApp refused it; the reason is shown
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, env, fail, json } from '../_shared/http.ts';
import { ensureInvoicePdf } from '../_shared/pdfStore.ts';
import { buildInvoiceTemplate, statusFromSendError } from '../_shared/whatsappCloud.ts';
import { formatDateIN, formatINR, type InvoicePayload } from '../_shared/invoicePdf.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'Method not allowed');
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail(req, 401, 'Please sign in');

  let body: { invoice_id?: string; check?: boolean; business_id?: string };
  try { body = await req.json(); } catch { return fail(req, 400, 'Invalid request'); }

  const url = env('SUPABASE_URL');
  const user = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser();
  if (!who?.user) return fail(req, 401, 'Please sign in');

  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const apiVersion = Deno.env.get('WHATSAPP_API_VERSION') ?? 'v21.0';
  const serverReady = !!token && !!phoneNumberId;

  if (body.check) {
    if (!body.business_id || !UUID.test(body.business_id)) return fail(req, 400, 'Invalid business');
    const ok = await user.rpc('has_permission', { p_business_id: body.business_id, p_perm: 'settings.manage' });
    if (ok.data !== true) return fail(req, 403, 'No permission');
    return json(req, { server_ready: serverReady });
  }

  if (!body.invoice_id || !UUID.test(body.invoice_id)) return fail(req, 400, 'Invalid invoice');
  // Authorise through the database (staff with invoice/payment/order access).
  const p = await user.rpc('staff_invoice_payload', { p_invoice_id: body.invoice_id });
  if (p.error || !p.data) return fail(req, 404, 'Invoice not found');
  const payload = p.data as InvoicePayload & { business_id: string };
  if (payload.invoice.status !== 'issued') return fail(req, 400, 'Cancelled invoices cannot be sent');

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const [{ data: biz }, { data: inv }] = await Promise.all([
    admin.from('businesses').select('id, whatsapp_auto_send, whatsapp_template_name, whatsapp_template_lang').eq('id', payload.business_id).single(),
    admin.from('invoices').select('id, order_id, customer_id, pdf_path, customer:customers(id, full_name, phone_e164, whatsapp_e164, whatsapp_status)').eq('id', body.invoice_id).single(),
  ]);
  if (!biz || !inv) return fail(req, 404, 'Invoice not found');
  if (!serverReady || !biz.whatsapp_auto_send) return json(req, { status: 'not_configured' });

  const c = inv.customer as unknown as { id: string; full_name: string; phone_e164: string; whatsapp_e164: string | null; whatsapp_status: string };
  const to = c.whatsapp_e164 ?? c.phone_e164;
  if (c.whatsapp_status === 'no') {
    await admin.from('whatsapp_messages').insert({ business_id: biz.id, invoice_id: inv.id, order_id: inv.order_id, customer_id: c.id,
      phone_e164: to, status: 'not_on_whatsapp', error_text: 'Earlier messages showed this number has no WhatsApp', sent_by: who.user.id });
    return json(req, { status: 'not_on_whatsapp' });
  }

  const limit = await admin.rpc('rate_limit_hit', { p_key: `wa:${biz.id}`, p_limit: 300, p_window_seconds: 3600 });
  if (limit.data !== true) return fail(req, 429, 'Too many messages this hour. Please try again later.');

  try {
    // The link must stay valid long enough for WhatsApp to fetch the PDF.
    const pdf = await ensureInvoicePdf(admin, payload, biz.id, (inv.pdf_path as string | null) ?? null,
      (payload.invoice.snapshot.business as { logo_path?: string | null }).logo_path ?? null, 24 * 3600);
    const message = buildInvoiceTemplate({
      toE164: to,
      templateName: biz.whatsapp_template_name,
      language: biz.whatsapp_template_lang,
      pdfUrl: pdf.url,
      fileName: pdf.fileName,
      name: c.full_name.split(' ')[0],
      orderNo: payload.invoice.snapshot.order.order_no,
      total: formatINR(payload.invoice.total),
      paid: formatINR(payload.paid),
      balance: formatINR(payload.balance),
      delivery: payload.invoice.snapshot.order.due_at ? formatDateIN(payload.invoice.snapshot.order.due_at) : 'to be confirmed',
    });
    const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const s = statusFromSendError(out);
      await admin.from('whatsapp_messages').insert({ business_id: biz.id, invoice_id: inv.id, order_id: inv.order_id, customer_id: c.id,
        phone_e164: to, status: s.status, error_code: s.errorCode, error_text: s.errorText, sent_by: who.user.id });
      return json(req, { status: s.status, error: s.status === 'failed' ? s.errorText : undefined });
    }
    const wamid = out?.messages?.[0]?.id as string | undefined;
    await admin.from('whatsapp_messages').insert({ business_id: biz.id, invoice_id: inv.id, order_id: inv.order_id, customer_id: c.id,
      phone_e164: to, wamid, status: 'accepted', sent_by: who.user.id });
    return json(req, { status: 'sent' });
  } catch (e) {
    return fail(req, 500, 'Could not send on WhatsApp. The invoice is saved; you can share it by hand.', e);
  }
});
