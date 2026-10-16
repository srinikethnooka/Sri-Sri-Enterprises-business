import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate, METHOD_LABEL, rupees, todayIST, toNum } from '@/lib/format';
import { periodFor, type Period } from '@/lib/periods';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Pagination } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { PeriodPicker } from '@/components/PeriodPicker';
import type { PaymentMethod } from '@/types/models';

const PAGE = 30;
interface Expense { id: string; expense_date: string; category_id: string; amount: number; description: string; method: PaymentMethod; notes: string | null; voided_at: string | null; void_reason: string | null; category: { name: string } }

export function ExpensesPage() {
  const bid = useBusinessId();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(periodFor('month'));
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Expense | 'new' | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);

  const cats = useQuery({ queryKey: ['expense-cats', bid], queryFn: async () => (await supabase.from('expense_categories').select('id, name').eq('business_id', bid).eq('active', true).order('name')).data ?? [] });
  const q = useQuery({
    queryKey: ['expenses', bid, period.from, period.to, cat, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let s = supabase.from('expenses').select('*, category:expense_categories(name)', { count: 'exact' })
        .eq('business_id', bid).gte('expense_date', period.from).lte('expense_date', period.to)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false });
      if (cat) s = s.eq('category_id', cat);
      const { data, error, count } = await s.range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      const sum = await supabase.from('expenses').select('amount').eq('business_id', bid).is('voided_at', null)
        .gte('expense_date', period.from).lte('expense_date', period.to).match(cat ? { category_id: cat } : {});
      return { rows: data as Expense[], total: count ?? 0, sum: (sum.data ?? []).reduce((a, x) => a + toNum(x.amount), 0) };
    },
  });

  const voidIt = useMutation({
    mutationFn: async ({ e, reason }: { e: Expense; reason: string }) => {
      const { error } = await supabase.rpc('void_expense', { p_expense_id: e.id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense voided'); setVoiding(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Running costs: rent, electricity, repairs, transport… Stock purchases go under Purchases, not here."
        actions={can('expenses.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add expense</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setPage(0); }} />
        <div>
          <label className="label" htmlFor="ecat">Category</label>
          <select id="ecat" className="input" value={cat} onChange={(e) => { setCat(e.target.value); setPage(0); }}>
            <option value="">All</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {q.data && <p className="pb-2.5 text-sm">Total: <b className="num">{rupees(q.data.sum)}</b></p>}
      </div>
      {q.error && <ErrorBox message={errorMessage(q.error)} />}
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : !q.data?.rows.length ? <EmptyState icon={<Wallet className="h-6 w-6" />} title="No expenses in this period" /> : (
          <>
            <ul className="divide-y divide-cream-200">
              {q.data.rows.map((e) => (
                <li key={e.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${e.voided_at ? 'opacity-60' : ''}`}>
                  <div>
                    <p className="font-medium">{e.description} {e.voided_at && <Badge tone="danger">Voided</Badge>}</p>
                    <p className="text-sm text-ink-500">{fmtDate(e.expense_date)} · {e.category.name} · {METHOD_LABEL[e.method]}{e.void_reason ? ` · ${e.void_reason}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`num font-semibold ${e.voided_at ? 'line-through' : ''}`}>{rupees(e.amount)}</span>
                    {can('expenses.manage') && !e.voided_at && <>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(e)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(e)}>Void</Button>
                    </>}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {edit && <ExpenseDialog expense={edit === 'new' ? null : edit} cats={cats.data ?? []} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!voiding} onClose={() => setVoiding(null)} title="Void this expense?" requireReason danger confirmLabel="Void"
        message="Voided expenses stay on record but are left out of totals and profit." loading={voidIt.isPending}
        onConfirm={(reason) => { if (voiding) voidIt.mutate({ e: voiding, reason }); }} />
    </div>
  );
}

function ExpenseDialog({ expense, cats, onClose }: { expense: Expense | null; cats: { id: string; name: string }[]; onClose: () => void }) {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ expense_date: todayIST(), category_id: '', amount: '', description: '', method: 'cash' as PaymentMethod, notes: '' });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [newCat, setNewCat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setF({ expense_date: expense?.expense_date ?? todayIST(), category_id: expense?.category_id ?? cats[0]?.id ?? '', amount: expense ? String(toNum(expense.amount)) : '',
      description: expense?.description ?? '', method: expense?.method ?? 'cash', notes: expense?.notes ?? '' });
  }, [expense, cats]);

  const save = useMutation({
    mutationFn: async () => {
      const a = Number(f.amount);
      if (!Number.isFinite(a) || a <= 0) throw new Error('Enter an amount more than 0');
      if (!f.description.trim()) throw new Error('Describe the expense');
      let category = f.category_id;
      if (newCat.trim()) {
        const c = await supabase.from('expense_categories').insert({ business_id: bid, name: newCat.trim() }).select('id').single();
        if (c.error) throw c.error;
        category = c.data.id;
      }
      if (!category) throw new Error('Choose a category');
      const row = { expense_date: f.expense_date, category_id: category, amount: a, description: f.description.trim(), method: f.method, notes: f.notes || null };
      const r = expense
        ? await supabase.from('expenses').update(row).eq('id', expense.id).select('id').single()
        : await supabase.from('expenses').insert({ ...row, business_id: bid }).select('id').single();
      if (r.error) throw r.error;
      if (receipt) {
        if (receipt.size > 10_000_000) throw new Error('Receipt saved without photo: file is over 10 MB');
        const path = `${bid}/expenses/${r.data.id}/${crypto.randomUUID()}.${receipt.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
        const up = await supabase.storage.from('receipts').upload(path, receipt, { contentType: receipt.type });
        if (up.error) throw up.error;
        await supabase.from('attachments').insert({ business_id: bid, bucket: 'receipts', path, entity_type: 'expense', entity_id: r.data.id, mime: receipt.type, size_bytes: receipt.size });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['expense-cats'] }); toast.success('Expense saved'); onClose(); },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <Dialog open onClose={onClose} title={expense ? 'Edit expense' : 'Add expense'} description={expense ? 'Changes are recorded in the audit log.' : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Date" type="date" value={f.expense_date} onChange={set('expense_date')} />
        <TextField label="Amount (₹)" inputMode="decimal" value={f.amount} onChange={set('amount')} />
        <SelectField label="Category" value={f.category_id} onChange={set('category_id')} disabled={!!newCat}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <TextField label="…or new category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        <TextField className="sm:col-span-2" label="Description" required value={f.description} onChange={set('description')} placeholder="October electricity bill" />
        <SelectField label="Paid by" value={f.method} onChange={set('method')}>
          {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        <div>
          <span className="label">Receipt photo (optional)</span>
          <input ref={file} type="file" accept="image/*,application/pdf" hidden onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          <Button variant="secondary" icon={<Paperclip className="h-4 w-4" />} onClick={() => file.current?.click()}>{receipt ? receipt.name.slice(0, 20) : 'Attach'}</Button>
        </div>
        <TextAreaField className="sm:col-span-2" label="Notes" rows={2} value={f.notes} onChange={set('notes')} />
      </div>
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </Dialog>
  );
}
