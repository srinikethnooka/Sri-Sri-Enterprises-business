import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { rupees, toNum } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Badge, Card, ErrorBox } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Order, OrderLine } from '@/types/models';

interface Cost { line_id: string; material_cost: number; labour_cost: number; other_cost: number; costs_complete: boolean }

/** Internal job-cost record. Only rendered for users with finance.view; RLS enforces it too. */
export function CostsSection({ order, lines }: { order: Order; lines: OrderLine[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, { labour: string; other: string; complete: boolean }>>({});
  const q = useQuery({
    queryKey: ['order-costs', order.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('order_line_costs').select('*').in('line_id', lines.map((l) => l.id));
      if (error) throw error;
      return Object.fromEntries((data as Cost[]).map((c) => [c.line_id, c]));
    },
    enabled: lines.length > 0,
  });

  const save = useMutation({
    mutationFn: async (lineId: string) => {
      const d = draft[lineId];
      const labour = Number(d.labour || 0), other = Number(d.other || 0);
      if (!Number.isFinite(labour) || labour < 0 || !Number.isFinite(other) || other < 0) throw new Error('Costs must be 0 or more');
      const { error } = await supabase.rpc('set_line_costs', { p_line_id: lineId, p_labour: labour, p_other: other, p_complete: d.complete });
      if (error) throw error;
    },
    onSuccess: (_d, lineId) => {
      setDraft(({ [lineId]: _, ...rest }) => rest);
      qc.invalidateQueries({ queryKey: ['order-costs', order.id] });
      toast.success('Costs saved');
    },
    onError: (e) => toast.error(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  const costs = q.data ?? {};
  let revenue = 0, cost = 0, complete = true;
  for (const l of lines) {
    const c = costs[l.id];
    revenue += toNum(l.line_subtotal);
    cost += toNum(c?.material_cost) + toNum(c?.labour_cost) + toNum(c?.other_cost);
    if (!c?.costs_complete) complete = false;
  }
  revenue -= toNum(order.order_discount);

  return (
    <Card title={<span className="flex items-center gap-2">Job cost <Badge tone="gold">Owner only</Badge></span>}>
      {q.error && <ErrorBox message={errorMessage(q.error)} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="table-head"><tr><th>Item</th><th className="text-right">Sale</th><th className="text-right">Materials</th><th>Labour ₹</th><th>Other ₹</th><th>Done</th><th /></tr></thead>
          <tbody className="divide-y divide-cream-200">
            {lines.map((l) => {
              const c = costs[l.id];
              const d = draft[l.id] ?? { labour: String(toNum(c?.labour_cost) || ''), other: String(toNum(c?.other_cost) || ''), complete: !!c?.costs_complete };
              const set = (p: Partial<typeof d>) => setDraft((x) => ({ ...x, [l.id]: { ...d, ...p } }));
              return (
                <tr key={l.id} className="table-row">
                  <td className="max-w-[12rem]">{l.description}</td>
                  <td className="num text-right">{rupees(l.line_subtotal)}</td>
                  <td className="num text-right">{rupees(c?.material_cost)}</td>
                  <td><input className="input w-24" inputMode="decimal" value={d.labour} onChange={(e) => set({ labour: e.target.value })} aria-label="Labour cost" /></td>
                  <td><input className="input w-24" inputMode="decimal" value={d.other} onChange={(e) => set({ other: e.target.value })} aria-label="Other cost" /></td>
                  <td><input type="checkbox" className="h-5 w-5 rounded text-burgundy-700" checked={d.complete} onChange={(e) => set({ complete: e.target.checked })} aria-label="All costs entered" /></td>
                  <td>{draft[l.id] && <Button size="sm" loading={save.isPending} onClick={() => save.mutate(l.id)}>Save</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cream-50 p-3 text-sm">
        <span>Sale after discount <b className="num">{rupees(revenue)}</b> − costs <b className="num">{rupees(cost)}</b></span>
        <span className="text-base font-semibold">
          {complete ? 'Profit' : 'Profit (incomplete)'}: <span className="num text-burgundy-700">{rupees(revenue - cost)}</span>
        </span>
      </div>
      {!complete && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> Tick “Done” on each item once all its costs are entered. Until then reports mark profit as incomplete.</p>
      )}
      <p className="mt-1 text-xs text-ink-500">Material cost comes from materials used (weighted average price). It never appears on customer invoices.</p>
    </Card>
  );
}
