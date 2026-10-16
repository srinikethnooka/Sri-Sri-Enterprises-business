import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { DELIVERY_LABEL, fmtDateTime, rupees } from '@/lib/format';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Badge, Card, EmptyState, ErrorBox } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Customer, DeliveryMethod, Order } from '@/types/models';

export interface Delivery {
  id: string; order_id: string; method: DeliveryMethod; status: string; destination: string | null; contact_name: string | null;
  contact_phone: string | null; provider: string | null; booking_ref: string | null; charge_to_shop: number; dispatched_at: string | null;
  delivered_at: string | null; notes: string | null; created_at: string;
}
const STATUSES = ['pending', 'booked', 'dispatched', 'delivered', 'failed', 'cancelled'];

export function DeliverySection({ order, customer }: { order: Order; customer: Customer }) {
  const { canAny } = useSession();
  const [edit, setEdit] = useState<Delivery | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['deliveries', order.id],
    queryFn: async () => (await supabase.from('deliveries').select('*').eq('order_id', order.id).order('created_at', { ascending: false })).data as Delivery[] ?? [],
  });
  const canEdit = canAny('delivery.manage', 'orders.manage');

  return (
    <Card title="Delivery" actions={canEdit && order.delivery_method !== 'pickup' && <Button size="sm" variant="secondary" onClick={() => setEdit('new')}>Add booking</Button>}>
      <p className="mb-2 text-sm text-ink-700">{DELIVERY_LABEL[order.delivery_method]}{order.delivery_address ? ` · ${order.delivery_address}` : ''}</p>
      {q.data?.length ? (
        <ul className="divide-y divide-cream-200 text-sm">
          {q.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div>
                <p className="font-medium">{d.provider || DELIVERY_LABEL[d.method]} {d.booking_ref && <span className="text-ink-500">· Ref {d.booking_ref}</span>}</p>
                <p className="text-xs text-ink-500">
                  {d.dispatched_at && `Sent ${fmtDateTime(d.dispatched_at)} · `}{d.delivered_at && `Delivered ${fmtDateTime(d.delivered_at)} · `}
                  Cost to shop {rupees(d.charge_to_shop)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={d.status === 'delivered' ? 'good' : d.status === 'failed' ? 'danger' : 'neutral'}>{d.status}</Badge>
                {canEdit && <button className="text-xs font-medium text-burgundy-700" onClick={() => setEdit(d)}>Update</button>}
              </div>
            </li>
          ))}
        </ul>
      ) : order.delivery_method !== 'pickup' ? <EmptyState icon={<Truck className="h-6 w-6" />} title="No booking yet" body="Book Rapido / courier yourself, then record the reference here." /> : null}
      {edit && <DeliveryDialog order={order} customer={customer} delivery={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

export function DeliveryDialog({ order, customer, delivery, onClose }: { order: Order; customer: Customer; delivery: Delivery | null; onClose: () => void }) {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    method: delivery?.method ?? order.delivery_method,
    status: delivery?.status ?? 'booked',
    provider: delivery?.provider ?? (order.delivery_method === 'rapido' ? 'Rapido' : ''),
    booking_ref: delivery?.booking_ref ?? '',
    destination: delivery?.destination ?? order.delivery_address ?? customer.address ?? '',
    contact_name: delivery?.contact_name ?? customer.full_name,
    contact_phone: delivery?.contact_phone ?? customer.phone_e164,
    charge_to_shop: String(delivery?.charge_to_shop ?? ''),
    notes: delivery?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setErr(null), [f]);

  const save = useMutation({
    mutationFn: async () => {
      const charge = Number(f.charge_to_shop || 0);
      if (!Number.isFinite(charge) || charge < 0) throw new Error('Delivery cost must be 0 or more');
      const now = new Date().toISOString();
      const row = {
        method: f.method, status: f.status, provider: f.provider || null, booking_ref: f.booking_ref || null,
        destination: f.destination || null, contact_name: f.contact_name || null, contact_phone: f.contact_phone || null,
        charge_to_shop: charge, notes: f.notes || null,
        dispatched_at: delivery?.dispatched_at ?? (['dispatched', 'delivered'].includes(f.status) ? now : null),
        delivered_at: delivery?.delivered_at ?? (f.status === 'delivered' ? now : null),
      };
      const r = delivery
        ? await supabase.from('deliveries').update(row).eq('id', delivery.id)
        : await supabase.from('deliveries').insert({ ...row, business_id: bid, order_id: order.id });
      if (r.error) throw r.error;
      // Keep the order status in step with the delivery.
      const to = f.status === 'dispatched' && order.status === 'ready' ? 'out_for_delivery'
        : f.status === 'delivered' && ['ready', 'out_for_delivery'].includes(order.status) ? 'delivered' : null;
      if (to) {
        const s = await supabase.rpc('change_order_status', { p_order_id: order.id, p_to: to, p_note: `Delivery ${f.status}` });
        if (s.error) throw s.error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['order', order.id] });
      toast.success('Delivery saved');
      onClose();
    },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open onClose={onClose} title={delivery ? 'Update delivery' : 'Record delivery booking'} description="Bookings are made outside this app (Rapido, courier). Record the details here."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Method" value={f.method} onChange={set('method')}>
          {Object.entries(DELIVERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        <SelectField label="Status" value={f.status} onChange={set('status')}>
          {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </SelectField>
        <TextField label="Provider" placeholder="Rapido, DTDC…" value={f.provider} onChange={set('provider')} />
        <TextField label="Booking / tracking ref" value={f.booking_ref} onChange={set('booking_ref')} />
        <TextAreaField className="sm:col-span-2" label="Destination" rows={2} value={f.destination} onChange={set('destination')} />
        <TextField label="Contact name" value={f.contact_name} onChange={set('contact_name')} />
        <TextField label="Contact phone" value={f.contact_phone} onChange={set('contact_phone')} />
        <TextField label="Cost to the shop (₹)" inputMode="decimal" value={f.charge_to_shop} onChange={set('charge_to_shop')} hint="What you pay the provider (counts as an expense)" />
        <TextField label="Notes" value={f.notes} onChange={set('notes')} />
      </div>
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </Dialog>
  );
}
