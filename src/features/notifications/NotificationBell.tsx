import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/session';
import { fmtDateTime } from '@/lib/format';

interface Note { id: string; type: string; title: string; body: string | null; entity_type: string | null; entity_id: string | null; created_at: string }

function linkFor(n: Note): string {
  if (n.entity_type === 'order') return `/orders/${n.entity_id}`;
  if (n.entity_type === 'material') return `/inventory/${n.entity_id}`;
  if (n.entity_type === 'purchase') return `/purchases/${n.entity_id}`;
  return '/';
}

export function NotificationBell() {
  const { current, session } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const bid = current?.business_id;

  // Generate reminders (deduplicated in the database), at most every 5 minutes.
  useQuery({
    queryKey: ['notify-refresh', bid],
    enabled: !!bid,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      await supabase.rpc('refresh_notifications', { p_business_id: bid });
      qc.invalidateQueries({ queryKey: ['notifications', bid] });
      return true;
    },
  });

  const list = useQuery({
    queryKey: ['notifications', bid],
    enabled: !!bid,
    queryFn: async () => {
      const [n, r] = await Promise.all([
        supabase.from('notifications').select('*').eq('business_id', bid!).order('created_at', { ascending: false }).limit(30),
        supabase.from('notification_reads').select('notification_id').eq('user_id', session!.user.id),
      ]);
      if (n.error) throw n.error;
      const read = new Set((r.data ?? []).map((x) => x.notification_id as string));
      return (n.data as Note[]).map((x) => ({ ...x, read: read.has(x.id) }));
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      await supabase.from('notification_reads').upsert(ids.map((id) => ({ notification_id: id, user_id: session!.user.id })), { ignoreDuplicates: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', bid] }),
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items = list.data ?? [];
  const unread = items.filter((i) => !i.read);

  return (
    <div className="relative" ref={box}>
      <button
        className="relative rounded-lg p-2 text-ink-700 hover:bg-cream-200"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`}
        aria-expanded={open}
      >
        <Bell className="h-6 w-6" />
        {unread.length > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-burgundy-700 px-1 text-[10px] font-bold text-white">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-cream-300 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-cream-200 px-4 py-2.5">
            <span className="text-sm font-semibold">Alerts</span>
            {unread.length > 0 && (
              <button className="text-xs font-medium text-burgundy-700" onClick={() => markRead.mutate(unread.map((u) => u.id))}>Mark all read</button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-500">No alerts right now.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  to={linkFor(n)}
                  onClick={() => { setOpen(false); if (!n.read) markRead.mutate([n.id]); }}
                  className={clsx('block border-b border-cream-100 px-4 py-3 text-sm hover:bg-cream-50', !n.read && 'bg-gold-100/40')}
                >
                  <p className={clsx('font-medium', n.type === 'order_overdue' && 'text-burgundy-700')}>{n.title}</p>
                  {n.body && <p className="text-ink-500">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-ink-400">{fmtDateTime(n.created_at)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
