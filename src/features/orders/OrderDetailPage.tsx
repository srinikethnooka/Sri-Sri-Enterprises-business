import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, MessageCircle, Pencil } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { DELIVERY_LABEL, fmtDate, fmtDateTime, qtyText, rupees, STATUS_LABEL, toNum } from '@/lib/format';
import { prettyPhone } from '@/lib/phone';
import { useSession } from '@/app/session';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Badge, Card, DL, ErrorBox, PageHeader, StatusBadge } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { ShareDialog, type SharePurpose } from '@/features/invoices/ShareDialog';
import { MeasurementView } from '@/features/customers/MeasurementsCard';
import { NEXT_STATUSES, type MeasurementSet, type OrderStatus } from '@/types/models';
import { getOrderFull, paidTotal } from './api';
import { PaymentsSection } from './PaymentsSection';
import { InvoiceSection } from './InvoiceSection';
import { MaterialsSection } from './MaterialsSection';
import { CostsSection } from './CostsSection';
import { DeliverySection } from './DeliverySection';
import { ImagesSection } from './ImagesSection';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const { can, canAny } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [share, setShare] = useState<SharePurpose | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const q = useQuery({ queryKey: ['order', id], queryFn: () => getOrderFull(id) });
  const ms = useQuery({
    queryKey: ['measurement', q.data?.order.measurement_set_id],
    enabled: !!q.data?.order.measurement_set_id && canAny('customers.manage', 'orders.manage'),
    queryFn: async () => (await supabase.from('measurement_sets').select('*').eq('id', q.data!.order.measurement_set_id!).single()).data as MeasurementSet,
  });

  useEffect(() => {
    if (sp.get('share') && q.data) {
      setShare('invoice');
      sp.delete('share');
      setSp(sp, { replace: true });
    }
  }, [sp, setSp, q.data]);

  const status = useMutation({
    mutationFn: async ({ to, note }: { to: OrderStatus; note?: string }) => {
      const { error } = await supabase.rpc('change_order_status', { p_order_id: id, p_to: to, p_note: note ?? null });
      if (error) throw error;
      return to;
    },
    onSuccess: (to) => {
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Marked as ${STATUS_LABEL[to].toLowerCase()}`);
      setCancelling(false);
      if (to === 'ready') setShare('order_ready');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorBox message={errorMessage(q.error ?? 'Order not found')} />;
  const { order, customer, lines, internal, history, invoices, payments, worker } = q.data;
  const paid = paidTotal(payments);
  const live = invoices.find((i) => i.status === 'issued') ?? null;
  const next = NEXT_STATUSES[order.status].filter((s) => s !== 'cancelled');
  const late = order.due_at && new Date(order.due_at) < new Date() && !['ready', 'out_for_delivery', 'delivered', 'cancelled', 'draft'].includes(order.status);
  const canStatus = (to: OrderStatus) => (['out_for_delivery', 'delivered'].includes(to) ? canAny('orders.manage', 'delivery.manage') : can('orders.manage'));

  return (
    <div className="space-y-4">
      <PageHeader
        back={<Link to="/orders" className="mb-1 inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Orders</Link>}
        title={<span className="flex flex-wrap items-center gap-2">{order.order_no} <StatusBadge status={order.status} />
          {internal?.priority && internal.priority !== 'normal' && <Badge tone="danger">{internal.priority}</Badge>}</span>}
        subtitle={<>
          <Link to={`/customers/${customer.id}`} className="font-medium text-burgundy-700 hover:underline">{customer.full_name}</Link>
          {' · '}{prettyPhone(customer.phone_e164)} · ordered {fmtDate(order.order_date)}
        </>}
        actions={<>
          {can('orders.manage') && !live && !['delivered', 'cancelled'].includes(order.status) && (
            <ButtonLink to={`/orders/${id}/edit`} variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink>
          )}
          {canAny('orders.manage', 'invoices.manage', 'delivery.manage') && (
            <Button variant="gold" icon={<MessageCircle className="h-4 w-4" />} onClick={() => setShare(live ? 'invoice' : order.status === 'ready' ? 'order_ready' : 'invoice')}>WhatsApp</Button>
          )}
          {live && paid < toNum(live.total) && canAny('orders.manage', 'invoices.manage') && (
            <Button variant="secondary" icon={<Bell className="h-4 w-4" />} onClick={() => setShare('payment_reminder')}>Remind</Button>
          )}
        </>}
      />

      {order.status === 'cancelled' && <ErrorBox message={`Cancelled: ${order.cancelled_reason ?? ''}`} />}

      {/* Status bar */}
      {next.length > 0 && (
        <div className="no-print card flex flex-wrap items-center gap-2 p-3">
          <span className="mr-1 text-sm text-ink-500">Move to:</span>
          {next.filter(canStatus).map((s) => (
            <Button key={s} size="sm" variant={s === 'ready' || s === 'delivered' || s === 'confirmed' ? 'primary' : 'secondary'}
              loading={status.isPending && status.variables?.to === s} onClick={() => status.mutate({ to: s })}>
              {STATUS_LABEL[s]}
            </Button>
          ))}
          {can('orders.manage') && NEXT_STATUSES[order.status].includes('cancelled') && (
            <Button size="sm" variant="danger" className="ml-auto" onClick={() => setCancelling(true)}>Cancel order</Button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Items" padded={false}>
            <ul className="divide-y divide-cream-200">
              {lines.map((l, i) => (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-medium">{i + 1}. {l.description}</p>
                      <p className="text-sm text-ink-500">
                        {qtyText(l.qty, l.unit)} × {rupees(l.unit_price)}{toNum(l.line_discount) > 0 && ` − ${rupees(l.line_discount)} discount`}
                      </p>
                      {l.garment_details && <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{l.garment_details}</p>}
                      {l.internal_notes && <p className="mt-1 text-sm text-gold-700">Team: {l.internal_notes}</p>}
                    </div>
                    <p className="num font-semibold">{rupees(l.line_subtotal)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-cream-200 bg-cream-50 px-4 py-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500">Items</dt><dd className="num">{rupees(order.items_subtotal)}</dd></div>
              {toNum(order.order_discount) > 0 && <div className="flex justify-between"><dt className="text-ink-500">Discount</dt><dd className="num">-{rupees(order.order_discount)}</dd></div>}
              {toNum(order.tax_amount) > 0 && <div className="flex justify-between"><dt className="text-ink-500">Tax {toNum(order.tax_rate)}%</dt><dd className="num">{rupees(order.tax_amount)}</dd></div>}
              {toNum(order.delivery_charge) > 0 && <div className="flex justify-between"><dt className="text-ink-500">Delivery</dt><dd className="num">{rupees(order.delivery_charge)}</dd></div>}
              {toNum(order.round_off) !== 0 && <div className="flex justify-between"><dt className="text-ink-500">Round off</dt><dd className="num">{rupees(order.round_off)}</dd></div>}
              <div className="flex justify-between text-base font-semibold text-burgundy-700"><dt>Total</dt><dd className="num">{rupees(order.total)}</dd></div>
            </dl>
          </Card>

          {canAny('invoices.manage', 'payments.record', 'orders.manage') && (
            <InvoiceSection order={order} invoices={invoices} onShare={() => setShare('invoice')} />
          )}
          {canAny('payments.record', 'invoices.manage') && <PaymentsSection order={order} payments={payments} paid={paid} />}
          {canAny('inventory.manage', 'finance.view') && <MaterialsSection order={order} lines={lines} />}
          {can('finance.view') && <CostsSection order={order} lines={lines} />}
          <ImagesSection order={order} />
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <DL items={[
              ['Expected delivery', <span className={clsx(late && 'font-semibold text-burgundy-700')}>{fmtDateTime(order.due_at)}{late && ' (late)'}</span>],
              ['Delivery', DELIVERY_LABEL[order.delivery_method]],
              ['Assigned to', worker?.name ?? 'Not assigned'],
              ['Customer note', order.customer_notes],
              ...(internal?.internal_notes ? [['Internal notes', internal.internal_notes] as [string, string]] : []),
            ]} />
          </Card>
          {ms.data && <Card title="Measurements used"><MeasurementView m={ms.data} compact /><p className="mt-2 text-xs text-ink-500">Taken {fmtDate(ms.data.taken_at)}</p></Card>}
          {canAny('delivery.manage', 'orders.manage') && <DeliverySection order={order} customer={customer} />}
          <Card title="History">
            <ol className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold-500" />
                  <div>
                    <p>{STATUS_LABEL[h.to_status]}{h.note ? ` — ${h.note}` : ''}</p>
                    <p className="text-xs text-ink-500">{fmtDateTime(h.changed_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {share && (
        <ShareDialog open onClose={() => setShare(null)} order={order} customer={customer} invoice={live} paid={paid} purpose={share} />
      )}
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${order.order_no}?`}
        message={<>Cancelled orders are not counted as sales.{paid > 0 && <> {rupees(paid)} has been collected — record a refund from the Payments section if you are returning it.</>}{live && <> Cancel the invoice first.</>}</>}
        requireReason
        confirmLabel="Cancel order"
        danger
        loading={status.isPending}
        onConfirm={(note) => status.mutate({ to: 'cancelled', note })}
      />
    </div>
  );
}
