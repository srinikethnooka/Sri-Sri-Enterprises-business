import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { prettyPhone, toE164 } from '@/lib/phone';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { Card, EmptyState, ErrorBox, Money, PageHeader } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import type { Supplier } from '@/types/models';
import { SupplierPaymentDialog } from './PurchasePages';

export function SuppliersPage() {
  const bid = useBusinessId();
  const { can } = useSession();
  const [edit, setEdit] = useState<Supplier | 'new' | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['suppliers', bid],
    queryFn: async () => {
      const [s, b] = await Promise.all([
        supabase.from('suppliers').select('*').eq('business_id', bid).order('name'),
        supabase.from('v_supplier_balances').select('supplier_id, purchased, paid, balance').eq('business_id', bid),
      ]);
      if (s.error) throw s.error;
      const bal = Object.fromEntries((b.data ?? []).map((x) => [x.supplier_id, x]));
      return (s.data as Supplier[]).map((x) => ({ ...x, bal: bal[x.id] as { purchased: number; paid: number; balance: number } | undefined }));
    },
  });
  return (
    <div>
      <PageHeader title="Suppliers" actions={can('purchasing.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add supplier</Button>} />
      {q.error && <ErrorBox message={errorMessage(q.error)} />}
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : !q.data?.length ? <EmptyState icon={<Building2 className="h-6 w-6" />} title="No suppliers yet" /> : (
          <ul className="divide-y divide-cream-200">
            {q.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{s.name} {!s.active && <span className="text-xs text-ink-400">(inactive)</span>}</p>
                  <p className="text-sm text-ink-500">{[prettyPhone(s.phone), s.address].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-3">
                  {s.bal && (
                    <div className="text-right text-sm">
                      <p className="text-ink-500">Bought <Money value={s.bal.purchased} /> · Paid <Money value={s.bal.paid} /></p>
                      <p className={Number(s.bal.balance) > 0 ? 'font-semibold text-burgundy-700' : 'text-ink-500'}>We owe <Money value={s.bal.balance} /></p>
                    </div>
                  )}
                  {can('purchasing.manage') && <>
                    <Button size="sm" variant="secondary" onClick={() => setPaying(s.id)}>Pay</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>
                  </>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <SupplierDialog supplier={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {paying && <SupplierPaymentDialog supplierId={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: '', phone: '', address: '', gstin: '', notes: '', active: true });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setF({ name: supplier?.name ?? '', phone: supplier?.phone ?? '', address: supplier?.address ?? '', gstin: supplier?.gstin ?? '', notes: supplier?.notes ?? '', active: supplier?.active ?? true });
  }, [supplier]);
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error('Enter a name');
      const phone = f.phone ? toE164(f.phone) : null;
      if (f.phone && !phone) throw new Error('Enter a valid phone number');
      const row = { name: f.name.trim(), phone, address: f.address || null, gstin: f.gstin.trim().toUpperCase() || null, notes: f.notes || null, active: f.active };
      const r = supplier ? await supabase.from('suppliers').update(row).eq('id', supplier.id) : await supabase.from('suppliers').insert({ ...row, business_id: bid });
      if (r.error) throw r.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); qc.invalidateQueries({ queryKey: ['suppliers-pick'] }); toast.success('Supplier saved'); onClose(); },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });
  const set = (k: 'name' | 'phone' | 'address' | 'gstin' | 'notes') => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open onClose={onClose} title={supplier ? 'Edit supplier' : 'Add supplier'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label="Name" required value={f.name} onChange={set('name')} />
        <TextField label="Phone" inputMode="tel" value={f.phone} onChange={set('phone')} />
        <TextField label="GSTIN" value={f.gstin} onChange={set('gstin')} />
        <TextAreaField className="sm:col-span-2" label="Address" rows={2} value={f.address} onChange={set('address')} />
        <TextAreaField className="sm:col-span-2" label="What they supply / notes" rows={2} value={f.notes} onChange={set('notes')} />
        {supplier && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 rounded text-burgundy-700" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> Active</label>
        )}
      </div>
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </Dialog>
  );
}
