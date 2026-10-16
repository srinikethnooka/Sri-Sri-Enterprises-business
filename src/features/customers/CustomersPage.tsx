import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useBusinessId, useSession } from '@/app/session';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/format';
import { prettyPhone } from '@/lib/phone';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBox, PageHeader, Pagination, SearchBox, Badge } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { CustomerFormDialog } from './CustomerFormDialog';
import { searchCustomers } from './api';

const PAGE = 25;

export function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function CustomersPage() {
  const bid = useBusinessId();
  const { can } = useSession();
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const t = useDebounced(term);
  useEffect(() => setPage(0), [t]);

  const q = useQuery({
    queryKey: ['customers', bid, t, page],
    queryFn: () => searchCustomers(bid, t, page, PAGE),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Search by name, phone number or customer ID."
        actions={can('customers.manage') || can('orders.manage') ? <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add customer</Button> : undefined}
      />
      <div className="mb-4 max-w-md"><SearchBox value={term} onChange={setTerm} placeholder="Search customers" /></div>
      {q.error && <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : !q.data?.rows.length ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title={t ? 'No customers match your search' : 'No customers yet'}
            action={!t && <Button onClick={() => setAdding(true)}>Add the first customer</Button>} />
        ) : (
          <>
            <ul className="divide-y divide-cream-200 md:hidden">
              {q.data.rows.map((c) => (
                <li key={c.id}>
                  <Link to={`/customers/${c.id}`} className="block px-4 py-3 hover:bg-cream-50">
                    <p className="font-medium">{c.full_name} <span className="text-xs text-ink-500">{c.customer_code}</span></p>
                    <p className="text-sm text-ink-500">{prettyPhone(c.phone_e164)}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="table-head border-b border-cream-200 bg-cream-50"><tr><th>Customer</th><th>ID</th><th>Phone</th><th>WhatsApp</th><th>Portal</th><th>Since</th></tr></thead>
                <tbody className="divide-y divide-cream-200">
                  {q.data.rows.map((c) => (
                    <tr key={c.id} className="table-row hover:bg-cream-50">
                      <td><Link to={`/customers/${c.id}`} className="font-medium text-burgundy-700 hover:underline">{c.full_name}</Link></td>
                      <td className="text-ink-500">{c.customer_code}</td>
                      <td>{prettyPhone(c.phone_e164)}</td>
                      <td>{c.whatsapp_status === 'yes' ? <Badge tone="good">Yes</Badge> : c.whatsapp_status === 'no' ? <Badge tone="warn">No</Badge> : <span className="text-ink-400">—</span>}</td>
                      <td>{c.user_id ? <Badge tone="good">Linked</Badge> : <span className="text-ink-400">—</span>}</td>
                      <td className="text-ink-500">{fmtDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <CustomerFormDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
