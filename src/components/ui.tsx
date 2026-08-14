/**
 * Small shared presentation primitives.
 *
 * Several of these carry product rules rather than styling:
 *  - `DataUnavailable` is the single way the site says "we don't have this".
 *    It always states *why*, so absence is never mistaken for zero.
 *  - `Measure` renders a figure together with its status, its context (share, rank,
 *    change) and its source, so a number can never appear detached from provenance.
 *  - `QualityNote` is how a caveat reaches the reader from now on: folded into the
 *    figure it qualifies, opened on demand. The screens used to stack seven to nine
 *    warning boxes, which taught readers to skip yellow boxes — including the ones
 *    that mattered. A prominent `Callout` is now reserved for a limitation that
 *    changes the conclusion.
 *  - `ReportErrorLink` and the corrections log exist because this site publishes
 *    measures about named people, and a reader needs a way to contest a figure.
 */
import { useId, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  FileWarning,
  Flag,
  Info,
  Link2,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { MISSING_LABEL, dataStatusLabel, formatNumber, formatPercent } from '../lib/format';
import type { DataStatus } from '../types/domain';
import { CHANGE_IS_NOMINAL_HE } from '../lib/context';
import { ISSUES_URL } from '../lib/site';

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
        <h2 id={id}>{title}</h2>
        {description !== undefined && (
          <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

type CalloutTone = 'info' | 'warning' | 'caution';

const TONE_STYLES: Record<CalloutTone, { box: string; icon: JSX.Element }> = {
  info: {
    box: 'border-brand/30 bg-brand-soft text-ink',
    icon: <Info className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />,
  },
  warning: {
    box: 'border-state-partial/40 bg-state-partial-soft text-ink',
    icon: <AlertTriangle className="h-5 w-5 shrink-0 text-state-partial" aria-hidden="true" />,
  },
  caution: {
    box: 'border-rule-strong bg-surface-2 text-ink-2',
    icon: <ShieldAlert className="h-5 w-5 shrink-0 text-ink-3" aria-hidden="true" />,
  },
};

/**
 * A prominent box. Use only when the limitation changes what the reader should
 * conclude; for everything else use QualityNote, which folds.
 */
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
 * A caveat the reader can open. Quiet by default, complete when expanded — the
 * replacement for a wall of warning boxes.
 */
export function QualityNote({
  label = 'איך לקרוא את המספר הזה',
  children,
}: {
  label?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <details className="group mt-2 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-ink-3 hover:text-ink-2">
        <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
        {label}
      </summary>
      <div className="mt-2 space-y-2 border-s-2 border-rule ps-3 text-sm leading-relaxed text-ink-2">
        {children}
      </div>
    </details>
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
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-rule-strong bg-surface-2 p-5 text-sm">
      <FileWarning className="h-5 w-5 shrink-0 text-ink-3" aria-hidden="true" />
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-1 max-w-2xl text-ink-2">{reason}</p>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<DataStatus, string> = {
  final: 'bg-state-final-soft text-state-final border-state-final/30',
  partial: 'bg-state-partial-soft text-state-partial border-state-partial/30',
  estimate: 'bg-state-estimate-soft text-state-estimate border-state-estimate/30',
  unavailable: 'bg-state-missing-soft text-state-missing border-state-missing/30',
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
  tone?: 'neutral' | 'primary' | 'muted' | 'warm';
}): JSX.Element {
  const styles =
    tone === 'primary'
      ? 'bg-brand-soft text-brand border-brand/30'
      : tone === 'muted'
        ? 'bg-surface-2 text-ink-3 border-rule'
        : tone === 'warm'
          ? 'bg-warm-soft text-warm border-warm/30'
          : 'bg-surface-2 text-ink-2 border-rule-strong';
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

export interface MeasureContext {
  /** "2.1% מהתקציב הרגיל" */
  sharePercent?: number | null;
  shareLabelHe?: string;
  /** Nominal change against an earlier period. */
  changePercent?: number | null;
  changeLabelHe?: string;
  /** "החמישי בגודלו מבין 43" */
  rank?: number | null;
  rankOutOf?: number | null;
  rankLabelHe?: string;
  /** Values for an inline sparkline, oldest first. */
  trend?: readonly (number | null)[];
}

/** The three comparisons that turn a bare figure into a readable one. */
function ContextRow({ context }: { context: MeasureContext }): JSX.Element | null {
  const parts: JSX.Element[] = [];

  if (context.sharePercent !== null && context.sharePercent !== undefined) {
    parts.push(
      <span key="share">
        <span className="num font-medium text-ink">{formatPercent(context.sharePercent)}</span>{' '}
        {context.shareLabelHe ?? 'מהסך'}
      </span>,
    );
  }
  if (context.changePercent !== null && context.changePercent !== undefined) {
    const up = context.changePercent > 0;
    parts.push(
      <span key="change" title={CHANGE_IS_NOMINAL_HE}>
        <span className={`num font-medium ${up ? 'text-up' : 'text-down'}`}>
          {up ? '+' : ''}
          {formatPercent(context.changePercent)}
        </span>{' '}
        {context.changeLabelHe ?? 'מהתקופה הקודמת'} <span className="text-ink-3">(נומינלי)</span>
      </span>,
    );
  }
  if (
    context.rank !== null &&
    context.rank !== undefined &&
    context.rankOutOf !== null &&
    context.rankOutOf !== undefined
  ) {
    parts.push(
      <span key="rank">
        מקום <span className="num font-medium text-ink">{formatNumber(context.rank)}</span> מתוך{' '}
        <span className="num">{formatNumber(context.rankOutOf)}</span>{' '}
        {context.rankLabelHe ?? 'סעיפים'}
      </span>,
    );
  }

  if (parts.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">{parts}</p>
  );
}

/**
 * A figure with its status, context and source attached. This is the only component
 * that renders a value in a KPI position, which is how the "every number carries a
 * source and a scale" rule stays structural rather than editorial.
 */
export function Measure({
  label,
  display,
  fullValue,
  status,
  sourceUrl,
  sourceTitle,
  note,
  context,
  children,
}: {
  label: string;
  display: string;
  fullValue?: string;
  status: DataStatus;
  sourceUrl?: string;
  sourceTitle?: string;
  /** Short caveat, folded. Long-form belongs on the "how to read" screen. */
  note?: string;
  context?: MeasureContext;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="card card-pad flex h-full flex-col">
      <p className="text-sm font-medium text-ink-2">{label}</p>
      <p className="num mt-1.5 text-2xl font-semibold text-ink" title={fullValue ?? display}>
        {display}
      </p>
      {context !== undefined && <ContextRow context={context} />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DataStatusBadge status={status} />
        {sourceUrl !== undefined && sourceTitle !== undefined && (
          <SourceLink url={sourceUrl} title={sourceTitle} />
        )}
      </div>
      {note !== undefined && <QualityNote>{<p>{note}</p>}</QualityNote>}
      {children}
    </div>
  );
}

/** A 0–100 index with its own bar, used by the scorecards. */
export function ScoreBar({
  score,
  label,
  max = 100,
  tone = 'brand',
}: {
  score: number | null;
  label: string;
  max?: number;
  tone?: 'brand' | 'warm';
}): JSX.Element {
  if (score === null) {
    return <span className="text-xs text-ink-3">אין נתון</span>;
  }
  const width = Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <span className="flex items-center gap-2" title={label}>
      <span className="relative h-2 w-20 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
        <span
          className={`absolute inset-y-0 right-0 rounded-full ${tone === 'warm' ? 'bg-warm' : 'bg-brand'}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="num text-xs font-medium text-ink">{formatNumber(score)}</span>
    </span>
  );
}

/** Copies a deep link to the current view, so a reader can cite what they see. */
export function CopyLinkButton({ label = 'העתקת קישור לתצוגה' }: { label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(window.location.href)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2500);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? (
        <Check className="h-4 w-4 text-state-final" aria-hidden="true" />
      ) : (
        <Link2 className="h-4 w-4" aria-hidden="true" />
      )}
      {copied ? 'הקישור הועתק' : label}
    </button>
  );
}

/**
 * Opens a correction request with the figure's own context pre-filled. The site
 * publishes measures about named office-holders; a reader who believes a figure is
 * wrong needs a route that does not depend on knowing how to file a GitHub issue.
 */
export function ReportErrorLink({
  subject,
  context,
  label = 'דווח על טעות',
}: {
  subject: string;
  context?: string;
  label?: string;
}): JSX.Element {
  const body = [
    `הפריט: ${subject}`,
    context !== undefined ? `ההקשר: ${context}` : null,
    `הכתובת: ${typeof window === 'undefined' ? '' : window.location.href}`,
    '',
    'מה שגוי, ומה המקור שממנו ניתן לאמת את התיקון:',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  const href = `${ISSUES_URL}/new?title=${encodeURIComponent(`תיקון: ${subject}`)}&body=${encodeURIComponent(body)}`;
  return (
    <a
      className="inline-flex items-center gap-1 text-xs text-ink-3 underline decoration-dotted hover:text-ink-2"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Flag className="h-3 w-3" aria-hidden="true" />
      {label}
    </a>
  );
}

export function LoadingState({ label = 'טוען נתונים…' }: { label?: string }): JSX.Element {
  return (
    <div
      className="flex items-center justify-center gap-3 p-12 text-ink-2"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * A shaped placeholder for a screen whose heavy dataset is still arriving. Better
 * than a spinner on a data-dense page: the reader sees where the content will land.
 */
export function SkeletonScreen({ label = 'טוען נתונים…' }: { label?: string }): JSX.Element {
  const id = useId();
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-label={label}>
      <div className="h-7 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={`${id}-kpi-${i}`} className="card card-pad">
            <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
            <div className="mt-3 h-7 w-32 animate-pulse rounded bg-surface-2" />
            <div className="mt-3 h-3 w-40 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
      <div className="card card-pad">
        <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
        <div className="mt-4 h-64 w-full animate-pulse rounded bg-surface-2" />
      </div>
      <span className="sr-only">{label}</span>
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
