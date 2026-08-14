import { useMemo } from 'react';
import { useUrlParam } from '../lib/useUrlState';
import { Link } from 'react-router-dom';
import type { BudgetItem, Dataset } from '../types/domain';
import {
  Callout,
  Card,
  DataStatusBadge,
  DataUnavailable,
  CopyLinkButton,
  SectionHeading,
  SourceLink,
} from '../components/ui';
import { CsvDownloadButton, FilterGrid, SearchField, SelectField } from '../components/controls';
import { BUDGET_SERIES, ChartWithTable, SlopeChart, TreemapChart } from '../components/charts';
import { budgetTrendSentence, compositionSentence } from '../lib/insights';
import { DataTable, type Column } from '../components/DataTable';
import { aggregateByYear, toSeriesPoints } from '../lib/budgetSeries';
import {
  budgetChangeAbsolute,
  budgetChangePercent,
  executionRate,
  EXECUTION_RATE_OUTLIER_HINT,
  isExecutionRateOutlier,
  isLargeChange,
  sumWithoutDoubleCounting,
  LARGE_CHANGE_ABSOLUTE_THRESHOLD,
  LARGE_CHANGE_PERCENT_THRESHOLD,
  LARGE_CHANGE_RULE_HE,
} from '../lib/calc';
import {
  formatCurrencyFull,
  formatCurrencyShort,
  formatPercent,
  formatNumber,
} from '../lib/format';
import { matchesQuery, uniqueSorted } from '../lib/selectors';

const ALL = 'all';

const MEASURE_GLOSSARY: ReadonlyArray<{ term: string; meaning: string }> = [
  {
    term: 'תקציב מקורי',
    meaning: 'הסכום שאושר בחוק התקציב לשנה, לפני שינויים במהלך השנה.',
  },
  {
    term: 'תקציב מעודכן',
    meaning: 'התקציב לאחר העברות, תוספות וקיצוצים שבוצעו במהלך שנת הכספים.',
  },
  {
    term: 'ביצוע',
    meaning: 'הסכום שנוצל בפועל. מוצג כ״ביצוע סופי״ רק כאשר נמצא מקור רשמי סופי ומזוהה לאותה שנה.',
  },
  {
    term: 'אומדן',
    meaning: 'הערכת ביצוע שפורסמה לפני סגירת השנה. לשנה שוטפת יוצג אומדן — לעולם לא ביצוע סופי.',
  },
];

export function BudgetPage({ data }: { data: Dataset }): JSX.Element {
  const [ministryId, setMinistryId] = useUrlParam('ministry', ALL);
  const [year, setYear] = useUrlParam('year', ALL);
  const [query, setQuery] = useUrlParam('q', '');
  const [largeOnly, setLargeOnly] = useUrlParam('large', 'no');
  const onlyLargeChanges = largeOnly === 'yes';
  const setOnlyLargeChanges = (next: boolean): void => setLargeOnly(next ? 'yes' : 'no');

  const analysisYears = data.methodology.analysisYears;

  const scoped = useMemo(
    () =>
      data.budgetItems.filter((item) => {
        if (ministryId !== ALL && item.ministryId !== ministryId) return false;
        if (year !== ALL && item.fiscalYear !== Number(year)) return false;
        if (onlyLargeChanges && !isLargeChange(item)) return false;
        return matchesQuery([item.title, item.budgetCode, ...item.hierarchyPath], query);
      }),
    [data.budgetItems, ministryId, year, query, onlyLargeChanges],
  );

  const comparisonItems = useMemo(
    () =>
      ministryId === ALL
        ? data.budgetItems
        : data.budgetItems.filter((item) => item.ministryId === ministryId),
    [data.budgetItems, ministryId],
  );

  const aggregates = aggregateByYear(comparisonItems, analysisYears);
  const levels = uniqueSorted(scoped.map((i) => String(i.hierarchyLevel)));

  const scopeLabel =
    ministryId === ALL
      ? 'כל הסעיפים שנאספו'
      : (data.ministries.find((m) => m.id === ministryId)?.displayName ?? 'הסעיף שנבחר');

  /**
   * Composition. With no ministry selected the tiles are sections; inside a
   * section they are its top-level programmes, which is the level a reader can
   * actually name. Only positive updated budgets are tiled — a treemap cannot
   * draw a negative area, and a zero tile would imply a figure that is absent.
   */
  const treemapYear =
    year !== ALL
      ? Number(year)
      : ([...aggregates].reverse().find((a) => a.updatedBudget !== null)?.fiscalYear ?? null);

  const treemapData = useMemo(() => {
    if (treemapYear === null) return [];
    const rows = data.budgetItems.filter((i) => i.fiscalYear === treemapYear);
    const buckets = new Map<string, { name: string; size: number }>();
    if (ministryId === ALL) {
      for (const ministry of data.ministries) {
        const total = sumWithoutDoubleCounting(
          rows.filter((i) => i.ministryId === ministry.id),
          (i) => i.updatedBudget,
        ).total;
        if (total !== null && total > 0) {
          buckets.set(ministry.id, { name: ministry.displayName, size: total });
        }
      }
    } else {
      for (const item of rows.filter(
        (i) => i.ministryId === ministryId && i.hierarchyLevel === 2,
      )) {
        if (item.updatedBudget !== null && item.updatedBudget > 0) {
          buckets.set(item.budgetCode, { name: item.title, size: item.updatedBudget });
        }
      }
      // A section with no level-2 rows falls back to its leaves, so the panel is
      // populated rather than mysteriously empty.
      if (buckets.size === 0) {
        for (const item of rows.filter((i) => i.ministryId === ministryId && i.isLeaf)) {
          if (item.updatedBudget !== null && item.updatedBudget > 0) {
            buckets.set(item.budgetCode, { name: item.title, size: item.updatedBudget });
          }
        }
      }
    }
    const palette = ['#154b6f', '#1b5e8a', '#2f7d54', '#7a5c9e', '#8f5f13', '#5b6d7a', '#9e6a7a'];
    return [...buckets.values()]
      .sort((a, b) => b.size - a.size)
      .slice(0, 24)
      .map((bucket, index) => ({
        ...bucket,
        color: palette[index % palette.length] as string,
      }));
  }, [data.budgetItems, data.ministries, ministryId, treemapYear]);

  /** The two outermost years that both carry a figure, for the slope chart. */
  const slopeYears = analysisYears.filter((y) =>
    data.budgetItems.some((i) => i.fiscalYear === y && i.updatedBudget !== null),
  );
  const slopeFrom = slopeYears[0] ?? null;
  const slopeTo = slopeYears.length > 1 ? (slopeYears[slopeYears.length - 1] as number) : null;
  const slopeRows = useMemo(() => {
    if (slopeFrom === null || slopeTo === null) return [];
    return data.ministries
      .filter((m) => ministryId === ALL || m.id === ministryId)
      .map((ministry) => {
        const forMinistry = data.budgetItems.filter((i) => i.ministryId === ministry.id);
        const pick = (fiscalYear: number): number | null =>
          sumWithoutDoubleCounting(
            forMinistry.filter((i) => i.fiscalYear === fiscalYear),
            (i) => i.updatedBudget,
          ).total;
        return {
          id: ministry.id,
          label: ministry.displayName,
          from: pick(slopeFrom),
          to: pick(slopeTo),
          href: `#/ministry/${ministry.id}`,
        };
      })
      .filter((row) => row.from !== null && row.to !== null);
  }, [data.budgetItems, data.ministries, ministryId, slopeFrom, slopeTo]);

  const noDataReason =
    'אין רשומות תקציב התואמות את הבחירה הנוכחית. נתוני התקציב באתר מכסים את סעיפי התקציב הרגיל של המשרדים שנאספו, לשנים 2023–2026. ספר התקציב ודוחות הביצוע הרשמיים מקוטלגים במסך המקורות עם קישור ישיר.';

  const columns: Column<BudgetItem>[] = [
    {
      key: 'ministry',
      header: 'משרד',
      render: (item) =>
        data.ministries.find((m) => m.id === item.ministryId)?.displayName ?? item.ministryId,
      sortValue: (item) => item.ministryId,
    },
    {
      key: 'fiscalYear',
      header: 'שנה',
      render: (item) => <span className="num">{item.fiscalYear}</span>,
      sortValue: (item) => item.fiscalYear,
      align: 'end',
    },
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
          <span className="block text-xs text-ink-3">
            {item.hierarchyPath.join(' › ')} · רמה {item.hierarchyLevel}
            {item.isLeaf ? ' (עלה)' : ''}
          </span>
        </div>
      ),
      sortValue: (item) => item.title,
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
      key: 'changePct',
      header: 'שינוי %',
      render: (item) => (
        <span title={LARGE_CHANGE_RULE_HE}>
          {formatPercent(budgetChangePercent(item))}
          {isLargeChange(item) && (
            <span className="ms-1 rounded bg-state-partial-soft px-1 text-xs text-state-partial">
              גדול
            </span>
          )}
        </span>
      ),
      sortValue: (item) => budgetChangePercent(item),
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
      header: 'סטטוס נתון',
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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl">תקציב וביצוע</h1>
        <p className="mt-2 max-w-3xl text-ink-2">
          השוואה בין תקציב מקורי, תקציב מעודכן, ביצוע ואומדן, לפי משרד ושנת תקציב. כל מספר מוצג עם
          סטטוס הנתון והמקור שממנו נאסף.
        </p>
      </header>

      <section aria-labelledby="glossary-heading">
        <SectionHeading id="glossary-heading" title="מה ההבדל בין המדדים" />
        <Card>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MEASURE_GLOSSARY.map((entry) => (
              <div key={entry.term}>
                <dt className="text-sm font-semibold text-ink">{entry.term}</dt>
                <dd className="mt-1 text-sm text-ink-2">{entry.meaning}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-rule pt-4 text-sm text-ink-2">
            <p className="font-medium text-ink-2">נוסחאות</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              <li>שינוי תקציב בש"ח = תקציב מעודכן − תקציב מקורי</li>
              <li>
                שינוי באחוזים = (מעודכן − מקורי) ÷ מקורי × 100, ומחושב רק כאשר התקציב המקורי אינו
                אפס
              </li>
              <li>
                שיעור ביצוע = ביצוע ÷ תקציב מעודכן × 100, ומחושב רק כאשר שני הערכים תקינים והתקציב
                המעודכן גדול מאפס
              </li>
              <li>
                זיהוי שינוי גדול:{' '}
                <span className="num">|שינוי %| ≥ {LARGE_CHANGE_PERCENT_THRESHOLD}%</span> וגם{' '}
                <span className="num">
                  |שינוי מוחלט| ≥ {formatCurrencyShort(LARGE_CHANGE_ABSOLUTE_THRESHOLD)}
                </span>{' '}
                — שני התנאים יחד
              </li>
            </ul>
            <p className="mt-2">
              כשמדד אינו ניתן לחישוב מוצג מקף, וההסבר זמין ב-tooltip של התא. עיגול: סכומים מקוצרים
              עד שני מקומות אחרי הנקודה, אחוזים למקום אחד. הסכום המלא זמין תמיד ב-tooltip.
            </p>
          </div>
        </Card>
      </section>

      <section aria-labelledby="filters-heading">
        <SectionHeading id="filters-heading" title="בחירת משרד ושנה" />
        <Card>
          <FilterGrid>
            <SelectField
              label="משרד"
              value={ministryId}
              onChange={setMinistryId}
              options={[
                { value: ALL, label: 'כל המשרדים' },
                ...data.ministries.map((m) => ({ value: m.id, label: m.displayName })),
              ]}
            />
            <SelectField
              label="שנת תקציב"
              value={year}
              onChange={setYear}
              options={[
                { value: ALL, label: 'כל השנים' },
                ...analysisYears.map((y) => ({ value: String(y), label: String(y) })),
              ]}
            />
            <SearchField
              label="חיפוש בסעיפים"
              value={query}
              onChange={setQuery}
              placeholder="שם סעיף או קוד"
            />
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-rule-strong"
                  checked={onlyLargeChanges}
                  onChange={(event) => setOnlyLargeChanges(event.target.checked)}
                />
                רק שינויים גדולים
              </label>
            </div>
          </FilterGrid>
          {levels.length > 1 && (
            <p className="mt-3 text-xs text-ink-3">
              בתוצאות קיימות {levels.length} רמות היררכיה. סכימה מתבצעת על רמה אחת בלבד, כדי למנוע
              כפל ספירה בין סעיף הורה לסעיפי הבנים שלו.
            </p>
          )}
        </Card>
      </section>

      <section aria-labelledby="compare-heading">
        <SectionHeading
          id="compare-heading"
          title="השוואת שנים"
          description="סכימה לפי שנת תקציב, על רמת היררכיה אחת."
          action={<CopyLinkButton />}
        />
        <ChartWithTable
          title="תקציב מקורי מול מעודכן מול ביצוע/אומדן לפי שנה"
          points={toSeriesPoints(aggregates)}
          series={BUDGET_SERIES}
          takeaway={budgetTrendSentence(aggregates, scopeLabel)}
          emptyReason={noDataReason}
        />
      </section>

      {/*
       * A hierarchy is a composition, not a series: a treemap answers "what is this
       * budget made of" in one glance, which the table below can only answer by
       * being read line by line.
       */}
      <section aria-labelledby="composition-heading">
        <SectionHeading
          id="composition-heading"
          title="ממה מורכב התקציב"
          description={
            ministryId === ALL
              ? 'גודל המלבן — התקציב המעודכן של הסעיף בשנה שנבחרה.'
              : 'גודל המלבן — התקציב המעודכן של התוכנית בתוך הסעיף.'
          }
        />
        <TreemapChart
          title={`הרכב התקציב המעודכן${treemapYear === null ? '' : ` ${treemapYear}`}`}
          data={treemapData}
          takeaway={compositionSentence(
            treemapData.map((d) => ({ label: d.name, value: d.size })),
            ministryId === ALL ? 'תקציב המדינה שנאסף' : 'תקציב הסעיף',
          )}
          valueLabelHe="תקציב מעודכן"
          emptyReason="אין רשומות עם תקציב מעודכן חיובי בבחירה הנוכחית, ולכן אין הרכב להצגה."
        />
      </section>

      {/* Two periods, the same sections: which grew and which shrank, nominally. */}
      {slopeRows.length > 1 && slopeFrom !== null && slopeTo !== null && (
        <section aria-labelledby="slope-heading">
          <SectionHeading
            id="slope-heading"
            title={`מי גדל ומי הצטמק, ${slopeFrom} מול ${slopeTo}`}
            description="קו עולה — התקציב המעודכן גדל; קו יורד — הצטמק. נומינלי, בלי ניכוי אינפלציה."
          />
          <SlopeChart
            title={`תקציב מעודכן: ${slopeFrom} מול ${slopeTo}`}
            rows={slopeRows}
            fromLabel={String(slopeFrom)}
            toLabel={String(slopeTo)}
            takeaway={`מבין ${formatNumber(slopeRows.length)} הסעיפים הגדולים שיש להם נתון בשתי השנים, ${formatNumber(slopeRows.filter((r) => (r.to ?? 0) >= (r.from ?? 0)).length)} גדלו נומינלית ו-${formatNumber(slopeRows.filter((r) => (r.to ?? 0) < (r.from ?? 0)).length)} הצטמקו.`}
            emptyReason="אין שתי שנים שיש להן נתון תקציב מעודכן עבור אותם סעיפים."
          />
        </section>
      )}

      <section aria-labelledby="table-heading">
        <SectionHeading
          id="table-heading"
          title="טבלת סעיפים תקציביים"
          description="מיון לפי כל עמודה. ההורדה כוללת בדיוק את השורות המסוננות."
          action={
            <CsvDownloadButton
              filename="budget-filtered"
              headers={[
                'id',
                'משרד',
                'שנה',
                'קוד',
                'סעיף',
                'רמה',
                'עלה',
                'תקציב מקורי',
                'תקציב מעודכן',
                'שינוי בש"ח',
                'שינוי באחוזים',
                'ביצוע',
                'אומדן',
                'שיעור ביצוע',
                'סטטוס',
                'מקור',
              ]}
              rows={(item: BudgetItem) => [
                item.id,
                item.ministryId,
                item.fiscalYear,
                item.budgetCode,
                item.title,
                item.hierarchyLevel,
                item.isLeaf ? 'כן' : 'לא',
                item.originalBudget,
                item.updatedBudget,
                budgetChangeAbsolute(item),
                budgetChangePercent(item),
                item.actualExecution,
                item.estimatedExecution,
                executionRate(item),
                item.dataStatus,
                item.sourceUrl,
              ]}
              items={scoped}
            />
          }
        />
        {data.budgetItems.length === 0 ? (
          <DataUnavailable title="אין נתוני תקציב בגרסה זו" reason={noDataReason} />
        ) : (
          <>
            <p className="num mb-2 text-sm text-ink-2" role="status" aria-live="polite">
              {formatNumber(scoped.length)} שורות מתוך {formatNumber(data.budgetItems.length)}
            </p>
            <DataTable
              items={scoped}
              columns={columns}
              caption="סעיפים תקציביים לפי משרד ושנה"
              rowKey={(item) => item.id}
              emptyMessage="אין שורות התואמות את הסינון הנוכחי."
            />
          </>
        )}
      </section>

      <Card className="flex flex-wrap items-center justify-between gap-4 bg-brand-soft">
        <div>
          <h2 className="text-base font-semibold">לאן הולך הכסף? ניתוח לפי סוגי שימוש ותמות</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            פירוק התקציב לפי הסיווג הכלכלי הרשמי (שכר, קניות, העברות), קיבוץ תמטי של תוכניות, ההסטות
            הגדולות של השנה ומדד אי-היציבות התקציבית.
          </p>
        </div>
        <Link className="btn btn-primary" to="/analysis">
          למסך הניתוח
        </Link>
      </Card>

      <Callout tone="caution" title="על דיוק ועיגול">
        <p>
          האתר אינו מציג יותר דיוק מכפי שהמקור מאפשר. אם המקור מפרסם באלפי ש"ח, לא מוצגות יחידות
          בודדות. סכום מקוצר הוא תמיד עיגול של הסכום המלא, שזמין ב-tooltip ובהורדת ה-CSV.
        </p>
      </Callout>
    </div>
  );
}
