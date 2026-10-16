// Generates (if needed) and stores the invoice PDF, returning a short-lived signed URL.
// Uses the service-role client ONLY after the caller has been authorised.
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildInvoicePdf, invoiceFileName, type InvoicePayload } from './invoicePdf.ts';

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

async function fonts() {
  if (!fontCache) {
    fontCache = {
      regular: await Deno.readFile(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
      bold: await Deno.readFile(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)),
    };
  }
  return fontCache;
}

export interface StoredPdf {
  url: string;
  fileName: string;
}

export async function ensureInvoicePdf(
  admin: SupabaseClient,
  payload: InvoicePayload,
  businessId: string,
  currentPath: string | null,
  logoPath: string | null,
  ttlSeconds = 300,
): Promise<StoredPdf> {
  const inv = payload.invoice;
  const fileName = invoiceFileName(inv.invoice_no, inv.id);
  // Paid/balance change over time, so the stored file is keyed by the amount paid.
  const version = `${inv.status}-${Math.round(Number(payload.paid) * 100)}`;
  const path = `${businessId}/${inv.id}/${version}.pdf`;

  if (currentPath !== path) {
    let logo: { bytes: Uint8Array; type: 'png' | 'jpg' } | null = null;
    if (logoPath) {
      const { data } = await admin.storage.from('branding').download(logoPath);
      if (data) {
        const type = /\.png$/i.test(logoPath) ? 'png' : /\.jpe?g$/i.test(logoPath) ? 'jpg' : null;
        if (type) logo = { bytes: new Uint8Array(await data.arrayBuffer()), type };
      }
    }
    const bytes = await buildInvoicePdf(payload, { ...(await fonts()), logo });
    const up = await admin.storage.from('invoices').upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (up.error) throw up.error;
    const upd = await admin.from('invoices').update({ pdf_path: path }).eq('id', inv.id);
    if (upd.error) throw upd.error;
  }

  const signed = await admin.storage.from('invoices').createSignedUrl(path, ttlSeconds, { download: fileName });
  if (signed.error || !signed.data) throw signed.error ?? new Error('Could not sign URL');
  return { url: signed.data.signedUrl, fileName };
}
