/**
 * Charts, each paired with an accessible data table.
 *
 * Every chart on the site is wrapped in `ChartWithTable`, which renders the same
 * figures as a real <table> that can be toggled into view. A chart is never the
 * only representation of a number, and a chart with no data renders an explicit
 * "no data" panel instead of empty axes.
 */
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2 } from 'lucide-react';
import { DataUnavailable } from './ui';
import { formatCurrencyFull, formatCurrencyShort } from '../lib/format';

export interface SeriesPoint {
  /** Category label, e.g. the fiscal year. */
  label: string;
  values: Record<string, number | null>;
}

export interface SeriesDefinition {
  key: string;
  label: string;
  color: string;
}

function ChartTable({
  points,
  series,
  caption,
}: {
  points: readonly SeriesPoint[];
  series: readonly SeriesDefinition[];
  caption: string;
}): JSX.Element {
  return (
    <div className="table-wrap mt-3">
      <table className="data-table">
        <caption className="px-3 py-2 text-right text-xs text-slate-600">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">תקופה</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row" className="px-3 py-2 text-right font-medium text-slate-700">
                {point.label}
              </th>
              {series.map((s) => {
                const value = point.values[s.key] ?? null;
                return (
                  <td key={s.key} className="num text-left" title={formatCurrencyFull(value)}>
                    {formatCurrencyShort(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Chart + table wrapper. `emptyReason` is required so that a chart which cannot
 * be drawn always explains why, rather than showing a blank frame.
 */
export function ChartWithTable({
  title,
  description,
  points,
  series,
  kind = 'bar',
  stacked = false,
  emptyReason,
}: {
  title: string;
  description?: string;
  points: readonly SeriesPoint[];
  series: readonly SeriesDefinition[];
  kind?: 'bar' | 'line';
  /** Stack the bar series (e.g. usage categories composing one total). */
  stacked?: boolean;
  emptyReason: string;
}): JSX.Element {
  const [showTable, setShowTable] = useState(false);

  const hasAnyValue = points.some((point) =>
    series.some((s) => {
      const value = point.values[s.key];
      return value !== null && value !== undefined && Number.isFinite(value);
    }),
  );

  return (
    <section className="card card-pad" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {description !== undefined && (
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>
          )}
        </div>
        {hasAnyValue && (
          <button
            type="button"
            className="btn"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
          >
            <Table2 className="h-4 w-4" aria-hidden="true" />
            {showTable ? 'הסתר טבלה' : 'הצג כטבלה'}
          </button>
        )}
      </div>

      {!hasAnyValue ? (
        <DataUnavailable reason={emptyReason} />
      ) : (
        <>
          {/* The chart itself is decorative for assistive tech: the table below carries the data. */}
          <div className="h-72 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              {kind === 'bar' ? (
                <BarChart
                  data={points.map((p) => ({ label: p.label, ...p.values }))}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" reversed tick={{ fontSize: 12 }} />
                  <YAxis
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => formatCurrencyShort(v)}
                    width={110}
                  />
                  <Tooltip
                    formatter={(value: number | string) => formatCurrencyFull(Number(value))}
                    contentStyle={{ direction: 'rtl', fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ direction: 'rtl', fontSize: 13 }} />
                  {series.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      fill={s.color}
                      stackId={stacked ? 'stack' : undefined}
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart
                  data={points.map((p) => ({ label: p.label, ...p.values }))}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" reversed tick={{ fontSize: 12 }} />
                  <YAxis
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => formatCurrencyShort(v)}
                    width={110}
                  />
                  <Tooltip
                    formatter={(value: number | string) => formatCurrencyFull(Number(value))}
                    contentStyle={{ direction: 'rtl', fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ direction: 'rtl', fontSize: 13 }} />
                  {series.map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={2}
                      connectNulls={false}
                      dot
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          {/* Always rendered for screen readers; visually toggled for sighted users. */}
          <div className={showTable ? '' : 'sr-only'}>
            <ChartTable points={points} series={series} caption={`${title} — נתוני הגרף בטבלה`} />
          </div>
        </>
      )}
    </section>
  );
}

export const BUDGET_SERIES: readonly SeriesDefinition[] = [
  { key: 'originalBudget', label: 'תקציב מקורי', color: '#94a3b8' },
  { key: 'updatedBudget', label: 'תקציב מעודכן', color: '#1b5e8a' },
  { key: 'execution', label: 'ביצוע / אומדן', color: '#2f7d54' },
];
