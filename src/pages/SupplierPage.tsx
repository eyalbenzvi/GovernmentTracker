/**
 * One supplier or support recipient, across the sections that contracted with it.
 *
 * The findings screen could show that a section's money is concentrated, and the
 * diary screen could show that someone met a supplier, but nothing joined the two on
 * the supplier's side. This page does, including the timing analysis — how close a
 * meeting sat to an order date — always next to the baseline that keeps a single
 * coincidence from reading as a pattern.
 */
import { Link, useParams } from 'react-router-dom';
import type { Dataset } from '../types/domain';
import { Badge, Callout, Card, QualityNote, SectionHeading, SourceLink } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { formatCurrencyShort, formatDate, formatNumber } from '../lib/format';
import { personId } from '../lib/tenure';
import {
  TIMING_BASELINE_NOTE_HE,
  TIMING_RULE_HE,
  TIMING_WINDOW_DAYS,
  analyseTiming,
} from '../lib/timing';

/**
 * URL-safe id for a supplier name. Like `personId`, it is not percent-encoded: the
 * router encodes and decodes path segments itself, so the id has to be the plain
 * form both sides agree on. Matching is done by comparing ids, never raw names.
 */
export function supplierId(name: string): string {
  return name.trim().replace(/\s+/g, ' ').replace(/\//g, '-');
}

interface Appearance {
  ministryId: string;
  ministryLabel: string;
  contractCount: number;
  totalVolume: number | null;
  totalExecuted: number | null;
  entityUrl: string | null;
  kind: 'supplier' | 'support';
}

export function SupplierPage({ data }: { data: Dataset }): JSX.Element {
  const { supplierId: routeId } = useParams();
  const routeKey = routeId ?? '';

  const appearances: Appearance[] = [];
  let name = routeKey;
  for (const [ministryId, list] of Object.entries(data.findings.suppliers)) {
    for (const supplier of list) {
      if (supplierId(supplier.name) !== routeKey) continue;
      name = supplier.name;
      appearances.push({
        ministryId,
        ministryLabel: data.ministries.find((m) => m.id === ministryId)?.displayName ?? ministryId,
        contractCount: supplier.contractCount,
        totalVolume: supplier.totalVolume,
        totalExecuted: supplier.totalExecuted,
        entityUrl: supplier.entityUrl,
        kind: 'supplier',
      });
    }
  }
  for (const [ministryId, list] of Object.entries(data.findings.supportRecipients)) {
    for (const recipient of list) {
      if (supplierId(recipient.name) !== routeKey) continue;
      name = recipient.name;
      appearances.push({
        ministryId,
        ministryLabel: data.ministries.find((m) => m.id === ministryId)?.displayName ?? ministryId,
        contractCount: recipient.requestCount,
        totalVolume: recipient.totalApproved,
        totalExecuted: recipient.totalPaid,
        entityUrl: recipient.entityUrl,
        kind: 'support',
      });
    }
  }

  if (appearances.length === 0) {
    return (
      <div className="space-y-6">
        <h1>לא נמצאה ישות בשם הזה</h1>
        <Callout tone="caution" title="מה כן נאסף">
          <p>
            האתר מחזיק את הספקים הגדולים ומקבלי התמיכות הגדולים בכל סעיף, ולא את כלל ההתקשרויות.
            ישות שאינה בין הגדולות בסעיף שלה לא תופיע כאן.
          </p>
        </Callout>
        <p>
          <Link className="link" to="/findings">
            למסך הממצאים
          </Link>
        </p>
      </div>
    );
  }

  const crossMatches = data.diaryInsights.crossMatches.filter(
    (c) => supplierId(c.matchedName) === routeKey,
  );
  const ministryIds = [...new Set(appearances.map((a) => a.ministryId))];
  const timings = ministryIds.map((ministryId) => ({
    ministryId,
    ministryLabel: data.ministries.find((m) => m.id === ministryId)?.displayName ?? ministryId,
    analysis: analyseTiming(
      crossMatches,
      data.findings.notableContracts[ministryId] ?? [],
      ministryId,
    ),
  }));
  const timedAll = timings.flatMap((t) => t.analysis.timed);
  const entityUrl = appearances.find((a) => a.entityUrl !== null)?.entityUrl ?? null;

  const columns: Column<Appearance>[] = [
    {
      key: 'ministry',
      header: 'סעיף',
      render: (row) => (
        <Link className="link" to={`/ministry/${row.ministryId}`}>
          {row.ministryLabel}
        </Link>
      ),
      sortValue: (row) => row.ministryLabel,
    },
    {
      key: 'kind',
      header: 'סוג',
      render: (row) => (
        <Badge tone={row.kind === 'supplier' ? 'primary' : 'warm'}>
          {row.kind === 'supplier' ? 'התקשרויות' : 'תמיכות'}
        </Badge>
      ),
      sortValue: (row) => row.kind,
    },
    {
      key: 'count',
      header: 'מספר רשומות',
      render: (row) => formatNumber(row.contractCount),
      sortValue: (row) => row.contractCount,
      align: 'end',
    },
    {
      key: 'volume',
      header: 'נפח / אושר',
      render: (row) => formatCurrencyShort(row.totalVolume),
      sortValue: (row) => row.totalVolume,
      align: 'end',
    },
    {
      key: 'executed',
      header: 'בוצע / שולם',
      render: (row) => formatCurrencyShort(row.totalExecuted),
      sortValue: (row) => row.totalExecuted,
      align: 'end',
    },
  ];

  return (
    <div className="space-y-8">
      <section>
        <p className="eyebrow">ספק או מקבל תמיכה</p>
        <h1 className="mt-1">{name}</h1>
        {entityUrl !== null && (
          <p className="mt-2">
            <SourceLink url={entityUrl} title={name} label="לישות במפתח התקציב" />
          </p>
        )}
      </section>

      <section aria-labelledby="appearances-heading">
        <SectionHeading
          id="appearances-heading"
          title="היכן הישות מופיעה"
          description="רק בסעיפים שבהם היא בין הגדולות שנאספו — לא כלל ההתקשרויות במדינה."
        />
        <DataTable
          items={appearances}
          columns={columns}
          caption="הופעות הישות לפי סעיף"
          rowKey={(row) => `${row.ministryId}-${row.kind}`}
          emptyMessage="אין הופעות."
        />
      </section>

      <section aria-labelledby="timing-heading">
        <SectionHeading
          id="timing-heading"
          title="פגישות ביומנים, ביחס למועדי ההתקשרות"
          description={`הפגישות שהוצלבו לישות הזו, והמרווח בימים מול מועד ההזמנה הקרוב ביותר. "בחלון" = עד ${TIMING_WINDOW_DAYS} יום לפני ההזמנה.`}
        />
        {crossMatches.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-2">
              לא נמצאה שורת יומן שנקוב בה שם הישות הזו. היעדר הצלבה אינו אומר שלא היו פגישות:
              היומנים מכסים דרג בכיר בלבד, ורק במשרדים שפרסמו וקריאתם הצליחה.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <p className="text-sm text-ink-2">פגישות שהוצלבו</p>
                <p className="num mt-1 text-2xl font-semibold text-ink">
                  {formatNumber(crossMatches.length)}
                </p>
              </Card>
              <Card>
                <p className="text-sm text-ink-2">מהן בחלון שלפני ההזמנה</p>
                <p className="num mt-1 text-2xl font-semibold text-ink">
                  {formatNumber(timings.reduce((acc, t) => acc + t.analysis.withinWindowCount, 0))}
                </p>
              </Card>
              <Card>
                <p className="text-sm text-ink-2">בסיס השוואה: התקשרויות בלי הצלבה</p>
                <p className="num mt-1 text-2xl font-semibold text-ink">
                  {formatNumber(
                    timings.reduce((acc, t) => acc + t.analysis.contractsWithoutMatch, 0),
                  )}
                </p>
              </Card>
            </div>

            {timedAll.length > 0 && (
              <Card>
                <h3>הפגישות שניתן היה למקם בזמן</h3>
                <ul className="mt-2 space-y-2">
                  {timedAll.slice(0, 15).map((timing) => (
                    <li
                      key={`${timing.crossMatch.entryId}-${timing.contract.orderDate}`}
                      className="border-b border-rule pb-2 text-sm last:border-0"
                    >
                      <p className="text-ink">{timing.crossMatch.subject}</p>
                      <p className="mt-0.5 text-xs text-ink-2">
                        פגישה ב-<span className="num">{formatDate(timing.crossMatch.date)}</span> ·
                        הזמנה ב-<span className="num">{formatDate(timing.contract.orderDate)}</span>{' '}
                        ·{' '}
                        <span className="num font-medium">
                          {timing.daysBeforeOrder >= 0
                            ? `${timing.daysBeforeOrder} ימים לפני`
                            : `${Math.abs(timing.daysBeforeOrder)} ימים אחרי`}
                        </span>
                        {timing.withinWindow && (
                          <>
                            {' · '}
                            <Badge tone="warm">בחלון</Badge>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Callout tone="warning" title="איך לא לקרוא את המסך הזה">
              <p>{TIMING_RULE_HE}</p>
              <p>{TIMING_BASELINE_NOTE_HE}</p>
            </Callout>
          </div>
        )}
      </section>

      {crossMatches.length > 0 && (
        <section aria-labelledby="who-heading">
          <SectionHeading id="who-heading" title="מי נפגש" />
          <ul className="flex flex-wrap gap-2">
            {[
              ...new Set(
                crossMatches.map((c) => c.personLabel).filter((p): p is string => p !== null),
              ),
            ].map((person) => (
              <li key={person}>
                <Link className="btn btn-sm" to={`/person/${personId(person)}`}>
                  {person}
                </Link>
              </li>
            ))}
          </ul>
          <QualityNote>
            <p>
              רשימת הנפגשים נגזרת מהיומנים שפורסמו ונקראו. אדם שאינו כאן אינו בהכרח אדם שלא נפגש.
            </p>
          </QualityNote>
        </section>
      )}
    </div>
  );
}
