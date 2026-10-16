// deno test --allow-read --allow-write --config supabase/functions/deno.json supabase/functions/_shared/
import { PDFDocument } from 'pdf-lib';
import { buildInvoicePdf, formatINR, formatDateIN, type InvoicePayload } from './invoicePdf.ts';

const assets = {
  regular: await Deno.readFile(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
  bold: await Deno.readFile(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)),
};

export function sample(lines = 2, status: 'issued' | 'cancelled' = 'issued'): InvoicePayload {
  return {
    invoice: {
      id: '00000000-0000-0000-0000-000000000001', invoice_no: 'SSB/2026-27/0001', status,
      issued_at: '2026-10-16T05:30:00Z', items_subtotal: 3649.5, order_discount: 100, delivery_charge: 50,
      taxable_amount: 3549.5, tax_label: null, tax_rate: 0, tax_amount: 0, round_off: 0.5, total: 3600,
      snapshot: {
        business: { name: 'Sri Sri Boutique', address: 'Main Road, Hanamkonda, Telangana 506001',
          phone: '+91 98765 43210', email: null, gstin: null,
          payment_instructions: 'UPI: srisriboutique@upi\nCash or UPI at the boutique.', footer: 'Thank you for choosing Sri Sri Boutique!' },
        customer: { name: 'Anjali', code: '1001', phone: '+91 99000 00001', address: 'Kazipet' },
        order: { order_no: 'ORD-2026-0001', order_date: '2026-10-16', due_at: '2026-10-25T12:30:00Z', notes: 'Please keep the old blouse for reference.' },
      },
    },
    lines: Array.from({ length: lines }, (_, i) => ({
      description: i % 2 ? 'Maggam work — peacock motif on sleeves and back neck with gold zari and stone work' : 'Blouse stitching (lining, princess cut)',
      qty: i % 2 ? 1 : 2, unit: 'pcs', unit_price: i % 2 ? 1449.5 : 1200, line_discount: i % 2 ? 0 : 200,
      line_subtotal: i % 2 ? 1449.5 : 2200,
    })),
    paid: 1000,
    balance: 2600,
  };
}

Deno.test('formats rupees in Indian grouping', () => {
  if (formatINR(123456.5) !== '₹1,23,456.50') throw new Error(formatINR(123456.5));
  if (formatINR(-20) !== '-₹20.00') throw new Error(formatINR(-20));
});

Deno.test('formats dates in IST', () => {
  // 20:00 UTC on 15 Oct is 16 Oct in India
  if (!formatDateIN('2026-10-15T20:00:00Z').startsWith('16')) throw new Error(formatDateIN('2026-10-15T20:00:00Z'));
});

Deno.test('builds a valid one-page invoice', async () => {
  const bytes = await buildInvoicePdf(sample(), assets);
  const doc = await PDFDocument.load(bytes);
  if (doc.getPageCount() !== 1) throw new Error('expected 1 page');
  await Deno.writeFile(new URL('../../../tmp-invoice-sample.pdf', import.meta.url), bytes);
});

Deno.test('long invoices flow onto more pages', async () => {
  const bytes = await buildInvoicePdf(sample(60), assets);
  const doc = await PDFDocument.load(bytes);
  if (doc.getPageCount() < 2) throw new Error('expected multiple pages');
});

Deno.test('cancelled invoices still render', async () => {
  const bytes = await buildInvoicePdf(sample(2, 'cancelled'), assets);
  await PDFDocument.load(bytes);
});
