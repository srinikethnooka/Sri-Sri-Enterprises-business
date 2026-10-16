import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Boxes, Plus } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '@/lib/supabase';
import { errorMessage, newKey } from '@/lib/errors';
import { fmtDateTime, qtyText, rupees, toNum, UNIT_LABEL } from '@/lib/format';
import { useBusinessId, useSession } from '@/app/session';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextField } from '@/components/ui/Field';
import { Badge, Card, DL, EmptyState, ErrorBox, PageHeader, Pagination, SearchBox } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useDebounced } from '@/features/customers/CustomersPage';
import { safeSearch } from '@/features/customers/api';
import { UNITS, type Material, type Supplier, type Unit } from '@/types/models';

const PAGE = 30;
interface StockRow { id: string; code: string; name: string; category: string | null; unit: Unit; on_hand: number; reorder_level: number; avg_cost: number; stock_value: number; is_low: boolean; suggested_reorder_qty: number; default_supplier: string | null }

export function MaterialsPage() {
  const bid = useBusinessId();
  const { canAny, can } = useSession();
  const [sp, setSp] = useSearchParams();
  const low = sp.get('low') === '1';
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const t = safeSearch(useDebounced(term));
  const finance = can('finance.view') || can('purchasing.manage') || can('inventory.manage');

  const q = useQuery({
    queryKey: ['materials', bid, t, low, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let s = supabase.from('v_material_stock').select('*', { count: 'exact' }).eq('business_id', bid).order('name');
      if (low) s = s.eq('is_low', true);
      if (t) s = s.or(`name.ilike.*${t}*,code.ilike.*${t}*,category.ilike.*${t}*`);
      const { data, error, count } = await s.range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as StockRow[], total: count ?? 0 };
    },
  });

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock changes only through purchases, material use and recorded adjustments."
        actions={canAny('inventory.manage', 'purchasing.manage') && <>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add material</Button>
          {can('purchasing.manage') && <ButtonLink variant="secondary" to="/purchases/new">Record purchase</ButtonLink>}
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm"><SearchBox value={term} onChange={(v) => { setTerm(v); setPage(0); }} placeholder="Search materials" /></div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 rounded text-burgundy-700" checked={low} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.checked) n.set('low', '1'); else n.delete('low'); setSp(n); setPage(0); }} />
          Low stock only (reorder list)
        </label>
      </div>
      {q.error && <ErrorBox message={errorMessage(q.error)} />}
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : !q.data?.rows.length ? <EmptyState icon={<Boxes className="h-6 w-6" />} title={low ? 'Nothing is low on stock' : 'No materials yet'} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="table-head border-b border-cream-200 bg-cream-50"><tr>
                  <th>Material</th><th className="text-right">In stock</th><th className="text-right">Reorder at</th>
                  {finance && <th className="text-right">Avg cost</th>}{finance && <th className="text-right">Value</th>}
                  {low && <th className="text-right">Suggest buying</th>}{low && <th>Supplier</th>}
                </tr></thead>
                <tbody className="divide-y divide-cream-200">
                  {q.data.rows.map((m) => (
                    <tr key={m.id} className="table-row hover:bg-cream-50">
                      <td><Link to={`/inventory/${m.id}`} className="font-medium text-burgundy-700 hover:underline">{m.name}</Link>
                        <p className="text-xs text-ink-500">{m.code}{m.category ? ` · ${m.category}` : ''}</p></td>
                      <td className={clsx('num text-right', m.is_low && 'font-semibold text-burgundy-700')}>{qtyText(m.on_hand, m.unit)} {m.is_low && <Badge tone="danger">Low</Badge>}</td>
                      <td className="num text-right text-ink-500">{qtyText(m.reorder_level, m.unit)}</td>
                      {finance && <td className="num text-right">{rupees(m.avg_cost)}</td>}
                      {finance && <td className="num text-right">{rupees(m.stock_value)}</td>}
                      {low && <td className="num text-right">{qtyText(m.suggested_reorder_qty, m.unit)}</td>}
                      {low && <td className="text-ink-500">{m.default_supplier ?? '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <MaterialFormDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

export function MaterialFormDialog({ open, onClose, material }: { open: boolean; onClose: () => void; material?: Material | null }) {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ code: '', name: '', category: '', unit: 'pcs' as Unit, reorder_level: '0', default_supplier_id: '' });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF({ code: material?.code ?? '', name: material?.name ?? '', category: material?.category ?? '', unit: material?.unit ?? 'pcs',
      reorder_level: String(toNum(material?.reorder_level)), default_supplier_id: material?.default_supplier_id ?? '' });
  }, [open, material]);
  const suppliers = useQuery({
    queryKey: ['suppliers-pick', bid], enabled: open,
    queryFn: async () => (await supabase.from('suppliers').select('id, name').eq('business_id', bid).eq('active', true).order('name')).data ?? [],
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error('Enter a name');
      const reorder = Number(f.reorder_level || 0);
      if (!Number.isFinite(reorder) || reorder < 0) throw new Error('Reorder level must be 0 or more');
      const code = (f.code.trim() || f.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 12)).toUpperCase();
      const row = { code, name: f.name.trim(), category: f.category.trim() || null, reorder_level: reorder, default_supplier_id: f.default_supplier_id || null };
      const r = material
        ? await supabase.from('materials').update(row).eq('id', material.id)
        : await supabase.from('materials').insert({ ...row, unit: f.unit, business_id: bid });
      if (r.error) throw r.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['materials'] }); qc.invalidateQueries({ queryKey: ['material'] }); toast.success('Material saved'); onClose(); },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} title={material ? 'Edit material' : 'Add material'}
      description={material ? undefined : 'Stock starts at 0. Add stock by recording a purchase (or an opening-stock adjustment).'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label="Name" required value={f.name} onChange={set('name')} placeholder="Gold zari thread" />
        <TextField label="Code" value={f.code} onChange={set('code')} hint="Leave empty to generate" />
        <TextField label="Category" value={f.category} onChange={set('category')} placeholder="Thread, fabric, stones…" />
        <SelectField label="Unit" value={f.unit} onChange={set('unit')} disabled={!!material} hint={material ? 'Unit cannot change after creation' : 'Stock is always counted in this unit'}>
          {UNITS.filter((u) => !['hour', 'job'].includes(u)).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </SelectField>
        <TextField label="Reorder when stock reaches" inputMode="decimal" value={f.reorder_level} onChange={set('reorder_level')} />
        <SelectField className="sm:col-span-2" label="Usual supplier" value={f.default_supplier_id} onChange={set('default_supplier_id')}>
          <option value="">—</option>
          {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectField>
      </div>
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </Dialog>
  );
}

const TYPE_LABEL: Record<string, string> = {
  receipt: 'Purchase received', consumption: 'Used on order', return_in: 'Returned to stock', return_out: 'Returned to supplier', waste: 'Waste / damage', adjustment: 'Stock count correction',
};

export function MaterialDetailPage() {
  const { id = '' } = useParams();
  const { canAny, can } = useSession();
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const finance = canAny('finance.view', 'purchasing.manage', 'inventory.manage');

  const m = useQuery({ queryKey: ['material', id], queryFn: async () => {
    const { data, error } = await supabase.from('materials').select('*, supplier:suppliers(name)').eq('id', id).single();
    if (error) throw error;
    return data as Material & { supplier: Pick<Supplier, 'name'> | null };
  } });
  const [page, setPage] = useState(0);
  const moves = useQuery({
    queryKey: ['material-moves', id, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase.from('stock_movements')
        .select('id, type, qty, unit_cost, value, reason, created_at, order_line:order_lines(order_id, order:orders(order_no))', { count: 'exact' })
        .eq('material_id', id).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as { id: string; type: string; qty: number; unit_cost: number; value: number; reason: string | null; created_at: string; order_line: { order_id: string; order: { order_no: string } } | null }[], total: count ?? 0 };
    },
  });

  if (m.isLoading) return <PageLoader />;
  if (m.error || !m.data) return <ErrorBox message={errorMessage(m.error ?? 'Not found')} />;
  const mat = m.data;
  return (
    <div className="space-y-4">
      <PageHeader
        back={<Link to="/inventory" className="mb-1 inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft className="h-4 w-4" /> Inventory</Link>}
        title={mat.name}
        subtitle={`${mat.code}${mat.category ? ` · ${mat.category}` : ''}`}
        actions={canAny('inventory.manage', 'purchasing.manage') && <>
          {can('inventory.manage') && <Button onClick={() => setAdjusting(true)}>Adjust stock</Button>}
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        </>}
      />
      <Card>
        <DL items={[
          ['In stock', <b className={clsx(toNum(mat.on_hand) <= toNum(mat.reorder_level) && 'text-burgundy-700')}>{qtyText(mat.on_hand, mat.unit)}</b>],
          ['Reorder at', qtyText(mat.reorder_level, mat.unit)],
          ...(finance ? [['Average cost', `${rupees(mat.avg_cost)} per ${mat.unit}`], ['Stock value', rupees(Math.max(0, toNum(mat.on_hand)) * toNum(mat.avg_cost))]] as [string, string][] : []),
          ['Usual supplier', mat.supplier?.name ?? '—'],
        ]} />
        <p className="mt-3 text-xs text-ink-500">Costing method: weighted average. Each use is valued at the average cost at that moment, and that value is kept on the order.</p>
      </Card>
      <Card title="Stock movements" padded={false}>
        {!moves.data?.rows.length ? <EmptyState title="No movements yet" /> : (
          <>
            <ul className="divide-y divide-cream-200 text-sm">
              {moves.data.rows.map((x) => (
                <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
                  <div>
                    <p className="font-medium">{TYPE_LABEL[x.type]}
                      {x.order_line && <> · <Link className="text-burgundy-700 underline" to={`/orders/${x.order_line.order_id}`}>{x.order_line.order.order_no}</Link></>}</p>
                    <p className="text-xs text-ink-500">{fmtDateTime(x.created_at)}{x.reason ? ` · ${x.reason}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className={clsx('num font-semibold', x.qty < 0 ? 'text-burgundy-700' : 'text-emerald-700')}>{x.qty > 0 ? '+' : ''}{qtyText(x.qty, mat.unit)}</p>
                    {finance && <p className="num text-xs text-ink-500">@ {rupees(x.unit_cost)} = {rupees(x.value)}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={moves.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <MaterialFormDialog open={editing} onClose={() => setEditing(false)} material={mat} />
      {adjusting && <AdjustDialog material={mat} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

function AdjustDialog({ material, onClose }: { material: Material; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = useRef(newKey());
  const [type, setType] = useState<'adjustment' | 'waste' | 'return_out'>('adjustment');
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { key.current = newKey(); }, [type, direction, qty, cost, reason]);

  const save = useMutation({
    mutationFn: async () => {
      const n = Number(qty);
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a quantity more than 0');
      if (!reason.trim()) throw new Error('Give a reason');
      const signed = type === 'adjustment' && direction === 'add' ? n : -n;
      const c = cost ? Number(cost) : null;
      if (c !== null && (!Number.isFinite(c) || c < 0)) throw new Error('Cost must be 0 or more');
      const { error } = await supabase.rpc('adjust_stock', {
        p_material_id: material.id, p_type: type, p_qty: signed, p_reason: reason.trim(), p_idempotency_key: key.current, p_unit_cost: c,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['material', material.id] });
      qc.invalidateQueries({ queryKey: ['material-moves', material.id] });
      qc.invalidateQueries({ queryKey: ['materials'] });
      toast.success('Stock updated');
      onClose();
    },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} title="Adjust stock" description={`${material.name} · ${qtyText(material.on_hand, material.unit)} now`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <SelectField label="What happened?" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="adjustment">Stock count correction / opening stock</option>
          <option value="waste">Waste or damage</option>
          <option value="return_out">Returned to supplier</option>
        </SelectField>
        {type === 'adjustment' && (
          <SelectField label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}>
            <option value="add">Add to stock</option>
            <option value="remove">Remove from stock</option>
          </SelectField>
        )}
        <TextField label={`Quantity (${material.unit})`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        {type === 'adjustment' && direction === 'add' && (
          <TextField label={`Cost per ${material.unit} (₹, optional)`} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)}
            hint="For opening stock enter what you paid. Leave empty to use the current average." />
        )}
        <TextField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <ErrorBox message={err} />}
      </div>
    </Dialog>
  );
}
