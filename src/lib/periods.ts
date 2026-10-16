import { addDays, todayIST } from './format';

export type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'fy' | 'custom';

export interface Period {
  key: PeriodKey;
  from: string; // YYYY-MM-DD (IST)
  to: string;
}

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: 'Today', week: 'This week', month: 'This month', year: 'This year', fy: 'This financial year', custom: 'Custom',
};

export function periodFor(key: Exclude<PeriodKey, 'custom'>, now: Date = new Date()): Period {
  const t = todayIST(now);
  const [y, m] = t.split('-').map(Number);
  switch (key) {
    case 'today':
      return { key, from: t, to: t };
    case 'week': {
      const dow = new Date(`${t}T12:00:00Z`).getUTCDay(); // 0=Sun
      const monday = addDays(t, -((dow + 6) % 7));
      return { key, from: monday, to: t };
    }
    case 'month':
      return { key, from: `${t.slice(0, 7)}-01`, to: t };
    case 'year':
      return { key, from: `${y}-01-01`, to: t };
    case 'fy': {
      const start = m >= 4 ? y : y - 1;
      return { key, from: `${start}-04-01`, to: t };
    }
  }
}
