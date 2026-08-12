/**
 * Form controls and the CSV export button.
 *
 * Each control is a labelled native element — no custom widget re-implements
 * keyboard behaviour — so filtering is fully operable from the keyboard and
 * announced correctly by screen readers.
 */
import { useId } from 'react';
import { Download, Search } from 'lucide-react';
import { buildCsv, downloadCsv } from '../lib/csv';

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  hint?: string;
}): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint !== undefined ? hintId : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): JSX.Element {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          id={id}
          type="search"
          className="field pr-9"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export function FilterGrid({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

/**
 * Exports exactly the rows the user is currently looking at — the filtered
 * result set, not the full dataset — so a download always matches the screen.
 */
export function CsvDownloadButton<T>({
  filename,
  headers,
  rows,
  items,
  label = 'הורדת CSV של התוצאות',
}: {
  filename: string;
  headers: readonly string[];
  rows: (item: T) => readonly unknown[];
  items: readonly T[];
  label?: string;
}): JSX.Element {
  const disabled = items.length === 0;
  return (
    <button
      type="button"
      className="btn"
      disabled={disabled}
      onClick={() => downloadCsv(filename, buildCsv(headers, items.map(rows)))}
      aria-label={disabled ? 'אין תוצאות להורדה' : `${label} — ${items.length} שורות, קובץ CSV`}
      title={disabled ? 'אין תוצאות להורדה' : undefined}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {label}
      {!disabled && <span className="num text-slate-500">({items.length})</span>}
    </button>
  );
}
