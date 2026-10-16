import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm, useWatch, type Control, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage, newKey } from '@/lib/errors';
import { DELIVERY_LABEL, fmtDate, fromLocalInput, rupees, toLocalInput, toNum, UNIT_LABEL } from '@/lib/format';
import { estimateTotals, lineSubtotal } from '@/lib/orderMath';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Card, ErrorBox, PageHeader } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { CustomerPicker } from '@/features/customers/CustomerPicker';
import { getCustomer, getMeasurements } from '@/features/customers/api';
import { UNITS, type Customer, type Service } from '@/types/models';
import { getOrderFull } from './api';
import { uploadPhotos } from './ImagesSection';
import { autoSendMessage, sendInvoiceOnWhatsApp } from '@/lib/autoWhatsApp';

const num = (msg: string) => z.coerce.number({ invalid_type_error: msg }).finite(msg);
const lineSchema = z.object({
  id: z.string().optional(),
  service_id: z.string().optional(),
  description: z.string().trim().min(1, 'Describe the item').max(300),
  customer_description: z.string().trim().max(300).optional(),
  garment_details: z.string().trim().max(1000).optional(),
  qty: num('Enter a quantity').positive('More than 0').max(100000),
  unit: z.enum(UNITS as [string, ...string[]]),
  unit_price: num('Enter a price').min(0, 'Cannot be negative').max(10000000),
  line_discount: num('Enter a number').min(0, 'Cannot be negative'),
  internal_notes: z.string().trim().max(1000).optional(),
}).refine((l) => l.line_discount <= l.qty * l.unit_price + 0.001, { path: ['line_discount'], message: 'More than the item amount' });

const schema = z.object({
  customer_id: z.string().min(1, 'Choose a customer'),
  measurement_set_id: z.string().optional(),
  due_at: z.string().optional(),
  delivery_method: z.enum(['pickup', 'local_delivery', 'courier', 'rapido']),
  delivery_address: z.string().trim().max(500).optional(),
  assigned_worker_id: z.string().optional(),
  priority: z.enum(['normal', 'high', 'urgent']),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(100),
  order_discount: num('Enter a number').min(0),
  delivery_charge: num('Enter a number').min(0),
  customer_notes: z.string().trim().max(1000).optional(),
  internal_notes: z.string().trim().max(2000).optional(),
  confirm: z.boolean(),
  invoice: z.boolean(),
  advance: num('Enter a number').min(0),
  advance_method: z.enum(['cash', 'upi', 'bank', 'card', 'other']),
  advance_ref: z.string().trim().max(80).optional(),
});
type Form = z.infer<typeof schema>;

const emptyLine = (): Form['lines'][number] => ({ description: '', qty: 1, unit: 'pcs', unit_price: 0, line_discount: 0 });

export function OrderEditorPage() {
  const { id } = useParams();
  const editing = !!id;
  const q = useQuery({ queryKey: ['order', id], queryFn: () => getOrderFull(id!), enabled: editing });
  if (editing && q.isLoading) return <PageLoader />;
  if (editing && (q.error || !q.data)) return <ErrorBox message={errorMessage(q.error ?? 'Not found')} />;
  if (q.data && q.data.invoices.some((i) => i.status === 'issued')) {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold">This order has an issued invoice</h1>
        <p className="mt-2 text-sm text-ink-700">To change items or prices, open the order and cancel the invoice first (with a reason). You can then edit the order and issue a corrected invoice.</p>
        <Link to={`/orders/${id}`} className="mt-4 inline-block font-medium text-burgundy-700">Back to order</Link>
      </div>
    );
  }
  if (q.data && ['delivered', 'cancelled'].includes(q.data.order.status)) {
    return <ErrorBox message="Delivered or cancelled orders cannot be edited." />;
  }
  return <OrderForm existing={q.data ?? null} />;
}

function OrderForm({ existing }: { existing: Awaited<ReturnType<typeof getOrderFull>> | null }) {
  const bid = useBusinessId();
  const { business, can } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [customer, setCustomer] = useState<Customer | null>(existing?.customer ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  // One key per form visit: double-taps and retries never create duplicates.
  const keys = useRef({ order: newKey(), invoice: newKey(), payment: newKey() });

  const services = useQuery({
    queryKey: ['services', bid, 'active'],
    queryFn: async () => (await supabase.from('services').select('*').eq('business_id', bid).eq('active', true).order('name')).data as Service[] ?? [],
  });
  const workers = useQuery({
    queryKey: ['workers', bid],
    queryFn: async () => (await supabase.from('workers').select('id, name').eq('business_id', bid).eq('active', true).order('name')).data ?? [],
  });

  // Preselect customer from ?customer=
  useEffect(() => {
    const cid = sp.get('customer');
    if (!existing && cid && !customer) getCustomer(cid).then(setCustomer).catch(() => undefined);
  }, [sp, existing, customer]);

  const measurements = useQuery({
    queryKey: ['measurements', customer?.id],
    queryFn: () => getMeasurements(customer!.id),
    enabled: !!customer,
  });

  const o = existing?.order;
  const { register, control, handleSubmit, setValue, getValues, watch, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer_id: o?.customer_id ?? '',
      measurement_set_id: o?.measurement_set_id ?? '',
      due_at: toLocalInput(o?.due_at),
      delivery_method: o?.delivery_method ?? 'pickup',
      delivery_address: o?.delivery_address ?? '',
      assigned_worker_id: o?.assigned_worker_id ?? '',
      priority: existing?.internal?.priority ?? 'normal',
      lines: existing?.lines.length
        ? existing.lines.map((l) => ({
            id: l.id, service_id: l.service_id ?? '', description: l.description, customer_description: l.customer_description ?? '',
            garment_details: l.garment_details ?? '', qty: toNum(l.qty), unit: l.unit, unit_price: toNum(l.unit_price),
            line_discount: toNum(l.line_discount), internal_notes: l.internal_notes ?? '',
          }))
        : [emptyLine()],
      order_discount: toNum(o?.order_discount),
      delivery_charge: toNum(o?.delivery_charge),
      customer_notes: o?.customer_notes ?? '',
      internal_notes: existing?.internal?.internal_notes ?? '',
      confirm: !existing,
      invoice: false,
      advance: 0,
      advance_method: 'upi',
      advance_ref: '',
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  useEffect(() => { setValue('customer_id', customer?.id ?? '', { shouldValidate: !!customer }); }, [customer, setValue]);
  useEffect(() => {
    // Default to the latest measurements for a new order.
    if (!existing && measurements.data?.length && !getValues('measurement_set_id')) setValue('measurement_set_id', measurements.data[0].id);
  }, [measurements.data, existing, getValues, setValue]);

  const invoiceNow = watch('invoice');
  const deliveryMethod = watch('delivery_method');

  const onSubmit = async (v: Form) => {
    setErr(null);
    const payload = {
      id: existing?.order.id,
      business_id: bid,
      idempotency_key: existing ? undefined : keys.current.order,
      customer_id: v.customer_id,
      measurement_set_id: v.measurement_set_id || null,
      due_at: fromLocalInput(v.due_at ?? ''),
      delivery_method: v.delivery_method,
      delivery_address: v.delivery_method === 'pickup' ? null : v.delivery_address || null,
      assigned_worker_id: v.assigned_worker_id || null,
      priority: v.priority,
      order_discount: v.order_discount,
      delivery_charge: v.delivery_charge,
      customer_notes: v.customer_notes || null,
      internal_notes: v.internal_notes || null,
      lines: v.lines.map((l) => ({
        id: l.id || undefined, service_id: l.service_id || null, description: l.description,
        customer_description: l.customer_description || null, garment_details: l.garment_details || null,
        qty: l.qty, unit: l.unit, unit_price: l.unit_price, line_discount: l.line_discount, internal_notes: l.internal_notes || null,
      })),
    };
    const saved = await supabase.rpc('save_order', { p: payload });
    if (saved.error) return setErr(errorMessage(saved.error));
    const orderId = saved.data as string;
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['order', orderId] });

    // Quick-bill steps for new orders. Each is idempotent, so a retry is safe.
    const status = existing?.order.status ?? 'draft';
    const steps: [string, () => PromiseLike<{ data?: unknown; error: unknown }>][] = [];
    let invoiceId: string | null = null;
    if ((v.confirm || v.invoice) && status === 'draft') {
      steps.push(['confirm the order', () => supabase.rpc('change_order_status', { p_order_id: orderId, p_to: 'confirmed', p_note: null })]);
    }
    if (v.invoice && can('invoices.manage')) {
      steps.push(['create the invoice', () => supabase.rpc('issue_invoice', { p_order_id: orderId, p_idempotency_key: keys.current.invoice })]);
    }
    if (v.advance > 0 && can('payments.record')) {
      steps.push(['record the advance', () => supabase.rpc('record_payment', {
        p_order_id: orderId, p_kind: 'payment', p_amount: v.advance, p_method: v.advance_method,
        p_idempotency_key: keys.current.payment, p_reference_no: v.advance_ref || null,
      })]);
    }
    for (const [label, run] of steps) {
      const r = await run();
      if (r.error) {
        toast.error(`Order saved, but could not ${label}: ${errorMessage(r.error)}`);
        return navigate(`/orders/${orderId}`, { replace: true });
      }
      if (label === 'create the invoice') invoiceId = r.data as string;
    }

    // Photos chosen in the form are saved to storage and linked to the order.
    if (photos.length) {
      try { await uploadPhotos(bid, 'order', orderId, photos); }
      catch (e) { toast.error(`Order saved, but photos could not be saved: ${e instanceof Error && !('code' in e) ? e.message : errorMessage(e)}`); }
    }

    // Automatic WhatsApp: send the bill straight to the customer when it is set up.
    if (invoiceId && business?.whatsapp_auto_send) {
      const r = await sendInvoiceOnWhatsApp(invoiceId);
      if (r.status !== 'not_configured') {
        const m = autoSendMessage(r);
        toast[m.kind](m.text);
        return navigate(`/orders/${orderId}`, { replace: true });
      }
    }
    toast.success(existing ? 'Order updated' : 'Order saved');
    navigate(`/orders/${orderId}${v.invoice ? '?share=1' : ''}`, { replace: true });
  };

  // Some fields with mistakes may be scrolled out of view: say what is wrong next to the Save button
  // and move to the first one, so saving never fails silently.
  const onInvalid = (errs: FieldErrors<Form>) => {
    const msgs: string[] = [];
    if (errs.customer_id) msgs.push('Choose a customer');
    errs.lines?.forEach?.((l, i) => {
      if (!l) return;
      const first = Object.values(l).find((x) => x && typeof x === 'object' && 'message' in x) as { message?: string } | undefined;
      if (first?.message) msgs.push(`Item ${i + 1}: ${first.message}`);
    });
    if (errs.lines?.message) msgs.push(errs.lines.message);
    for (const [k, label] of [['order_discount', 'Order discount'], ['delivery_charge', 'Delivery charge'], ['advance', 'Advance'], ['delivery_address', 'Delivery address'], ['customer_notes', 'Note for the customer'], ['internal_notes', 'Internal notes']] as const) {
      const e = errs[k];
      if (e?.message) msgs.push(`${label}: ${e.message}`);
    }
    setErr(`Not saved yet. Please fix: ${msgs.length ? msgs.join(' · ') : 'the highlighted fields'}`);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
    });
  };

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">
      <PageHeader
        back={<Link to={existing ? `/orders/${existing.order.id}` : '/orders'} className="mb-1 inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Back</Link>}
        title={existing ? `Edit ${existing.order.order_no}` : 'New order'}
      />

      <Card title="Customer">
        <CustomerPicker value={customer} onChange={setCustomer} error={errors.customer_id?.message} locked={!!existing && existing.order.status !== 'draft'} />
        {customer && (
          <div className="mt-3">
            <SelectField label="Measurements to use" {...register('measurement_set_id')}
              hint={measurements.data?.length ? 'The chosen set is kept with this order even if measurements change later.' : 'No measurements saved yet. You can add them from the customer page.'}>
              <option value="">None</option>
              {measurements.data?.map((m, i) => (
                <option key={m.id} value={m.id}>{i === 0 ? 'Latest' : 'Earlier'} · {m.garment_type} · {fmtDate(m.taken_at)}</option>
              ))}
            </SelectField>
          </div>
        )}
      </Card>

      <Card title="Items" actions={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => append(emptyLine())}>Add item</Button>}>
        {errors.lines?.message && <p className="mb-2 text-sm text-burgundy-700">{errors.lines.message}</p>}
        <div className="space-y-4">
          {fields.map((f, i) => (
            <div key={f.id} className="rounded-xl border border-cream-300 bg-cream-50/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gold-700">Item {i + 1}</span>
                {fields.length > 1 && (
                  <button type="button" className="rounded-lg p-2 text-ink-500 hover:bg-cream-200" onClick={() => remove(i)} aria-label={`Remove item ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <SelectField className="col-span-2" label="Service" {...register(`lines.${i}.service_id`, {
                  onChange: (e) => {
                    const s = services.data?.find((x) => x.id === e.target.value);
                    if (s) {
                      setValue(`lines.${i}.description`, s.name, { shouldValidate: true });
                      setValue(`lines.${i}.unit`, s.unit);
                      if (toNum(s.default_price) > 0) setValue(`lines.${i}.unit_price`, toNum(s.default_price));
                    }
                  },
                })}>
                  <option value="">Custom item</option>
                  {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name}{toNum(s.default_price) ? ` — ${rupees(s.default_price, { whole: true })}` : ''}</option>)}
                </SelectField>
                <TextField className="col-span-2 sm:col-span-4" label="Description" required {...register(`lines.${i}.description`)} error={errors.lines?.[i]?.description?.message} />
                <TextField label="Qty" inputMode="decimal" {...register(`lines.${i}.qty`)} error={errors.lines?.[i]?.qty?.message} />
                <SelectField label="Unit" {...register(`lines.${i}.unit`)}>
                  {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                </SelectField>
                <TextField label="Price (₹)" inputMode="decimal" {...register(`lines.${i}.unit_price`)} error={errors.lines?.[i]?.unit_price?.message} />
                <TextField label="Discount (₹)" inputMode="decimal" {...register(`lines.${i}.line_discount`)} error={errors.lines?.[i]?.line_discount?.message} />
                <LineTotal control={control} index={i} />
                <details className="col-span-2 sm:col-span-6">
                  <summary className="cursor-pointer text-sm font-medium text-burgundy-700">Design details & notes</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <TextAreaField label="Garment / design details" rows={2} {...register(`lines.${i}.garment_details`)} hint="Neck style, sleeves, work placement…" />
                    <TextAreaField label="Text on the invoice" rows={2} {...register(`lines.${i}.customer_description`)} hint="Leave empty to use the description" />
                    <TextAreaField className="sm:col-span-2" label="Internal notes" rows={2} {...register(`lines.${i}.internal_notes`)} hint="Never shown to the customer" />
                  </div>
                </details>
              </div>
            </div>
          ))}
        </div>
        <Button className="mt-3 w-full sm:w-auto" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => append(emptyLine())}>Add another item</Button>
      </Card>

      <Card title="Design photos" actions={<>
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
          onChange={(e) => { const f = Array.from(e.target.files ?? []); setPhotos((p) => [...p, ...f].slice(0, 20)); e.target.value = ''; }} />
        <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => photoInput.current?.click()}>Add photos</Button>
      </>}>
        {photos.length ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {photos.map((f, i) => (
              <div key={i} className="relative">
                <img src={URL.createObjectURL(f)} alt="" className="aspect-square w-full rounded-lg object-cover" />
                <button type="button" className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-white" aria-label="Remove photo"
                  onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-ink-500">Optional: reference designs, fabric or measurements photos. They are saved with the order when you save.</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Delivery & work">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Expected delivery" type="datetime-local" {...register('due_at')} />
            <SelectField label="Delivery method" {...register('delivery_method')}>
              {Object.entries(DELIVERY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
            {deliveryMethod !== 'pickup' && <TextAreaField className="sm:col-span-2" label="Delivery address" rows={2} {...register('delivery_address')} />}
            <SelectField label="Assigned to" {...register('assigned_worker_id')}>
              <option value="">Not assigned</option>
              {workers.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </SelectField>
            <SelectField label="Priority" {...register('priority')}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectField>
            <TextAreaField className="sm:col-span-2" label="Note for the customer" rows={2} {...register('customer_notes')} hint="Printed on the invoice" />
            <TextAreaField className="sm:col-span-2" label="Internal notes" rows={2} {...register('internal_notes')} hint="Team only" />
          </div>
        </Card>

        <Card title="Amount">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Order discount (₹)" inputMode="decimal" {...register('order_discount')} error={errors.order_discount?.message} />
            <TextField label="Delivery charge (₹)" inputMode="decimal" {...register('delivery_charge')} error={errors.delivery_charge?.message} />
          </div>
          <Totals control={control} settings={{ tax_enabled: !!business?.tax_enabled, tax_rate: toNum(business?.tax_rate), rounding_rule: business?.rounding_rule ?? 'rupee' }} taxLabel={business?.tax_label ?? 'Tax'} />

          {!existing && (
            <div className="mt-4 space-y-3 rounded-xl border border-gold-300 bg-gold-100/40 p-3">
              <p className="text-sm font-semibold text-gold-700">Quick billing</p>
              <Checkbox label="Confirm the order now" {...register('confirm')} />
              {can('invoices.manage') && <Checkbox label="Create the invoice now"
                hint={business?.whatsapp_auto_send ? 'The bill is sent to the customer on WhatsApp automatically when you save' : 'Opens the share screen (PDF and WhatsApp) after saving'} {...register('invoice')} />}
              {can('payments.record') && (
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Advance received (₹)" inputMode="decimal" {...register('advance')} error={errors.advance?.message} />
                  <SelectField label="Paid by" {...register('advance_method')}>
                    <option value="upi">UPI</option><option value="cash">Cash</option><option value="bank">Bank transfer</option>
                    <option value="card">Card</option><option value="other">Other</option>
                  </SelectField>
                  <TextField className="col-span-2" label="UPI / reference no. (optional)" {...register('advance_ref')} />
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {err && <ErrorBox message={err} />}
      <div className="no-print sticky bottom-16 z-20 flex justify-end gap-2 rounded-xl border border-cream-300 bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
        <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        <Button type="submit" size="lg" loading={isSubmitting}>
          {existing ? 'Save changes' : invoiceNow ? 'Save & create invoice' : 'Save order'}
        </Button>
      </div>
    </form>
  );
}

function LineTotal({ control, index }: { control: Control<Form>; index: number }) {
  const l = useWatch({ control, name: `lines.${index}` });
  const v = lineSubtotal({ qty: toNum(l?.qty), unit_price: toNum(l?.unit_price), line_discount: toNum(l?.line_discount) });
  return (
    <div className="col-span-2">
      <span className="label">Line total</span>
      <p className="num py-2.5 text-lg font-semibold">{rupees(v)}</p>
    </div>
  );
}

function Totals({ control, settings, taxLabel }: { control: Control<Form>; settings: Parameters<typeof estimateTotals>[3]; taxLabel: string }) {
  const lines = useWatch({ control, name: 'lines' });
  const disc = useWatch({ control, name: 'order_discount' });
  const del = useWatch({ control, name: 'delivery_charge' });
  const t = useMemo(() => estimateTotals(
    (lines ?? []).map((l) => ({ qty: toNum(l.qty), unit_price: toNum(l.unit_price), line_discount: toNum(l.line_discount) })),
    toNum(disc), toNum(del), settings,
  ), [lines, disc, del, settings]);
  return (
    <dl className="mt-4 space-y-1.5 text-sm">
      <div className="flex justify-between"><dt className="text-ink-500">Items</dt><dd className="num">{rupees(t.items)}</dd></div>
      {toNum(disc) > 0 && <div className="flex justify-between"><dt className="text-ink-500">Discount</dt><dd className="num">-{rupees(disc)}</dd></div>}
      {t.tax > 0 && <div className="flex justify-between"><dt className="text-ink-500">{taxLabel} {settings.tax_rate}%</dt><dd className="num">{rupees(t.tax)}</dd></div>}
      {toNum(del) > 0 && <div className="flex justify-between"><dt className="text-ink-500">Delivery</dt><dd className="num">{rupees(del)}</dd></div>}
      {t.roundOff !== 0 && <div className="flex justify-between"><dt className="text-ink-500">Round off</dt><dd className="num">{rupees(t.roundOff)}</dd></div>}
      <div className="flex justify-between border-t border-cream-200 pt-2 text-lg font-semibold text-burgundy-700"><dt>Total</dt><dd className="num">{rupees(t.total)}</dd></div>
      {t.taxable < 0 && <p className="text-sm text-burgundy-700">The discount is more than the items total.</p>}
      <p className="text-xs text-ink-500">Final amounts are calculated and saved by the server.</p>
    </dl>
  );
}
