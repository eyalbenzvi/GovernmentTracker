import { Link } from 'react-router-dom';
import { AlertOctagon, Github } from 'lucide-react';
import type { Dataset } from '../types/domain';
import { Callout, Card, SectionHeading } from '../components/ui';
import { formatDate, formatNumber } from '../lib/format';
import { DATA_DIR_URL, ISSUES_URL, RAW_DATA_DIR_URL, REPO_URL, SCRIPTS_URL } from '../lib/site';

export function MethodologyPage({ data }: { data: Dataset }): JSX.Element {
  const { methodology, dataVersion } = data;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl sm:text-3xl">מתודולוגיה ומגבלות</h1>
        <p className="mt-2 max-w-3xl text-ink-2">{methodology.purpose}</p>
        <p className="num mt-3 text-sm text-ink-3">
          גרסת נתונים {dataVersion.version} · תאריך איסוף אחרון {formatDate(methodology.windowEnd)}
        </p>
      </header>

      <Callout tone="warning" title="הכלל המרכזי של האתר">
        <p>
          אם אין נתון — כתוב שאין נתון. לא אפס, לא null חשוף, ולא הערכה מוסווית. מספר שאינו ניתן
          לאימות מול מקור אינו מוצג כלל.
        </p>
      </Callout>

      <section aria-labelledby="scope-summary">
        <SectionHeading id="scope-summary" title="גבולות התקופה והנתונים" />
        <Card>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-ink-2">תקופת הממשלה</dt>
              <dd className="mt-1 text-sm text-ink">{methodology.governmentPeriod}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ink-2">טווח הניתוח</dt>
              <dd className="num mt-1 text-sm text-ink">
                {formatDate(methodology.windowStart)} – {formatDate(methodology.windowEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ink-2">שנות תקציב</dt>
              <dd className="num mt-1 text-sm text-ink">{methodology.analysisYears.join(', ')}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-rule pt-4 text-sm text-ink-2">
            תאריך תחילת הטווח הוא פרמטר מוצהר של המוצר — תחילת כהונת הממשלה ה-37 — ולא נתון שנאסף.
            אימות מול המקור הרשמי אפשרי דרך עמוד ממשלות ישראל שמקוטלג ב
            <Link className="link" to="/sources">
              קטלוג המקורות
            </Link>
            .
          </p>
        </Card>
      </section>

      {methodology.sections.map((section) => (
        <section key={section.id} aria-labelledby={`section-${section.id}`}>
          <SectionHeading id={`section-${section.id}`} title={section.title} />
          <Card>
            <div className="space-y-3 text-sm leading-relaxed text-ink-2">
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.id}-${index}`}>{paragraph}</p>
              ))}
            </div>
          </Card>
        </section>
      ))}

      <section aria-labelledby="causation-heading">
        <SectionHeading id="causation-heading" title="איסור פירוש מתאם כסיבתיות" />
        <div className="rounded-lg border border-state-partial/40 bg-state-partial-soft p-5">
          <div className="flex gap-3">
            <AlertOctagon className="h-6 w-6 shrink-0 text-state-partial" aria-hidden="true" />
            <div className="space-y-2 text-sm leading-relaxed text-ink">
              <p>
                גם כאשר מוצג קשר בין נושא פעילות ובין סעיף תקציבי, אין להסיק ממנו סיבתיות. הופעה של
                נושא בפרסומי משרד אינה מוכיחה שהתקציב הוקצה בעקבותיה, וגם לא ההפך.
              </p>
              <p>
                תקציב נקבע בתהליכים רבים — חקיקה, משא ומתן, החלטות ממשלה, אילוצי חירום — שאינם באים
                לידי ביטוי בפרסום פומבי. פרסום פומבי הוא אינדיקציה חלקית מאוד, ותכיפות פרסום אינה
                מדד להיקף עבודה.
              </p>
              <p>
                כל קשר באתר מוצג עם הראיות שמאחוריו ועם הסבר המיפוי, כדי שניתן יהיה לבדוק אותו
                ולדחות אותו.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="known-limits">
        <SectionHeading
          id="known-limits"
          title="מגבלות נתונים ידועות"
          description="נכון לגרסת נתונים זו."
        />
        <Card>
          <ul className="list-inside list-disc space-y-2 text-sm text-ink-2">
            {/* These two were written when the site had no budget or activity data
                at all, and kept interpolating the count after it did — so the page
                read "there is no budget data on the site: 2,725 records were
                collected". A limitation that no longer holds must stop being
                published as one. */}
            {dataVersion.counts.budgetItems === 0 ? (
              <li>
                אין באתר נתוני תקציב או ביצוע בגרסה זו. הסיבה מפורטת בסעיף מגבלת סביבת הבנייה.
              </li>
            ) : (
              <li>
                נתוני התקציב מכסים את התקציב הרגיל בלבד:{' '}
                {formatNumber(dataVersion.counts.budgetItems)} רשומות. תקציב הפיתוח, המפעלים
                העסקיים, שירות החוב והרזרבה הכללית אינם נכללים — ראו "מה לא נכלל בנתוני התקציב".
              </li>
            )}
            {dataVersion.counts.activityItems === 0 ? (
              <li>אין באתר פריטי פעילות בגרסה זו.</li>
            ) : (
              <li>
                פריטי הפעילות מכסים {formatNumber(dataVersion.counts.ministriesWithActivityData)}{' '}
                מתוך {formatNumber(dataVersion.counts.ministries)} הסעיפים:{' '}
                {formatNumber(dataVersion.counts.activityItems)} פריטים. היעדר פריטים בסעיף אינו
                היעדר פעילות.
              </li>
            )}
            {dataVersion.counts.ministerTenures === 0 ? (
              <li>
                אין באתר נתוני כהונת שרים בגרסה זו: תאריכי כהונה לא נאספו ממקור רשמי, ואינם נגזרים
                בהסקה.
              </li>
            ) : (
              <li>
                כהונות השרים נאספות משירות ה-OData של הכנסת —{' '}
                {formatNumber(dataVersion.counts.ministerTenures)} כהונות, מהן{' '}
                {formatNumber(dataVersion.counts.ministerTenuresEnded)} הסתיימו במהלך כהונת הממשלה.
                מינוי במשרד שאין לו סעיף תקציב עצמאי נספר בנפרד ואינו משויך בכוח לסעיף שכן.
              </li>
            )}
            <li>
              קטלוג המקורות מכיל {formatNumber(dataVersion.counts.sources)} מקורות אמיתיים, אך גוף
              המסמך אוחזר עבור {formatNumber(dataVersion.counts.sourcesRetrieved)} מהם בלבד.
            </li>
            <li>
              {formatNumber(dataVersion.counts.topicsDefined)} נושאים מוגדרים בטקסונומיה, מתוכם{' '}
              {formatNumber(dataVersion.counts.topicsWithActivity)} מגובים בפריטי פעילות. נושא ללא
              פריטים אינו מוצג כנתון בשום מסך.
            </li>
            <li>
              נתוני תקציב מקובצי PDF ו-Excel לא חולצו. חילוץ טבלאות מפריסת PDF אינו אמין, ולכן
              המקורות נשמרו לאימות אנושי במקום להיות מנוחשים.
            </li>
            <li>
              רשימת המשרדים במאגר כוללת {formatNumber(dataVersion.counts.ministries)} משרדים בלבד —
              אלה שנמצאו עבורם מקורות. לא נבנתה רשימה משוערת של יתר המשרדים.
            </li>
          </ul>
        </Card>
      </section>

      <section aria-labelledby="corrections-heading">
        <SectionHeading id="corrections-heading" title="מדיניות תיקון שגיאות" />
        <Card>
          <p className="text-sm text-ink-2">
            מצאתם נתון שגוי, מקור שאינו במקומו, מיפוי מוטעה או ניסוח מטעה — אנא פתחו Issue. כל תיקון
            נבדק מול המקור הראשוני לפני שינוי הנתונים.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              className="btn btn-primary"
              href={ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              פתיחת Issue לתיקון נתון
            </a>
            <a className="btn" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              ה-repository
            </a>
            <a className="btn" href={DATA_DIR_URL} target="_blank" rel="noopener noreferrer">
              קובצי הנתונים המעובדים
            </a>
            <a className="btn" href={RAW_DATA_DIR_URL} target="_blank" rel="noopener noreferrer">
              נתוני הגלם ויומני האיסוף
            </a>
            <a className="btn" href={SCRIPTS_URL} target="_blank" rel="noopener noreferrer">
              סקריפטי האיסוף
            </a>
          </div>
        </Card>
      </section>

      <section aria-labelledby="catalog-link-heading">
        <SectionHeading
          id="catalog-link-heading"
          title="קטלוג מקורות מלא"
          description={`${formatNumber(dataVersion.counts.sources)} מקורות, עם מפרסם, סוג, תקופה, שיטת גילוי וסטטוס אחזור.`}
        />
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-ink-2">
            הקטלוג ניתן לסינון לפי משרד, שנה, סוג ומפרסם, וניתן להורדה כ-CSV.
          </p>
          <Link className="btn btn-primary" to="/sources">
            למסך קטלוג המקורות
          </Link>
        </Card>
      </section>
    </div>
  );
}
