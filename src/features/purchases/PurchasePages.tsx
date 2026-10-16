import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Paperclip, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage, newKey } from '@/lib/errors';
import { fmtDate, fmtDateTime, METHOD_LABEL, qtyText, rupees, todayIST, toNum } from '@/lib/format';
import { useBusinessId, useSession } from '@/app/session';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Badge, Card, DL, EmptyState, ErrorBox, Money, PageHeader, Pagination } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import type { Material, PaymentMethod } from '@/types/models';

const PAGE = 25;

interface Purchase {
  id: string; purchase_no: string; supplier_id: string; purchase_date: string; supplier_bill_no: string | null; status: 'draft' | 'received' | 'cancelled';
  lines_total: number; discount: number; other_charges: number; total: number; due_date: string | null; notes: string | null; received_at: string | null;
  supplier?: { name: string };
}

export function PurchasesPage() {
  const bid = useBusinessId();
  const { can } = useSession();
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ['purchases', bid, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase.from('purchases').select('*, supplier:suppliers(name)', { count: 'exact' })
        .eq('business_id', bid).order('purchase_date', { ascending: false }).order('created_at', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as Purchase[], total: count ?? 0 };
    },
  });
  return (
    <div>
      <PageHeader title="Purchases" subtitle="Stock you buy. Receiving a purchase adds it to inventory once."
        actions={can('purchasing.manage') && <ButtonLink to="/purchases/new" icon={<Plus className="h-4 w-4" />}>Record purchase</ButtonLink>} />
      {q.error && <ErrorBox message={errorMessage(q.error)} />}
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : !q.data?.rows.length ? <EmptyState icon={<ShoppingCart className="h-6 w-6" />} title="No purchases yet" /> : (
          <>
            <ul className="divide-y divide-cream-200">
              {q.data.rows.map((p) => (
                <li key={p.id}>
                  <Link to={`/purchases/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream-50">
                    <div>
                      <p className="font-medium text-burgundy-700">{p.purchase_no} · {p.supplier?.name}</p>
                      <p className="text-sm text-ink-500">{fmtDate(p.purchase_date)}{p.supplier_bill_no ? ` · Bill ${p.supplier_bill_no}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Money value={p.total} strong />
                      <Badge tone={p.status === 'received' ? 'good' : p.status === 'cancelled' ? 'danger' : 'warn'}>{p.status}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

interface LineDraft { id?: string; material_id: string; qty: string; unit_cost: string; batch_no: string }

/** Create or edit a draft purchase. Lines are saved, then "Receive" updates stock. */
export function PurchaseEditorPage() {
  const { id } = useParams();
  const bid = useBusinessId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [head, setHead] = useState({ supplier_id: '', purchase_date: todayIST(), supplier_bill_no: '', discount: '0', other_charges: '0', due_date: '', notes: '' });
  const [lines, setLines] = useState<LineDraft[]>([{ material_id: '', qty: '', unit_cost: '', batch_no: '' }]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const suppliers = useQuery({ queryKey: ['suppliers-pick', bid], queryFn: async () => (await supabase.from('suppliers').select('id, name').eq('business_id', bid).eq('active', true).order('name')).data ?? [] });
  const materials = useQuery({ queryKey: ['materials-pick', bid], queryFn: async () => (await supabase.from('materials').select('*').eq('business_id', bid).eq('active', true).order('name')).data as Material[] ?? [] });
  const existing = useQuery({
    queryKey: ['purchase', id], enabled: !!id,
    queryFn: async () => {
      const [p, l] = await Promise.all([
        supabase.from('purchases').select('*').eq('id', id!).single(),
        supabase.from('purchase_lines').select('*').eq('purchase_id', id!),
      ]);
      if (p.error) throw p.error;
      return { p: p.data as Purchase, l: (l.data ?? []) as { id: string; material_id: string; qty: number; unit_cost: number; batch_no: string | null }[] };
    },
  });
  useEffect(() => {
    if (!existing.data) return;
    const p = existing.data.p;
    setHead({ supplier_id: p.supplier_id, purchase_date: p.purchase_date, supplier_bill_no: p.supplier_bill_no ?? '', discount: String(toNum(p.discount)),
      other_charges: String(toNum(p.other_charges)), due_date: p.due_date ?? '', notes: p.notes ?? '' });
    setLines(existing.data.l.map((l) => ({ id: l.id, material_id: l.material_id, qty: String(toNum(l.qty)), unit_cost: String(toNum(l.unit_cost)), batch_no: l.batch_no ?? '' })));
  }, [existing.data]);

  const linesTotal = lines.reduce((a, l) => a + Math.round(Number(l.qty || 0) * Number(l.unit_cost || 0) * 100) / 100, 0);
  const total = linesTotal - Number(head.discount || 0) + Number(head.other_charges || 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!head.supplier_id) throw new Error('Choose a supplier');
      const valid = lines.filter((l) => l.material_id);
      if (!valid.length) throw new Error('Add at least one item');
      for (const [i, l] of valid.entries()) {
        if (!(Number(l.qty) > 0)) throw new Error(`Item ${i + 1}: quantity must be more than 0`);
        if (!(Number(l.unit_cost) >= 0) || l.unit_cost === '') throw new Error(`Item ${i + 1}: enter the price`);
      }
      const row = { supplier_id: head.supplier_id, purchase_date: head.purchase_date, supplier_bill_no: head.supplier_bill_no || null,
        discount: Number(head.discount || 0), other_charges: Number(head.other_charges || 0), due_date: head.due_date || null, notes: head.notes || null };
      let pid = id;
      if (pid) {
        const r = await supabase.from('purchases').update(row).eq('id', pid);
        if (r.error) throw r.error;
      } else {
        const r = await supabase.from('purchases').insert({ ...row, business_id: bid }).select('id').single();
        if (r.error) throw r.error;
        pid = r.data.id as string;
      }
      if (removed.length) {
        const r = await supabase.from('purchase_lines').delete().in('id', removed);
        if (r.error) throw r.error;
      }
      for (const l of valid) {
        const lr = { material_id: l.material_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost), batch_no: l.batch_no || null };
        const r = l.id
          ? await supabase.from('purchase_lines').update(lr).eq('id', l.id)
          : await supabase.from('purchase_lines').insert({ ...lr, purchase_id: pid, business_id: bid });
        if (r.error) throw r.error;
      }
      return pid!;
    },
    onSuccess: (pid) => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['purchase', pid] }); toast.success('Purchase saved as draft'); navigate(`/purchases/${pid}`, { replace: true }); },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  if (id && existing.isLoading) return <PageLoader />;
  if (existing.data && existing.data.p.status !== 'draft') return <ErrorBox message="Only draft purchases can be edited." />;
  const setH = (k: keyof typeof head) => (e: { target: { value: string } }) => setHead((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <PageHeader back={<Link to="/purchases" className="mb-1 inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Purchases</Link>}
        title={id ? `Edit ${existing.data?.p.purchase_no}` : 'Record purchase'} />
      <Card title="Bill">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Supplier" required value={head.supplier_id} onChange={setH('supplier_id')} hint={<Link className="text-burgundy-700" to="/suppliers">Add a supplier</Link>}>
            <option value="">Choose…</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <TextField label="Bill date" type="date" value={head.purchase_date} onChange={setH('purchase_date')} />
          <TextField label="Supplier bill no." value={head.supplier_bill_no} onChange={setH('supplier_bill_no')} />
        </div>
      </Card>
      <Card title="Items" actions={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((x) => [...x, { material_id: '', qty: '', unit_cost: '', batch_no: '' }])}>Add item</Button>}>
        <div className="space-y-3">
          {lines.map((l, i) => {
            const m = materials.data?.find((x) => x.id === l.material_id);
            const set = (k: keyof LineDraft) => (e: { target: { value: string } }) => setLines((x) => x.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)));
            return (
              <div key={i} className="grid items-end gap-2 rounded-lg border border-cream-300 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
                <SelectField label="Material" value={l.material_id} onChange={set('material_id')} hint={<Link className="text-burgundy-700" to="/inventory">New material</Link>}>
                  <option value="">Choose…</option>
                  {materials.data?.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                </SelectField>
                <TextField label={`Qty${m ? ` (${m.unit})` : ''}`} inputMode="decimal" value={l.qty} onChange={set('qty')} />
                <TextField label={`Price per ${m?.unit ?? 'unit'} (₹)`} inputMode="decimal" value={l.unit_cost} onChange={set('unit_cost')} />
                <TextField label="Batch / lot" value={l.batch_no} onChange={set('batch_no')} />
                <p className="num pb-2.5 font-semibold">{rupees(Number(l.qty || 0) * Number(l.unit_cost || 0))}</p>
                <button className="mb-1 rounded-lg p-2 text-ink-500 hover:bg-cream-200" aria-label={`Remove item ${i + 1}`}
                  onClick={() => { if (l.id) setRemoved((r) => [...r, l.id!]); setLines((x) => x.filter((_, j) => j !== i)); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Totals & payment terms">
        <div className="grid gap-3 sm:grid-cols-4">
          <TextField label="Discount (₹)" inputMode="decimal" value={head.discount} onChange={setH('discount')} />
          <TextField label="Transport / other charges (₹)" inputMode="decimal" value={head.other_charges} onChange={setH('other_charges')} />
          <TextField label="Pay supplier by" type="date" value={head.due_date} onChange={setH('due_date')} />
          <div><span className="label">Bill total</span><p className="num py-2.5 text-xl font-semibold text-burgundy-700">{rupees(total)}</p></div>
          <TextAreaField className="sm:col-span-4" label="Notes" rows={2} value={head.notes} onChange={setH('notes')} />
        </div>
        <p className="mt-2 text-xs text-ink-500">Discount and charges are spread over the items by value to get the landed cost used for stock.</p>
      </Card>
      {err && <ErrorBox message={err} />}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        <Button size="lg" loading={save.isPending} onClick={() => save.mutate()}>Save draft</Button>
      </div>
    </div>
  );
}

export function PurchaseDetailPage() {
  const { id = '' } = useParams();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bid = useBusinessId();

  const q = useQuery({
    queryKey: ['purchase', id],
    queryFn: async () => {
      const [p, l, pay, att] = await Promise.all([
        supabase.from('purchases').select('*, supplier:suppliers(name)').eq('id', id).single(),
        supabase.from('purchase_lines').select('*, material:materials(name, unit)').eq('purchase_id', id),
        supabase.from('supplier_payments').select('*').eq('purchase_id', id).order('paid_at'),
        supabase.from('attachments').select('id, path').eq('entity_type', 'purchase').eq('entity_id', id),
      ]);
      if (p.error) throw p.error;
      return {
        p: p.data as Purchase,
        l: (l.data ?? []) as { id: string; qty: number; unit_cost: number; line_total: number; batch_no: string | null; material: { name: string; unit: string } }[],
        pay: (pay.data ?? []) as { id: string; amount: number; method: PaymentMethod; paid_at: string; reference_no: string | null; note: string | null }[],
        att: (att.data ?? []) as { id: string; path: string }[],
      };
    },
  });

  const receive = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('receive_purchase', { p_purchase_id: id }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries(); toast.success('Received. Stock updated.'); setReceiving(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('cancel_purchase', { p_purchase_id: id }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase', id] }); qc.invalidateQueries({ queryKey: ['purchases'] }); toast.success('Purchase cancelled'); setCancelling(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const uploadBill = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      if (file.size > 10_000_000) throw new Error('File is too large (max 10 MB)');
      const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
      const path = `${bid}/purchases/${id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const ins = await supabase.from('attachments').insert({ business_id: bid, bucket: 'receipts', path, entity_type: 'purchase', entity_id: id, mime: file.type, size_bytes: file.size });
      if (ins.error) throw ins.error;
      qc.invalidateQueries({ queryKey: ['purchase', id] });
      toast.success('Bill attached');
    } catch (e) { toast.error(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)); }
    setUploading(false);
  };
  const openBill = async (path: string) => {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 120);
    if (error) return toast.error(errorMessage(error));
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorBox message={errorMessage(q.error ?? 'Not found')} />;
  const { p, l, pay, att } = q.data;
  const paid = pay.reduce((a, x) => a + toNum(x.amount), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        back={<Link to="/purchases" className="mb-1 inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Purchases</Link>}
        title={<span className="flex items-center gap-2">{p.purchase_no} <Badge tone={p.status === 'received' ? 'good' : p.status === 'cancelled' ? 'danger' : 'warn'}>{p.status}</Badge></span>}
        subtitle={`${p.supplier?.name} · ${fmtDate(p.purchase_date)}${p.supplier_bill_no ? ` · Bill ${p.supplier_bill_no}` : ''}`}
        actions={can('purchasing.manage') && <>
          {p.status === 'draft' && <Button icon={<PackageCheck className="h-4 w-4" />} onClick={() => setReceiving(true)}>Receive into stock</Button>}
          {p.status === 'draft' && <Button variant="secondary" onClick={() => navigate(`/purchases/${id}/edit`)}>Edit</Button>}
          {p.status === 'received' && <Button onClick={() => setPaying(true)}>Pay supplier</Button>}
          {p.status === 'draft' && <Button variant="danger" onClick={() => setCancelling(true)}>Cancel</Button>}
        </>}
      />
      <Card title="Items" padded={false}>
        <ul className="divide-y divide-cream-200 text-sm">
          {l.map((x) => (
            <li key={x.id} className="flex justify-between gap-2 px-4 py-2.5">
              <span>{x.material.name} — {qtyText(x.qty, x.material.unit)} × {rupees(x.unit_cost)}{x.batch_no ? ` · lot ${x.batch_no}` : ''}</span>
              <span className="num font-semibold">{rupees(x.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-cream-200 bg-cream-50 px-4 py-3 text-sm">
          <div className="flex justify-between"><dt>Items</dt><dd className="num">{rupees(p.lines_total)}</dd></div>
          {toNum(p.discount) > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="num">-{rupees(p.discount)}</dd></div>}
          {toNum(p.other_charges) > 0 && <div className="flex justify-between"><dt>Other charges</dt><dd className="num">{rupees(p.other_charges)}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="num">{rupees(p.total)}</dd></div>
        </dl>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Payments to supplier">
          <DL items={[['Paid', rupees(paid)], ['Still to pay', rupees(toNum(p.total) - paid)], ['Pay by', fmtDate(p.due_date)], ['Received', fmtDateTime(p.received_at)]]} />
          {pay.length > 0 && (
            <ul className="mt-3 divide-y divide-cream-200 text-sm">
              {pay.map((x) => <li key={x.id} className="flex justify-between py-2"><span>{fmtDate(x.paid_at)} · {METHOD_LABEL[x.method]}{x.reference_no ? ` · ${x.reference_no}` : ''}{x.note ? ` · ${x.note}` : ''}</span><Money value={x.amount} /></li>)}
            </ul>
          )}
        </Card>
        <Card title="Supplier bill" actions={can('purchasing.manage') && <>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => uploadBill(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" icon={<Paperclip className="h-4 w-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>Attach</Button>
        </>}>
          {att.length ? att.map((a, i) => <button key={a.id} className="block text-sm font-medium text-burgundy-700 underline" onClick={() => openBill(a.path)}>View bill {i + 1}</button>)
            : <p className="text-sm text-ink-500">No bill photo attached.</p>}
          {p.notes && <p className="mt-3 text-sm">{p.notes}</p>}
        </Card>
      </div>
      <ConfirmDialog open={receiving} onClose={() => setReceiving(false)} title="Receive this purchase?" confirmLabel="Receive into stock"
        message="This adds every item to stock and updates average costs. It happens only once and cannot be undone — use a stock adjustment or supplier return for corrections."
        loading={receive.isPending} onConfirm={() => receive.mutate()} />
      <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} title="Cancel this draft purchase?" confirmLabel="Cancel purchase" danger
        message="Nothing was added to stock yet. The purchase stays on record as cancelled." loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
      {paying && <SupplierPaymentDialog supplierId={p.supplier_id} purchaseId={p.id} suggested={toNum(p.total) - paid} onClose={() => setPaying(false)} />}
    </div>
  );
}

export function SupplierPaymentDialog({ supplierId, purchaseId, suggested, onClose }: { supplierId: string; purchaseId?: string; suggested?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = useRef(newKey());
  const [amount, setAmount] = useState(suggested && suggested > 0 ? String(suggested) : '');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const a = Number(amount);
      if (!Number.isFinite(a) || a === 0) throw new Error('Enter an amount');
      const { error } = await supabase.rpc('record_supplier_payment', {
        p_supplier_id: supplierId, p_amount: a, p_method: method, p_idempotency_key: key.current,
        p_purchase_id: purchaseId ?? null, p_reference_no: ref || null, p_note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success('Supplier payment recorded'); onClose(); },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title="Pay supplier" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <TextField label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} hint="Use a negative amount (with a note) to correct a wrong entry." />
        <SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        <TextField label="Reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <ErrorBox message={err} />}
      </div>
    </Dialog>
  );
}
