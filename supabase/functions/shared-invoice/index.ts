// Public endpoint behind the secure invoice link (/i/<token>).
// POST { token }. No login. Rate-limited per IP and per token.
// Unknown, expired, revoked and cancelled links all get the same 404.
import { createClient } from '@supabase/supabase-js';
import { clientIp, corsHeaders, env, fail, json } from '../_shared/http.ts';
import { ensureInvoicePdf } from '../_shared/pdfStore.ts';

const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'Method not allowed');

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const ip = clientIp(req);
  const ipOk = await admin.rpc('rate_limit_hit', { p_key: `inv-ip:${ip}`, p_limit: 30, p_window_seconds: 60 });
  if (ipOk.error) return fail(req, 500, 'Please try again', ipOk.error);
  if (ipOk.data !== true) return fail(req, 429, 'Too many requests. Please wait a minute.');

  let token: unknown;
  try {
    ({ token } = await req.json());
  } catch {
    return fail(req, 400, 'Invalid request');
  }
  if (typeof token !== 'string' || !TOKEN.test(token)) return fail(req, 404, 'This link is not valid or has expired');

  const tokOk = await admin.rpc('rate_limit_hit', { p_key: `inv-tok:${token.slice(0, 12)}`, p_limit: 20, p_window_seconds: 60 });
  if (tokOk.data !== true) return fail(req, 429, 'Too many requests. Please wait a minute.');

  const { data, error } = await admin.rpc('open_shared_invoice', { p_token: token });
  if (error) return fail(req, 500, 'Please try again', error);
  if (!data) return fail(req, 404, 'This link is not valid or has expired');

  try {
    const inv = data.invoice;
    const pdf = await ensureInvoicePdf(admin, data, data.business_id, inv.pdf_path ?? null,
      inv.snapshot?.business?.logo_path ?? null);
    // Strip internal identifiers before returning.
    const { pdf_path: _p, id: _id, ...publicInvoice } = inv;
    const { business_id: _b, ...rest } = data;
    return json(req, { ...rest, invoice: publicInvoice, pdf_url: pdf.url, file_name: pdf.fileName });
  } catch (e) {
    return fail(req, 500, 'Could not load the invoice. Please try again.', e);
  }
});
