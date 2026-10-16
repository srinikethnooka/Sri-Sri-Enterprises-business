import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceDocument } from './InvoiceDocument';
import type { InvoicePayload } from '@/types/models';

const payload: InvoicePayload = {
  invoice: {
    invoice_no: 'SSB/2026-27/0001', status: 'issued', issued_at: '2026-10-16T05:30:00Z',
    items_subtotal: 3649.5, order_discount: 100, delivery_charge: 50, taxable_amount: 3549.5,
    tax_label: null, tax_rate: 0, tax_amount: 0, round_off: 0.5, total: 3600,
    snapshot: {
      business: { name: 'Sri Sri Boutique', phone: '+918919093604', whatsapp: '+918919093604', payment_instructions: 'UPI only' },
      customer: { name: 'Anjali', code: '1001', phone: '+919900000001' },
      order: { order_no: 'ORD-2026-0001', due_at: '2026-10-25T06:30:00Z' },
    },
  },
  lines: [
    { description: 'Blouse stitching', qty: 2, unit: 'pcs', unit_price: 1200, line_discount: 200, line_subtotal: 2200 },
    { description: 'Maggam work', qty: 1, unit: 'pcs', unit_price: 1449.5, line_discount: 0, line_subtotal: 1449.5 },
  ],
  paid: 1000, balance: 2600, payments: [], order_status: 'in_progress', due_at: null,
};

describe('InvoiceDocument', () => {
  it('shows totals, payments and balance', () => {
    render(<InvoiceDocument p={payload} />);
    expect(screen.getByText('SSB/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('₹3,600.00')).toBeInTheDocument();
    expect(screen.getByText('₹2,600.00')).toBeInTheDocument();
    expect(screen.getByText('Balance due')).toBeInTheDocument();
    expect(screen.getByText('UPI only')).toBeInTheDocument();
  });
  it('marks cancelled invoices', () => {
    render(<InvoiceDocument p={{ ...payload, invoice: { ...payload.invoice, status: 'cancelled' } }} />);
    expect(screen.getByText('CANCELLED')).toBeInTheDocument();
  });
  it('contains no internal cost wording', () => {
    const { container } = render(<InvoiceDocument p={payload} />);
    expect(container.textContent).not.toMatch(/cost|margin|profit|labour|supplier/i);
  });
});
