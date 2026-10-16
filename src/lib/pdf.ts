import { supabase } from './supabase';

/** Asks the invoice-pdf Edge Function for a short-lived signed download URL. */
export async function getInvoicePdfUrl(invoiceId: string): Promise<{ url: string; file_name: string }> {
  const { data, error } = await supabase.functions.invoke('invoice-pdf', { body: { invoice_id: invoiceId } });
  if (error) {
    let msg = 'Could not prepare the PDF. Please try again.';
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) msg = body.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data as { url: string; file_name: string };
}

export async function downloadInvoicePdf(invoiceId: string) {
  const { url } = await getInvoicePdfUrl(invoiceId);
  // The signed URL already forces a download with the right file name.
  window.location.assign(url);
}
