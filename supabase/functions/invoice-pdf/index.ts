// POST { invoice_id } with the user's JWT.
// Staff (invoices/payments/orders permission) or the invoice's own customer get a
// 5-minute signed download URL. The PDF is generated on first request and whenever
// the paid amount or status changes.
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, env, fail, json } from '../_shared/http.ts';
import { ensureInvoicePdf } from '../_shared/pdfStore.ts';
import type { InvoicePayload } from '../_shared/invoicePdf.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'Method not allowed');

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail(req, 401, 'Please sign in');

  let invoiceId: string;
  try {
    ({ invoice_id: invoiceId } = await req.json());
  } catch {
    return fail(req, 400, 'Invalid request');
  }
  if (typeof invoiceId !== 'string' || !UUID.test(invoiceId)) return fail(req, 400, 'Invalid invoice');

  const url = env('SUPABASE_URL');
  const user = createClient(url, env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: who, error: whoErr } = await user.auth.getUser();
  if (whoErr || !who.user) return fail(req, 401, 'Please sign in');

  // Authorise through the database: staff first, then customer portal.
  let payload: (InvoicePayload & { business_id: string }) | null = null;
  const staff = await user.rpc('staff_invoice_payload', { p_invoice_id: invoiceId });
  if (!staff.error && staff.data) {
    payload = staff.data;
  } else {
    const cust = await user.rpc('portal_invoice', { p_invoice_id: invoiceId });
    if (!cust.error && cust.data) payload = cust.data;
  }
  if (!payload) return fail(req, 404, 'Invoice not found');

  try {
    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const raw = payload.invoice as InvoicePayload['invoice'] & { pdf_path?: string | null; snapshot: { business: { logo_path?: string | null } } };
    const pdf = await ensureInvoicePdf(admin, payload, payload.business_id, raw.pdf_path ?? null,
      raw.snapshot.business.logo_path ?? null);
    return json(req, { url: pdf.url, file_name: pdf.fileName });
  } catch (e) {
    return fail(req, 500, 'Could not prepare the PDF. Please try again.', e);
  }
});
