import { buildScanRequest, indianMobile, normalizeScan, toolInput } from './billScan.ts';

const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const TODAY = '2026-10-16';

Deno.test('cleans a typical handwritten bill', () => {
  const r = normalizeScan({
    bill_no: '  247 ', bill_date: '12/10/26', delivery_date: '20-10-2026', customer_name: 'Sravani',
    phone: '98490 12345',
    items: [
      { description: 'Blouse stitching', qty: 2, rate: 650, amount: 1300 },
      { description: 'Maggam work', amount: '2,500/-' },
    ],
    total: 3800, advance: 1000, balance: 2800,
    measurements: { 'Blouse Length': 15, bust: '34', weird: 900 },
  }, TODAY);
  eq(r.bill_no, '247', 'bill no trimmed');
  eq(r.bill_date, '2026-10-12', 'day/month/year date');
  eq(r.delivery_date, '2026-10-20', 'delivery date');
  eq(r.phone, '+919849012345', 'phone to +91');
  eq(r.items[1], { description: 'Maggam work', qty: 1, unit_price: 2500, amount: 2500 }, 'amount-only line gets qty 1 and rate');
  eq(r.measurements, { blouse_length: 15, bust: 34 }, 'measurements cleaned, nonsense dropped');
  eq(r.warnings, [], 'no warnings when everything adds up');
});

Deno.test('flags mismatches instead of guessing', () => {
  const r = normalizeScan({
    phone: '12345', bill_date: '31/02/2026',
    items: [{ description: 'Blouse', qty: 2, rate: 650, amount: 1000 }],
    total: 900, advance: 500, balance: 300, unreadable: ['customer name'],
  }, TODAY);
  const w = r.warnings.join(' | ');
  for (const part of ['is not ₹1000', 'bill total says ₹900', 'is not the written balance', 'not a valid 10-digit', 'Could not understand the bill date', 'customer name']) {
    if (!w.includes(part)) throw new Error(`missing warning "${part}" in: ${w}`);
  }
  eq(r.bill_date, null, 'impossible date rejected');
  eq(r.phone, null, 'bad phone rejected');
});

Deno.test('rejects future dates and empty pages', () => {
  const r = normalizeScan({ bill_date: '2027-01-01', items: [] }, TODAY);
  eq(r.bill_date, null, 'future date dropped');
  if (!r.warnings.some((x) => x.includes('No items'))) throw new Error('expected no-items warning');
});

Deno.test('mobile number formats', () => {
  eq(indianMobile('+91 89190 93604'), '+918919093604', 'with +91');
  eq(indianMobile('08919093604'), '+918919093604', 'leading 0');
  eq(indianMobile('5919093604'), null, 'invalid start digit');
});

Deno.test('request shape and tool output parsing', () => {
  const req = buildScanRequest('AAAA', 'image/jpeg', 'test-model');
  eq(req.tool_choice, { type: 'tool', name: 'record_bill' }, 'forces the tool');
  eq(req.messages[0].content[0].type, 'image', 'image first');
  eq(toolInput({ content: [{ type: 'text' }, { type: 'tool_use', name: 'record_bill', input: { items: [] } }] }), { items: [] }, 'finds tool input');
  eq(toolInput({ content: [{ type: 'text' }] }), null, 'no tool block');
});
