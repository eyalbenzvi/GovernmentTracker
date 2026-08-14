import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityEvidence, BudgetItem, Dataset } from '../types/domain';
import {
  Badge,
  Callout,
  Card,
  CopyLinkButton,
  DataStatusBadge,
  DataUnavailable,
  Measure,
  QualityNote,
  SectionHeading,
  SourceLink,
} from '../components/ui';
import { CsvDownloadButton, FilterGrid, SearchField, SelectField } from '../components/controls';
import { BUDGET_SERIES, ChartWithTable, WaterfallChart } from '../components/charts';
import { TenureRibbon } from '../components/TenureRibbon';
import { DataTable, type Column } from '../components/DataTable';
import { aggregateByYear, toSeriesPoints } from '../lib/budgetSeries';
import { buildWaterfall, WATERFALL_RULE_HE } from '../lib/waterfall';
import { changePercent, rankOf, shareOf } from '../lib/context';
import { budgetTrendSentence } from '../lib/insights';
import {
  budgetChangeAbsolute,
  budgetChangePercent,
  executionRate,
  sumWithoutDoubleCounting,
  EXECUTION_RATE_OUTLIER_HINT,
  isExecutionRateOutlier,
  isLargeChange,
  LARGE_CHANGE_RULE_HE,
} from '../lib/calc';
import {
  activitySourceTypeLabel,
  coverageLevelLabel,
  formatCurrencyFull,
  formatCurrencyShort,
  formatDate,
  formatNumber,
  formatPercent,
  MISSING_SHORT,
  retrievalStatusLabel,
} from '../lib/format';
import {
  activitiesFor,
  budgetItemsFor,
  coverageFor,
  matchesQuery,
  ministryById,
  sourcesFor,
  uniqueSorted,
} from '../lib/selectors';
import { NotFoundPage } from './NotFoundPage';

const ALL = 'all';

export function MinistryPage({
  data,
  ministryId,
}: {
  data: Dataset;
  ministryId: string | undefined;
}): JSX.Element {
  const ministry = ministryById(data, ministryId);
  if (ministry === undefined) {
    return <NotFoundPage message="המשרד המבוקש אינו קיים במאגר, או שטרם נאסף." />;
  }

  const coverage = coverageFor(data, ministry.id);
  const budgetItems = budgetItemsFor(data, ministry.id);
  const activities = activitiesFor(data, ministry.id);
  const sources = sourcesFor(data, ministry.id);
  const tenures = data.ministerTenures.filter((t) => t.ministryId === ministry.id);
  const links = data.links.filter((l) => l.ministryId === ministry.id);

  const analysisYears = data.methodology.analysisYears;
  const aggregates = aggregateByYear(budgetItems, analysisYears);
  const latest = [...aggregates].reverse().find((a) => a.updatedBudget !== null) ?? null;
  const latestOriginal = latest?.originalBudget ?? null;
  const latestUpdated = latest?.updatedBudget ?? null;

  // Context for the headline figure: share of everything collected, nominal change
  // against the previous year that has a figure, and rank among all sections.
  const previous = [...aggregates]
    .reverse()
    .find((a) => a.updatedBudget !== null && a.fiscalYear !== latest?.fiscalYear);
  const updatedChange = changePercent(previous?.updatedBudget ?? null, latestUpdated);
  const allSectionsLatest = new Map<string, number | null>(
    data.ministries.map((m) => {
      const items = data.budgetItems.filter(
        (i) => i.ministryId === m.id && i.fiscalYear === latest?.fiscalYear,
      );
      return [m.id, sumWithoutDoubleCounting(items, (i) => i.updatedBudget).total];
    }),
  );
  const shareOfAllUpdated = shareOf(
    latestUpdated,
    [...allSectionsLatest.values()].reduce<number>(
      (acc, v) => (v !== null && v > 0 ? acc + v : acc),
      0,
    ),
  );
  const budgetRank = rankOf(ministry.id, allSectionsLatest);

  // The waterfall uses the latest year that has both a budget level and an
  // execution figure, so the bridge is complete rather than half-drawn.
  const waterfallYear =
    [...aggregates].reverse().find((a) => a.updatedBudget !== null && a.execution !== null)
      ?.fiscalYear ??
    latest?.fiscalYear ??
    null;
  const waterfall = buildWaterfall(
    data.budgetItems,
    data.findings.budgetChanges[ministry.id] ?? [],
    ministry.id,
    waterfallYear ?? 0,
  );
  const waterfallTransfer = waterfall.steps.find((s) => s.id === 'transfer')?.value ?? null;
  const waterfallUnused = waterfall.steps.find((s) => s.id === 'unused')?.value ?? null;
  const waterfallTakeaway =
    waterfallYear === null || waterfallTransfer === null
      ? null
      : `ב-${waterfallYear} ${waterfallTransfer >= 0 ? 'נוספו' : 'הופחתו'} ${formatCurrencyShort(Math.abs(waterfallTransfer))} בין התקציב המקורי למעודכן${
          waterfallUnused === null
            ? ''
            : waterfallUnused < 0
              ? `, ובסוף השנה נותרו ${formatCurrencyShort(Math.abs(waterfallUnused))} שלא נוצלו`
              : `, והביצוע חרג ב-${formatCurrencyShort(waterfallUnused)} מעל התקציב המעודכן`
        }.`;

  const noBudgetReason =
    `לא נאספו רשומות תקציב עבור ${ministry.displayName}. ${coverage?.limitations[0] ?? ''}`.trim();
  const noActivityReason = `לא נאספו פריטי פעילות פומבית עבור ${ministry.displayName}. היעדר פריטים אינו אומר שלא הייתה פעילות — הוא אומר שלא נאסף מקור.`;

  return (
    <div className="space-y-8">
      <header>
        <nav aria-label="מסלול ניווט" className="mb-2 text-sm text-ink-3">
          <Link className="link" to="/">
            בית
          </Link>{' '}
          / {ministry.displayName}
        </nav>
        <h1 className="text-2xl sm:text-3xl">{ministry.officialName}</h1>
        <p className="mt-2 max-w-3xl text-ink-2">{ministry.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="primary">{ministry.governmentPeriod}</Badge>
          {coverage !== undefined && (
            <Badge tone="muted">
              <span className="num">
                טווח כיסוי {formatDate(coverage.dateRangeStart)} –{' '}
                {formatDate(coverage.dateRangeEnd)}
              </span>
            </Badge>
          )}
          {ministry.budgetCodes.length > 0 ? (
            <Badge>
              <span className="num">קוד תקציבי {ministry.budgetCodes.join(', ')}</span>
            </Badge>
          ) : (
            <Badge tone="muted">קוד תקציבי לא אומת ממקור</Badge>
          )}
          <SourceLink
            url={ministry.nameEvidenceUrl}
            title={ministry.nameEvidenceTitle}
            label="מקור לזיהוי המשרד"
          />
        </div>
      </header>

      <section aria-labelledby="coverage-heading">
        <SectionHeading
          id="coverage-heading"
          title="מה נסרק ומה חסר"
          description="שקיפות על הכיסוי היא חלק מהנתון עצמו."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <h3 className="text-sm font-medium text-ink-2">מקורות</h3>
            <p className="num mt-2 text-2xl font-semibold">
              {formatNumber(coverage?.sourcesDefined ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              מקורות רשמיים זוהו וקוטלגו · מתוכם{' '}
              <span className="num">
                {formatNumber(coverage?.sourcesSuccessfullyCollected ?? 0)}
              </span>{' '}
              אוחזרו בפועל
            </p>
          </Card>
          <Card>
            <h3 className="text-sm font-medium text-ink-2">רשומות תקציב</h3>
            <p className="num mt-2 text-2xl font-semibold">
              {formatNumber(coverage?.budgetRecordCount ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              שנות תקציב זמינות:{' '}
              <span className="num">
                {coverage !== undefined && coverage.budgetYearsAvailable.length > 0
                  ? coverage.budgetYearsAvailable.join(', ')
                  : MISSING_SHORT}
              </span>
            </p>
          </Card>
          <Card>
            <h3 className="text-sm font-medium text-ink-2">פריטי פעילות</h3>
            <p className="num mt-2 text-2xl font-semibold">
              {formatNumber(coverage?.activityItemCount ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-3">פרסומים פומביים בלבד</p>
          </Card>
        </div>
        {coverage !== undefined && coverage.limitations.length > 0 && (
          <div className="mt-4">
            <Callout tone="warning" title="מגבלות כיסוי עבור משרד זה">
              <ul className="list-inside list-disc space-y-1">
                {coverage.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
      </section>

      <section aria-labelledby="ministers-heading">
        <SectionHeading
          id="ministers-heading"
          title="שרים ובעלי תפקידים"
          description="רק כהונות שנמצאו במקור רשמי, עם תאריכים ומקור."
        />
        {tenures.length === 0 ? (
          <DataUnavailable
            title="לא נאספו נתוני כהונה"
            reason="עמוד הרכב הממשלה הרשמי מקוטלג באתר, אך gov.il דוחה בקשות אוטומטיות ולכן גופו לא אוחזר. תאריכי כהונה אינם נגזרים בהסקה, ולכן לא הוצגו שמות או תאריכים כלל."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">שרים ובעלי תפקידים במשרד</caption>
              <thead>
                <tr>
                  <th scope="col">שם</th>
                  <th scope="col">תפקיד</th>
                  <th scope="col">תקופת כהונה</th>
                  <th scope="col">מקור</th>
                </tr>
              </thead>
              <tbody>
                {tenures.map((tenure) => (
                  <tr key={tenure.id}>
                    <td>{tenure.personName}</td>
                    <td>{tenure.role}</td>
                    <td className="num">
                      {formatDate(tenure.startDate)} –{' '}
                      {tenure.endDate === null ? 'בתוקף' : formatDate(tenure.endDate)}
                    </td>
                    <td>
                      <SourceLink url={tenure.sourceUrl} title={tenure.sourceTitle} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="budget-heading">
        <SectionHeading
          id="budget-heading"
          title="סיכום תקציבי"
          description="תקציב מקורי, תקציב מעודכן, ביצוע או אומדן — כל אחד עם סטטוס הנתון, נתח מסך התקציב ומקום בדירוג."
          action={<CopyLinkButton />}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Measure
            label={latest === null ? 'תקציב מקורי' : `תקציב מקורי ${latest.fiscalYear}`}
            display={formatCurrencyShort(latestOriginal)}
            fullValue={formatCurrencyFull(latestOriginal)}
            status={latestOriginal === null ? 'unavailable' : 'partial'}
          />
          <Measure
            label={latest === null ? 'תקציב מעודכן' : `תקציב מעודכן ${latest.fiscalYear}`}
            display={formatCurrencyShort(latestUpdated)}
            fullValue={formatCurrencyFull(latestUpdated)}
            status={latestUpdated === null ? 'unavailable' : 'partial'}
            context={{
              sharePercent: shareOfAllUpdated,
              shareLabelHe: 'מהתקציב המעודכן שנאסף',
              changePercent: updatedChange,
              changeLabelHe: `מ-${previous?.fiscalYear ?? ''}`,
              rank: budgetRank?.rank ?? null,
              rankOutOf: budgetRank?.outOf ?? null,
              rankLabelHe: 'סעיפים לפי גודל',
            }}
          />
          <Measure
            label="שיעור ביצוע"
            display={
              latest === null
                ? MISSING_SHORT
                : formatPercent(
                    executionRate({
                      actualExecution: latest.executionIsEstimate ? null : latest.execution,
                      estimatedExecution: latest.executionIsEstimate ? latest.execution : null,
                      updatedBudget: latest.updatedBudget,
                    }),
                  )
            }
            status={latest?.executionStatus ?? 'unavailable'}
            note="שיעור ביצוע = ביצוע ÷ תקציב מעודכן × 100. מחושב רק כאשר שני הערכים תקינים והתקציב המעודכן גדול מאפס."
          />
        </div>

        {/* Who held the office over the years the charts below cover. */}
        {tenures.length > 0 && (
          <div className="mt-4">
            <TenureRibbon
              tenures={tenures}
              windowStart={data.methodology.windowStart}
              windowEnd={data.methodology.windowEnd}
            />
          </div>
        )}

        <div className="mt-4">
          <ChartWithTable
            title="תקציב מקורי מול מעודכן מול ביצוע/אומדן"
            description="לפי שנת תקציב. שנה בלי נתון מוצגת כפער בגרף, לא כאפס."
            points={toSeriesPoints(aggregates)}
            series={BUDGET_SERIES}
            takeaway={budgetTrendSentence(aggregates, ministry.displayName)}
            emptyReason={noBudgetReason}
          />
        </div>

        {/* The bridge between the three levels, which the line chart cannot show. */}
        <div className="mt-4">
          <WaterfallChart
            title={`ממה הורכב התקציב ${waterfallYear ?? ''} — מהמקורי לביצוע`}
            description="כל מדרגה היא המעבר בין שתי רמות שפורסמו. הפניות שבידינו מוצגות מתחת לגרף."
            steps={waterfall.steps}
            takeaway={waterfallTakeaway}
            emptyReason={`אין נתוני תקציב מלאים ל-${waterfallYear ?? 'שנה שנבחרה'} עבור ${ministry.displayName}, ולכן לא ניתן לבנות את המפל.`}
            footer={
              <div className="mt-3 space-y-2 border-t border-rule pt-3">
                {waterfall.requests.length > 0 ? (
                  <>
                    <p className="text-xs font-medium text-ink-2">
                      פניות ועדת הכספים שבידינו לשנה זו:{' '}
                      <span className="num">{formatNumber(waterfall.requests.length)}</span>, בסך{' '}
                      <span className="num">{formatCurrencyShort(waterfall.requestsNetTotal)}</span>
                    </p>
                    <ul className="space-y-1 text-xs text-ink-2">
                      {waterfall.requests.slice(0, 5).map((request) => (
                        <li key={`${request.transactionId ?? ''}-${request.date ?? ''}`}>
                          <span className="num">{formatDate(request.date)}</span> —{' '}
                          {request.reqTitle ?? 'פנייה ללא כותרת'} (
                          <span className="num">{formatCurrencyShort(request.netExpenseDiff)}</span>
                          , {request.changeTypeName ?? 'סוג לא מדווח'}){' '}
                          <a
                            className="link"
                            href={request.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            למקור
                          </a>
                        </li>
                      ))}
                    </ul>
                    {waterfall.unexplainedTransfer !== null && (
                      <p className="text-xs text-ink-3">
                        ההפרש שאינו מוסבר בפניות שבידינו:{' '}
                        <span className="num">
                          {formatCurrencyShort(waterfall.unexplainedTransfer)}
                        </span>
                        . האתר מחזיק מדגם פניות ולא את כל תנועות התקציב.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-ink-3">
                    לא נאספו פניות תקציביות לשנה זו בסעיף הזה. מדרגת ההעברות היא ההפרש בין הרמות
                    שפורסמו.
                  </p>
                )}
                <QualityNote>
                  <p>{WATERFALL_RULE_HE}</p>
                </QualityNote>
              </div>
            }
          />
        </div>
      </section>

      <BudgetItemsSection
        items={budgetItems}
        ministryName={ministry.displayName}
        years={analysisYears}
      />

      <ActivitySection
        activities={activities}
        data={data}
        emptyReason={noActivityReason}
        ministryName={ministry.displayName}
      />

      <section aria-labelledby="link-heading">
        <SectionHeading
          id="link-heading"
          title="פעילות ותקציב — קריאה זהירה"
          description="אין כאן טענה סיבתית. מתאם בין נושא פעילות ובין סעיף תקציבי אינו מלמד שאחד גרם לשני."
        />
        {links.length === 0 ? (
          <DataUnavailable
            title="לא נמצא מיפוי מספיק להצגה"
            reason="קשר מוצג רק כאשר קיימים גם פריטי פעילות מזוהים, גם סעיפי תקציב מזוהים, וגם מיפוי מתועד ביניהם. בגרסת נתונים זו לא נאספו שני הצדדים, ולכן לא הוצג אף קשר."
          />
        ) : (
          <ul className="space-y-4">
            {links.map((link) => (
              <li key={link.id}>
                <Card>
                  <h3 className="text-base">
                    {data.topics.find((t) => t.id === link.topicId)?.labelHe ?? link.topicId}
                  </h3>
                  <p className="mt-2 text-sm text-ink-2">{link.mappingBasis}</p>
                  <p className="mt-2 text-sm text-state-partial">{link.caveat}</p>
                  <p className="num mt-2 text-xs text-ink-3">
                    {link.activityIds.length} פריטי פעילות · {link.budgetItemIds.length} סעיפי תקציב
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sources-heading">
        <SectionHeading
          id="sources-heading"
          title={`מקורות שקוטלגו עבור ${ministry.displayName}`}
          description="כל מקור עם מפרסם, סוג, תקופה וסטטוס אחזור."
          action={
            <CsvDownloadButton
              filename={`sources-${ministry.id}`}
              headers={['id', 'כותרת', 'מפרסם', 'סוג', 'שנות תקציב', 'סטטוס אחזור', 'URL']}
              rows={(s) => [
                s.id,
                s.title,
                s.publisher,
                s.sourceTypeLabelHe,
                s.fiscalYears,
                retrievalStatusLabel(s.retrievalStatus),
                s.url,
              ]}
              items={sources}
            />
          }
        />
        {sources.length === 0 ? (
          <DataUnavailable reason="לא קוטלגו מקורות עבור משרד זה." />
        ) : (
          <ul className="space-y-3">
            {sources.map((source) => (
              <li key={source.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-ink">{source.title}</h3>
                      <p className="mt-1 text-xs text-ink-3">
                        {source.publisher} · {source.sourceTypeLabelHe} · {source.periodCovered}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        tone={source.reliabilityLevel === 'primary_official' ? 'primary' : 'muted'}
                      >
                        {source.reliabilityLevel === 'primary_official'
                          ? 'מקור רשמי ראשוני'
                          : 'שכבת עזר'}
                      </Badge>
                      <SourceLink url={source.url} title={source.title} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-ink-3">{source.retrievalNote}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BudgetItemsSection({
  items,
  ministryName,
  years,
}: {
  items: readonly BudgetItem[];
  ministryName: string;
  years: readonly number[];
}): JSX.Element {
  const [year, setYear] = useState<string>(ALL);
  const [level, setLevel] = useState<string>(ALL);
  const [query, setQuery] = useState('');

  const levels = uniqueSorted(items.map((i) => String(i.hierarchyLevel)));

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (year !== ALL && item.fiscalYear !== Number(year)) return false;
        if (level !== ALL && String(item.hierarchyLevel) !== level) return false;
        return matchesQuery([item.title, item.budgetCode, ...item.hierarchyPath], query);
      }),
    [items, year, level, query],
  );

  const columns: Column<BudgetItem>[] = [
    {
      key: 'budgetCode',
      header: 'קוד',
      render: (item) => <span className="num">{item.budgetCode}</span>,
      sortValue: (item) => item.budgetCode,
    },
    {
      key: 'title',
      header: 'סעיף',
      render: (item) => (
        <div>
          <span className="font-medium">{item.title}</span>
          <span className="block text-xs text-ink-3">{item.hierarchyPath.join(' › ')}</span>
        </div>
      ),
      sortValue: (item) => item.title,
    },
    {
      key: 'fiscalYear',
      header: 'שנה',
      render: (item) => <span className="num">{item.fiscalYear}</span>,
      sortValue: (item) => item.fiscalYear,
      align: 'end',
    },
    {
      key: 'originalBudget',
      header: 'תקציב מקורי',
      render: (item) => (
        <span title={formatCurrencyFull(item.originalBudget)}>
          {formatCurrencyShort(item.originalBudget)}
        </span>
      ),
      sortValue: (item) => item.originalBudget,
      align: 'end',
    },
    {
      key: 'updatedBudget',
      header: 'תקציב מעודכן',
      render: (item) => (
        <span title={formatCurrencyFull(item.updatedBudget)}>
          {formatCurrencyShort(item.updatedBudget)}
        </span>
      ),
      sortValue: (item) => item.updatedBudget,
      align: 'end',
    },
    {
      key: 'change',
      header: 'שינוי',
      render: (item) => {
        const abs = budgetChangeAbsolute(item);
        const pct = budgetChangePercent(item);
        return (
          <span title={LARGE_CHANGE_RULE_HE}>
            {formatCurrencyShort(abs)}
            {pct !== null && <span className="text-ink-3"> ({formatPercent(pct)})</span>}
            {isLargeChange(item) && (
              <span className="ms-1 rounded bg-state-partial-soft px-1 text-xs text-state-partial">
                שינוי גדול
              </span>
            )}
          </span>
        );
      },
      sortValue: (item) => budgetChangeAbsolute(item),
      align: 'end',
    },
    {
      key: 'execution',
      header: 'ביצוע / אומדן',
      render: (item) => {
        const value = item.actualExecution ?? item.estimatedExecution;
        return <span title={formatCurrencyFull(value)}>{formatCurrencyShort(value)}</span>;
      },
      sortValue: (item) => item.actualExecution ?? item.estimatedExecution,
      align: 'end',
    },
    {
      key: 'executionRate',
      header: 'שיעור ביצוע',
      render: (item) => {
        const rate = executionRate(item);
        const outlier = isExecutionRateOutlier(rate);
        return (
          <span
            title={
              rate === null
                ? 'לא ניתן לחשב: נדרשים ביצוע ותקציב מעודכן גדול מאפס'
                : outlier
                  ? EXECUTION_RATE_OUTLIER_HINT
                  : 'ביצוע ÷ תקציב מעודכן × 100'
            }
          >
            {formatPercent(rate)}
            {outlier && (
              <span className="ms-1 rounded bg-state-partial-soft px-1 text-xs text-state-partial">
                חריגה
              </span>
            )}
          </span>
        );
      },
      sortValue: (item) => executionRate(item),
      align: 'end',
    },
    {
      key: 'status',
      header: 'סטטוס',
      render: (item) => <DataStatusBadge status={item.dataStatus} />,
      sortValue: (item) => item.dataStatus,
    },
    {
      key: 'source',
      header: 'מקור',
      render: (item) => <SourceLink url={item.sourceUrl} title={item.sourceTitle} />,
    },
  ];

  return (
    <section aria-labelledby="budget-table-heading">
      <SectionHeading
        id="budget-table-heading"
        title="סעיפים תקציביים"
        description="חיפוש, מיון, סינון שנה ומעבר בין רמות היררכיה. ההורדה כוללת בדיוק את השורות המסוננות."
        action={
          <CsvDownloadButton
            filename="budget-items-filtered"
            headers={[
              'id',
              'שנה',
              'קוד',
              'סעיף',
              'רמה',
              'תקציב מקורי',
              'תקציב מעודכן',
              'שינוי',
              'ביצוע',
              'אומדן',
              'שיעור ביצוע',
              'סטטוס',
              'מקור',
            ]}
            rows={(item: BudgetItem) => [
              item.id,
              item.fiscalYear,
              item.budgetCode,
              item.title,
              item.hierarchyLevel,
              item.originalBudget,
              item.updatedBudget,
              budgetChangeAbsolute(item),
              item.actualExecution,
              item.estimatedExecution,
              executionRate(item),
              item.dataStatus,
              item.sourceUrl,
            ]}
            items={filtered}
          />
        }
      />
      <Card className="mb-4">
        <FilterGrid>
          <SelectField
            label="שנת תקציב"
            value={year}
            onChange={setYear}
            options={[
              { value: ALL, label: 'כל השנים' },
              ...years.map((y) => ({ value: String(y), label: String(y) })),
            ]}
          />
          <SelectField
            label="רמת היררכיה"
            value={level}
            onChange={setLevel}
            options={[
              { value: ALL, label: 'כל הרמות' },
              ...levels.map((l) => ({ value: l, label: `רמה ${l}` })),
            ]}
            hint="סכימה מתבצעת על רמה אחת בלבד, כדי למנוע כפל ספירה."
          />
          <SearchField
            label="חיפוש בסעיפים"
            value={query}
            onChange={setQuery}
            placeholder="שם סעיף או קוד תקציבי"
          />
        </FilterGrid>
      </Card>
      <DataTable
        items={filtered}
        columns={columns}
        caption={`סעיפים תקציביים של ${ministryName}`}
        rowKey={(item) => item.id}
        emptyMessage={
          items.length === 0
            ? 'לא נאספו רשומות תקציב עבור משרד זה, ולכן אין טבלה להציג.'
            : 'אין שורות התואמות את הסינון הנוכחי.'
        }
      />
    </section>
  );
}

function ActivitySection({
  activities,
  data,
  emptyReason,
  ministryName,
}: {
  activities: readonly ActivityEvidence[];
  data: Dataset;
  emptyReason: string;
  ministryName: string;
}): JSX.Element {
  const [year, setYear] = useState<string>(ALL);
  const [sourceType, setSourceType] = useState<string>(ALL);
  const [topicId, setTopicId] = useState<string>(ALL);
  const [entity, setEntity] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(30);

  const entities = uniqueSorted(activities.flatMap((a) => [...a.people, ...a.organizations]));
  const sourceTypes = uniqueSorted(activities.map((a) => a.sourceType));
  const topicsPresent = data.topics.filter(
    (topic) => activities.some((a) => a.topics.includes(topic.id)) && topic.activityItemCount > 0,
  );

  const filtered = useMemo(
    () =>
      activities.filter((activity) => {
        if (year !== ALL && (activity.date === null || !activity.date.startsWith(year)))
          return false;
        if (sourceType !== ALL && activity.sourceType !== sourceType) return false;
        if (topicId !== ALL && !activity.topics.includes(topicId)) return false;
        if (entity !== ALL && ![...activity.people, ...activity.organizations].includes(entity)) {
          return false;
        }
        return matchesQuery([activity.title, activity.summary], query);
      }),
    [activities, year, sourceType, topicId, entity, query],
  );

  return (
    <section aria-labelledby="activity-heading">
      <SectionHeading
        id="activity-heading"
        title="ציר זמן פעילות פומבית"
        description="פרסומים פומביים בלבד. אינם תמונה מלאה של פעילות המשרד או עובדיו."
        action={
          <CsvDownloadButton
            filename="activity-filtered"
            headers={['id', 'תאריך', 'כותרת', 'תקציר', 'סוג מקור', 'נושאים', 'רמת כיסוי', 'URL']}
            rows={(a: ActivityEvidence) => [
              a.id,
              a.date,
              a.title,
              a.summary,
              activitySourceTypeLabel(a.sourceType),
              a.topics,
              coverageLevelLabel(a.coverageLevel),
              a.sourceUrl,
            ]}
            items={filtered}
          />
        }
      />

      {activities.length === 0 ? (
        <DataUnavailable title="לא נאספו פריטי פעילות" reason={emptyReason} />
      ) : (
        <>
          <Card className="mb-4">
            <FilterGrid>
              <SelectField
                label="שנה"
                value={year}
                onChange={setYear}
                options={[
                  { value: ALL, label: 'כל השנים' },
                  ...data.methodology.analysisYears.map((y) => ({
                    value: String(y),
                    label: String(y),
                  })),
                ]}
              />
              <SelectField
                label="סוג מקור"
                value={sourceType}
                onChange={setSourceType}
                options={[
                  { value: ALL, label: 'כל סוגי המקור' },
                  ...sourceTypes.map((t) => ({ value: t, label: activitySourceTypeLabel(t) })),
                ]}
              />
              <SelectField
                label="נושא"
                value={topicId}
                onChange={setTopicId}
                options={[
                  { value: ALL, label: 'כל הנושאים' },
                  ...topicsPresent.map((t) => ({
                    value: t.id,
                    label: `${t.labelHe} (${t.activityItemCount})`,
                  })),
                ]}
              />
              {entities.length > 0 ? (
                <SelectField
                  label="אדם או ארגון"
                  value={entity}
                  onChange={setEntity}
                  options={[
                    { value: ALL, label: 'כל האנשים והארגונים' },
                    ...entities.map((e) => ({ value: e, label: e })),
                  ]}
                />
              ) : (
                <SearchField
                  label="חיפוש חופשי"
                  value={query}
                  onChange={setQuery}
                  placeholder="כותרת או תקציר"
                />
              )}
            </FilterGrid>
          </Card>

          <ol className="space-y-3">
            {filtered.slice(0, visible).map((activity) => (
              <li key={activity.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="num text-xs text-ink-3">{formatDate(activity.date)}</p>
                      <h3 className="mt-1 text-sm font-semibold text-ink">{activity.title}</h3>
                      <p className="mt-1 max-w-3xl text-sm text-ink-2">{activity.summary}</p>
                    </div>
                    <SourceLink url={activity.sourceUrl} title={activity.sourceTitle} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone="muted">{activitySourceTypeLabel(activity.sourceType)}</Badge>
                    <Badge tone="muted">כיסוי {coverageLevelLabel(activity.coverageLevel)}</Badge>
                    {activity.topics.map((id) => (
                      <Badge key={id} tone="primary">
                        {data.topics.find((t) => t.id === id)?.labelHe ?? id}
                      </Badge>
                    ))}
                  </div>
                </Card>
              </li>
            ))}
          </ol>
          {filtered.length === 0 && (
            <DataUnavailable
              title="אין פריטים התואמים את הסינון"
              reason="נסו להרחיב את טווח השנים או לאפס את הסינון."
            />
          )}
          {filtered.length > visible && (
            <div className="mt-3 text-center">
              <button type="button" className="btn" onClick={() => setVisible((v) => v + 30)}>
                הצג עוד 30 מתוך {formatNumber(filtered.length - visible)} הנותרים
              </button>
            </div>
          )}
        </>
      )}

      <div className="mt-6">
        <SectionHeading
          title="חלוקת נושאים"
          description="מספר פריטי פעילות לכל נושא. נושא ללא פריטים אינו מוצג כנתון."
        />
        {topicsPresent.length === 0 ? (
          <DataUnavailable
            title="אין חלוקת נושאים להצגה"
            reason={`טקסונומיית הנושאים מוגדרת (${data.topics.length} נושאים), אך לא סווגו פריטי פעילות עבור ${ministryName}. הצגת התפלגות ללא פריטים הייתה יוצרת מראית עין של נתון.`}
          />
        ) : (
          <ul className="space-y-2">
            {topicsPresent.map((topic) => (
              <li key={topic.id} className="card card-pad">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{topic.labelHe}</span>
                  <span className="num text-sm text-ink-2">{topic.activityItemCount}</span>
                </div>
                <p className="mt-1 text-xs text-ink-3">{topic.classificationRule}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
