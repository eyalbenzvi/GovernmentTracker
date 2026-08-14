/**
 * Who runs this, how to contest a figure, and what has already been corrected.
 *
 * The site publishes measures about named office-holders and had no operator
 * identity, no route for a reply, and no record of its own corrections. Those three
 * absences are a risk rather than a missing feature, which is why this screen is
 * plain text and no charts: it is a commitment, and it should read like one.
 */
import { Card, Callout, SectionHeading } from '../components/ui';
import {
  CORRECTIONS,
  CORRECTIONS_POLICY_HE,
  OPERATOR_HE,
  RIGHT_OF_REPLY_HE,
} from '../lib/corrections';
import { formatDate, formatNumber } from '../lib/format';
import { ISSUES_URL, REPO_URL } from '../lib/site';

export function CorrectionsPage(): JSX.Element {
  return (
    <div className="space-y-8">
      <section>
        <h1>מי מפעיל, איך מתקנים, ואיפה התגובה</h1>
        <p className="mt-2 max-w-3xl text-ink-2">
          האתר מפרסם מדדים על גופים ועל אנשים בשמם. שלושת הדברים בעמוד הזה — זהות, זכות תגובה ויומן
          תיקונים — הם התנאי לכך שפרסום כזה יהיה כלי שקיפות ולא פרסום חד-צדדי.
        </p>
      </section>

      <section aria-labelledby="operator-heading">
        <SectionHeading id="operator-heading" title="מי מפעיל את האתר" />
        <Card>
          <p className="text-sm leading-relaxed text-ink-2">{OPERATOR_HE}</p>
          <p className="mt-3 flex flex-wrap gap-4 text-sm">
            <a className="link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              קוד המקור וכל קובצי הנתונים
            </a>
            <a className="link" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
              פנייה, דיווח על טעות או בקשת תיקון
            </a>
          </p>
        </Card>
      </section>

      <section aria-labelledby="reply-heading">
        <SectionHeading id="reply-heading" title="זכות תגובה" />
        <Callout tone="info">
          <p>{RIGHT_OF_REPLY_HE}</p>
        </Callout>
      </section>

      <section aria-labelledby="log-heading">
        <SectionHeading
          id="log-heading"
          title="יומן תיקונים"
          description={`${formatNumber(CORRECTIONS.length)} רשומות. כל אחת מציגה מה הוצג לפני התיקון, מה מוצג אחריו, ומי מצא אותה.`}
        />
        <p className="mb-4 max-w-3xl text-sm text-ink-2">{CORRECTIONS_POLICY_HE}</p>
        <ol className="space-y-3">
          {CORRECTIONS.map((correction) => (
            <li key={correction.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="num text-xs font-medium text-ink-3">
                    {formatDate(correction.date)}
                  </p>
                  <p className="text-xs text-ink-3">{correction.foundByHe}</p>
                </div>
                <dl className="mt-2 space-y-2 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-ink-3">מה הוצג לפני</dt>
                    <dd className="text-ink-2">{correction.wasShownHe}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-ink-3">מה מוצג עכשיו</dt>
                    <dd className="text-ink">{correction.nowShownHe}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-ink-3">
                  תוקן ב: <code>{correction.whereFixed}</code>
                </p>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
