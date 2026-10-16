import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ruler } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/format';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Card, EmptyState, ErrorBox } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { MeasurementSet } from '@/types/models';
import { BLOUSE_FIELDS, getMeasurements } from './api';

function labelFor(key: string) {
  return BLOUSE_FIELDS.find((f) => f.key === key)?.label ?? key.replace(/_/g, ' ');
}

export function MeasurementView({ m, compact }: { m: MeasurementSet; compact?: boolean }) {
  return (
    <div>
      <dl className={`grid grid-cols-2 gap-x-4 gap-y-1 text-sm ${compact ? '' : 'sm:grid-cols-3'}`}>
        {Object.entries(m.values).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-dashed border-cream-200 py-1">
            <dt className="capitalize text-ink-500">{labelFor(k)}</dt>
            <dd className="num font-medium">{String(v)} {m.unit === 'cm' ? 'cm' : '″'}</dd>
          </div>
        ))}
      </dl>
      {m.notes && <p className="mt-2 text-sm text-ink-700">{m.notes}</p>}
    </div>
  );
}

export function MeasurementsCard({ customerId }: { customerId: string }) {
  const { canAny } = useSession();
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({ queryKey: ['measurements', customerId], queryFn: () => getMeasurements(customerId) });
  const sets = q.data ?? [];
  const visible = showAll ? sets : sets.slice(0, 1);

  return (
    <Card
      title="Measurements"
      actions={canAny('customers.manage', 'orders.manage') && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{sets.length ? 'New measurements' : 'Add measurements'}</Button>}
    >
      {q.error && <ErrorBox message={errorMessage(q.error)} />}
      {!q.isLoading && sets.length === 0 && <EmptyState icon={<Ruler className="h-6 w-6" />} title="No measurements yet" />}
      <div className="space-y-4">
        {visible.map((m, i) => (
          <div key={m.id}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gold-700">
              {i === 0 ? 'Latest' : 'Earlier'} · {m.garment_type} · {fmtDate(m.taken_at)}
            </p>
            <MeasurementView m={m} />
          </div>
        ))}
      </div>
      {sets.length > 1 && (
        <button className="mt-3 text-sm font-medium text-burgundy-700" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show latest only' : `Show history (${sets.length - 1} earlier)`}
        </button>
      )}
      <p className="mt-3 text-xs text-ink-500">Measurements are never overwritten: saving creates a new set, so past orders keep the ones they used.</p>
      <MeasurementDialog open={adding} onClose={() => setAdding(false)} customerId={customerId} previous={sets[0]} />
    </Card>
  );
}

function MeasurementDialog({ open, onClose, customerId, previous }: { open: boolean; onClose: () => void; customerId: string; previous?: MeasurementSet }) {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const [garment, setGarment] = useState(previous?.garment_type ?? 'blouse');
  const [unit, setUnit] = useState<'inch' | 'cm'>(previous?.unit ?? 'inch');
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(previous?.values ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [extraKey, setExtraKey] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGarment(previous?.garment_type ?? 'blouse');
    setUnit(previous?.unit ?? 'inch');
    setValues(Object.fromEntries(Object.entries(previous?.values ?? {}).map(([k, v]) => [k, String(v)])));
    setNotes('');
    setErr(null);
  }, [open, previous]);

  const keys = Array.from(new Set([...BLOUSE_FIELDS.map((f) => f.key), ...Object.keys(values)]));

  const save = useMutation({
    mutationFn: async () => {
      const clean: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(values)) {
        const t = v.trim();
        if (!t) continue;
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0 || n > 200) throw new Error(`${labelFor(k)}: enter a number between 0 and 200`);
        clean[k] = n;
      }
      if (!Object.keys(clean).length) throw new Error('Enter at least one measurement');
      const { error } = await supabase.from('measurement_sets').insert({
        business_id: bid, customer_id: customerId, garment_type: garment.trim() || 'blouse', unit, values: clean, notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['measurements', customerId] });
      toast.success('Measurements saved');
      onClose();
    },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New measurements" description="Starts from the latest set. Change what's different." size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save measurements</Button></>}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <TextField label="Garment" value={garment} onChange={(e) => setGarment(e.target.value)} />
        <SelectField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as 'inch' | 'cm')}>
          <option value="inch">Inches</option>
          <option value="cm">Centimetres</option>
        </SelectField>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {keys.map((k) => (
          <TextField key={k} label={<span className="capitalize">{labelFor(k)}</span>} inputMode="decimal" value={values[k] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
        ))}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <TextField className="flex-1" label="Add another measurement" placeholder="e.g. hip" value={extraKey} onChange={(e) => setExtraKey(e.target.value)} />
        <Button variant="secondary" onClick={() => {
          const k = extraKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
          if (k) setValues((v) => ({ ...v, [k]: v[k] ?? '' }));
          setExtraKey('');
        }}>Add</Button>
      </div>
      <TextAreaField className="mt-3" label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </Dialog>
  );
}
