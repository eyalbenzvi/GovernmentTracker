import { useMemo, useState } from 'react';
import type { BudgetItem, Dataset } from '../types/domain';
import {
  Callout,
  Card,
  DataStatusBadge,
  DataUnavailable,
  SectionHeading,
  SourceLink,
} from '../components/ui';
import { CsvDownloadButton, FilterGrid, SearchField, SelectField } from '../components/controls';
import { BUDGET_SERIES, ChartWithTable } from '../components/charts';
import { DataTable, type Column } from '../components/DataTable';
import { aggregateByYear, toSeriesPoints } from '../lib/budgetSeries';
import {
  budgetChangeAbsolute,
  budgetChangePercent,
  executionRate,
  isLargeChange,
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
  const [ministryId, setMinistryId] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [query, setQuery] = useState('');
  const [onlyLargeChanges, setOnlyLargeChanges] = useState(false);

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

  const noDataReason =
    'לא נאספו רשומות תקציב בגרסת נתונים זו. מתחמי המקורות הרשמיים — ובהם ספר התקציב באתר הכנסת, דוחות ביצוע התקציב של משרד האוצר ו-data.gov.il — חסומים על ידי רשימת ההיתר של סביבת הבנייה. מקורות אלה מקוטלגים באתר עם קישור ישיר, אך לא חולצו מהם מספרים, ולא הוזנו נתונים ממקור עקיף או משוער.';

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
          <span className="block text-xs text-slate-500">
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
            <span className="ms-1 rounded bg-amber-100 px-1 text-xs text-amber-800">גדול</span>
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
      render: (item) => (
        <span
          title={
            executionRate(item) === null
              ? 'לא ניתן לחשב: נדרשים ביצוע ותקציב מעודכן גדול מאפס'
              : 'ביצוע ÷ תקציב מעודכן × 100'
          }
        >
          {formatPercent(executionRate(item))}
        </span>
      ),
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
        <p className="mt-2 max-w-3xl text-slate-600">
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
                <dt className="text-sm font-semibold text-slate-800">{entry.term}</dt>
                <dd className="mt-1 text-sm text-slate-600">{entry.meaning}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <p className="font-medium text-slate-700">נוסחאות</p>
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
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={onlyLargeChanges}
                  onChange={(event) => setOnlyLargeChanges(event.target.checked)}
                />
                רק שינויים גדולים
              </label>
            </div>
          </FilterGrid>
          {levels.length > 1 && (
            <p className="mt-3 text-xs text-slate-500">
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
        />
        <ChartWithTable
          title="תקציב מקורי מול מעודכן מול ביצוע/אומדן לפי שנה"
          points={toSeriesPoints(aggregates)}
          series={BUDGET_SERIES}
          emptyReason={noDataReason}
        />
      </section>

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
            <p className="num mb-2 text-sm text-slate-600" role="status" aria-live="polite">
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

      <Callout tone="caution" title="על דיוק ועיגול">
        <p>
          האתר אינו מציג יותר דיוק מכפי שהמקור מאפשר. אם המקור מפרסם באלפי ש"ח, לא מוצגות יחידות
          בודדות. סכום מקוצר הוא תמיד עיגול של הסכום המלא, שזמין ב-tooltip ובהורדת ה-CSV.
        </p>
      </Callout>
    </div>
  );
}
