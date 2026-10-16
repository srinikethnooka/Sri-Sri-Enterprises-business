// Manual WhatsApp sharing (release 1). Opening WhatsApp with a prefilled message
// does NOT attach the PDF and does NOT send anything: the owner reviews and sends.
// MessageChannel keeps billing code unchanged when the WhatsApp Business API is added.
import { fmtDateLong, rupeesShort } from './format';
import { waDigits } from './phone';

export const DEFAULT_TEMPLATE = `Hello {name}, thank you for choosing {business}!

Your order {order_no} is confirmed.

Invoice total: {total}
Amount paid: {paid}
Balance due: {balance}
Expected delivery: {due_date}

Invoice: {link}

Thank you for your support!`;

export const READY_TEMPLATE = `Hello {name}, your order {order_no} from {business} is ready{delivery_note}.

Balance due: {balance}

Thank you!`;

export const REMINDER_TEMPLATE = `Hello {name}, this is a gentle reminder from {business}.

Balance due for order {order_no}: {balance}

Invoice: {link}

Thank you!`;

export interface MessageData {
  name: string;
  business: string;
  order_no: string;
  invoice_no?: string;
  total: number | string;
  paid: number | string;
  balance: number | string;
  due_at?: string | null;
  link?: string | null;
  delivery_note?: string;
}

/** Fills a template. Lines containing a placeholder with no value are removed. */
export function renderTemplate(template: string, d: MessageData): string {
  const values: Record<string, string> = {
    name: d.name,
    business: d.business,
    order_no: d.order_no,
    invoice_no: d.invoice_no ?? '',
    total: rupeesShort(d.total),
    paid: rupeesShort(d.paid),
    balance: rupeesShort(d.balance),
    due_date: d.due_at ? fmtDateLong(d.due_at) : '',
    link: d.link ?? '',
    delivery_note: d.delivery_note ?? '',
  };
  return template
    .split('\n')
    .filter((line) => {
      const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      return keys.every((k) => k === 'delivery_note' || (values[k] ?? '') !== '');
    })
    .map((line) => line.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function whatsappUrl(phoneE164: string, message: string): string {
  return `https://wa.me/${waDigits(phoneE164)}?text=${encodeURIComponent(message)}`;
}

export interface OutgoingMessage {
  phoneE164: string;
  text: string;
}

export interface MessageChannel {
  readonly id: 'whatsapp_manual' | 'whatsapp_cloud_api';
  /** True only if the channel can confirm delivery. Manual sharing never can. */
  readonly confirmsDelivery: boolean;
  send(msg: OutgoingMessage): Promise<{ opened: boolean }>;
}

export const manualWhatsApp: MessageChannel = {
  id: 'whatsapp_manual',
  confirmsDelivery: false,
  async send(msg) {
    // With noopener the browser never tells us whether the tab opened, so this
    // only records that we tried. The owner still has to press Send in WhatsApp.
    window.open(whatsappUrl(msg.phoneE164, msg.text), '_blank', 'noopener,noreferrer');
    return { opened: true };
  },
};
