import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage, newKey } from '@/lib/errors';
import { fmtDate, qtyText, rupees, toNum } from '@/lib/format';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { Card, EmptyState, ErrorBox } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Material, Order, OrderLine } from '@/types/models';

interface Move { id: string; material_id: string; type: string; qty: number; unit_cost: number | null; value: number | null; order_line_id: string; created_at: string; reason: string | null; material: { name: string; unit: string } }

export function MaterialsSection({ order, lines }: { order: Order; lines: OrderLine[] }) {
  const { can } = useSession();
  const [using, setUsing] = useState<{ line: OrderLine; mode: 'use' | 'return' } | null>(null);
  const finance = can('finance.view');
  const q = useQuery({
    queryKey: ['order-materials', order.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_movements')
        .select('id, material_id, type, qty, unit_cost, value, order_line_id, created_at, reason, material:materials(name, unit)')
        .in('order_line_id', lines.map((l) => l.id)).order('created_at');
      if (error) throw error;
      return (data ?? []) as unknown as Move[];
    },
    enabled: lines.length > 0,
  });

  return (
    <Card title="Materials used">
      {q.error && <ErrorBox message={errorMessage(q.error)} />}
      <div className="space-y-4">
        {lines.map((l, i) => {
          const moves = (q.data ?? []).filter((m) => m.order_line_id === l.id);
          return (
            <div key={l.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{i + 1}. {l.description}</p>
                {can('inventory.manage') && order.status !== 'cancelled' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setUsing({ line: l, mode: 'use' })}>Use material</Button>
                    {moves.length > 0 && <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setUsing({ line: l, mode: 'return' })}>Return</Button>}
                  </div>
                )}
              </div>
              {moves.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-sm text-ink-700">
                  {moves.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span>{m.type === 'return_in' ? 'Returned ' : ''}{qtyText(Math.abs(m.qty), m.material.unit)} {m.material.name} <span className="text-ink-400">· {fmtDate(m.created_at)}</span></span>
                      {finance && <span className="num text-ink-500">{rupees(-toNum(m.value))}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-ink-400">None recorded</p>}
            </div>
          );
        })}
      </div>
      {lines.length === 0 && <EmptyState icon={<Boxes className="h-6 w-6" />} title="No items" />}
      {using && <UseMaterialDialog order={order} line={using.line} mode={using.mode} onClose={() => setUsing(null)} />}
    </Card>
  );
}

function UseMaterialDialog({ order, line, mode, onClose }: { order: Order; line: OrderLine; mode: 'use' | 'return'; onClose: () => void }) {
  const bid = useBusinessId();
  const { isOwner, business } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const key = useRef(newKey());
  const [materialId, setMaterialId] = useState('');
  const [qty, setQty] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { key.current = newKey(); }, [materialId, qty]);

  const mats = useQuery({
    queryKey: ['materials-pick', bid],
    queryFn: async () => (await supabase.from('materials').select('*').eq('business_id', bid).eq('active', true).order('name')).data as Material[] ?? [],
  });
  const m = mats.data?.find((x) => x.id === materialId);
  const short = mode === 'use' && m && Number(qty) > toNum(m.on_hand);

  const save = useMutation({
    mutationFn: async () => {
      const n = Number(qty);
      if (!materialId) throw new Error('Choose a material');
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a quantity more than 0');
      const r = mode === 'use'
        ? await supabase.rpc('consume_material', { p_order_line_id: line.id, p_material_id: materialId, p_qty: n,
            p_idempotency_key: key.current, p_override: override, p_reason: override ? reason || 'Owner approved shortage' : null })
        : await supabase.rpc('adjust_stock', { p_material_id: materialId, p_type: 'return_in', p_qty: n,
            p_reason: reason || `Returned from ${order.order_no}`, p_idempotency_key: key.current, p_order_line_id: line.id });
      if (r.error) throw r.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order-materials', order.id] });
      qc.invalidateQueries({ queryKey: ['order-costs', order.id] });
      qc.invalidateQueries({ queryKey: ['materials'] });
      toast.success(mode === 'use' ? 'Material recorded' : 'Material returned to stock');
      onClose();
    },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} title={mode === 'use' ? 'Use material' : 'Return unused material'} description={`${order.order_no} · ${line.description}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!!short && !override} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <SelectField label="Material" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">Choose…</option>
          {mats.data?.map((x) => <option key={x.id} value={x.id}>{x.name} — {qtyText(x.on_hand, x.unit)} in stock</option>)}
        </SelectField>
        <TextField label={`Quantity${m ? ` (${m.unit})` : ''}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        {short && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Only {qtyText(m!.on_hand, m!.unit)} in stock.
            {business?.stock_shortage_mode === 'override' && isOwner ? (
              <div className="mt-2 space-y-2">
                <Checkbox label="I approve using more than the stock on hand" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                {override && <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />}
              </div>
            ) : <p className="mt-1">Receive a purchase first{business?.stock_shortage_mode === 'override' ? ', or ask the owner to approve it' : ''}.</p>}
          </div>
        )}
        {mode === 'return' && <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />}
        {err && <ErrorBox message={err} />}
      </div>
    </Dialog>
  );
}
