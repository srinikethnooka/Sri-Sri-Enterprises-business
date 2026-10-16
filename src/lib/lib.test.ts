import { describe, expect, it } from 'vitest';
import { addDays, fmtDate, fromLocalInput, rupees, rupeesShort, todayIST, toLocalInput } from './format';
import { prettyPhone, toE164, waDigits } from './phone';
import { DEFAULT_TEMPLATE, renderTemplate, whatsappUrl } from './whatsapp';
import { toCsv } from './csv';
import { estimateTotals, lineSubtotal } from './orderMath';
import { periodFor } from './periods';
import { errorMessage } from './errors';
import { safeSearch } from '@/features/customers/api';

describe('money', () => {
  it('uses Indian grouping', () => {
    expect(rupees(1234567.5)).toBe('₹12,34,567.50');
    expect(rupees(-50)).toBe('-₹50.00');
    expect(rupeesShort(3600)).toBe('₹3,600');
    expect(rupeesShort('2600.50')).toBe('₹2,600.50');
  });
});

describe('dates (IST)', () => {
  it('rolls over at Indian midnight, not UTC', () => {
    expect(todayIST(new Date('2026-10-15T19:00:00Z'))).toBe('2026-10-16');
    expect(todayIST(new Date('2026-10-15T18:00:00Z'))).toBe('2026-10-15');
  });
  it('round-trips datetime-local inputs in IST', () => {
    expect(toLocalInput('2026-10-25T06:30:00Z')).toBe('2026-10-25T12:00');
    expect(fromLocalInput('2026-10-25T12:00')).toBe('2026-10-25T06:30:00.000Z');
  });
  it('formats plain dates without shifting the day', () => {
    expect(fmtDate('2026-04-01')).toContain('01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('phone numbers', () => {
  it('adds +91 to Indian mobiles', () => {
    expect(toE164('89190 93604')).toBe('+918919093604');
    expect(toE164('08919093604')).toBe('+918919093604');
    expect(toE164('+91 89190-93604')).toBe('+918919093604');
  });
  it('rejects invalid numbers', () => {
    expect(toE164('12345')).toBeNull();
    expect(toE164('5919093604')).toBeNull(); // Indian mobiles start 6-9
    expect(toE164('')).toBeNull();
  });
  it('formats and strips for wa.me', () => {
    expect(prettyPhone('+918919093604')).toBe('+91 89190 93604');
    expect(waDigits('+918919093604')).toBe('918919093604');
  });
});

describe('WhatsApp message', () => {
  const data = { name: 'Anjali', business: 'Sri Sri Boutique', order_no: 'ORD-2026-0001', total: 3600, paid: 1000, balance: 2600, due_at: '2026-10-25T06:30:00Z', link: 'https://x/i/abc' };
  it('fills the template from real data', () => {
    const m = renderTemplate(DEFAULT_TEMPLATE, data);
    expect(m).toContain('Hello Anjali');
    expect(m).toContain('ORD-2026-0001');
    expect(m).toContain('Invoice total: ₹3,600');
    expect(m).toContain('Amount paid: ₹1,000');
    expect(m).toContain('Balance due: ₹2,600');
    expect(m).toContain('25 October 2026');
    expect(m).toContain('https://x/i/abc');
  });
  it('drops lines whose value is missing instead of printing blanks', () => {
    const m = renderTemplate(DEFAULT_TEMPLATE, { ...data, link: null, due_at: null });
    expect(m).not.toContain('Invoice:');
    expect(m).not.toContain('Expected delivery');
    expect(m).not.toMatch(/\{\w+\}/);
  });
  it('builds an encoded wa.me link', () => {
    expect(whatsappUrl('+918919093604', 'Hi & bye')).toBe('https://wa.me/918919093604?text=Hi%20%26%20bye');
  });
});

describe('order estimate (mirrors the database)', () => {
  const s = { tax_enabled: false, tax_rate: 0, rounding_rule: 'rupee' as const };
  it('matches the database test case', () => {
    const t = estimateTotals([{ qty: 2, unit_price: 1200, line_discount: 200 }, { qty: 1, unit_price: 1449.5, line_discount: 0 }], 100, 50, s);
    expect(t.items).toBe(3649.5);
    expect(t.total).toBe(3600);
    expect(t.roundOff).toBe(0.5);
  });
  it('applies tax on the discounted amount', () => {
    const t = estimateTotals([{ qty: 1, unit_price: 1000, line_discount: 0 }], 100, 0, { tax_enabled: true, tax_rate: 5, rounding_rule: 'none' });
    expect(t.tax).toBe(45);
    expect(t.total).toBe(945);
  });
  it('handles fractional quantities', () => {
    expect(lineSubtotal({ qty: 2.5, unit_price: 120, line_discount: 0 })).toBe(300);
  });
});

describe('periods', () => {
  it('uses the Indian financial year', () => {
    expect(periodFor('fy', new Date('2026-10-16T00:00:00Z')).from).toBe('2026-04-01');
    expect(periodFor('fy', new Date('2027-02-10T00:00:00Z')).from).toBe('2026-04-01');
  });
  it('starts weeks on Monday', () => {
    expect(periodFor('week', new Date('2026-10-16T06:00:00Z')).from).toBe('2026-10-12');
  });
});

describe('CSV export', () => {
  it('quotes and neutralises formulas', () => {
    const csv = toCsv([{ name: 'A, B', note: '=HYPERLINK("x")', amount: -50 }]);
    expect(csv).toContain('"A, B"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-50');
  });
});

describe('safety helpers', () => {
  it('strips filter syntax from search terms', () => {
    expect(safeSearch('anjali,user_id.eq.x')).not.toContain(',');
    expect(safeSearch('a)(b*')).toBe('a  b');
  });
  it('never shows raw technical errors', () => {
    expect(errorMessage({ message: 'permission denied for table payments', code: '42501' })).toBe('You do not have permission to do this.');
    expect(errorMessage({ message: 'Refund is more than the amount collected (₹500)' })).toContain('₹500');
    expect(errorMessage({ message: 'relation "x" does not exist {internal}' })).toBe('Something went wrong. Please try again.');
  });
});
