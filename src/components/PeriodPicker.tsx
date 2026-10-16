import { PERIOD_LABEL, periodFor, type Period, type PeriodKey } from '@/lib/periods';

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor="period">Period</label>
        <select
          id="period"
          className="input"
          value={value.key}
          onChange={(e) => {
            const k = e.target.value as PeriodKey;
            onChange(k === 'custom' ? { ...value, key: 'custom' } : periodFor(k));
          }}
        >
          {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
        </select>
      </div>
      {value.key === 'custom' && (
        <>
          <div>
            <label className="label" htmlFor="pfrom">From</label>
            <input id="pfrom" type="date" className="input" value={value.from} max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pto">To</label>
            <input id="pto" type="date" className="input" value={value.to} min={value.from}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
          </div>
        </>
      )}
    </div>
  );
}
