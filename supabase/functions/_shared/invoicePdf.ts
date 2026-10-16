// Customer-facing invoice PDF. Runs in Deno (Edge Functions) and Node (tests).
// Input is the customer-safe invoice payload (app.customer_invoice_payload):
// it never contains costs, internal notes or supplier data.
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface InvoiceLine {
  description: string;
  qty: number | string;
  unit: string;
  unit_price: number | string;
  line_discount: number | string;
  line_subtotal: number | string;
}

export interface InvoicePayload {
  invoice: {
    id: string;
    invoice_no: string;
    status: 'issued' | 'cancelled';
    issued_at: string;
    items_subtotal: number | string;
    order_discount: number | string;
    delivery_charge: number | string;
    taxable_amount: number | string;
    tax_label: string | null;
    tax_rate: number | string;
    tax_amount: number | string;
    round_off: number | string;
    total: number | string;
    snapshot: {
      business: {
        name: string;
        address?: string | null;
        phone?: string | null;
        whatsapp?: string | null;
        email?: string | null;
        gstin?: string | null;
        payment_instructions?: string | null;
        footer?: string | null;
      };
      customer: { name: string; code: string; phone?: string | null; address?: string | null };
      order: { order_no: string; order_date?: string | null; due_at?: string | null; notes?: string | null };
    };
  };
  lines: InvoiceLine[];
  paid: number | string;
  balance: number | string;
}

export interface PdfAssets {
  regular: Uint8Array;
  bold: Uint8Array;
  logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
}

const BURGUNDY = rgb(0.45, 0.09, 0.16);
const GOLD = rgb(0.69, 0.55, 0.27);
const INK = rgb(0.13, 0.11, 0.1);
const MUTED = rgb(0.42, 0.38, 0.35);
const CREAM = rgb(0.98, 0.96, 0.91);
const LINE = rgb(0.85, 0.8, 0.72);

const n = (v: number | string | null | undefined) => Number(v ?? 0);

export function formatINR(v: number | string | null | undefined): string {
  const x = n(v);
  const s = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(x));
  return (x < 0 ? '-₹' : '₹') + s;
}

export function formatDateIN(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00+05:30' : iso);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
  }).format(d);
}

function qtyText(q: number | string, unit: string) {
  const x = n(q);
  const s = Number.isInteger(x) ? String(x) : x.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return unit === 'pcs' ? s : `${s} ${unit}`;
}

// Word-wraps text to a width, honouring explicit newlines.
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of (text ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= width) {
        line = trial;
      } else {
        if (line) out.push(line);
        // Hard-break very long words
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

export async function buildInvoicePdf(p: InvoicePayload, assets: PdfAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(assets.regular, { subset: true });
  const bold = await doc.embedFont(assets.bold, { subset: true });
  const inv = p.invoice;
  const biz = inv.snapshot.business;
  const cust = inv.snapshot.customer;
  const ord = inv.snapshot.order;

  doc.setTitle(`Invoice ${inv.invoice_no}`);
  doc.setAuthor(biz.name);
  doc.setCreator('Sri Sri Boutique Manager');

  const W = 595.28, H = 841.89, M = 40;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, size = 10, f: PDFFont = font, color: RGB = INK) =>
    page.drawText(s, { x, y: yy, size, font: f, color });
  const right = (s: string, xr: number, yy: number, size = 10, f: PDFFont = font, color: RGB = INK) =>
    page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });

  // --- Header band
  page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: CREAM });
  page.drawRectangle({ x: 0, y: H - 112, width: W, height: 2, color: GOLD });
  let hx = M;
  if (assets.logo) {
    try {
      const img = assets.logo.type === 'png' ? await doc.embedPng(assets.logo.bytes) : await doc.embedJpg(assets.logo.bytes);
      const s = Math.min(64 / img.height, 64 / img.width);
      page.drawImage(img, { x: M, y: H - 92, width: img.width * s, height: img.height * s });
      hx = M + img.width * s + 12;
    } catch {
      /* unsupported logo: skip it rather than fail the invoice */
    }
  }
  text(biz.name, hx, H - 50, 20, bold, BURGUNDY);
  let hy = H - 66;
  const contact = [biz.phone, biz.whatsapp && biz.whatsapp !== biz.phone ? `WhatsApp ${biz.whatsapp}` : null, biz.email]
    .filter(Boolean).join('  •  ');
  for (const l of [biz.address, contact, biz.whatsapp && biz.whatsapp === biz.phone ? 'Phone & WhatsApp' : null,
                   biz.gstin ? `GSTIN: ${biz.gstin}` : null]) {
    if (!l) continue;
    for (const w of wrap(l, font, 9, 300)) { text(w, hx, hy, 9, font, MUTED); hy -= 12; }
  }
  right('INVOICE', W - M, H - 50, 22, bold, BURGUNDY);
  right(inv.invoice_no, W - M, H - 68, 11, bold);
  right(`Date: ${formatDateIN(inv.issued_at)}`, W - M, H - 83, 9, font, MUTED);
  right(`Order: ${ord.order_no}`, W - M, H - 96, 9, font, MUTED);

  y = H - 140;

  // --- Bill to / delivery
  text('BILL TO', M, y, 8, bold, GOLD);
  text('EXPECTED DELIVERY', W / 2 + 20, y, 8, bold, GOLD);
  y -= 14;
  text(cust.name, M, y, 11, bold);
  text(formatDateIN(ord.due_at ?? null, true), W / 2 + 20, y, 11, bold);
  y -= 13;
  let by = y;
  text(`Customer ID: ${cust.code}`, M, by, 9, font, MUTED); by -= 12;
  if (cust.phone) { text(cust.phone, M, by, 9, font, MUTED); by -= 12; }
  if (cust.address) for (const w of wrap(cust.address, font, 9, 230)) { text(w, M, by, 9, font, MUTED); by -= 12; }
  y = by - 14;

  // --- Items table
  const cols = { no: M, desc: M + 24, qty: 360, rate: 430, disc: 490, amt: W - M };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: BURGUNDY });
    text('#', cols.no + 4, y, 9, bold, rgb(1, 1, 1));
    text('Description', cols.desc, y, 9, bold, rgb(1, 1, 1));
    right('Qty', cols.qty, y, 9, bold, rgb(1, 1, 1));
    right('Rate', cols.rate, y, 9, bold, rgb(1, 1, 1));
    right('Disc.', cols.disc, y, 9, bold, rgb(1, 1, 1));
    right('Amount', cols.amt - 4, y, 9, bold, rgb(1, 1, 1));
    y -= 22;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
    text(`${biz.name} — ${inv.invoice_no} (continued)`, M, y, 9, font, MUTED);
    y -= 24;
    header();
  };
  header();

  p.lines.forEach((l, i) => {
    const descLines = wrap(l.description, font, 9.5, cols.qty - cols.desc - 46);
    const h = descLines.length * 12 + 6;
    if (y - h < 200) newPage();
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - h + 9, width: W - 2 * M, height: h, color: rgb(0.995, 0.985, 0.96) });
    text(String(i + 1), cols.no + 4, y, 9.5);
    descLines.forEach((d, k) => text(d, cols.desc, y - k * 12, 9.5));
    right(qtyText(l.qty, l.unit), cols.qty, y, 9.5);
    right(formatINR(l.unit_price), cols.rate, y, 9.5);
    right(n(l.line_discount) ? formatINR(l.line_discount) : '—', cols.disc, y, 9.5, font, MUTED);
    right(formatINR(l.line_subtotal), cols.amt - 4, y, 9.5, bold);
    y -= h;
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: LINE });
  });

  // --- Totals
  if (y < 260) newPage();
  y -= 8;
  const totalsTop = y;
  const tx = 360;
  const row = (label: string, value: string, strong = false, color: RGB = INK) => {
    text(label, tx, y, strong ? 11 : 9.5, strong ? bold : font, strong ? color : MUTED);
    right(value, W - M - 4, y, strong ? 11 : 9.5, strong ? bold : font, color);
    y -= strong ? 18 : 14;
  };
  row('Subtotal', formatINR(inv.items_subtotal));
  if (n(inv.order_discount)) row('Discount', '-' + formatINR(inv.order_discount));
  if (n(inv.tax_amount)) row(`${inv.tax_label ?? 'Tax'} @ ${n(inv.tax_rate)}%`, formatINR(inv.tax_amount));
  if (n(inv.delivery_charge)) row('Delivery charges', formatINR(inv.delivery_charge));
  if (n(inv.round_off)) row('Round off', formatINR(inv.round_off));
  page.drawLine({ start: { x: tx, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 1, color: GOLD });
  y -= 4;
  row('Total', formatINR(inv.total), true, BURGUNDY);
  row('Paid', formatINR(p.paid));
  y -= 6;
  page.drawRectangle({ x: tx - 8, y: y - 6, width: W - M - tx + 8, height: 22, color: CREAM });
  row('Balance due', formatINR(p.balance), true, n(p.balance) > 0 ? BURGUNDY : INK);

  // --- Notes, payment instructions, footer
  let ly = totalsTop - 4;
  const leftBlock = (title: string, body?: string | null) => {
    if (!body) return;
    text(title, M, ly, 8, bold, GOLD);
    ly -= 13;
    for (const w of wrap(body, font, 9, tx - M - 30)) { text(w, M, ly, 9, font, INK); ly -= 12; }
    ly -= 8;
  };
  leftBlock('NOTES', ord.notes);
  leftBlock('PAYMENT INSTRUCTIONS', biz.payment_instructions);

  page.drawLine({ start: { x: M, y: 70 }, end: { x: W - M, y: 70 }, thickness: 0.5, color: LINE });
  const footer = biz.footer || 'Thank you for choosing us!';
  page.drawText(footer, { x: (W - bold.widthOfTextAtSize(footer, 11)) / 2, y: 50, size: 11, font: bold, color: BURGUNDY });
  const gen = 'This is a computer-generated invoice.';
  page.drawText(gen, { x: (W - font.widthOfTextAtSize(gen, 8)) / 2, y: 36, size: 8, font, color: MUTED });

  if (inv.status === 'cancelled') {
    for (const pg of doc.getPages()) {
      pg.drawText('CANCELLED', { x: 120, y: 360, size: 90, font: bold, color: rgb(0.8, 0.1, 0.1), opacity: 0.18,
        rotate: degrees(35) });
    }
  }

  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    const s = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(s, { x: W - M - font.widthOfTextAtSize(s, 8), y: 20, size: 8, font, color: MUTED });
  });

  return await doc.save();
}

export function invoiceFileName(invoiceNo: string, id: string) {
  return `${invoiceNo.replace(/[^A-Za-z0-9-]+/g, '-')}-${id.slice(0, 8)}.pdf`;
}
