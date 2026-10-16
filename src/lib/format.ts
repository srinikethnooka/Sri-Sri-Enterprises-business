// Formatting for India: rupees with lakh/crore grouping, IST dates.
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function toNum(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

export function rupees(v: number | string | null | undefined, opts: { whole?: boolean } = {}): string {
  const n = toNum(v);
  const s = (opts.whole ? inr0 : inr).format(Math.abs(n));
  return `${n < 0 ? '-' : ''}₹${s}`;
}

/** Plain-number rupees for messages: ₹3,600 (no paise when whole). */
export function rupeesShort(v: number | string | null | undefined): string {
  const n = toNum(v);
  return Number.isInteger(n) ? rupees(n, { whole: true }) : rupees(n);
}

const TZ = 'Asia/Kolkata';

function asDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+05:30` : v);
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(asDate(v));
}

export function fmtDateLong(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(asDate(v));
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(asDate(v));
}

/** Today's date in India as YYYY-MM-DD. */
export function todayIST(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Value for <input type="datetime-local"> in IST from an ISO timestamp. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** ISO timestamp from an IST datetime-local value. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00+05:30`).toISOString();
}

export function qtyText(q: number | string, unit: string): string {
  const n = toNum(q);
  const s = Number.isInteger(n) ? String(n) : String(+n.toFixed(3));
  return unit === 'pcs' ? s : `${s} ${unit}`;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  waiting_materials: 'Waiting for materials',
  quality_check: 'Quality check',
  ready: 'Ready for collection',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const DELIVERY_LABEL: Record<string, string> = {
  pickup: 'Collect at boutique',
  local_delivery: 'Local delivery',
  courier: 'Courier',
  rapido: 'Rapido / bike delivery',
};

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', card: 'Card', other: 'Other',
};

export const UNIT_LABEL: Record<string, string> = {
  pcs: 'pieces', m: 'metres', g: 'grams', ml: 'millilitres', roll: 'rolls', set: 'sets', hour: 'hours', job: 'job',
};
