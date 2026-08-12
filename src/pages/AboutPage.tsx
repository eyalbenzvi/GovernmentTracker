import { Link } from 'react-router-dom';
import type { Coverage, Dataset } from '../types/domain';
import { Badge, Callout, Card, SectionHeading } from '../components/ui';
import { CsvDownloadButton } from '../components/controls';
import { DataTable, type Column } from '../components/DataTable';
import { formatDate, formatNumber } from '../lib/format';
import { DATA_DIR_URL, REPO_URL } from '../lib/site';

export function AboutPage({ data }: { data: Dataset }): JSX.Element {
  const { dataVersion, coverage, ministries } = data;

  const counts: ReadonlyArray<{ label: string; value: number; note?: string }> = [
    { label: 'משרדים במאגר', value: dataVersion.counts.ministries },
    {
      label: 'משרדים עם נתוני תקציב',
      value: dataVersion.counts.ministriesWithBudgetData,
      note: 'מתוך המשרדים במאגר',
    },
    {
      label: 'משרדים עם פריטי פעילות',
      value: dataVersion.counts.ministriesWithActivityData,
      note: 'מתוך המשרדים במאגר',
    },
    { label: 'רשומות תקציב', value: dataVersion.counts.budgetItems },
    { label: 'פריטי פעילות', value: dataVersion.counts.activityItems },
    { label: 'כהונות שרים', value: dataVersion.counts.ministerTenures },
    { label: 'מקורות בקטלוג', value: dataVersion.counts.sources },
    {
      label: 'מקורות שגופם אוחזר',
      value: dataVersion.counts.sourcesRetrieved,
      note: 'היתר נשמרו כהפניה בלבד',
    },
    { label: 'נושאים מוגדרים', value: dataVersion.counts.topicsDefined },
    {
      label: 'נושאים מגובים בפריטים',
      value: dataVersion.counts.topicsWithActivity,
      note: 'נושא ללא פריטים אינו מוצג כנתון',
    },
  ];

  const columns: Column<Coverage>[] = [
    {
      key: 'ministry',
      header: 'משרד',
      render: (row) => {
        const ministry = ministries.find((m) => m.id === row.ministryId);
        return (
          <Link className="link" to={`/ministry/${row.ministryId}`}>
            {ministry?.officialName ?? row.ministryId}
          </Link>
        );
      },
      sortValue: (row) => row.ministryId,
    },
    {
      key: 'range',
      header: 'טווח כיסוי',
      render: (row) => (
        <span className="num">
          {formatDate(row.dateRangeStart)} – {formatDate(row.dateRangeEnd)}
        </span>
      ),
      sortValue: (row) => row.dateRangeStart,
    },
    {
      key: 'sourcesDefined',
      header: 'מקורות מוגדרים',
      render: (row) => <span className="num">{formatNumber(row.sourcesDefined)}</span>,
      sortValue: (row) => row.sourcesDefined,
      align: 'end',
    },
    {
      key: 'sourcesCollected',
      header: 'מקורות שאוחזרו',
      render: (row) => (
        <span className="num">{formatNumber(row.sourcesSuccessfullyCollected)}</span>
      ),
      sortValue: (row) => row.sourcesSuccessfullyCollected,
      align: 'end',
    },
    {
      key: 'budget',
      header: 'רשומות תקציב',
      render: (row) => <span className="num">{formatNumber(row.budgetRecordCount)}</span>,
      sortValue: (row) => row.budgetRecordCount,
      align: 'end',
    },
    {
      key: 'years',
      header: 'שנות תקציב',
      render: (row) => (
        <span className="num">
          {row.budgetYearsAvailable.length > 0 ? row.budgetYearsAvailable.join(', ') : '—'}
        </span>
      ),
      sortValue: (row) => row.budgetYearsAvailable.length,
      align: 'end',
    },
    {
      key: 'activity',
      header: 'פריטי פעילות',
      render: (row) => <span className="num">{formatNumber(row.activityItemCount)}</span>,
      sortValue: (row) => row.activityItemCount,
      align: 'end',
    },
    {
      key: 'limitations',
      header: 'מגבלות',
      render: (row) => (
        <ul className="max-w-md list-inside list-disc space-y-1 text-xs text-slate-600">
          {row.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl sm:text-3xl">אודות ואיכות נתונים</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          מה בדיוק יש במאגר, מה חסר, וכמה ניתן להסתמך על כל חלק. הדף נבנה מקובצי הנתונים עצמם, ולכן
          אינו יכול לסטות מהם.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="primary">
            <span className="num">גרסת נתונים {dataVersion.version}</span>
          </Badge>
          <Badge tone="muted">
            <span className="num">נבנתה {formatDate(dataVersion.builtAt.slice(0, 10))}</span>
          </Badge>
          <Badge tone="muted">{dataVersion.governmentPeriod}</Badge>
        </div>
      </header>

      <section aria-labelledby="counts-heading">
        <SectionHeading id="counts-heading" title="מספרים בגרסה זו" />
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {counts.map((item) => (
            <li key={item.label}>
              <Card className="h-full">
                <p className="text-sm font-medium text-slate-600">{item.label}</p>
                <p className="num mt-1 text-2xl font-semibold text-slate-900">
                  {formatNumber(item.value)}
                </p>
                {item.note !== undefined && (
                  <p className="mt-1 text-xs text-slate-500">{item.note}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="coverage-table-heading">
        <SectionHeading
          id="coverage-table-heading"
          title="טבלת כיסוי לכל משרד"
          action={
            <CsvDownloadButton
              filename="coverage"
              headers={[
                'משרד',
                'תחילת טווח',
                'סוף טווח',
                'מקורות מוגדרים',
                'מקורות שאוחזרו',
                'רשומות תקציב',
                'שנות תקציב',
                'פריטי פעילות',
                'מגבלות',
              ]}
              rows={(row: Coverage) => [
                row.ministryId,
                row.dateRangeStart,
                row.dateRangeEnd,
                row.sourcesDefined,
                row.sourcesSuccessfullyCollected,
                row.budgetRecordCount,
                row.budgetYearsAvailable,
                row.activityItemCount,
                row.limitations,
              ]}
              items={coverage}
            />
          }
        />
        <DataTable
          items={coverage}
          columns={columns}
          caption="כיסוי נתונים לכל משרד"
          rowKey={(row) => row.ministryId}
          emptyMessage="אין נתוני כיסוי."
        />
      </section>

      <section aria-labelledby="not-collected-heading">
        <SectionHeading id="not-collected-heading" title="מה נכלל ומה לא" />
        <Callout tone="caution">
          <p>
            המאגר מכסה את כל {formatNumber(ministries.length)} סעיפי התקציב הרגיל של תקציב המדינה:{' '}
            {formatNumber(ministries.filter((m) => m.sectionKind === 'ministry').length)} משרדי
            ממשלה והיתר מוסדות, רשויות וסעיפים טכניים (מסומנים בהתאם). זיהוי כל סעיף מבוסס על כותרתו
            הרשמית במקור, המקושרת מעמוד הסעיף.
          </p>
          <p>
            לא נכללים: תקציב הפיתוח (סעיפים תחומיים שאינם נושאים שם משרד), משרדים ללא סעיף תקציב
            עצמאי (מתוקצבים בתוך סעיף משרד ראש הממשלה), והשכבה התמטית קיימת בשלב זה עבור חמשת משרדי
            העומק בלבד — היתר מסומנים "טרם סווג".
          </p>
          <p>
            יומני השרים, סגני השרים והמנכ"לים נאספים מהמאגר הציבורי של התנועה לחופש המידע, ולכל
            רשומה מצוינת שיטת החילוץ — כולל סימון מפורש כאשר הרשומה פוענחה ב-OCR מסריקה ועשויה
            להכיל שגיאות תעתיק. קבצים שלא ניתן היה לקרוא מוצגים ברשימה נפרדת עם הסיבה, ולא שוחזרו
            בניחוש.
          </p>
        </Callout>
      </section>

      <section aria-labelledby="quality-heading">
        <SectionHeading id="quality-heading" title="הערות איכות וחסר" />
        <Card>
          <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
            <li>
              איכות זיהוי המשרד שונה בין משרדים: עבור התחבורה, החינוך והבריאות שם המשרד מופיע בכותרת
              מקור רשמי. עבור הגנת הסביבה והכלכלה הזיהוי נשען על שם קובץ ספר התקציב באתר הכנסת —
              ראיה חלשה יותר, ולכן היא מסומנת במפורש בעמוד המשרד.
            </li>
            <li>
              קוד תקציבי אומת רק עבור משרד התחבורה. עבור יתר המשרדים לא הוצג קוד תקציבי, כדי לא
              להציג מספר שאינו מגובה במקור.
            </li>
            <li>
              שיטת הגילוי היא אינדקס חיפוש. היא מחזירה כותרת ו-URL אמיתיים, אך אינה תחליף לאחזור
              המסמך עצמו. לכן כל פריט בקטלוג נושא שדה סטטוס אחזור.
            </li>
            <li>
              המאגר אינו מכסה את כלל פעילות עובדי המשרדים, ואינו מתיימר לכך. הוא מכסה פרסומים
              פומביים ומסמכי תקציב רשמיים בלבד.
            </li>
          </ul>
        </Card>
      </section>

      <section aria-labelledby="transparency-heading">
        <SectionHeading id="transparency-heading" title="הצהרת שקיפות" />
        <Card>
          <p className="text-sm leading-relaxed text-slate-700">
            אתר זה אינו מקור רשמי ואינו מחליף את המקורות המקוריים. הוא כלי הנגשה: הוא מפנה למקורות
            הרשמיים, מתעד מה נאסף ומה לא, ומאפשר לבדוק כל טענה. במקרה של סתירה בין האתר לבין המקור
            הרשמי — המקור הרשמי קובע.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a className="btn" href={DATA_DIR_URL} target="_blank" rel="noopener noreferrer">
              קובצי הנתונים
            </a>
            <a className="btn" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              קוד המקור
            </a>
            <Link className="btn" to="/methodology">
              מתודולוגיה ומגבלות
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
