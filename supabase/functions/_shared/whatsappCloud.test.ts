import { buildInvoiceTemplate, cleanParam, parseStatuses, statusFromSendError, verifySignature } from './whatsappCloud.ts';

const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

Deno.test('builds the invoice template with the PDF and six values', () => {
  const m = buildInvoiceTemplate({
    toE164: '+919849012345', templateName: 'invoice_with_pdf', language: 'en', pdfUrl: 'https://x/f.pdf', fileName: 'SSB-1.pdf',
    name: 'Sravani', orderNo: 'ORD-2026-0009', total: '₹4,000.00', paid: '₹1,500.00', balance: '₹2,500.00', delivery: '24 Oct 2026',
  });
  eq(m.to, '919849012345', 'number without +');
  eq(m.template.components[0].parameters[0], { type: 'document', document: { link: 'https://x/f.pdf', filename: 'SSB-1.pdf' } }, 'PDF in header');
  eq(m.template.components[1].parameters.length, 6, 'six body values');
});

Deno.test('cleans values WhatsApp would reject', () => {
  eq(cleanParam('a\nb\t c     d'), 'a b c d', 'no newlines, tabs or long spaces');
  eq(cleanParam(''), '-', 'never empty');
});

Deno.test('reads delivery statuses from the webhook', () => {
  const s = parseStatuses({ entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.A', status: 'delivered' },
    { id: 'wamid.B', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] },
    { id: 'wamid.C', status: 'deleted' },
  ] } }] }] });
  eq(s, [
    { wamid: 'wamid.A', status: 'delivered', errorCode: null, errorText: null },
    { wamid: 'wamid.B', status: 'failed', errorCode: '131026', errorText: 'Message undeliverable' },
  ], 'parsed statuses');
  eq(parseStatuses({ foo: 1 }), [], 'ignores unrelated payloads');
});

Deno.test('maps send errors', () => {
  eq(statusFromSendError({ error: { code: 131026, message: 'x' } }).status, 'not_on_whatsapp', 'undeliverable number');
  eq(statusFromSendError({ error: { code: 132001, message: 'Template does not exist' } }).status, 'failed', 'other errors fail');
});

Deno.test('verifies the webhook signature', async () => {
  const body = '{"a":1}';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!(await verifySignature(body, `sha256=${sig}`, 'secret'))) throw new Error('valid signature rejected');
  if (await verifySignature(body, `sha256=${sig}`, 'wrong')) throw new Error('wrong secret accepted');
  if (await verifySignature(body + ' ', `sha256=${sig}`, 'secret')) throw new Error('changed body accepted');
  if (await verifySignature(body, null, 'secret')) throw new Error('missing header accepted');
});
