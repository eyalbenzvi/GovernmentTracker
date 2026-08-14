/**
 * Sortable, accessible data table.
 *
 * Sorting is exposed through real <button> elements inside the <th>, with
 * aria-sort on the header cell, so the sort state is announced rather than
 * implied by an icon. Rows are rendered eagerly up to `pageSize` and extended on
 * demand, which keeps thousands of records responsive without virtualisation.
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell content. */
  render: (item: T) => React.ReactNode;
  /** Sort key. Returning null puts the row last, regardless of direction. */
  sortValue?: (item: T) => string | number | null;
  align?: 'start' | 'end';
  widthClass?: string;
}

type Direction = 'asc' | 'desc';

export function DataTable<T>({
  items,
  columns,
  caption,
  rowKey,
  pageSize = 50,
  emptyMessage,
}: {
  items: readonly T[];
  columns: readonly Column<T>[];
  caption: string;
  rowKey: (item: T) => string;
  pageSize?: number;
  emptyMessage: string;
}): JSX.Element {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('asc');
  const [visible, setVisible] = useState(pageSize);

  const sorted = useMemo(() => {
    if (sortKey === null) return [...items];
    const column = columns.find((c) => c.key === sortKey);
    if (column?.sortValue === undefined) return [...items];
    const getValue = column.sortValue;
    const factor = direction === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      // Missing values always sort last so they never masquerade as low numbers.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv), 'he') * factor;
    });
  }, [items, columns, sortKey, direction]);

  function toggleSort(key: string): void {
    if (sortKey === key) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDirection('asc');
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-rule-strong bg-surface-2 p-6 text-sm text-ink-2">
        {emptyMessage}
      </div>
    );
  }

  const rows = sorted.slice(0, visible);
  const primary = columns[0];
  const secondary = columns.slice(1);

  return (
    <div>
      {/*
       * Narrow screens get one card per row instead of a horizontally scrolling
       * table: the first column heads the card and the rest become labelled pairs,
       * so no column is lost off-screen and the header never scrolls away.
       */}
      <ul className="space-y-2 sm:hidden" data-rows="cards" aria-label={caption}>
        {rows.map((item) => (
          <li key={rowKey(item)} className="card p-3">
            {primary !== undefined && (
              <p className="text-sm font-medium text-ink">{primary.render(item)}</p>
            )}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {secondary.map((column) => (
                <div key={column.key} className="min-w-0">
                  <dt className="truncate text-ink-3">{column.header}</dt>
                  <dd className={`text-ink-2 ${column.align === 'end' ? 'num' : ''}`}>
                    {column.render(item)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <div className="table-wrap hidden max-h-[32rem] overflow-y-auto sm:block">
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const isSorted = sortKey === column.key;
                const ariaSort = isSorted
                  ? direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortValue !== undefined ? ariaSort : undefined}
                    className={column.widthClass}
                  >
                    {column.sortValue !== undefined ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-brand"
                        onClick={() => toggleSort(column.key)}
                        aria-label={`מיון לפי ${column.header}`}
                      >
                        {column.header}
                        {isSorted ? (
                          direction === 'asc' ? (
                            <ArrowUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden="true" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={rowKey(item)}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={column.align === 'end' ? 'num text-left' : undefined}
                  >
                    {column.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span className="num">
          מוצגות {rows.length} מתוך {items.length} שורות
        </span>
        {visible < items.length && (
          <button type="button" className="btn" onClick={() => setVisible((v) => v + pageSize)}>
            הצג עוד {Math.min(pageSize, items.length - visible)} שורות
          </button>
        )}
      </div>
    </div>
  );
}
