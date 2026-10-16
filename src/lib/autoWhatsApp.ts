import { supabase } from './supabase';

export type AutoSendResult =
  | { status: 'sent' }
  | { status: 'not_on_whatsapp' }
  | { status: 'not_configured' }
  | { status: 'failed'; error: string };

/**
 * Sends the invoice PDF to the customer on WhatsApp automatically (WhatsApp Business Platform).
 * Never throws: the invoice is already saved, so any problem just comes back as a status.
 */
export async function sendInvoiceOnWhatsApp(invoiceId: string): Promise<AutoSendResult> {
  try {
    const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: { invoice_id: invoiceId } });
    if (error) {
      let msg = 'Could not send on WhatsApp.';
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* keep default */ }
      return { status: 'failed', error: msg };
    }
    return data as AutoSendResult;
  } catch {
    return { status: 'failed', error: 'Could not reach the server.' };
  }
}

/** One-line message for the person who just saved the bill. */
export function autoSendMessage(r: AutoSendResult): { kind: 'success' | 'error'; text: string } {
  switch (r.status) {
    case 'sent': return { kind: 'success', text: 'Saved and the bill was sent to the customer on WhatsApp.' };
    case 'not_on_whatsapp': return { kind: 'success', text: 'Saved. This number is not on WhatsApp, so the bill was only saved.' };
    case 'not_configured': return { kind: 'success', text: 'Saved.' };
    case 'failed': return { kind: 'error', text: `Saved, but WhatsApp sending failed: ${r.error}` };
  }
}

export const WA_STATUS_LABEL: Record<string, string> = {
  accepted: 'Sent', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', not_on_whatsapp: 'Not on WhatsApp',
};
