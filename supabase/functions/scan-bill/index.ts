// POST { business_id, image_base64, media_type } with the user's JWT.
// Reads a bill-book photo with an AI vision model and returns the fields for review.
// Nothing is saved here: the person checks the form and saves it in the app.
// The photo is sent to the AI provider only for reading; it is not stored by this function.
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, env, fail, json } from '../_shared/http.ts';
import { buildScanRequest, normalizeScan, toolInput } from '../_shared/billScan.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BASE64 = 6_000_000; // ~4.5 MB image; the app shrinks photos well below this

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'Method not allowed');

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail(req, 401, 'Please sign in');

  let body: { business_id?: string; image_base64?: string; media_type?: string };
  try { body = await req.json(); } catch { return fail(req, 400, 'Invalid request'); }
  const { business_id, image_base64, media_type } = body;
  if (!business_id || !UUID.test(business_id)) return fail(req, 400, 'Invalid business');
  if (!image_base64 || typeof image_base64 !== 'string' || image_base64.length > MAX_BASE64) return fail(req, 400, 'Photo is missing or too large');
  if (!media_type || !TYPES.has(media_type)) return fail(req, 400, 'Use a JPG, PNG or WEBP photo');

  const url = env('SUPABASE_URL');
  const user = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser();
  if (!who?.user) return fail(req, 401, 'Please sign in');
  const perm = await user.rpc('has_permission', { p_business_id: business_id, p_perm: 'orders.manage' });
  if (perm.error || perm.data !== true) return fail(req, 403, 'You do not have permission to add orders');

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const limit = await admin.rpc('rate_limit_hit', { p_key: `scan:${business_id}`, p_limit: 120, p_window_seconds: 3600 });
  if (limit.data !== true) return fail(req, 429, 'Too many bills scanned this hour. Please wait and try again.');

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return fail(req, 503, 'Bill scanning is not set up yet. Add the ANTHROPIC_API_KEY secret (see docs/BILL_SCAN.md).');
  const model = Deno.env.get('SCAN_MODEL') ?? 'claude-sonnet-5-5';

  const log = (status: 'ok' | 'failed', error?: string) =>
    admin.rpc('log_bill_scan', { p_business_id: business_id, p_user_id: who.user!.id, p_status: status, p_model: model, p_error: error ?? null });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(buildScanRequest(image_base64, media_type, model)),
    });
    if (!res.ok) {
      const detail = await res.text();
      await log('failed', `HTTP ${res.status}: ${detail.slice(0, 300)}`);
      return fail(req, 502, 'The bill could not be read right now. Please try again.', detail);
    }
    const input = toolInput(await res.json());
    if (!input) {
      await log('failed', 'no tool output');
      return fail(req, 422, 'Nothing could be read from this photo. Try a clearer, straight photo of one page.');
    }
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    await log('ok');
    return json(req, normalizeScan(input, today));
  } catch (e) {
    await log('failed', String(e));
    return fail(req, 500, 'The bill could not be read right now. Please try again.', e);
  }
});
