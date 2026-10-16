import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ImagePlus, Loader2, Plus, ScanText, Trash2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '@/lib/supabase';
import { errorMessage, newKey } from '@/lib/errors';
import { METHOD_LABEL, rupees, STATUS_LABEL, todayIST, toNum } from '@/lib/format';
import { prettyPhone, toE164 } from '@/lib/phone';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Card, EmptyState, ErrorBox, PageHeader } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import { findByPhone } from '@/features/customers/api';
import { autoSendMessage, sendInvoiceOnWhatsApp } from '@/lib/autoWhatsApp';
import type { OrderStatus, PaymentMethod, Service } from '@/types/models';

/** What the scan-bill function returns (see supabase/functions/_shared/billScan.ts). */
interface Scanned {
  bill_no: string | null; bill_date: string | null; delivery_date: string | null;
  customer_name: string | null; phone: string | null; phone_raw: string | null;
  items: { description: string; qty: number; unit_price: number; amount: number }[];
  discount: number; total: number | null; advance: number | null; balance: number | null;
  notes: string | null; measurements: Record<string, number>; warnings: string[];
}

type Status = 'waiting' | 'reading' | 'ready' | 'saving' | 'saved' | 'failed' | 'skipped';
interface Job { id: string; file: File; preview: string; status: Status; error?: string; data?: Scanned; orderId?: string; orderNo?: string }

/** Photo → JPEG of at most `max` px, as base64 (no prefix). Large enough to read handwriting. */
async function toJpegBase64(file: File, max = 2000): Promise<{ base64: string; blob: Blob }> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the photo'))), 'image/jpeg', 0.88));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), blob };
}

async function readBill(businessId: string, file: File): Promise<Scanned> {
  const { base64 } = await toJpegBase64(file);
  const { data, error } = await supabase.functions.invoke('scan-bill', { body: { business_id: businessId, image_base64: base64, media_type: 'image/jpeg' } });
  if (error) {
    let msg = 'The bill could not be read. Please try again.';
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data as Scanned;
}

export function ScanBillPage() {
  const bid = useBusinessId();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const update = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    const next: Job[] = Array.from(files).slice(0, 30).map((file) => ({
      id: crypto.randomUUID(), file, preview: URL.createObjectURL(file),
      status: /^image\/(jpeg|png|webp)$/.test(file.type) ? 'waiting' : 'failed',
      error: /^image\/(jpeg|png|webp)$/.test(file.type) ? undefined : 'Use a JPG or PNG photo',
    }));
    setJobs((js) => [...js, ...next]);
  };

  // Read photos one at a time, in the background, while the owner reviews.
  useEffect(() => {
    if (busy.current) return;
    const next = jobs.find((j) => j.status === 'waiting');
    if (!next) return;
    busy.current = true;
    update(next.id, { status: 'reading' });
    readBill(bid, next.file)
      .then((data) => update(next.id, { status: 'ready', data }))
      .catch((e: Error) => update(next.id, { status: 'failed', error: e.message }))
      .finally(() => { busy.current = false; setJobs((js) => [...js]); });
  }, [jobs, bid]);

  // Open the first bill that is ready for review.
  useEffect(() => {
    const cur = jobs.find((j) => j.id === current);
    if (!cur || !['ready', 'saving'].includes(cur.status)) {
      const ready = jobs.find((j) => j.status === 'ready');
      setCurrent(ready?.id ?? null);
    }
  }, [jobs, current]);

  useEffect(() => () => jobs.forEach((j) => URL.revokeObjectURL(j.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const job = jobs.find((j) => j.id === current) ?? null;
  const counts = useMemo(() => ({
    saved: jobs.filter((j) => j.status === 'saved').length,
    pending: jobs.filter((j) => ['waiting', 'reading', 'ready'].includes(j.status)).length,
  }), [jobs]);

  return (
    <div className="space-y-4">
      <PageHeader
        back={<Link to="/orders" className="mb-1 inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Orders</Link>}
        title="Scan bill book"
        subtitle="Take a photo of a bill page. The app reads it and fills the order for you to check and save."
        actions={<>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <Button icon={<Camera className="h-4 w-4" />} onClick={() => camera.current?.click()}>Take photo</Button>
          <Button variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => picker.current?.click()}>Choose photos</Button>
        </>}
      />

      {jobs.length === 0 ? (
        <Card>
          <EmptyState icon={<ScanText className="h-6 w-6" />} title="No bills added yet"
            body="Photograph one bill page at a time, flat and in good light, with the whole page in the frame. You can choose up to 30 photos at once." />
        </Card>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Bills">
          {jobs.map((j, i) => (
            <button key={j.id} onClick={() => ['ready', 'saving'].includes(j.status) && setCurrent(j.id)}
              className={clsx('relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border-2', j.id === current ? 'border-burgundy-700' : 'border-cream-300')}
              aria-label={`Bill ${i + 1}: ${j.status}`}>
              <img src={j.preview} alt="" className="h-full w-full object-cover" />
              <span className={clsx('absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-0.5 text-[10px] font-semibold text-white',
                { waiting: 'bg-ink-500', reading: 'bg-gold-500', ready: 'bg-burgundy-700', saving: 'bg-gold-500', saved: 'bg-emerald-700', failed: 'bg-burgundy-900', skipped: 'bg-ink-400' }[j.status])}>
                {j.status === 'reading' && <Loader2 className="h-3 w-3 animate-spin" />}
                {j.status === 'saved' && <CheckCircle2 className="h-3 w-3" />}
                {j.status === 'failed' && <XCircle className="h-3 w-3" />}
                {{ waiting: 'Waiting', reading: 'Reading', ready: 'Check', saving: 'Saving', saved: 'Saved', failed: 'Failed', skipped: 'Skipped' }[j.status]}
              </span>
            </button>
          ))}
        </div>
      )}
      {jobs.length > 0 && <p className="text-sm text-ink-500">{counts.saved} saved · {counts.pending} still to check</p>}

      {jobs.filter((j) => j.status === 'failed').map((j) => (
        <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-burgundy-50 p-3 text-sm text-burgundy-900">
          <span><b>{j.file.name}</b>: {j.error}</span>
          {/^image\/(jpeg|png|webp)$/.test(j.file.type) && <Button size="sm" variant="secondary" onClick={() => update(j.id, { status: 'waiting', error: undefined })}>Try again</Button>}
        </div>
      ))}

      {job?.data && (
        <ReviewForm key={job.id} job={job}
          onSaved={(orderId, orderNo) => update(job.id, { status: 'saved', orderId, orderNo })}
          onSkip={() => update(job.id, { status: 'skipped' })}
          onSaving={(b) => update(job.id, { status: b ? 'saving' : 'ready' })} />
      )}
      {!job && jobs.some((j) => j.status === 'reading' || j.status === 'waiting') && (
        <Card><div className="flex items-center gap-3 text-sm text-ink-700"><Loader2 className="h-5 w-5 animate-spin text-burgundy-700" /> Reading the bill… this takes a few seconds.</div></Card>
      )}

      {jobs.some((j) => j.status === 'saved') && (
        <Card title="Saved from the bill book">
          <ul className="space-y-1 text-sm">
            {jobs.filter((j) => j.status === 'saved').map((j) => (
              <li key={j.id}><Link className="font-medium text-burgundy-700 underline" to={`/orders/${j.orderId}`}>{j.orderNo}</Link> — {j.data?.customer_name ?? 'customer'}{j.data?.bill_no ? ` (book bill ${j.data.bill_no})` : ''}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

interface Line { description: string; qty: string; price: string; service_id: string }

function ReviewForm({ job, onSaved, onSkip, onSaving }: {
  job: Job; onSaved: (id: string, no: string) => void; onSkip: () => void; onSaving: (b: boolean) => void;
}) {
  const d = job.data!;
  const bid = useBusinessId();
  const { can, business } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useRef({ order: newKey(), invoice: newKey(), payment: newKey() });
  const createdCustomer = useRef<string | null>(null);
  const today = todayIST();

  const [billNo, setBillNo] = useState(d.bill_no ?? '');
  const [billDate, setBillDate] = useState(d.bill_date ?? today);
  const [dueDate, setDueDate] = useState(d.delivery_date ?? '');
  const [name, setName] = useState(d.customer_name ?? '');
  const [phone, setPhone] = useState(d.phone ?? d.phone_raw ?? '');
  const [lines, setLines] = useState<Line[]>(d.items.length
    ? d.items.map((l) => ({ description: l.description, qty: String(l.qty), price: String(l.unit_price || ''), service_id: '' }))
    : [{ description: '', qty: '1', price: '', service_id: '' }]);
  const [discount, setDiscount] = useState(String(d.discount || ''));
  const [advance, setAdvance] = useState(String(d.advance ?? ''));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState(d.notes ?? '');
  const pastDue = !!d.delivery_date && d.delivery_date < today;
  const [finalStatus, setFinalStatus] = useState<OrderStatus>(pastDue || (d.balance === 0) ? 'delivered' : 'in_progress');
  const [saveMeasurements, setSaveMeasurements] = useState(Object.keys(d.measurements).length > 0);
  const [invoice, setInvoice] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const e164 = toE164(phone);
  const existing = useQuery({
    queryKey: ['scan-customer', bid, e164],
    enabled: !!e164,
    queryFn: () => findByPhone(bid, e164!),
  });
  const match = existing.data?.[0] ?? null;

  const services = useQuery({
    queryKey: ['services', bid, 'active'],
    queryFn: async () => (await supabase.from('services').select('*').eq('business_id', bid).eq('active', true).order('name')).data as Service[] ?? [],
  });
  // Link read items to the price list when the names match, for service reports.
  useEffect(() => {
    if (!services.data) return;
    setLines((ls) => ls.map((l) => {
      if (l.service_id) return l;
      const d0 = l.description.toLowerCase();
      const s = services.data!.find((x) => d0.includes(x.name.toLowerCase().split(' ')[0]) && d0.includes(x.name.toLowerCase().split(' ').slice(-1)[0]));
      return s ? { ...l, service_id: s.id } : l;
    }));
  }, [services.data]);

  const itemsTotal = lines.reduce((a, l) => a + Math.round(toNum(l.qty) * toNum(l.price) * 100) / 100, 0);
  const total = itemsTotal - toNum(discount);
  const writtenTotal = d.total;

  const save = async () => {
    setErr(null);
    const clean = lines.filter((l) => l.description.trim());
    if (!clean.length) return setErr('Add at least one item.');
    if (clean.some((l) => !(toNum(l.qty) > 0))) return setErr('Every item needs a quantity more than 0.');
    if (!name.trim() && !match) return setErr('Enter the customer name.');
    if (!e164) return setErr('Enter a valid 10-digit mobile number for the customer.');
    if (toNum(advance) > total) return setErr('Advance is more than the total.');
    if (billDate > today) return setErr('Bill date cannot be in the future.');
    setSaving(true);
    onSaving(true);
    try {
      // 1. Customer: reuse the existing one with this phone, otherwise create.
      let customerId = match?.id ?? createdCustomer.current ?? undefined;
      if (!customerId) {
        const c = await supabase.from('customers').insert({ business_id: bid, full_name: name.trim(), phone_e164: e164, whatsapp_e164: e164 }).select('id').single();
        if (c.error) throw c.error;
        customerId = c.data.id as string;
        createdCustomer.current = customerId;
      }
      // 2. Measurements written on the bill.
      let measurementId: string | null = null;
      if (saveMeasurements && Object.keys(d.measurements).length) {
        const m = await supabase.from('measurement_sets').insert({ business_id: bid, customer_id: customerId, values: d.measurements, notes: `From bill book${billNo ? ` bill ${billNo}` : ''}` }).select('id').single();
        if (m.error) throw m.error;
        measurementId = m.data.id as string;
      }
      // 3. The order, dated on the bill.
      const saved = await supabase.rpc('save_order', { p: {
        business_id: bid, idempotency_key: keys.current.order, customer_id: customerId, measurement_set_id: measurementId,
        order_date: billDate, source_ref: billNo.trim() || null,
        due_at: dueDate ? new Date(`${dueDate}T18:00:00+05:30`).toISOString() : null,
        delivery_method: 'pickup', priority: 'normal', order_discount: toNum(discount), delivery_charge: 0,
        customer_notes: notes.trim() || null, internal_notes: `Imported from bill book${billNo ? ` (bill ${billNo})` : ''}`,
        lines: clean.map((l) => ({ description: l.description.trim(), qty: toNum(l.qty), unit: 'pcs', unit_price: toNum(l.price), line_discount: 0, service_id: l.service_id || null })),
      } });
      if (saved.error) throw saved.error;
      const orderId = saved.data as string;

      // 4. Status, invoice, advance — each step is safe to retry.
      const path: OrderStatus[] = ['confirmed', 'in_progress', 'ready', 'delivered'];
      for (const s of path.slice(0, path.indexOf(finalStatus) + 1)) {
        const r = await supabase.rpc('change_order_status', { p_order_id: orderId, p_to: s, p_note: s === 'confirmed' ? 'Imported from bill book' : null });
        if (r.error && !/Cannot move an order from (\w+) to/.test(r.error.message)) throw r.error;
      }
      let invoiceId: string | null = null;
      if (invoice && can('invoices.manage')) {
        const r = await supabase.rpc('issue_invoice', { p_order_id: orderId, p_idempotency_key: keys.current.invoice });
        if (r.error) throw r.error;
        invoiceId = r.data as string;
      }
      if (toNum(advance) > 0 && can('payments.record')) {
        const r = await supabase.rpc('record_payment', {
          p_order_id: orderId, p_kind: 'payment', p_amount: toNum(advance), p_method: method, p_idempotency_key: keys.current.payment,
          p_received_at: new Date(`${billDate}T12:00:00+05:30`).toISOString(), p_note: 'Advance written in bill book',
        });
        if (r.error) throw r.error;
      }
      // 5. Keep the bill photo with the order (team only).
      try {
        const { blob } = await toJpegBase64(job.file, 1600);
        const path2 = `${bid}/${orderId}/bill-${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from('order-images').upload(path2, blob, { contentType: 'image/jpeg' });
        if (!up.error) {
          await supabase.from('attachments').insert({ business_id: bid, bucket: 'order-images', path: path2, entity_type: 'order', entity_id: orderId,
            visibility: 'internal', mime: 'image/jpeg', size_bytes: blob.size, caption: 'Bill book photo' });
        }
      } catch { /* the order is saved; the photo is a convenience */ }

      if (invoiceId && business?.whatsapp_auto_send) {
        const r = await sendInvoiceOnWhatsApp(invoiceId);
        if (r.status !== 'not_configured') { const m = autoSendMessage(r); toast[m.kind](m.text); }
      }
      const no = (await supabase.from('orders').select('order_no').eq('id', orderId).single()).data?.order_no as string;
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Saved as ${no}`);
      onSaved(orderId, no);
    } catch (e) {
      setErr(errorMessage(e));
      onSaving(false);
    } finally {
      setSaving(false);
    }
  };

  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card title="Bill photo" padded={false}>
        <a href={job.preview} target="_blank" rel="noreferrer" title="Open full size">
          <img src={job.preview} alt="Bill book page" className="max-h-[75vh] w-full object-contain bg-cream-50" />
        </a>
        <p className="px-4 py-2 text-xs text-ink-500">Tap the photo to open it full size and compare.</p>
      </Card>

      <Card title="Check and save">
        <div className="space-y-4">
          {d.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> Please check</p>
              <ul className="list-disc space-y-0.5 pl-5">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TextField label="Book bill no." value={billNo} onChange={(e) => setBillNo(e.target.value)} hint="Stops the same bill being entered twice" />
            <TextField label="Bill date" type="date" max={today} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            <TextField label="Delivery date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField label="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              error={phone && !e164 ? 'Not a valid mobile number' : undefined} />
          </div>
          {match && (
            <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">
              Existing customer <b>{match.full_name}</b> ({match.customer_code}) has this number. The order will be added to them.
            </p>
          )}
          {!match && e164 && <p className="text-sm text-ink-500">New customer will be created: {name || '—'} · {prettyPhone(e164)}</p>}

          <div>
            <p className="label">Items</p>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_4.5rem_6rem_auto] items-start gap-2">
                  <input className="input" aria-label={`Item ${i + 1}`} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Item" />
                  <input className="input" aria-label={`Qty ${i + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
                  <input className="input" aria-label={`Price ${i + 1}`} inputMode="decimal" value={l.price} onChange={(e) => setLine(i, 'price', e.target.value)} placeholder="₹" />
                  <button className="rounded-lg p-2.5 text-ink-500 hover:bg-cream-200" aria-label={`Remove item ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((ls) => [...ls, { description: '', qty: '1', price: '', service_id: '' }])}>Add item</Button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TextField label="Discount (₹)" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            <TextField label="Advance paid (₹)" inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} />
            <SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectField>
          </div>

          <dl className="space-y-1 rounded-lg bg-cream-50 p-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-500">Total</dt><dd className="num font-semibold">{rupees(total)}</dd></div>
            {writtenTotal !== null && Math.abs(writtenTotal - total) > 1 && (
              <div className="flex justify-between text-amber-800"><dt>Total written on the bill</dt><dd className="num">{rupees(writtenTotal)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-ink-500">Balance</dt><dd className="num">{rupees(total - toNum(advance))}</dd></div>
          </dl>

          <TextAreaField label="Design notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Where is this order now?" value={finalStatus} onChange={(e) => setFinalStatus(e.target.value as OrderStatus)}>
              {(['confirmed', 'in_progress', 'ready', 'delivered'] as OrderStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </SelectField>
            <div className="space-y-2 pt-1">
              {Object.keys(d.measurements).length > 0 && (
                <Checkbox label={`Save ${Object.keys(d.measurements).length} measurements to the customer`} checked={saveMeasurements} onChange={(e) => setSaveMeasurements(e.target.checked)} />
              )}
              {can('invoices.manage') && <Checkbox label="Also create an invoice" hint="Leave off for old bills already given on paper" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} />}
            </div>
          </div>

          {err && <ErrorBox message={err} />}
          <div className="flex flex-wrap justify-end gap-2 border-t border-cream-200 pt-3">
            <Button variant="ghost" onClick={onSkip} disabled={saving}>Skip this bill</Button>
            <Button size="lg" loading={saving} onClick={save}>Save & next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
