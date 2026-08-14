/**
 * An insight as the reader meets it: a number, one sentence that says what it
 * means, and one that says what it does not.
 *
 * The second sentence is not decoration. A true figure read as a claim it cannot
 * carry is the most likely way this site misleads, so `notSayingHe` is a required
 * field on the data and is rendered on the card itself rather than hidden behind a
 * methodology link.
 */
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SummaryInsight } from '../types/summary';
import { Badge, QualityNote, SourceLink } from './ui';

const KIND_LABELS: Record<SummaryInsight['kind'], string> = {
  budget: 'תקציב',
  execution: 'ביצוע',
  procurement: 'התקשרויות',
  diary: 'יומנים',
  coverage: 'כיסוי הנתונים',
};

/** Turns the stored hash href into a router path. */
function toRoutePath(href: string): string {
  return href.startsWith('#') ? href.slice(1) : href;
}

export function InsightCard({
  insight,
  featured = false,
}: {
  insight: SummaryInsight;
  featured?: boolean;
}): JSX.Element {
  return (
    <article
      className={`card flex h-full flex-col p-4 sm:p-5 ${
        featured ? 'border-brand/40 bg-brand-soft/40' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <Badge tone={featured ? 'primary' : 'muted'}>{KIND_LABELS[insight.kind]}</Badge>
      </div>
      <p
        className={`num mt-2 font-semibold text-ink ${featured ? 'text-3xl sm:text-4xl' : 'text-2xl'}`}
      >
        {insight.headline}
      </p>
      <p className={`mt-2 text-ink ${featured ? 'text-base' : 'text-sm'}`}>{insight.sentenceHe}</p>
      <QualityNote label="מה זה לא אומר">
        <p>{insight.notSayingHe}</p>
      </QualityNote>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
        <Link
          className="link inline-flex items-center gap-1 text-sm"
          to={toRoutePath(insight.href)}
        >
          לבדיקה במסך המלא
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        {insight.sourceUrl !== null && insight.sourceTitleHe !== null && (
          <SourceLink url={insight.sourceUrl} title={insight.sourceTitleHe} />
        )}
      </div>
    </article>
  );
}
