import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, FileText } from 'lucide-react';
import type { Dataset } from '../types/domain';
import { Callout, Card, DataUnavailable, Measure, SectionHeading } from '../components/ui';
import { SelectField } from '../components/controls';
import { BUDGET_SERIES, ChartWithTable } from '../components/charts';
import { aggregateByYear, toSeriesPoints } from '../lib/budgetSeries';
import { formatCurrencyFull, formatCurrencyShort, formatDate, formatNumber } from '../lib/format';
import { SCOPE_WARNING, SITE_TAGLINE, SITE_TITLE } from '../lib/site';

const ALL = 'all';

export function HomePage({ data }: { data: Dataset }): JSX.Element {
  const [ministryId, setMinistryId] = useState<string>(ALL);
  const [year, setYear] = useState<string>(ALL);

  const analysisYears = data.methodology.analysisYears;

  const scopedBudget = useMemo(
    () =>
      data.budgetItems.filter(
        (item) =>
          (ministryId === ALL || item.ministryId === ministryId) &&
          (year === ALL || item.fiscalYear === Number(year)),
      ),
    [data.budgetItems, ministryId, year],
  );

  const scopedActivities = useMemo(
    () =>
      data.activities.filter(
        (item) =>
          (ministryId === ALL || item.ministryId === ministryId) &&
          (year === ALL || (item.date !== null && item.date.startsWith(year))),
      ),
    [data.activities, ministryId, year],
  );

  const scopedSources = useMemo(
    () =>
      data.sources.filter(
        (source) =>
          (ministryId === ALL || source.ministryIds.includes(ministryId)) &&
          (year === ALL || source.fiscalYears.includes(Number(year))),
      ),
    [data.sources, ministryId, year],
  );

  const aggregates = useMemo(() => {
    const chartYears = year === ALL ? analysisYears : [Number(year)];
    return aggregateByYear(scopedBudget, chartYears);
  }, [scopedBudget, year, analysisYears]);

  const selectedAggregate = aggregates.length === 1 ? (aggregates[0] ?? null) : null;
  const latestWithData = [...aggregates].reverse().find((a) => a.updatedBudget !== null) ?? null;
  const focus = selectedAggregate ?? latestWithData;
  const focusUpdatedBudget = focus?.updatedBudget ?? null;
  const focusExecution = focus?.execution ?? null;

  const ministryOptions = [
    { value: ALL, label: `כל המשרדים שנאספו (${data.ministries.length})` },
    ...data.ministries.map((m) => ({ value: m.id, label: m.displayName })),
  ];
  const yearOptions = [
    { value: ALL, label: `כל שנות הניתוח (${analysisYears.join('–')})` },
    ...analysisYears.map((y) => ({ value: String(y), label: String(y) })),
  ];

  const noBudgetReason =
    'לא נאספו רשומות תקציב בגרסת נתונים זו. מתחמי המקורות הרשמיים חסומים בסביבת הבנייה, ולא הוזנו מספרים ממקור עקיף או משוער. פירוט מלא במסך המתודולוגיה.';

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl sm:text-3xl">
          {SITE_TITLE} — {SITE_TAGLINE}
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          דשבורד שקיפות על משרדי ממשלת ישראל בתקופת {data.dataVersion.governmentPeriod}, מ־
          <span className="num">{formatDate(data.methodology.windowStart)}</span> ועד{' '}
          <span className="num">{formatDate(data.methodology.windowEnd)}</span>. כל פריט מוצג עם
          קישור למקור, או עם ציון מפורש שהנתון חסר.
        </p>
        <div className="mt-4">
          <Callout tone="warning" title="הסתייגות מתודולוגית">
            <p>{SCOPE_WARNING}</p>
            <p>
              האתר אינו מתיימר לדעת במה עוסקים עובדי המשרדים. הוא מציג פרסומים פומביים, נתוני תקציב
              ממקורות רשמיים, וקטלוג מקורות שניתן לאמת.
            </p>
          </Callout>
        </div>
      </section>

      <section aria-labelledby="selection-heading">
        <SectionHeading
          id="selection-heading"
          title="בחירת משרד וטווח שנים"
          description="הבחירה משפיעה על כל המדדים והגרפים בדף זה."
        />
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="משרד"
              value={ministryId}
              options={ministryOptions}
              onChange={setMinistryId}
              hint="מוצגים רק משרדים שנאספו עבורם מקורות. יתר המשרדים מסומנים כ״טרם נאסף״."
            />
            <SelectField
              label="שנת תקציב"
              value={year}
              options={yearOptions}
              onChange={setYear}
              hint="שנות הניתוח נגזרות מתקופת הממשלה ה-37."
            />
          </div>
        </Card>
      </section>

      <section aria-labelledby="kpi-heading">
        <SectionHeading
          id="kpi-heading"
          title="מדדים מרכזיים"
          description="כל מדד מציג את סטטוס הנתון שלו: סופי, אומדן, חלקי או חסר."
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Measure
            label="מקורות רשמיים ופריטי פעילות"
            display={`${formatNumber(scopedSources.length)} מקורות · ${formatNumber(scopedActivities.length)} פריטי פעילות`}
            status={scopedSources.length > 0 ? 'partial' : 'unavailable'}
            note={
              scopedActivities.length === 0
                ? 'המקורות זוהו וקוטלגו עם קישור ישיר. פריטי פעילות טרם נאספו — ראו מסך המתודולוגיה.'
                : 'פריטי פעילות הם פרסומים פומביים בלבד, ולא תמונה מלאה של פעילות המשרד.'
            }
          />
          <Measure
            label={focus === null ? 'תקציב מעודכן' : `תקציב מעודכן ${focus.fiscalYear}`}
            display={formatCurrencyShort(focusUpdatedBudget)}
            fullValue={formatCurrencyFull(focusUpdatedBudget)}
            status={focusUpdatedBudget === null ? 'unavailable' : 'partial'}
            note={
              focusUpdatedBudget === null
                ? 'אין נתון זמין במקור שנאסף.'
                : 'סכימה על רמת היררכיה אחת בלבד, כדי למנוע כפל ספירה.'
            }
          />
          <Measure
            label={focus === null ? 'ביצוע / אומדן ביצוע' : `ביצוע / אומדן ${focus.fiscalYear}`}
            display={formatCurrencyShort(focusExecution)}
            fullValue={formatCurrencyFull(focusExecution)}
            status={
              focusExecution === null
                ? 'unavailable'
                : focus?.executionIsEstimate === true
                  ? 'estimate'
                  : 'final'
            }
            note={
              focusExecution === null
                ? 'אין נתון זמין במקור שנאסף.'
                : focus?.executionIsEstimate === true
                  ? 'הנתון הוא אומדן ביצוע, ולא ביצוע סופי.'
                  : 'ביצוע לפי מקור רשמי סופי ומזוהה.'
            }
          />
        </div>
      </section>

      <section aria-labelledby="trend-heading">
        <SectionHeading
          id="trend-heading"
          title="מגמה רב-שנתית"
          description="תקציב מקורי מול תקציב מעודכן מול ביצוע או אומדן, לפי שנת תקציב."
        />
        <ChartWithTable
          title="תקציב וביצוע לפי שנה"
          points={toSeriesPoints(aggregates)}
          series={BUDGET_SERIES}
          kind="line"
          emptyReason={noBudgetReason}
        />
      </section>

      <section aria-labelledby="ministries-heading">
        <SectionHeading
          id="ministries-heading"
          title="משרדים זמינים ומדדי כיסוי"
          description="לכל משרד מוצג מה נאסף בפועל ומה חסר."
        />
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.ministries.map((ministry) => {
            const coverage = data.coverage.find((c) => c.ministryId === ministry.id);
            return (
              <li key={ministry.id}>
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base">
                        <Link className="link" to={`/ministry/${ministry.id}`}>
                          {ministry.officialName}
                        </Link>
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">{ministry.dataCoverageSummary}</p>
                    </div>
                    <Link
                      to={`/ministry/${ministry.id}`}
                      className="btn shrink-0"
                      aria-label={`לעמוד ${ministry.officialName}`}
                    >
                      פירוט
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                  {coverage !== undefined && coverage.limitations.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs text-slate-500">
                      {coverage.limitations.slice(0, 2).map((limitation) => (
                        <li key={limitation}>• {limitation}</li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
        <div className="mt-4">
          <Callout tone="caution" title="משרדים שטרם נאספו">
            <p>
              במאגר זה נאספו {data.ministries.length} משרדים. יתר משרדי הממשלה מסומנים כ״טרם נאסף״:
              לא נבנתה עבורם רשימה משוערת, והרשימה הרשמית המלאה מופיעה בקטלוג המקורות תחת עמוד חברי
              הממשלה.
            </p>
          </Callout>
        </div>
      </section>

      <section aria-labelledby="whatsnew-heading">
        <SectionHeading id="whatsnew-heading" title="מה חדש בגרסת הנתונים" />
        <Card>
          <p className="num text-sm font-medium text-slate-700">
            גרסה {data.dataVersion.version} · נבנתה{' '}
            {formatDate(data.dataVersion.builtAt.slice(0, 10))}
          </p>
          <ul className="mt-3 space-y-3 text-sm text-slate-700">
            {data.dataVersion.changelog.map((entry) => (
              <li key={`${entry.date}-${entry.note.slice(0, 20)}`} className="flex gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>
                  <span className="num font-medium">{formatDate(entry.date)}</span> — {entry.note}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="methodology-cta">
        <h2 id="methodology-cta" className="sr-only">
          מתודולוגיה
        </h2>
        {data.budgetItems.length === 0 && (
          <div className="mb-4">
            <DataUnavailable title="אין באתר נתוני תקציב בגרסה זו" reason={noBudgetReason} />
          </div>
        )}
        <Card className="flex flex-wrap items-center justify-between gap-4 bg-brand-50">
          <div>
            <h3 className="text-base">לפני שמסתמכים על מספר — קראו את המתודולוגיה</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-700">
              מה נאסף, איך נאסף, מה המשמעות של כל מדד, מה המגבלות הידועות, ומדוע אין לפרש מתאם
              כסיבתיות.
            </p>
          </div>
          <Link to="/methodology" className="btn btn-primary">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            למסך מתודולוגיה ומגבלות
          </Link>
        </Card>
      </section>
    </div>
  );
}
