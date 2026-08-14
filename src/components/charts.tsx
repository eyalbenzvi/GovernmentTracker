/**
 * Charts, each paired with an accessible data table.
 *
 * Rules that hold for every chart in this file:
 *  - The figures are always available as a real <table>, toggled for sighted
 *    readers and always present for assistive tech. A chart is never the only
 *    representation of a number.
 *  - A chart with no usable figure renders an explicit "no data" panel with a
 *    reason, never empty axes.
 *  - A chart may carry a `takeaway` sentence, generated from the same figures by
 *    src/lib/insights.ts, because a title that only names the axes leaves a reader
 *    who does not work in government with nothing.
 *
 * The form is chosen by the question, which is why there are six of them:
 *   line/bar   change over time, magnitude by category
 *   waterfall  how one level became another (budget lifecycle)
 *   treemap    composition of a whole (budget structure)
 *   dot plot   one measure compared across many sections
 *   slope      the same sections between two periods
 *   sparkline  a trend inline, next to its number
 */
import { useId, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2 } from 'lucide-react';
import { DataUnavailable } from './ui';
import {
  formatCurrencyAxis,
  formatCurrencyFull,
  formatCurrencyShort,
  formatPercent,
} from '../lib/format';
import type { SeriesDefinition, SeriesPoint } from '../types/chart';
import type { WaterfallStep } from '../lib/waterfall';

export type { SeriesDefinition, SeriesPoint };

/** Grid and axis ink, taken from the theme tokens so both themes stay legible. */
const AXIS_STYLE = { fontSize: 11, fill: 'rgb(var(--ink-3))' } as const;
const GRID_STROKE = 'rgb(var(--rule))';

const TOOLTIP_STYLE = {
  direction: 'rtl',
  fontSize: 13,
  background: 'rgb(var(--surface))',
  border: '1px solid rgb(var(--rule-strong))',
  borderRadius: 6,
  color: 'rgb(var(--ink))',
} as const;

function ChartTable({
  points,
  series,
  caption,
  formatValue = formatCurrencyShort,
  fullValue = formatCurrencyFull,
  firstColumnLabel = 'תקופה',
}: {
  points: readonly SeriesPoint[];
  series: readonly SeriesDefinition[];
  caption: string;
  formatValue?: (value: number | null) => string;
  fullValue?: (value: number | null) => string;
  firstColumnLabel?: string;
}): JSX.Element {
  return (
    <div className="table-wrap mt-3">
      <table className="data-table">
        <caption className="px-3 py-2 text-right text-xs text-ink-3">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{firstColumnLabel}</th>
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
              <th scope="row" className="px-3 py-2 text-right font-medium text-ink-2">
                {point.label}
              </th>
              {series.map((s) => {
                const value = point.values[s.key] ?? null;
                return (
                  <td key={s.key} className="num text-left" title={fullValue(value)}>
                    {formatValue(value)}
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

/** Shared chrome: heading, optional takeaway, table toggle, empty state. */
function ChartFrame({
  title,
  description,
  takeaway,
  hasAnyValue,
  emptyReason,
  table,
  children,
  footer,
}: {
  title: string;
  description?: string;
  takeaway?: string | null;
  hasAnyValue: boolean;
  emptyReason: string;
  table: JSX.Element;
  children: ReactNode;
  footer?: JSX.Element;
}): JSX.Element {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card card-pad" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3>{title}</h3>
          {description !== undefined && (
            <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>
          )}
        </div>
        {hasAnyValue && (
          <button
            type="button"
            className="btn btn-sm"
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
          {/* The drawing is decorative for assistive tech: the table carries the data. */}
          <div aria-hidden="true">{children}</div>
          {takeaway !== undefined && takeaway !== null && takeaway !== '' && (
            <p className="mt-3 border-t border-rule pt-3 text-sm font-medium text-ink">
              <span className="eyebrow ms-0 me-2">שורה תחתונה</span>
              {takeaway}
            </p>
          )}
          {footer}
          <div className={showTable ? '' : 'sr-only'}>{table}</div>
        </>
      )}
    </section>
  );
}

function hasValue(points: readonly SeriesPoint[], series: readonly SeriesDefinition[]): boolean {
  return points.some((point) =>
    series.some((s) => {
      const value = point.values[s.key];
      return value !== null && value !== undefined && Number.isFinite(value);
    }),
  );
}

/* ------------------------------------------------------------------------- *
 * Line and bar
 * ------------------------------------------------------------------------- */

export function ChartWithTable({
  title,
  description,
  takeaway,
  points,
  series,
  kind = 'bar',
  stacked = false,
  emptyReason,
  formatValue = formatCurrencyShort,
  fullValue = formatCurrencyFull,
  axisFormat,
  firstColumnLabel,
}: {
  title: string;
  description?: string;
  takeaway?: string | null;
  points: readonly SeriesPoint[];
  series: readonly SeriesDefinition[];
  kind?: 'bar' | 'line';
  stacked?: boolean;
  emptyReason: string;
  formatValue?: (value: number | null) => string;
  fullValue?: (value: number | null) => string;
  /** Axis ticks default to the compact money form; counts pass their own. */
  axisFormat?: (value: number | null) => string;
  firstColumnLabel?: string;
}): JSX.Element {
  const data = points.map((p) => ({ label: p.label, ...p.values }));
  const axisFormatter =
    axisFormat ?? (formatValue === formatCurrencyShort ? formatCurrencyAxis : formatValue);
  return (
    <ChartFrame
      title={title}
      description={description}
      takeaway={takeaway}
      hasAnyValue={hasValue(points, series)}
      emptyReason={emptyReason}
      table={
        <ChartTable
          points={points}
          series={series}
          caption={`${title} — נתוני הגרף בטבלה`}
          formatValue={formatValue}
          fullValue={fullValue}
          firstColumnLabel={firstColumnLabel}
        />
      }
    >
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bar' ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="label" reversed tick={AXIS_STYLE} />
              <YAxis
                orientation="right"
                tick={AXIS_STYLE}
                tickFormatter={(v: number) => axisFormatter(v)}
                width={78}
              />
              <Tooltip
                formatter={(value: number | string) => fullValue(Number(value))}
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend wrapperStyle={{ direction: 'rtl', fontSize: 13 }} />
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  radius={stacked ? 0 : [4, 4, 0, 0]}
                  stackId={stacked ? 'stack' : undefined}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="label" reversed tick={AXIS_STYLE} />
              <YAxis
                orientation="right"
                tick={AXIS_STYLE}
                tickFormatter={(v: number) => axisFormatter(v)}
                width={78}
              />
              <Tooltip
                formatter={(value: number | string) => fullValue(Number(value))}
                contentStyle={TOOLTIP_STYLE}
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
    </ChartFrame>
  );
}

export const BUDGET_SERIES: readonly SeriesDefinition[] = [
  { key: 'originalBudget', label: 'תקציב מקורי', color: '#94a3b8' },
  { key: 'updatedBudget', label: 'תקציב מעודכן', color: '#1b5e8a' },
  { key: 'execution', label: 'ביצוע / אומדן', color: '#2f7d54' },
];

/* ------------------------------------------------------------------------- *
 * Waterfall — how one level became another
 * ------------------------------------------------------------------------- */

const WATERFALL_COLORS = {
  base: '#94a3b8',
  total: '#1b5e8a',
  increase: '#2f7d54',
  decrease: '#8c2f39',
  residual: '#8f5f13',
} as const;

export function WaterfallChart({
  title,
  description,
  takeaway,
  steps,
  emptyReason,
  footer,
}: {
  title: string;
  description?: string;
  takeaway?: string | null;
  steps: readonly WaterfallStep[];
  emptyReason: string;
  footer?: JSX.Element;
}): JSX.Element {
  const usable = steps.filter((s) => s.value !== null);
  // A floating bar is drawn as a transparent base plus the visible span.
  const data = steps.map((step) => {
    const start = step.start ?? 0;
    const end = step.end ?? 0;
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    return {
      label: step.labelHe,
      base: step.value === null ? 0 : low,
      span: step.value === null ? 0 : Math.max(high - low, 0),
      kind: step.kind,
      value: step.value,
      note: step.noteHe,
    };
  });

  const points: SeriesPoint[] = steps.map((step) => ({
    label: step.labelHe,
    values: { value: step.value },
  }));

  return (
    <ChartFrame
      title={title}
      description={description}
      takeaway={takeaway}
      hasAnyValue={usable.length > 0}
      emptyReason={emptyReason}
      footer={footer}
      table={
        <ChartTable
          points={points}
          series={[{ key: 'value', label: 'סכום', color: WATERFALL_COLORS.total }]}
          caption={`${title} — נתוני הגרף בטבלה`}
          firstColumnLabel="מדרגה"
        />
      }
    >
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={{ ...AXIS_STYLE, fontSize: 10 }} interval={0} />
            <YAxis
              orientation="right"
              tick={AXIS_STYLE}
              tickFormatter={(v: number) => formatCurrencyAxis(v)}
              width={78}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(_value: number | string, _name: string, entry: { payload?: unknown }) => {
                const payload = entry.payload as { value: number | null } | undefined;
                return formatCurrencyFull(payload?.value ?? null);
              }}
            />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="span" stackId="w" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={WATERFALL_COLORS[entry.kind]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------------- *
 * Treemap — composition of a whole
 * ------------------------------------------------------------------------- */

export interface TreemapDatum {
  name: string;
  size: number;
  color: string;
  /** Optional secondary figure, e.g. an execution rate, shown in the tooltip. */
  secondaryLabel?: string;
}

export function TreemapChart({
  title,
  description,
  takeaway,
  data,
  emptyReason,
  valueLabelHe = 'סכום',
}: {
  title: string;
  description?: string;
  takeaway?: string | null;
  data: readonly TreemapDatum[];
  emptyReason: string;
  valueLabelHe?: string;
}): JSX.Element {
  const usable = data.filter((d) => Number.isFinite(d.size) && d.size > 0);
  const points: SeriesPoint[] = usable.map((d) => ({
    label: d.name,
    values: { size: d.size },
  }));

  return (
    <ChartFrame
      title={title}
      description={description}
      takeaway={takeaway}
      hasAnyValue={usable.length > 0}
      emptyReason={emptyReason}
      table={
        <ChartTable
          points={points}
          series={[{ key: 'size', label: valueLabelHe, color: '#1b5e8a' }]}
          caption={`${title} — נתוני הגרף בטבלה`}
          firstColumnLabel="רכיב"
        />
      }
    >
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={usable as TreemapDatum[]}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="rgb(var(--surface))"
            isAnimationActive={false}
            content={<TreemapCell />}
          >
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number | string) => formatCurrencyFull(Number(value))}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/**
 * Treemap tile. Recharts passes geometry as props; the label is drawn only when the
 * tile is big enough to hold it, so tiles never overlap their own text.
 */
function TreemapCell(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  color?: string;
  size?: number;
}): JSX.Element {
  const { x = 0, y = 0, width = 0, height = 0, name = '', color = '#1b5e8a' } = props;
  const showLabel = width > 72 && height > 34;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        stroke="rgb(var(--surface))"
        strokeWidth={2}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffff"
          fontSize={12}
          direction="rtl"
        >
          {name.length > 22 ? `${name.slice(0, 21)}…` : name}
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------------- *
 * Dot plot — one measure across many sections
 * ------------------------------------------------------------------------- */

export interface DotPlotRow {
  id: string;
  label: string;
  value: number | null;
  /** Rendered as a link when present. */
  href?: string;
  /** Marks the row the reader is looking at. */
  highlighted?: boolean;
}

export function DotPlot({
  title,
  description,
  takeaway,
  rows,
  emptyReason,
  formatValue = formatPercent,
  valueLabelHe = 'ערך',
  referenceLabelHe,
}: {
  title: string;
  description?: string;
  takeaway?: string | null;
  rows: readonly DotPlotRow[];
  emptyReason: string;
  formatValue?: (value: number | null) => string;
  valueLabelHe?: string;
  /** Draws a median line and names it. */
  referenceLabelHe?: string;
}): JSX.Element {
  const usable = rows.filter((r): r is DotPlotRow & { value: number } => r.value !== null);
  const sorted = [...usable].sort((a, b) => b.value - a.value);
  const max = sorted.length > 0 ? Math.max(...sorted.map((r) => r.value)) : 0;
  const min = Math.min(0, ...sorted.map((r) => r.value));
  const span = max - min || 1;
  const median =
    sorted.length > 0
      ? (sorted[Math.floor(sorted.length / 2)] as DotPlotRow & { value: number }).value
      : null;

  const points: SeriesPoint[] = sorted.map((r) => ({ label: r.label, values: { value: r.value } }));

  return (
    <ChartFrame
      title={title}
      description={description}
      takeaway={takeaway}
      hasAnyValue={sorted.length > 0}
      emptyReason={emptyReason}
      table={
        <ChartTable
          points={points}
          series={[{ key: 'value', label: valueLabelHe, color: '#1b5e8a' }]}
          caption={`${title} — נתוני הגרף בטבלה`}
          formatValue={formatValue}
          fullValue={formatValue}
          firstColumnLabel="סעיף"
        />
      }
    >
      <ol className="space-y-1">
        {sorted.map((row) => {
          const left = ((row.value - min) / span) * 100;
          return (
            <li
              key={row.id}
              className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-2"
            >
              <span
                className={`truncate text-xs ${row.highlighted ? 'font-semibold text-ink' : 'text-ink-2'}`}
                title={row.label}
              >
                {row.href !== undefined ? (
                  <a className="link" href={row.href}>
                    {row.label}
                  </a>
                ) : (
                  row.label
                )}
              </span>
              <span className="relative block h-4">
                <span className="absolute inset-y-1/2 right-0 left-0 h-px bg-rule" />
                {median !== null && referenceLabelHe !== undefined && (
                  <span
                    className="absolute inset-y-0 w-px bg-rule-strong"
                    style={{ right: `${((median - min) / span) * 100}%` }}
                  />
                )}
                <span
                  className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full ring-2 ring-surface ${
                    row.highlighted ? 'bg-warm' : 'bg-brand'
                  }`}
                  style={{ right: `${left}%` }}
                />
              </span>
              <span className="num text-xs text-ink-2">{formatValue(row.value)}</span>
            </li>
          );
        })}
      </ol>
      {median !== null && referenceLabelHe !== undefined && (
        <p className="mt-2 text-xs text-ink-3">
          הקו האנכי: {referenceLabelHe} — <span className="num">{formatValue(median)}</span>
        </p>
      )}
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------------- *
 * Slope — the same rows between two periods
 * ------------------------------------------------------------------------- */

export interface SlopeRow {
  id: string;
  label: string;
  from: number | null;
  to: number | null;
  href?: string;
}

export function SlopeChart({
  title,
  description,
  takeaway,
  rows,
  fromLabel,
  toLabel,
  emptyReason,
  formatValue = formatCurrencyShort,
  maxRows = 12,
}: {
  title: string;
  description?: string;
  takeaway?: string | null;
  rows: readonly SlopeRow[];
  fromLabel: string;
  toLabel: string;
  emptyReason: string;
  formatValue?: (value: number | null) => string;
  maxRows?: number;
}): JSX.Element {
  const usable = rows
    .filter((r): r is SlopeRow & { from: number; to: number } => r.from !== null && r.to !== null)
    .sort((a, b) => b.to - a.to)
    .slice(0, maxRows);
  const values = usable.flatMap((r) => [r.from, r.to]);
  const max = values.length > 0 ? Math.max(...values) : 1;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const span = max - min || 1;
  const y = (value: number): number => 92 - ((value - min) / span) * 84;

  const points: SeriesPoint[] = usable.map((r) => ({
    label: r.label,
    values: { from: r.from, to: r.to },
  }));
  const titleId = useId();

  return (
    <ChartFrame
      title={title}
      description={description}
      takeaway={takeaway}
      hasAnyValue={usable.length > 0}
      emptyReason={emptyReason}
      table={
        <ChartTable
          points={points}
          series={[
            { key: 'from', label: fromLabel, color: '#94a3b8' },
            { key: 'to', label: toLabel, color: '#1b5e8a' },
          ]}
          caption={`${title} — נתוני הגרף בטבלה`}
          formatValue={formatValue}
          fullValue={formatValue}
          firstColumnLabel="סעיף"
        />
      }
    >
      <div className="w-full overflow-x-auto">
        <svg
          viewBox="0 0 100 100"
          className="h-72 w-full min-w-[20rem]"
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>{title}</title>
          <line x1="18" y1="4" x2="18" y2="96" stroke={GRID_STROKE} strokeWidth="0.4" />
          <line x1="82" y1="4" x2="82" y2="96" stroke={GRID_STROKE} strokeWidth="0.4" />
          {usable.map((row) => (
            <g key={row.id}>
              <line
                x1="18"
                y1={y(row.to)}
                x2="82"
                y2={y(row.from)}
                stroke={row.to >= row.from ? '#2f7d54' : '#8c2f39'}
                strokeWidth="0.9"
                opacity="0.9"
              />
              <circle cx="18" cy={y(row.to)} r="1.4" fill="#1b5e8a" />
              <circle cx="82" cy={y(row.from)} r="1.4" fill="#94a3b8" />
              <text
                x="16.5"
                y={y(row.to)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="2.6"
                fill="rgb(var(--ink-2))"
                direction="rtl"
              >
                {row.label.length > 18 ? `${row.label.slice(0, 17)}…` : row.label}
              </text>
            </g>
          ))}
          <text x="18" y="2.6" textAnchor="middle" fontSize="3" fill="rgb(var(--ink-3))">
            {toLabel}
          </text>
          <text x="82" y="2.6" textAnchor="middle" fontSize="3" fill="rgb(var(--ink-3))">
            {fromLabel}
          </text>
        </svg>
      </div>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------------- *
 * Sparkline — a trend beside its number
 * ------------------------------------------------------------------------- */

export function Sparkline({
  values,
  label,
  className = '',
}: {
  values: readonly (number | null)[];
  /** Read by assistive tech in place of the drawing. */
  label: string;
  className?: string;
}): JSX.Element | null {
  const usable = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (usable.length < 2) return null;
  const max = Math.max(...usable);
  const min = Math.min(...usable);
  const span = max - min || 1;
  const step = 100 / (values.length - 1);
  const points = values
    .map((value, index) =>
      value === null ? null : `${100 - index * step},${28 - ((value - min) / span) * 24}`,
    )
    .filter((p): p is string => p !== null)
    .join(' ');
  const lastValue = usable[usable.length - 1] as number;
  // findLastIndex is ES2023; the app targets ES2021, so scan backwards by hand.
  let lastIndex = values.length - 1;
  while (lastIndex > 0 && values[lastIndex] === null) lastIndex -= 1;

  return (
    <svg
      viewBox="0 0 100 30"
      className={`h-6 w-20 ${className}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke="rgb(var(--brand))" strokeWidth="1.6" />
      <circle
        cx={100 - lastIndex * step}
        cy={28 - ((lastValue - min) / span) * 24}
        r="2"
        fill="rgb(var(--brand))"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------------- *
 * Small multiples — every section on one scale
 * ------------------------------------------------------------------------- */

export interface SmallMultiple {
  id: string;
  label: string;
  values: readonly (number | null)[];
  href?: string;
}

export function SmallMultiples({
  title,
  description,
  takeaway,
  panels,
  periodLabels,
  emptyReason,
  formatValue = formatCurrencyShort,
}: {
  title: string;
  description?: string;
  takeaway?: string | null;
  panels: readonly SmallMultiple[];
  periodLabels: readonly string[];
  emptyReason: string;
  formatValue?: (value: number | null) => string;
}): JSX.Element {
  const usable = panels.filter((p) => p.values.some((v) => v !== null));
  // One shared scale across panels, so the panels are comparable by eye — the
  // whole point of the form.
  const all = usable.flatMap((p) => p.values).filter((v): v is number => v !== null);
  const max = all.length > 0 ? Math.max(...all) : 1;

  const points: SeriesPoint[] = usable.map((panel) => ({
    label: panel.label,
    values: Object.fromEntries(periodLabels.map((period, i) => [period, panel.values[i] ?? null])),
  }));

  return (
    <ChartFrame
      title={title}
      description={description}
      takeaway={takeaway}
      hasAnyValue={usable.length > 0}
      emptyReason={emptyReason}
      table={
        <ChartTable
          points={points}
          series={periodLabels.map((period) => ({
            key: period,
            label: period,
            color: '#1b5e8a',
          }))}
          caption={`${title} — נתוני הגרף בטבלה`}
          formatValue={formatValue}
          fullValue={formatValue}
          firstColumnLabel="סעיף"
        />
      }
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {usable.map((panel) => (
          <li key={panel.id} className="rounded-md bg-surface-2 p-2">
            <p className="truncate text-xs font-medium text-ink-2" title={panel.label}>
              {panel.href !== undefined ? (
                <a className="link" href={panel.href}>
                  {panel.label}
                </a>
              ) : (
                panel.label
              )}
            </p>
            <div className="mt-1 flex h-12 items-end gap-0.5">
              {panel.values.map((value, index) => (
                <span
                  key={periodLabels[index] ?? index}
                  className="flex-1 rounded-t bg-brand"
                  style={{
                    height: value === null ? '2px' : `${Math.max(2, (value / max) * 100)}%`,
                    opacity: value === null ? 0.25 : 1,
                  }}
                  title={`${periodLabels[index] ?? ''}: ${formatValue(value)}`}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
