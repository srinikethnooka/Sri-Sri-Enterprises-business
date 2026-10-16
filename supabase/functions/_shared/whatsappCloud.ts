// WhatsApp Business Platform (Cloud API) helpers. Pure functions so they can be
// unit-tested; the Edge Functions do the network calls.
//
// Automatic messages from a business must use a template approved by Meta.
// The template this app expects is documented in docs/WHATSAPP_AUTO.md:
//   header: DOCUMENT (the invoice PDF)
//   body:   {{1}} name, {{2}} order no, {{3}} total, {{4}} paid, {{5}} balance, {{6}} delivery date

export interface InvoiceMessageData {
  toE164: string;
  templateName: string;
  language: string;
  pdfUrl: string;
  fileName: string;
  name: string;
  orderNo: string;
  total: string;
  paid: string;
  balance: string;
  delivery: string;
}

/** Template parameters may not contain new lines, tabs or more than 4 spaces in a row. */
export function cleanParam(v: string, max = 120): string {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return (s || '-').slice(0, max);
}

export function waNumber(e164: string): string {
  return e164.replace(/\D/g, '');
}

export function buildInvoiceTemplate(d: InvoiceMessageData) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waNumber(d.toE164),
    type: 'template',
    template: {
      name: d.templateName,
      language: { code: d.language },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { link: d.pdfUrl, filename: d.fileName } }] },
        {
          type: 'body',
          parameters: [d.name, d.orderNo, d.total, d.paid, d.balance, d.delivery].map((t) => ({ type: 'text', text: cleanParam(t) })),
        },
      ],
    },
  };
}

/** Error codes meaning "this number cannot receive WhatsApp messages". */
export const NOT_ON_WHATSAPP_CODES = new Set(['131026']);

export interface StatusUpdate { wamid: string; status: string; errorCode: string | null; errorText: string | null }

/** Extracts message status updates from a webhook payload. Ignores everything else. */
export function parseStatuses(body: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    for (const c of ((e as { changes?: unknown[] }).changes ?? [])) {
      const statuses = (c as { value?: { statuses?: unknown[] } }).value?.statuses ?? [];
      for (const s of statuses as { id?: string; status?: string; errors?: { code?: number | string; title?: string; message?: string }[] }[]) {
        if (!s?.id || !s.status) continue;
        if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        const err = s.errors?.[0];
        out.push({
          wamid: String(s.id),
          status: s.status,
          errorCode: err?.code != null ? String(err.code) : null,
          errorText: err ? String(err.message ?? err.title ?? '') : null,
        });
      }
    }
  }
  return out;
}

const enc = new TextEncoder();

/** Checks Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7).toLowerCase();
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** Turns a Cloud API error response into a stored status. */
export function statusFromSendError(body: { error?: { code?: number; message?: string; error_data?: { details?: string } } }) {
  const code = body?.error?.code != null ? String(body.error.code) : null;
  return {
    status: code && NOT_ON_WHATSAPP_CODES.has(code) ? 'not_on_whatsapp' : 'failed',
    errorCode: code,
    errorText: body?.error?.error_data?.details ?? body?.error?.message ?? 'Unknown error',
  };
}
