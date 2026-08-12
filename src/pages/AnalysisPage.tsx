import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Bot, ChevronDown, ChevronUp } from 'lucide-react';
import type { Dataset } from '../types/domain';
import {
  Badge,
  Callout,
  Card,
  DataUnavailable,
  SectionHeading,
  SourceLink,
} from '../components/ui';
import { CsvDownloadButton, SelectField } from '../components/controls';
import { ChartWithTable } from '../components/charts';
import {
  hundredShekelBreakdown,
  themeAggregates,
  topBudgetShifts,
  usageDetailForYear,
  usageSeries,
  volatilityIndex,
  type ThemeAggregate,
} from '../lib/analysis';
import {
  formatCurrencyFull,
  formatCurrencyShort,
  formatNumber,
  formatPercent,
  MISSING_SHORT,
} from '../lib/format';

const ALL = 'all';
const TOP_SHIFTS_LIMIT = 12;

export function AnalysisPage({ data }: { data: Dataset }): JSX.Element {
  const analysisYears = data.methodology.analysisYears;
  const defaultYear = analysisYears.includes(2025) ? '2025' : String(analysisYears[0] ?? 2025);
  const [ministryId, setMinistryId] = useState<string>(ALL);
  const [year, setYear] = useState<string>(defaultYear);
  const selectedYear = Number(year);

  const ministryOptions = [
    { value: ALL, label: 'כל המשרדים שנאספו' },
    ...data.ministries.map((m) => ({ value: m.id, label: m.displayName })),
  ];
  const yearOptions = analysisYears.map((y) => ({ value: String(y), label: String(y) }));

  const usage = useMemo(
    () => usageSeries(data.usageBreakdown.rows, ministryId, analysisYears),
    [data.usageBreakdown.rows, ministryId, analysisYears],
  );
  const detail = useMemo(
    () => usageDetailForYear(data.usageBreakdown.rows, ministryId, selectedYear),
    [data.usageBreakdown.rows, ministryId, selectedYear],
  );
  const hundred = useMemo(
    () => hundredShekelBreakdown(data.usageBreakdown.rows, ministryId, selectedYear),
    [data.usageBreakdown.rows, ministryId, selectedYear],
  );
  const themes = useMemo(
    () =>
      themeAggregates(
        data.budgetItems,
        data.budgetThemes.assignments,
        data.budgetThemes.themes,
        ministryId,
        selectedYear,
      ),
    [data.budgetItems, data.budgetThemes, ministryId, selectedYear],
  );
  const shifts = useMemo(
    () =>
      topBudgetShifts(
        data.budgetItems,
        data.budgetThemes.assignments,
        ministryId,
        selectedYear,
        TOP_SHIFTS_LIMIT,
      ),
    [data.budgetItems, data.budgetThemes.assignments, ministryId, selectedYear],
  );
  const volatility = useMemo(
    () =>
      data.ministries
        .map((m) => ({
          ministry: m,
          index: volatilityIndex(data.budgetItems, m.id, selectedYear),
        }))
        .filter((v) => v.index.indexPercent !== null)
        .sort((a, b) => (b.index.indexPercent ?? 0) - (a.index.indexPercent ?? 0)),
    [data.budgetItems, data.ministries, selectedYear],
  );

  const coverageRows = data.usageBreakdown.coverage.filter(
    (c) =>
      (ministryId === ALL || c.ministryId === ministryId) &&
      c.coveragePercent !== null &&
      c.coveragePercent < 99.5,
  );

  const themeById = new Map(data.budgetThemes.themes.map((t) => [t.id, t]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl sm:text-3xl">ניתוח: לאן הולך הכסף</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          שתי שכבות ניתוח על נתוני התקציב שנאספו: פירוק לפי <strong>סוגי שימוש</strong> על בסיס
          הסיווג הכלכלי הרשמי, ופירוק <strong>תמטי</strong> שסווג בסיוע מודל שפה בזמן בניית המאגר.
          לכל מספר יש מקור, ולכל שיוך יש נימוק גלוי.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Callout tone="info" title="שכבה רשמית — סיווג כלכלי">
          <p className="flex items-start gap-2">
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              הקטגוריות שכר / קניות / העברות הן הסיווג הכלכלי של אגף התקציבים, כפי שהוא מופיע ברמת
              התקנות. שום מודל אינו מעורב בשכבה זו.
            </span>
          </p>
        </Callout>
        <Callout tone="caution" title="שכבה פרשנית — סיווג תמטי בסיוע מודל שפה">
          <p className="flex items-start gap-2">
            <Bot className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              התמות (״שירותים לציבור״, ״מטה״...) סווגו על ידי מודל שפה <strong>בזמן הבנייה</strong>{' '}
              — לא בזמן הריצה — מתוך כותרת הסעיף בלבד. כל שיוך נושא נימוק ורמת ודאות, ניתן לביקורת
              בקובץ הסיווג שב-repository, ואינו קביעה רשמית.
            </span>
          </p>
        </Callout>
      </div>

      <section aria-labelledby="selection-heading">
        <SectionHeading
          id="selection-heading"
          title="בחירת משרד ושנה"
          description="הבחירה חלה על כל התצוגות בעמוד."
        />
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="משרד"
              value={ministryId}
              options={ministryOptions}
              onChange={setMinistryId}
            />
            <SelectField
              label="שנת תקציב"
              value={year}
              options={yearOptions}
              onChange={setYear}
              hint="נתוני 2026 הם שנה שוטפת: אומדנים, וכיסוי סיווג חלקי."
            />
          </div>
        </Card>
      </section>

      {/* ---- usage breakdown (official) ---- */}
      <section aria-labelledby="usage-heading">
        <SectionHeading
          id="usage-heading"
          title="התקציב לפי סוגי שימוש"
          description="תקציב מעודכן, מפורק לפי הסיווג הכלכלי הרשמי. סכימה על רמת התקנות בלבד — ללא כפל ספירה."
        />

        {hundred.length > 0 && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-slate-700">
              מכל 100 ₪ בתקציב המעודכן ({selectedYear})
            </h3>
            <div
              className="mt-3 flex h-8 w-full overflow-hidden rounded"
              role="img"
              aria-label={`חלוקת התקציב המעודכן לשנת ${selectedYear}: ${hundred
                .map((s) => `${s.label} ${s.perHundred} מתוך 100`)
                .join(', ')}`}
            >
              {hundred.map((slice) => (
                <div
                  key={slice.label}
                  style={{ width: `${slice.perHundred}%`, backgroundColor: slice.color }}
                  title={`${slice.label}: ${slice.perHundred} ₪ מכל 100 ₪`}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {hundred.map((slice) => (
                <li key={slice.label} className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: slice.color }}
                    aria-hidden="true"
                  />
                  {slice.label}: <span className="num font-medium">{slice.perHundred} ₪</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              החישוב על רכיבים חיוביים בלבד; שורות הכנסות מיועדות וחשבונות מעבר בסכום אפס או שלילי
              אינן נכללות.
            </p>
          </Card>
        )}

        <ChartWithTable
          title="סוגי שימוש לפי שנה"
          description="עמודות נערמות: כל צבע הוא קטגוריה בסיווג הכלכלי הרשמי."
          points={usage.points}
          series={usage.series}
          stacked
          emptyReason="אין נתוני סיווג כלכלי עבור הבחירה הנוכחית."
        />

        {coverageRows.length > 0 && (
          <div className="mt-3">
            <Callout tone="warning" title="כיסוי סיווג חלקי">
              <ul className="list-inside list-disc space-y-1">
                {coverageRows.map((c) => {
                  const ministry = data.ministries.find((m) => m.id === c.ministryId);
                  return (
                    <li key={`${c.ministryId}-${c.fiscalYear}`}>
                      {ministry?.displayName ?? c.ministryId}, {c.fiscalYear}: הסיווג מכסה{' '}
                      <span className="num">{formatPercent(c.coveragePercent)}</span> מהתקציב
                      המעודכן — היתרה טרם חולקה לתקנות מסווגות (מצב רגיל בשנה שוטפת).
                    </li>
                  );
                })}
              </ul>
            </Callout>
          </div>
        )}

        <div className="mt-4">
          <SectionHeading
            title={`פירוט הסיווג לשנת ${selectedYear}`}
            action={
              <CsvDownloadButton
                filename={`usage-${ministryId}-${selectedYear}`}
                headers={[
                  'סיווג ראשי',
                  'סיווג משני',
                  'תקציב מקורי',
                  'תקציב מעודכן',
                  'ביצוע/אומדן',
                  'נתח מהמעודכן %',
                  'מספר תקנות',
                  'מקור',
                ]}
                rows={(r) => [
                  r.econLevel1,
                  r.econLevel2,
                  r.allocated,
                  r.revised,
                  r.executed,
                  r.shareOfRevised,
                  r.lineCount,
                  r.sourceUrl,
                ]}
                items={detail}
              />
            }
          />
          {detail.length === 0 ? (
            <DataUnavailable reason="אין שורות סיווג לשנה ולבחירה הנוכחית." />
          ) : (
            <div className="table-wrap max-h-96 overflow-y-auto">
              <table className="data-table">
                <caption className="sr-only">פירוט הסיווג הכלכלי לשנה הנבחרת</caption>
                <thead>
                  <tr>
                    <th scope="col">סיווג ראשי</th>
                    <th scope="col">סיווג משני</th>
                    <th scope="col">מקורי</th>
                    <th scope="col">מעודכן</th>
                    <th scope="col">ביצוע / אומדן</th>
                    <th scope="col">נתח</th>
                    <th scope="col">תקנות</th>
                    <th scope="col">מקור</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((row) => (
                    <tr key={`${row.econLevel1}|${row.econLevel2}`}>
                      <td>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: usage.series.find((s) => s.key === row.econLevel1)
                                ?.color,
                            }}
                            aria-hidden="true"
                          />
                          {row.econLevel1}
                        </span>
                      </td>
                      <td>{row.econLevel2}</td>
                      <td className="num text-left" title={formatCurrencyFull(row.allocated)}>
                        {formatCurrencyShort(row.allocated)}
                      </td>
                      <td className="num text-left" title={formatCurrencyFull(row.revised)}>
                        {formatCurrencyShort(row.revised)}
                      </td>
                      <td className="num text-left" title={formatCurrencyFull(row.executed)}>
                        {formatCurrencyShort(row.executed)}
                      </td>
                      <td className="num text-left">{formatPercent(row.shareOfRevised)}</td>
                      <td className="num text-left">{formatNumber(row.lineCount)}</td>
                      <td>
                        <SourceLink url={row.sourceUrl} title="מפתח התקציב" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---- thematic layer (LLM at build time) ---- */}
      <section aria-labelledby="themes-heading">
        <SectionHeading
          id="themes-heading"
          title="התקציב לפי תמות"
          description="קיבוץ תוכניות התקציב לתמות מובנות לציבור. הסיווג נעשה בסיוע מודל שפה בזמן הבנייה — פתחו תמה כדי לראות אילו סעיפים נכללים בה ולמה."
        />
        {themes.length === 0 ? (
          <DataUnavailable reason="אין תוכניות תקציב מסווגות לבחירה הנוכחית." />
        ) : (
          <ol className="space-y-3">
            {themes.map((aggregate) => (
              <ThemeCard key={aggregate.theme.id} aggregate={aggregate} data={data} />
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {data.budgetThemes.methodNote}{' '}
          <a
            className="link"
            href="https://github.com/eyalbenzvi/GovernmentTracker/blob/main/data/raw/seeds/budget-themes.seed.json"
            target="_blank"
            rel="noopener noreferrer"
          >
            קובץ הסיווג המלא
          </a>
        </p>
      </section>

      {/* ---- anomalies ---- */}
      <section aria-labelledby="shifts-heading">
        <SectionHeading
          id="shifts-heading"
          title={`ההסטות הגדולות של ${selectedYear}`}
          description={`${TOP_SHIFTS_LIMIT} השינויים הגדולים בערך מוחלט בין התקציב המקורי לתקציב המעודכן, ברמת התוכניות. שינוי גדול אינו בהכרח חריגה — הוא מלמד היכן התקציב נכתב מחדש במהלך השנה.`}
          action={
            <CsvDownloadButton
              filename={`shifts-${ministryId}-${selectedYear}`}
              headers={[
                'משרד',
                'קוד',
                'תוכנית',
                'תמה',
                'מקורי',
                'מעודכן',
                'שינוי בש"ח',
                'שינוי %',
                'מקור',
              ]}
              rows={(s) => [
                s.item.ministryId,
                s.item.budgetCode,
                s.item.title,
                s.assignment !== null ? (themeById.get(s.assignment.themeId)?.labelHe ?? '') : '',
                s.item.originalBudget,
                s.item.updatedBudget,
                s.deltaAbsolute,
                s.deltaPercent,
                s.item.sourceUrl,
              ]}
              items={shifts}
            />
          }
        />
        {shifts.length === 0 ? (
          <DataUnavailable reason="לא נמצאו שינויים בין מקורי למעודכן בבחירה הנוכחית." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">ההסטות התקציביות הגדולות בשנה הנבחרת</caption>
              <thead>
                <tr>
                  <th scope="col">תוכנית</th>
                  <th scope="col">תמה</th>
                  <th scope="col">מקורי</th>
                  <th scope="col">מעודכן</th>
                  <th scope="col">שינוי</th>
                  <th scope="col">מקור</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => {
                  const ministry = data.ministries.find((m) => m.id === shift.item.ministryId);
                  const theme =
                    shift.assignment !== null ? themeById.get(shift.assignment.themeId) : undefined;
                  return (
                    <tr key={shift.item.id}>
                      <td>
                        <span className="font-medium">{shift.item.title}</span>
                        <span className="block text-xs text-slate-500">
                          {ministry?.displayName ?? shift.item.ministryId} ·{' '}
                          <span className="num">{shift.item.budgetCode}</span>
                        </span>
                      </td>
                      <td>
                        {theme !== undefined ? (
                          <Badge tone="muted">{theme.labelHe}</Badge>
                        ) : (
                          MISSING_SHORT
                        )}
                      </td>
                      <td
                        className="num text-left"
                        title={formatCurrencyFull(shift.item.originalBudget)}
                      >
                        {formatCurrencyShort(shift.item.originalBudget)}
                      </td>
                      <td
                        className="num text-left"
                        title={formatCurrencyFull(shift.item.updatedBudget)}
                      >
                        {formatCurrencyShort(shift.item.updatedBudget)}
                      </td>
                      <td className="num text-left">
                        <span
                          className={shift.deltaAbsolute > 0 ? 'text-emerald-700' : 'text-red-700'}
                          title={formatCurrencyFull(shift.deltaAbsolute)}
                        >
                          {shift.deltaAbsolute > 0 ? '+' : '−'}
                          {formatCurrencyShort(Math.abs(shift.deltaAbsolute))}
                          {shift.deltaPercent !== null && (
                            <span className="text-slate-500">
                              {' '}
                              ({formatPercent(shift.deltaPercent)})
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <SourceLink url={shift.item.sourceUrl} title={shift.item.sourceTitle} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="volatility-heading">
        <SectionHeading
          id="volatility-heading"
          title={`מדד אי-יציבות תקציבית, ${selectedYear}`}
          description="כמה מהתקציב המקורי נכתב מחדש במהלך השנה, בכל כיוון. הנוסחה: סכום |מעודכן − מקורי| על כל התוכניות ÷ סכום התקציב המקורי × 100."
        />
        {volatility.length === 0 ? (
          <DataUnavailable reason="אין נתונים לחישוב המדד בשנה הנבחרת." />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {volatility.map(({ ministry, index }) => (
              <li key={ministry.id}>
                <Card className="h-full">
                  <p className="text-sm font-medium text-slate-600">
                    <Link className="link" to={`/ministry/${ministry.id}`}>
                      {ministry.displayName}
                    </Link>
                  </p>
                  <p className="num mt-1 text-2xl font-semibold">
                    {formatPercent(index.indexPercent)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="num">{formatCurrencyShort(index.sumAbsoluteDelta)}</span> הוסטו
                    מתוך <span className="num">{formatCurrencyShort(index.sumOriginal)}</span> ·{' '}
                    <span className="num">{index.leafCount}</span> תוכניות
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-slate-500">
          מדד גבוה אינו בהכרח ביקורת: הוא יכול לשקף היערכות לחירום, תוספות שהוסכמו במהלך השנה או
          תכנון שמרני. הוא מודד תנועה, לא איכות.
        </p>
      </section>

      <Card className="flex flex-wrap items-center justify-between gap-4 bg-brand-50">
        <div>
          <h2 className="text-base font-semibold">רוצים שמות? מסך הממצאים</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-700">
            הספקים המרכזיים של כל משרד, מקבלי התמיכות הגדולים, ההעברות שאושרו באמצע השנה עם ההסבר
            הרשמי, וסריקת חריגים בכל התקנות.
          </p>
        </div>
        <Link className="btn btn-primary" to="/findings">
          למסך הממצאים
        </Link>
      </Card>

      <Callout tone="caution" title="גבולות הניתוח">
        <p>
          הניתוח חל על סעיפי התקציב הרגיל של חמשת המשרדים שנאספו בלבד, ואינו כולל את תקציב הפיתוח.
          הנתונים משכבת עזר (מפתח התקציב) ואינם סופיים. אין להסיק סיבתיות מהסטה תקציבית, והסיווג
          התמטי הוא פרשנות של כותרות — לא קביעה רשמית. פירוט מלא ב
          <Link className="link" to="/methodology">
            מסך המתודולוגיה
          </Link>
          .
        </p>
      </Callout>
    </div>
  );
}

function ThemeCard({ aggregate, data }: { aggregate: ThemeAggregate; data: Dataset }): JSX.Element {
  const [open, setOpen] = useState(false);
  const { theme } = aggregate;
  const mediumCount = aggregate.members.filter((m) => m.assignment.confidence === 'medium').length;

  return (
    <li className="card card-pad list-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-1 inline-block h-4 w-4 shrink-0 rounded"
            style={{ backgroundColor: theme.color }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{theme.labelHe}</h3>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-600">{theme.description}</p>
          </div>
        </div>
        <div className="text-left">
          <p
            className="num text-xl font-semibold"
            title={formatCurrencyFull(aggregate.updatedBudget)}
          >
            {formatCurrencyShort(aggregate.updatedBudget)}
          </p>
          <p className="num text-xs text-slate-500">
            {aggregate.shareOfRevised !== null
              ? `${formatPercent(aggregate.shareOfRevised)} מהתקציב המעודכן`
              : MISSING_SHORT}
          </p>
        </div>
      </div>

      {aggregate.shareOfRevised !== null && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded bg-slate-100" aria-hidden="true">
          <div
            className="h-full rounded"
            style={{
              width: `${Math.min(100, aggregate.shareOfRevised)}%`,
              backgroundColor: theme.color,
            }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
          {open ? 'הסתר סעיפים' : `אילו סעיפים נכללים (${aggregate.members.length})`}
        </button>
        {mediumCount > 0 && <Badge tone="muted">{mediumCount} שיוכים ברמת ודאות בינונית</Badge>}
      </div>

      {open && (
        <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {aggregate.members.map(({ item, assignment }) => {
            const ministry = data.ministries.find((m) => m.id === item.ministryId);
            return (
              <li key={item.id} className="rounded border border-slate-100 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {item.title}{' '}
                      <span className="num text-xs text-slate-500">({item.budgetCode})</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {ministry?.displayName ?? item.ministryId}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="num" title={formatCurrencyFull(item.updatedBudget)}>
                      {formatCurrencyShort(item.updatedBudget)}
                    </span>
                    <SourceLink url={item.sourceUrl} title={item.sourceTitle} />
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  <strong>נימוק השיוך:</strong> {assignment.reasoning}{' '}
                  <Badge tone={assignment.confidence === 'high' ? 'primary' : 'muted'}>
                    ודאות {assignment.confidence === 'high' ? 'גבוהה' : 'בינונית'}
                  </Badge>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
