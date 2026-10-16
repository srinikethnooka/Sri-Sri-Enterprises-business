import { fmtDate, fmtDateTime, qtyText, rupees, toNum } from '@/lib/format';
import { prettyPhone } from '@/lib/phone';
import type { InvoicePayload } from '@/types/models';

/** Customer-facing invoice. Renders ONLY the customer-safe payload (no costs, no internal notes). */
export function InvoiceDocument({ p }: { p: InvoicePayload }) {
  const inv = p.invoice;
  const b = inv.snapshot.business;
  const c = inv.snapshot.customer;
  const o = inv.snapshot.order;
  const balance = toNum(p.balance);
  return (
    <article className="print-sheet relative overflow-hidden rounded-xl border border-cream-300 bg-white shadow-card">
      {inv.status === 'cancelled' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rotate-[-30deg] text-7xl font-bold tracking-widest text-burgundy-700/15">CANCELLED</span>
        </div>
      )}
      <header className="flex flex-col justify-between gap-4 border-b-2 border-gold-500 bg-cream-100 px-5 py-5 sm:flex-row sm:px-8">
        <div>
          <h2 className="font-display text-3xl font-bold text-burgundy-700">{b.name}</h2>
          {b.address && <p className="text-sm text-ink-500">{b.address}</p>}
          <p className="text-sm text-ink-500">
            {[b.phone && prettyPhone(b.phone), b.whatsapp && b.whatsapp !== b.phone && `WhatsApp ${prettyPhone(b.whatsapp)}`, b.email].filter(Boolean).join(' • ')}
          </p>
          {b.gstin && <p className="text-sm text-ink-500">GSTIN: {b.gstin}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-2xl font-bold tracking-wide text-burgundy-700">INVOICE</p>
          <p className="font-semibold">{inv.invoice_no}</p>
          <p className="text-sm text-ink-500">Date: {fmtDate(inv.issued_at)}</p>
          <p className="text-sm text-ink-500">Order: {o.order_no}</p>
        </div>
      </header>

      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-700">Bill to</p>
          <p className="font-semibold">{c.name}</p>
          <p className="text-sm text-ink-500">Customer ID: {c.code}</p>
          {c.phone && <p className="text-sm text-ink-500">{prettyPhone(c.phone)}</p>}
          {c.address && <p className="text-sm text-ink-500">{c.address}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-700">Expected delivery</p>
          <p className="font-semibold">{fmtDateTime(o.due_at ?? p.due_at)}</p>
        </div>
      </div>

      <div className="overflow-x-auto px-5 sm:px-8">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="bg-burgundy-700 text-left text-xs uppercase tracking-wide text-white">
              <th className="px-2 py-2">#</th><th className="px-2 py-2">Description</th><th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Rate</th><th className="px-2 py-2 text-right">Disc.</th><th className="px-2 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => (
              <tr key={i} className="border-b border-cream-200 odd:bg-white even:bg-cream-50">
                <td className="px-2 py-2 align-top">{i + 1}</td>
                <td className="px-2 py-2 align-top">{l.description}</td>
                <td className="num px-2 py-2 text-right align-top">{qtyText(l.qty, l.unit)}</td>
                <td className="num px-2 py-2 text-right align-top">{rupees(l.unit_price)}</td>
                <td className="num px-2 py-2 text-right align-top text-ink-500">{toNum(l.line_discount) ? rupees(l.line_discount) : '—'}</td>
                <td className="num px-2 py-2 text-right align-top font-semibold">{rupees(l.line_subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 px-5 py-5 sm:grid-cols-2 sm:px-8">
        <div className="space-y-3 text-sm">
          {o.notes && <div><p className="text-xs font-semibold uppercase tracking-wider text-gold-700">Notes</p><p className="whitespace-pre-line">{o.notes}</p></div>}
          {b.payment_instructions && <div><p className="text-xs font-semibold uppercase tracking-wider text-gold-700">Payment instructions</p><p className="whitespace-pre-line">{b.payment_instructions}</p></div>}
        </div>
        <dl className="space-y-1.5 text-sm">
          <Row k="Subtotal" v={rupees(inv.items_subtotal)} />
          {toNum(inv.order_discount) > 0 && <Row k="Discount" v={`-${rupees(inv.order_discount)}`} />}
          {toNum(inv.tax_amount) > 0 && <Row k={`${inv.tax_label ?? 'Tax'} @ ${toNum(inv.tax_rate)}%`} v={rupees(inv.tax_amount)} />}
          {toNum(inv.delivery_charge) > 0 && <Row k="Delivery charges" v={rupees(inv.delivery_charge)} />}
          {toNum(inv.round_off) !== 0 && <Row k="Round off" v={rupees(inv.round_off)} />}
          <div className="flex justify-between border-t-2 border-gold-500 pt-2 text-lg font-bold text-burgundy-700"><dt>Total</dt><dd className="num">{rupees(inv.total)}</dd></div>
          <Row k="Paid" v={rupees(p.paid)} />
          <div className="flex justify-between rounded-lg bg-cream-100 px-2 py-2 text-lg font-bold">
            <dt>{balance < 0 ? 'Credit' : 'Balance due'}</dt><dd className={balance > 0 ? 'num text-burgundy-700' : 'num'}>{rupees(Math.abs(balance))}</dd>
          </div>
        </dl>
      </div>

      <footer className="border-t border-cream-200 px-5 py-4 text-center sm:px-8">
        <p className="font-semibold text-burgundy-700">{b.footer || 'Thank you for choosing us!'}</p>
        <p className="text-xs text-ink-400">This is a computer-generated invoice.</p>
      </footer>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><dt className="text-ink-500">{k}</dt><dd className="num">{v}</dd></div>;
}
