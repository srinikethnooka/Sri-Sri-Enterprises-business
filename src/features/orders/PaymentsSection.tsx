import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '@/lib/supabase';
import { errorMessage, newKey } from '@/lib/errors';
import { fmtDateTime, METHOD_LABEL, rupees, toNum } from '@/lib/format';
import { useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { SelectField, TextField } from '@/components/ui/Field';
import { Card, EmptyState, ErrorBox, Money } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Order, Payment, PaymentMethod } from '@/types/models';

export function PaymentsSection({ order, payments, paid }: { order: Order; payments: Payment[]; paid: number }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'payment' | 'refund' | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const balance = toNum(order.total) - paid;
  const reversed = new Set(payments.filter((p) => p.reverses_payment_id).map((p) => p.reverses_payment_id));

  const reverse = useMutation({
    mutationFn: async ({ p, reason }: { p: Payment; reason: string }) => {
      const { error } = await supabase.rpc('reverse_payment', { p_payment_id: p.id, p_reason: reason, p_idempotency_key: newKey() });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['order', order.id] }); toast.success('Entry reversed'); setReversing(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card
      title="Payments"
      actions={can('payments.record') && (
        <>
          {order.status !== 'cancelled' && balance > 0 && <Button size="sm" onClick={() => setMode('payment')}>Record payment</Button>}
          {paid > 0 && <Button size="sm" variant="secondary" onClick={() => setMode('refund')}>Refund</Button>}
        </>
      )}
    >
      <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-cream-50 p-3 text-center text-sm">
        <div><p className="text-xs text-ink-500">Total</p><Money value={order.total} strong /></div>
        <div><p className="text-xs text-ink-500">Paid</p><Money value={paid} strong /></div>
        <div><p className="text-xs text-ink-500">{balance < 0 ? 'Credit' : 'Balance'}</p>
          <Money value={Math.abs(balance)} strong className={balance > 0 ? 'text-burgundy-700' : 'text-emerald-700'} /></div>
      </div>
      {payments.length === 0 ? <EmptyState title="No payments recorded" /> : (
        <ul className="divide-y divide-cream-200 text-sm">
          {payments.map((p) => (
            <li key={p.id} className={clsx('flex items-start justify-between gap-3 py-2.5', reversed.has(p.id) && 'opacity-50')}>
              <div>
                <p className="font-medium capitalize">
                  {p.kind === 'payment' ? 'Payment' : p.kind === 'refund' ? 'Refund' : 'Reversal'} · {METHOD_LABEL[p.method]}
                  {reversed.has(p.id) && <span className="ml-1 text-xs font-normal">(reversed)</span>}
                </p>
                <p className="text-xs text-ink-500">{fmtDateTime(p.received_at)}{p.reference_no ? ` · Ref ${p.reference_no}` : ''}</p>
                {p.note && <p className="text-xs text-ink-500">{p.note}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Money value={p.signed_amount} strong />
                {can('payments.record') && p.kind !== 'reversal' && !reversed.has(p.id) && (
                  <button className="rounded p-1.5 text-ink-400 hover:bg-cream-200 hover:text-burgundy-700" title="Reverse a wrong entry" aria-label="Reverse entry" onClick={() => setReversing(p)}>
                    <Undo2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-500">Recorded by hand. A payment here means someone entered it — it is not confirmed by a bank or UPI provider.</p>

      <PaymentDialog open={!!mode} kind={mode ?? 'payment'} onClose={() => setMode(null)} order={order} max={mode === 'refund' ? paid : balance} />
      <ConfirmDialog
        open={!!reversing}
        onClose={() => setReversing(null)}
        title="Reverse this entry?"
        message={reversing && <>This adds a reversal of {rupees(reversing.signed_amount)} so the mistake stays on record. Use it only for entries made in error.</>}
        requireReason
        reasonLabel="What was wrong?"
        confirmLabel="Reverse entry"
        danger
        loading={reverse.isPending}
        onConfirm={(reason) => { if (reversing) reverse.mutate({ p: reversing, reason }); }}
      />
    </Card>
  );
}

function PaymentDialog({ open, onClose, order, kind, max }: { open: boolean; onClose: () => void; order: Order; kind: 'payment' | 'refund'; max: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = useRef(newKey());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    key.current = newKey();
    setAmount(kind === 'payment' && max > 0 ? String(max) : '');
    setRef(''); setNote(''); setErr(null);
  }, [open, kind, max]);

  const save = useMutation({
    mutationFn: async () => {
      const a = Number(amount);
      if (!Number.isFinite(a) || a <= 0) throw new Error('Enter an amount more than 0');
      if (a > max + 0.001) throw new Error(kind === 'payment' ? `Balance due is only ${rupees(max)}` : `Only ${rupees(max)} has been collected`);
      if (kind === 'refund' && !note.trim()) throw new Error('Give a reason for the refund');
      const { error } = await supabase.rpc('record_payment', {
        p_order_id: order.id, p_kind: kind, p_amount: a, p_method: method, p_idempotency_key: key.current,
        p_reference_no: ref || null, p_note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', order.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(kind === 'payment' ? 'Payment recorded' : 'Refund recorded');
      onClose();
    },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  return (
    <Dialog open={open} onClose={onClose} title={kind === 'payment' ? 'Record payment' : 'Record refund'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{kind === 'payment' ? 'Save payment' : 'Save refund'}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <TextField label="Amount (₹)" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)}
          hint={kind === 'payment' ? `Balance due: ${rupees(max)}` : `Collected so far: ${rupees(max)}`} />
        <SelectField label={kind === 'payment' ? 'Paid by' : 'Refunded by'} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        <TextField label="UPI / reference no. (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
        <TextField label={kind === 'refund' ? 'Reason' : 'Note (optional)'} required={kind === 'refund'} value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <ErrorBox message={err} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
