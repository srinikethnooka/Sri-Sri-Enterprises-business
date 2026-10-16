import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { rupees, STATUS_LABEL, toNum } from '@/lib/format';
import type { Money } from '@/types/models';

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-cream-200 px-4 py-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Money({ value, className, strong }: { value: Money | null | undefined; className?: string; strong?: boolean }) {
  return <span className={clsx('num whitespace-nowrap', strong && 'font-semibold', toNum(value) < 0 && 'text-burgundy-700', className)}>{rupees(value)}</span>;
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-cream-200 text-ink-700',
  confirmed: 'bg-sky-50 text-sky-800 ring-sky-200',
  in_progress: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  waiting_materials: 'bg-amber-50 text-amber-900 ring-amber-200',
  quality_check: 'bg-violet-50 text-violet-800 ring-violet-200',
  ready: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  out_for_delivery: 'bg-teal-50 text-teal-800 ring-teal-200',
  delivered: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  cancelled: 'bg-burgundy-50 text-burgundy-800 ring-burgundy-200',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent', STATUS_STYLE[status] ?? 'bg-cream-200')}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'good' | 'gold' }) {
  const t = {
    neutral: 'bg-cream-200 text-ink-700', warn: 'bg-amber-50 text-amber-900', danger: 'bg-burgundy-50 text-burgundy-800',
    good: 'bg-emerald-50 text-emerald-800', gold: 'bg-gold-100 text-gold-700',
  }[tone];
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      {icon && <div className="mb-1 rounded-full bg-cream-200 p-3 text-gold-700">{icon}</div>}
      <p className="font-medium text-ink-900">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-burgundy-200 bg-burgundy-50 p-4 text-sm text-burgundy-900" role="alert">
      {message}
      {onRetry && <button className="ml-3 font-medium underline" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        type="search"
        className="input pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="px-4 py-3 text-xs text-ink-500">{total} shown</p> : null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-cream-200 px-4 py-3 text-sm" aria-label="Pages">
      <span className="text-ink-500">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total}
      </span>
      <div className="flex gap-2">
        <button className="rounded-lg border border-cream-300 p-2 disabled:opacity-40" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="self-center text-ink-500">Page {page + 1} / {pages}</span>
        <button className="rounded-lg border border-cream-300 p-2 disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

export function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'danger' | 'good'; to?: string }) {
  const body = (
    <div className={clsx('card h-full p-4 transition', to && 'hover:border-gold-300')}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={clsx('num mt-1 text-2xl font-semibold', tone === 'danger' && 'text-burgundy-700', tone === 'warn' && 'text-amber-700', tone === 'good' && 'text-emerald-700')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function DL({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{k}</dt>
          <dd className="mt-0.5 text-ink-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
