import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Pencil, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/format';
import { prettyPhone } from '@/lib/phone';
import { useBusinessId, useSession } from '@/app/session';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, Card, DL, EmptyState, ErrorBox, Money, PageHeader, StatusBadge } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { ShareLinkBox } from '@/components/ShareLinkBox';
import { CustomerFormDialog } from './CustomerFormDialog';
import { MeasurementsCard } from './MeasurementsCard';
import { getCustomer } from './api';
import { PhotosCard } from '@/features/orders/ImagesSection';
import type { Order } from '@/types/models';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const bid = useBusinessId();
  const { can, canAny, business } = useSession();
  const [editing, setEditing] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);

  const c = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id) });
  const orders = useQuery({
    queryKey: ['customer-orders', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('id, order_no, status, order_date, due_at, total')
        .eq('customer_id', id).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as Pick<Order, 'id' | 'order_no' | 'status' | 'order_date' | 'due_at' | 'total'>[];
    },
    enabled: canAny('orders.manage', 'invoices.manage', 'payments.record', 'delivery.manage'),
  });
  const balance = useQuery({
    queryKey: ['customer-balance', id],
    enabled: canAny('invoices.manage', 'payments.record'),
    queryFn: async () => {
      const { data, error } = await supabase.from('v_customer_balances').select('*').eq('customer_id', id).maybeSingle();
      if (error) throw error;
      return data as { invoiced: number; paid: number; outstanding: number; invoice_count: number } | null;
    },
  });

  const makeInvite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_invite', { p_business_id: bid, p_kind: 'customer', p_customer_id: id, p_display_name: c.data?.full_name });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (token) => setInvite(`${window.location.origin}/invite/${token}`),
  });

  if (c.isLoading) return <PageLoader />;
  if (c.error || !c.data) return <ErrorBox message={errorMessage(c.error ?? 'Not found')} />;
  const cust = c.data;

  return (
    <div className="space-y-4">
      <PageHeader
        back={<Link to="/customers" className="mb-1 inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Customers</Link>}
        title={cust.full_name}
        subtitle={<span className="flex flex-wrap items-center gap-2">Customer ID <b className="num text-ink-900">{cust.customer_code}</b> · {prettyPhone(cust.phone_e164)}
          <WhatsAppBadge status={cust.whatsapp_status} />
          {cust.user_id && <Badge tone="good">Portal linked</Badge>}</span>}
        actions={<>
          {can('orders.manage') && <ButtonLink to={`/orders/new?customer=${cust.id}`} icon={<ClipboardList className="h-4 w-4" />}>New order</ButtonLink>}
          {can('customers.manage') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          {can('customers.manage') && !cust.user_id && (
            <Button variant="secondary" icon={<Send className="h-4 w-4" />} loading={makeInvite.isPending} onClick={() => makeInvite.mutate()}>Invite to portal</Button>
          )}
        </>}
      />
      {makeInvite.error && <ErrorBox message={errorMessage(makeInvite.error)} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-1">
          <DL items={[
            ['Phone', prettyPhone(cust.phone_e164)],
            ['WhatsApp', prettyPhone(cust.whatsapp_e164) || '—'],
            ['Email', cust.email],
            ['Address', cust.address],
            ['Customer since', fmtDate(cust.created_at)],
            ['Team notes', cust.notes],
          ]} />
          {balance.data && (
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-cream-50 p-3 text-center text-sm">
              <div><p className="text-xs text-ink-500">Invoiced</p><Money value={balance.data.invoiced} strong /></div>
              <div><p className="text-xs text-ink-500">Paid</p><Money value={balance.data.paid} strong /></div>
              <div><p className="text-xs text-ink-500">Owes</p><Money value={balance.data.outstanding} strong className={Number(balance.data.outstanding) > 0 ? 'text-burgundy-700' : ''} /></div>
            </div>
          )}
        </Card>
        <div className="lg:col-span-2"><MeasurementsCard customerId={cust.id} /></div>
      </div>

      <PhotosCard entityType="customer" entityId={cust.id} title="Customer photos"
        emptyText="Add photos of the customer's own blouse, measurement sheets or past designs. They are saved and shown here every time." />

      {orders.data && (
        <Card title="Orders" padded={false}>
          {orders.data.length === 0 ? <EmptyState title="No orders yet" /> : (
            <ul className="divide-y divide-cream-200">
              {orders.data.map((o) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-cream-50">
                    <div>
                      <p className="font-medium">{o.order_no}</p>
                      <p className="text-sm text-ink-500">{fmtDate(o.order_date)}{o.due_at ? ` · due ${fmtDate(o.due_at)}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3"><Money value={o.total} /><StatusBadge status={o.status} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <CustomerFormDialog open={editing} onClose={() => setEditing(false)} customer={cust} />
      <Dialog open={!!invite} onClose={() => setInvite(null)} title="Customer portal invite" description="Send this link so the customer can see their orders, invoices and balance.">
        {invite && (
          <ShareLinkBox
            url={invite}
            phone={cust.whatsapp_e164 ?? cust.phone_e164}
            message={`Hello ${cust.full_name}, you can now see your orders and invoices from ${business?.name ?? 'our boutique'} online. Create your account here (valid for 7 days): ${invite}`}
          />
        )}
      </Dialog>
    </div>
  );
}

export function WhatsAppBadge({ status }: { status: 'unknown' | 'yes' | 'no' }) {
  if (status === 'yes') return <Badge tone="good">On WhatsApp</Badge>;
  if (status === 'no') return <Badge tone="warn">Not on WhatsApp</Badge>;
  return <Badge>WhatsApp not checked yet</Badge>;
}
