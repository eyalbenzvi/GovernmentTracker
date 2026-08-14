/**
 * The home screen leads with a finding, not with a form.
 *
 * It used to open with a methodological warning, then two dropdowns, then three
 * measures each carrying its own caveat — asking the reader to decide what to ask
 * before the site had shown them why anything here is worth asking about. Now the
 * order is: one headline figure, the ranked insights, the reader's own hundred
 * shekels, and only then the ways in.
 *
 * It renders from site-summary.json alone — tens of kilobytes — so the first screen
 * does not wait on the 12MB corpus. The deep screens fetch that when they are opened.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Coins, Landmark, ListChecks, Users } from 'lucide-react';
import type { SiteSummary } from '../types/summary';
import { Badge, Callout, Card, QualityNote, SectionHeading } from '../components/ui';
import { InsightCard } from '../components/InsightCard';
import { BUDGET_SERIES, ChartWithTable, Sparkline } from '../components/charts';
import { HundredShekel } from '../components/HundredShekel';
import { budgetTrendSentence } from '../lib/insights';
import { changePercent } from '../lib/context';
import { formatCurrencyShort, formatDate, formatNumber, formatPercent } from '../lib/format';
import { SITE_TAGLINE, SITE_TITLE } from '../lib/site';

const ENTRY_POINTS = [
  {
    to: '/budget',
    label: 'לפי כסף',
    description: 'תקציב מקורי, תוספות במהלך השנה, ביצוע ויתרה — לכל סעיף ולכל שנה.',
    icon: Coins,
  },
  {
    to: '/scorecards',
    label: 'לפי משרד',
    description: 'טבלת ליגה: גודל תקציב, שיעור ביצוע, ריכוזיות רכש וציון שקיפות היומנים.',
    icon: Landmark,
  },
  {
    to: '/diaries',
    label: 'לפי אדם',
    description: 'שרים, סגנים ומנכ"לים: במה עסק הזמן שדווח, ומה לא נרשם בו.',
    icon: Users,
  },
  {
    to: '/findings',
    label: 'לפי ממצא',
    description: 'חריגים בתקציב והצלבות ליומנים, מדורגים לפי עוצמה ולא לפי סדר האיסוף.',
    icon: ListChecks,
  },
] as const;

export function HomePage({ summary }: { summary: SiteSummary }): JSX.Element {
  const [lead, ...rest] = summary.insights;

  const trendPoints = summary.trend.map((point) => ({
    label: String(point.fiscalYear),
    values: {
      originalBudget: point.originalBudget,
      updatedBudget: point.updatedBudget,
      execution: point.execution,
    },
  }));

  const withUpdated = summary.trend.filter((t) => t.updatedBudget !== null);
  const first = withUpdated[0] ?? null;
  const last = withUpdated[withUpdated.length - 1] ?? null;
  const trendChange =
    first === null || last === null ? null : changePercent(first.updatedBudget, last.updatedBudget);

  const takeaway = budgetTrendSentence(
    summary.trend.map((t) => ({
      fiscalYear: t.fiscalYear,
      originalBudget: t.originalBudget,
      updatedBudget: t.updatedBudget,
      execution: t.execution,
      executionIsEstimate: t.executionIsEstimate,
      executionStatus: t.executionStatus,
      recordCount: 0,
    })),
    'כל הסעיפים שנאספו',
  );

  return (
    <div className="space-y-10">
      {/* The lead: one figure, in words, before anything else. */}
      <section aria-labelledby="lead-heading">
        <p className="eyebrow">
          {SITE_TITLE} · {summary.dataVersion.governmentPeriod} ·{' '}
          <span className="num">
            {formatDate(summary.windowStart)}–{formatDate(summary.windowEnd)}
          </span>
        </p>
        <h1 id="lead-heading" className="mt-1">
          {SITE_TAGLINE}
        </h1>

        {lead !== undefined ? (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
            <InsightCard insight={lead} featured />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Card>
                <p className="text-sm font-medium text-ink-2">מה יש כאן</p>
                <ul className="mt-2 space-y-1 text-sm text-ink-2">
                  <li>
                    <span className="num font-semibold text-ink">
                      {formatNumber(summary.counts.ministries)}
                    </span>{' '}
                    סעיפי תקציב, מהם{' '}
                    <span className="num">{formatNumber(summary.counts.ministrySections)}</span>{' '}
                    משרדי ממשלה
                  </li>
                  <li>
                    <span className="num font-semibold text-ink">
                      {formatNumber(summary.counts.budgetItems)}
                    </span>{' '}
                    רשומות תקציב וביצוע
                  </li>
                  <li>
                    <span className="num font-semibold text-ink">
                      {formatNumber(summary.counts.diaryEntries)}
                    </span>{' '}
                    שורות יומן של{' '}
                    <span className="num">{formatNumber(summary.counts.diaryPeople)}</span> בעלי
                    תפקידים
                  </li>
                  <li>
                    <span className="num font-semibold text-ink">
                      {formatNumber(summary.counts.activityItems)}
                    </span>{' '}
                    פריטי פעילות פומבית
                  </li>
                </ul>
                <QualityNote label="מה אין כאן">
                  <p>
                    האתר אינו יודע במה עוסקים עובדי המשרדים. הוא מציג פרסומים פומביים, נתוני תקציב
                    ממקורות רשמיים, וקטלוג מקורות שניתן לאמת — ולא תמונה מלאה של פעילות הממשלה.
                  </p>
                  <p>
                    אין באתר מעקב יישום החלטות ממשלה ואין מדדי תוצאה, כי אלה טרם נאספו. אין גם תיקון
                    למדד המחירים: כל שינוי רב-שנתי כאן נומינלי.
                  </p>
                </QualityNote>
              </Card>
              {trendChange !== null && (
                <Card>
                  <p className="text-sm font-medium text-ink-2">
                    התקציב המעודכן, {first?.fiscalYear}–{last?.fiscalYear}
                  </p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <p className="num text-2xl font-semibold text-ink">
                      {formatCurrencyShort(last?.updatedBudget ?? null)}
                    </p>
                    <Sparkline
                      values={summary.trend.map((t) => t.updatedBudget)}
                      label={`מגמת התקציב המעודכן, ${first?.fiscalYear} עד ${last?.fiscalYear}`}
                    />
                  </div>
                  <p className="mt-1 text-xs text-ink-2">
                    <span
                      className={`num font-medium ${trendChange > 0 ? 'text-up' : 'text-down'}`}
                    >
                      {trendChange > 0 ? '+' : ''}
                      {formatPercent(trendChange)}
                    </span>{' '}
                    מ-{first?.fiscalYear} <span className="text-ink-3">(נומינלי)</span>
                  </p>
                </Card>
              )}
            </div>
          </div>
        ) : (
          <Callout tone="caution" title="אין תובנות בגרסת הנתונים הזו">
            <p>קובץ הסיכום נבנה בלי ממצאים. המסכים המפורטים עדיין זמינים.</p>
          </Callout>
        )}
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="insights-heading">
          <SectionHeading
            id="insights-heading"
            title="מה בולט בנתונים"
            description="נבחר אוטומטית לפי עוצמת האפקט, איכות הנתון ונדירות התופעה — ולא לפי סדר האיסוף. לכל תובנה מוצג גם מה היא אינה אומרת."
            action={
              <Link className="link text-sm" to="/how-to-read">
                איך נקבע הדירוג
              </Link>
            }
          />
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rest.map((insight) => (
              <li key={insight.id}>
                <InsightCard insight={insight} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="hundred-heading">
        <SectionHeading
          id="hundred-heading"
          title="מכל 100 ש״ח בתקציב"
          description="פירוק ההוצאה לפי הסיווג הכלכלי הרשמי של משרד האוצר. הדרך הקצרה להבין על מה בנוי התקציב, בלי לקרוא היררכיית סעיפים."
        />
        <HundredShekel
          slices={summary.hundredShekel}
          year={summary.hundredShekelYear}
          emptyReason="לא נמצאו שורות סיווג כלכלי חיוביות בשנים שנאספו, ולכן אין פירוק להצגה."
        />
      </section>

      <section aria-labelledby="trend-heading">
        <SectionHeading
          id="trend-heading"
          title="מגמה רב-שנתית"
          description="תקציב מקורי מול מעודכן מול ביצוע או אומדן, לכל הסעיפים שנאספו."
        />
        <ChartWithTable
          title="תקציב וביצוע לפי שנה"
          points={trendPoints}
          series={BUDGET_SERIES}
          kind="line"
          takeaway={takeaway}
          emptyReason="אין רשומות תקציב בגרסת הנתונים הזו. פירוט מה נאסף ומה לא — במסך המתודולוגיה."
        />
      </section>

      <section aria-labelledby="entry-heading">
        <SectionHeading
          id="entry-heading"
          title="ארבע דרכים להיכנס לנתונים"
          description="כל מסך פותח באותם נתונים מזווית אחרת."
        />
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ENTRY_POINTS.map((entry) => {
            const Icon = entry.icon;
            return (
              <li key={entry.to}>
                <Link
                  to={entry.to}
                  className="card flex h-full items-start gap-3 p-4 transition hover:border-brand/50 hover:bg-surface-2"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      {entry.label}
                      <ArrowLeft className="h-4 w-4 text-ink-3" aria-hidden="true" />
                    </span>
                    <span className="mt-1 block text-sm text-ink-2">{entry.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="read-first-heading">
        <h2 id="read-first-heading" className="sr-only">
          לפני שמסתמכים על מספר
        </h2>
        <Card className="flex flex-wrap items-center justify-between gap-4 bg-brand-soft">
          <div>
            <h3>לפני שמסתמכים על מספר</h3>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">
              מסך אחד מרכז את כל ההסתייגויות: מה נאסף, מה המשמעות של כל מדד, איך נקבע הדירוג, ומה
              המגבלות הידועות. הן אינן חוזרות בכל מסך — הן צמודות לכל מספר, בלחיצה.
            </p>
            <p className="mt-2 flex flex-wrap gap-2">
              <Badge tone="muted">
                גרסת נתונים <span className="num">{summary.dataVersion.version}</span>
              </Badge>
              <Badge tone="muted">
                <span className="num">{formatNumber(summary.counts.sourcesRetrieved)}</span> מקורות
                אוחזרו עם checksum
              </Badge>
            </p>
          </div>
          <Link to="/how-to-read" className="btn btn-primary">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            איך לקרוא את האתר
          </Link>
        </Card>
      </section>
    </div>
  );
}
