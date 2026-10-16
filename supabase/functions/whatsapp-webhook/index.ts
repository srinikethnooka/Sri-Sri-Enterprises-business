// Webhook that WhatsApp (Meta) calls with message statuses: sent, delivered, read, failed.
// GET  → subscription check (hub.verify_token must match WHATSAPP_VERIFY_TOKEN)
// POST → status updates, accepted only with a valid X-Hub-Signature-256 from WHATSAPP_APP_SECRET
import { createClient } from '@supabase/supabase-js';
import { env } from '../_shared/http.ts';
import { parseStatuses, verifySignature } from '../_shared/whatsappCloud.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe'
      && url.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256'), env('WHATSAPP_APP_SECRET')))) {
    return new Response('Invalid signature', { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  for (const s of parseStatuses(body)) {
    const { error } = await admin.rpc('whatsapp_status_update', {
      p_wamid: s.wamid, p_status: s.status, p_error_code: s.errorCode, p_error_text: s.errorText,
    });
    if (error) console.error('status update failed', s.wamid, error.message);
  }
  // Always answer 200 quickly so Meta does not retry valid deliveries.
  return new Response('ok', { status: 200 });
});
