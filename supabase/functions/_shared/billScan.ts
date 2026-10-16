// Reading a photo of a handwritten bill-book page into structured fields.
// Pure helpers (prompt, schema, request, normalisation) so they can be unit-tested
// without calling the AI service. Runs in Deno (Edge Function) and Node (tests).

export interface ScannedLine {
  description: string;
  qty: number;
  unit_price: number;
  amount: number;
}

export interface ScannedBill {
  bill_no: string | null;
  bill_date: string | null;      // YYYY-MM-DD
  delivery_date: string | null;  // YYYY-MM-DD
  customer_name: string | null;
  phone: string | null;          // E.164 (+91…) when it looks like a valid mobile
  phone_raw: string | null;      // exactly what was written, for checking
  items: ScannedLine[];
  discount: number;
  total: number | null;
  advance: number | null;
  balance: number | null;
  notes: string | null;
  measurements: Record<string, number>;
  warnings: string[];
}

export const SCAN_TOOL = {
  name: 'record_bill',
  description: 'Record the details read from one boutique bill-book page.',
  input_schema: {
    type: 'object',
    properties: {
      bill_no: { type: ['string', 'null'], description: 'Bill / receipt number printed or written on the page' },
      bill_date: { type: ['string', 'null'], description: 'Bill date as YYYY-MM-DD. Indian format is day/month/year.' },
      delivery_date: { type: ['string', 'null'], description: 'Promised delivery / trial date as YYYY-MM-DD, if written' },
      customer_name: { type: ['string', 'null'], description: 'Customer name in English letters (transliterate Telugu)' },
      phone: { type: ['string', 'null'], description: 'Mobile number exactly as written (digits)' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Item in English, e.g. "Blouse stitching", "Maggam work", "Fall & pico"' },
            qty: { type: ['number', 'null'] },
            rate: { type: ['number', 'null'], description: 'Price per piece in rupees' },
            amount: { type: ['number', 'null'], description: 'Line amount in rupees' },
          },
          required: ['description'],
        },
      },
      discount: { type: ['number', 'null'] },
      total: { type: ['number', 'null'], description: 'Bill total in rupees' },
      advance: { type: ['number', 'null'], description: 'Advance / amount paid in rupees' },
      balance: { type: ['number', 'null'], description: 'Balance due in rupees' },
      measurements: {
        type: ['object', 'null'],
        description: 'Blouse measurements if written, keys like blouse_length, bust, waist, shoulder, armhole, sleeve_length, sleeve_round, front_neck_depth, back_neck_depth; values in inches',
        additionalProperties: { type: 'number' },
      },
      notes: { type: ['string', 'null'], description: 'Design or other notes written on the bill, in English' },
      unreadable: { type: 'array', items: { type: 'string' }, description: 'Fields you could not read with confidence' },
    },
    required: ['items'],
  },
} as const;

export const SCAN_PROMPT = `This is a photo of one page from the paper bill book of Sri Sri Boutique, a tailoring and embroidery shop in Telangana, India.
It may be handwritten, in English, Telugu or a mix. Read it and call record_bill once.

Rules:
- Copy only what is written. Never guess or invent a value. If something is missing or unreadable, use null and list it in "unreadable".
- Amounts are in rupees. Write numbers without ₹ or commas. "/-" after a number just means rupees.
- Dates are written day/month/year (Indian style). Convert to YYYY-MM-DD. If the year is written with two digits, it is 20xx.
- If only a line amount is written, leave qty and rate null. If qty is not written, use 1.
- Item names in English: blouse stitching, lining blouse, maggam/aari work, mugam work, fall & pico, saree kuchu, alteration, lehenga, DTF printing, etc.
- "Adv", "Advance", "Paid" mean the advance. "Bal" means balance.
- If the page is not a bill, return an empty items list and explain in "unreadable".`;

export function buildScanRequest(imageBase64: string, mediaType: string, model: string) {
  return {
    model,
    max_tokens: 2000,
    tools: [SCAN_TOOL],
    tool_choice: { type: 'tool', name: SCAN_TOOL.name },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: SCAN_PROMPT },
      ],
    }],
  };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s/-]+$/g, '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
};

const isoDate = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

export function indianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

/** Cleans the AI output and adds plain-language warnings for the person reviewing it. */
export function normalizeScan(raw: Record<string, unknown>, today: string): ScannedBill {
  const warnings: string[] = [];
  const items: ScannedLine[] = (Array.isArray(raw.items) ? raw.items : [])
    .map((it: Record<string, unknown>) => {
      const description = String(it?.description ?? '').trim().slice(0, 300);
      let qty = num(it?.qty) ?? 1;
      let rate = num(it?.rate);
      let amount = num(it?.amount);
      if (qty <= 0) qty = 1;
      if (rate === null && amount !== null) rate = Math.round((amount / qty) * 100) / 100;
      if (amount === null && rate !== null) amount = Math.round(qty * rate * 100) / 100;
      if (rate !== null && amount !== null && Math.abs(qty * rate - amount) > 1) {
        warnings.push(`“${description}”: ${qty} × ₹${rate} is not ₹${amount}. Check this line.`);
      }
      return { description, qty, unit_price: rate ?? 0, amount: amount ?? 0 };
    })
    .filter((l) => l.description);

  const discount = num(raw.discount) ?? 0;
  const total = num(raw.total);
  const advance = num(raw.advance);
  const balance = num(raw.balance);
  const itemsSum = Math.round(items.reduce((a, l) => a + l.amount, 0) * 100) / 100;

  if (!items.length) warnings.push('No items could be read. Add them by hand.');
  if (items.some((l) => l.unit_price === 0)) warnings.push('Some items have no price.');
  if (total !== null && items.length && Math.abs(itemsSum - discount - total) > 1) {
    warnings.push(`Items add up to ₹${itemsSum}${discount ? ` less ₹${discount} discount` : ''}, but the bill total says ₹${total}.`);
  }
  if (total !== null && advance !== null && balance !== null && Math.abs(total - advance - balance) > 1) {
    warnings.push(`Total ₹${total} − advance ₹${advance} is not the written balance ₹${balance}.`);
  }
  if (advance !== null && total !== null && advance > total) warnings.push('Advance is more than the total.');

  const phoneRaw = raw.phone ? String(raw.phone).slice(0, 30) : null;
  const phone = indianMobile(phoneRaw);
  if (phoneRaw && !phone) warnings.push(`Phone “${phoneRaw}” is not a valid 10-digit mobile number.`);
  if (!phoneRaw) warnings.push('No phone number found.');

  let billDate = isoDate(raw.bill_date);
  if (raw.bill_date && !billDate) warnings.push(`Could not understand the bill date “${raw.bill_date}”.`);
  if (billDate && billDate > today) { warnings.push(`Bill date ${billDate} is in the future. Check the date.`); billDate = null; }
  const deliveryDate = isoDate(raw.delivery_date);

  const measurements: Record<string, number> = {};
  if (raw.measurements && typeof raw.measurements === 'object') {
    for (const [k, v] of Object.entries(raw.measurements as Record<string, unknown>)) {
      const n = num(v);
      const key = k.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
      if (n !== null && n > 0 && n < 200 && key) measurements[key] = n;
    }
  }
  for (const u of Array.isArray(raw.unreadable) ? raw.unreadable.slice(0, 8) : []) {
    warnings.push(`Not clear on the photo: ${String(u).slice(0, 120)}`);
  }

  return {
    bill_no: raw.bill_no ? String(raw.bill_no).trim().slice(0, 40) : null,
    bill_date: billDate,
    delivery_date: deliveryDate,
    customer_name: raw.customer_name ? String(raw.customer_name).trim().slice(0, 120) : null,
    phone,
    phone_raw: phoneRaw,
    items,
    discount,
    total,
    advance,
    balance,
    notes: raw.notes ? String(raw.notes).trim().slice(0, 1000) : null,
    measurements,
    warnings,
  };
}

/** Pulls the tool input out of an Anthropic Messages API response. */
export function toolInput(response: { content?: { type: string; name?: string; input?: unknown }[] }): Record<string, unknown> | null {
  const block = response.content?.find((b) => b.type === 'tool_use' && b.name === SCAN_TOOL.name);
  return block && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : null;
}
