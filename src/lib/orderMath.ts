// Client-side ESTIMATE shown while typing. The database recalculates and stores
// the real totals (app.recalc_order); this must mirror it for display only.
export interface LineInput {
  qty: number;
  unit_price: number;
  line_discount: number;
}

export interface OrderSettings {
  tax_enabled: boolean;
  tax_rate: number;
  rounding_rule: 'rupee' | 'none';
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineSubtotal(l: LineInput): number {
  return r2((l.qty || 0) * (l.unit_price || 0) - (l.line_discount || 0));
}

export function estimateTotals(lines: LineInput[], orderDiscount: number, deliveryCharge: number, s: OrderSettings) {
  const items = r2(lines.reduce((a, l) => a + lineSubtotal(l), 0));
  const taxable = r2(items - (orderDiscount || 0));
  const tax = s.tax_enabled ? r2((taxable * s.tax_rate) / 100) : 0;
  const raw = r2(taxable + tax + (deliveryCharge || 0));
  const total = s.rounding_rule === 'rupee' ? Math.round(raw) : raw;
  return { items, taxable, tax, roundOff: r2(total - raw), total };
}
