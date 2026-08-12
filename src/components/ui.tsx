/**
 * Small shared presentation primitives.
 *
 * Two of these carry product rules rather than styling:
 *  - `DataUnavailable` is the single way the site says "we don't have this".
 *    It always states *why*, so absence is never mistaken for zero.
 *  - `Measure` renders a figure together with its status and source, so a number
 *    can never appear on screen detached from its provenance.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, ExternalLink, FileWarning, Info, Loader2, ShieldAlert } from 'lucide-react';
import { MISSING_LABEL, dataStatusLabel } from '../lib/format';
import type { DataStatus } from '../types/domain';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={`card card-pad ${className}`}>{children}</div>;
}

export function SectionHeading({
  title,
  description,
  id,
  action,
}: {
  title: string;
  description?: string;
  id?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-lg sm:text-xl">
          {title}
        </h2>
        {description !== undefined && (
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

type CalloutTone = 'info' | 'warning' | 'caution';

const TONE_STYLES: Record<CalloutTone, { box: string; icon: JSX.Element }> = {
  info: {
    box: 'border-brand-100 bg-brand-50 text-brand-900',
    icon: <Info className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />,
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />,
  },
  caution: {
    box: 'border-slate-300 bg-slate-100 text-slate-800',
    icon: <ShieldAlert className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />,
  },
};

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}): JSX.Element {
  const styles = TONE_STYLES[tone];
  return (
    <div className={`flex gap-3 rounded-lg border p-4 text-sm leading-relaxed ${styles.box}`}>
      {styles.icon}
      <div className="min-w-0">
        {title !== undefined && <p className="mb-1 font-semibold">{title}</p>}
        <div className="space-y-2">{children}</div>
      </div>
    </div>
  );
}

/**
 * The site's single "no data" presentation. `reason` is mandatory on purpose:
 * an empty panel must always explain itself.
 */
export function DataUnavailable({
  reason,
  title = MISSING_LABEL,
}: {
  reason: string;
  title?: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm">
      <FileWarning className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
      <div>
        <p className="font-semibold text-slate-800">{title}</p>
        <p className="mt-1 max-w-2xl text-slate-600">{reason}</p>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<DataStatus, string> = {
  final: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  partial: 'bg-amber-50 text-amber-800 border-amber-200',
  estimate: 'bg-sky-50 text-sky-800 border-sky-200',
  unavailable: 'bg-slate-100 text-slate-700 border-slate-300',
};

export function DataStatusBadge({ status }: { status: DataStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {dataStatusLabel(status)}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'muted';
}): JSX.Element {
  const styles =
    tone === 'primary'
      ? 'bg-brand-50 text-brand-800 border-brand-100'
      : tone === 'muted'
        ? 'bg-slate-50 text-slate-600 border-slate-200'
        : 'bg-slate-100 text-slate-700 border-slate-300';
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${styles}`}>
      {children}
    </span>
  );
}

/** An outbound link to an original source. Always labelled for screen readers. */
export function SourceLink({
  url,
  title,
  label = 'למקור',
}: {
  url: string;
  title: string;
  label?: string;
}): JSX.Element {
  return (
    <a
      className="link inline-flex items-center gap-1 text-sm"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}: ${title} (נפתח בחלון חדש)`}
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

/**
 * A figure with its status and source attached. This is the only component that
 * renders a monetary or percentage value in a KPI position, which is how the
 * "every number carries a source" rule is kept structural rather than editorial.
 */
export function Measure({
  label,
  display,
  fullValue,
  status,
  sourceUrl,
  sourceTitle,
  note,
}: {
  label: string;
  display: string;
  fullValue?: string;
  status: DataStatus;
  sourceUrl?: string;
  sourceTitle?: string;
  note?: string;
}): JSX.Element {
  return (
    <div className="card card-pad flex h-full flex-col">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="num mt-2 text-2xl font-semibold text-slate-900" title={fullValue ?? display}>
        {display}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DataStatusBadge status={status} />
        {sourceUrl !== undefined && sourceTitle !== undefined && (
          <SourceLink url={sourceUrl} title={sourceTitle} />
        )}
      </div>
      {note !== undefined && <p className="mt-2 text-xs leading-relaxed text-slate-500">{note}</p>}
    </div>
  );
}

export function LoadingState({ label = 'טוען נתונים…' }: { label?: string }): JSX.Element {
  return (
    <div
      className="flex items-center justify-center gap-3 p-12 text-slate-600"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }): JSX.Element {
  return (
    <div className="p-8" role="alert">
      <Callout tone="warning" title="טעינת הנתונים נכשלה">
        <p>{message}</p>
        <p>
          קובצי הנתונים זמינים ישירות בתיקיית <code>data/processed</code> שב-repository, גם אם
          הדשבורד אינו נטען.
        </p>
      </Callout>
    </div>
  );
}
