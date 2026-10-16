import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { useBusinessId } from '@/app/session';
import { prettyPhone } from '@/lib/phone';
import { Button } from '@/components/ui/Button';
import { SearchBox } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/Spinner';
import type { Customer } from '@/types/models';
import { searchCustomers } from './api';
import { CustomerFormDialog } from './CustomerFormDialog';
import { useDebounced } from './CustomersPage';

export function CustomerPicker({ value, onChange, error, locked }: {
  value: Customer | null; onChange: (c: Customer | null) => void; error?: string; locked?: boolean;
}) {
  const bid = useBusinessId();
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const t = useDebounced(term, 250);
  const q = useQuery({
    queryKey: ['customer-pick', bid, t],
    queryFn: () => searchCustomers(bid, t, 0, 8),
    enabled: !value && t.length >= 2,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gold-300 bg-gold-100/40 px-3 py-2.5">
        <div>
          <p className="font-medium">{value.full_name} <span className="text-xs text-ink-500">{value.customer_code}</span></p>
          <p className="text-sm text-ink-500">{prettyPhone(value.phone_e164)}</p>
        </div>
        {!locked && (
          <button type="button" className="rounded-lg p-2 text-ink-500 hover:bg-cream-200" onClick={() => onChange(null)} aria-label="Change customer">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex-1"><SearchBox value={term} onChange={setTerm} placeholder="Type a name or phone number" /></div>
        <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>New</Button>
      </div>
      {error && <p className="mt-1 text-sm text-burgundy-700" role="alert">{error}</p>}
      {t.length >= 2 && (
        <div className="mt-2 overflow-hidden rounded-lg border border-cream-300 bg-white">
          {q.isFetching && <div className="flex justify-center p-3"><Spinner /></div>}
          {q.data?.rows.map((c) => (
            <button key={c.id} type="button" onClick={() => { onChange(c); setTerm(''); }}
              className="flex w-full items-center justify-between gap-3 border-b border-cream-100 px-3 py-2.5 text-left hover:bg-cream-50">
              <span className="font-medium">{c.full_name} <span className="text-xs text-ink-500">{c.customer_code}</span></span>
              <span className="text-sm text-ink-500">{prettyPhone(c.phone_e164)}</span>
            </button>
          ))}
          {q.data && !q.data.rows.length && (
            <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-ink-500">
              No match.
              <Button size="sm" onClick={() => setAdding(true)}>Add “{t}”</Button>
            </div>
          )}
        </div>
      )}
      <CustomerFormDialog open={adding} onClose={() => setAdding(false)} onSaved={(c) => { onChange(c); setTerm(''); }} />
    </div>
  );
}
