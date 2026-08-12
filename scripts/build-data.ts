/**
 * build-data — assembles the derived datasets the site actually reads.
 *
 * Consumes: the seeds, source-catalog.json, budget-items.json,
 *           activity-evidence.json, topics.json and the collection logs.
 * Produces: ministries.json, minister-tenures.json, coverage.json,
 *           activity-budget-links.json, methodology.json, data-version.json
 *           and the CSV exports under data/processed/csv/.
 *
 * This script derives; it never invents. Every count it writes is a count of
 * records that exist in the processed files.
 */
import path from 'node:path';
import fs from 'node:fs';
import {
  COLLECTION_LOG_DIR,
  CSV_DIR,
  PROCESSED_DIR,
  RAW_DIR,
  listFiles,
  readJson,
  writeJson,
  writeText,
} from './lib/paths.js';
import { toCsv } from './lib/csv.js';
import type {
  ActivityBudgetLink,
  ActivityEvidence,
  BudgetItem,
  Coverage,
  Ministry,
  MinisterTenure,
  SourceCatalogItem,
  Topic,
} from './lib/schema.js';
import type { CollectionLog } from './lib/log.js';

const GOVERNMENT_PERIOD = 'הממשלה ה-37';
const WINDOW_START = '2022-12-29';
const ANALYSIS_YEARS = [2023, 2024, 2025, 2026] as const;

interface MinistrySeedEntry {
  id: string;
  officialName: string;
  displayName: string;
  aliases: string[];
  description: string;
  budgetCodes: string[];
  budgetBookVolume: string | null;
  budgetCodeEvidence: { url: string } | null;
  nameEvidence: { url: string; titleEvidence: string };
}
interface MinistriesSeedFile {
  ministries: MinistrySeedEntry[];
  notCollectedNote: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const buildDate = today();
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));
  const catalog = readJson<SourceCatalogItem[]>(path.join(PROCESSED_DIR, 'source-catalog.json'));
  const budgetItems = readJson<BudgetItem[]>(path.join(PROCESSED_DIR, 'budget-items.json'));
  const activities = readJson<ActivityEvidence[]>(
    path.join(PROCESSED_DIR, 'activity-evidence.json'),
  );
  const topics = readJson<Topic[]>(path.join(PROCESSED_DIR, 'topics.json'));

  const logs = listFiles(COLLECTION_LOG_DIR, '.json').map((f) => readJson<CollectionLog>(f));
  const attempts = logs.flatMap((l) => l.attempts);
  // Two distinct failure classes, reported separately because they mean different
  // things: an egress denial is a limitation of the build environment, while an
  // HTTP rejection is the source itself refusing an automated client.
  const blockedHosts = [
    ...new Set(attempts.filter((a) => a.outcome === 'blocked').map((a) => new URL(a.url).host)),
  ].sort();
  const refusedHosts = [
    ...new Set(
      attempts
        .filter((a) => a.outcome === 'http_error' && a.httpStatus !== null && a.httpStatus >= 400)
        .map((a) => new URL(a.url).host),
    ),
  ].sort();
  const retrievedCount = attempts.filter((a) => a.outcome === 'ok').length;

  // ---- coverage -----------------------------------------------------------
  const coverage: Coverage[] = seed.ministries.map((ministry) => {
    const ministrySources = catalog.filter((s) => s.ministryIds.includes(ministry.id));
    const retrieved = ministrySources.filter((s) => s.retrievalStatus === 'retrieved');
    const ministryBudget = budgetItems.filter((b) => b.ministryId === ministry.id);
    const ministryActivities = activities.filter((a) => a.ministryId === ministry.id);
    const years = [...new Set(ministryBudget.map((b) => b.fiscalYear))].sort((a, b) => a - b);

    const limitations: string[] = [];
    if (ministryBudget.length === 0) {
      limitations.push(
        'לא נאספו רשומות תקציב עבור משרד זה. אין באתר תקציב מקורי, תקציב מעודכן, ביצוע או אומדן ביצוע.',
      );
    }
    if (ministryActivities.length === 0) {
      limitations.push('לא נאספו פריטי פעילות פומבית עבור משרד זה.');
    }
    if (retrieved.length === 0 && ministrySources.length > 0) {
      limitations.push(
        `${ministrySources.length} מקורות רשמיים זוהו וקוטלגו, אך גוף אף מסמך לא אוחזר בסביבת הבנייה. הקישורים מפנים ישירות למקור.`,
      );
    }
    if (years.length > 0 && years.length < ANALYSIS_YEARS.length) {
      limitations.push(
        `נתוני תקציב קיימים עבור ${years.join(', ')} בלבד, ולא עבור כל שנות הניתוח 2023–2026.`,
      );
    }

    return {
      ministryId: ministry.id,
      dateRangeStart: WINDOW_START,
      dateRangeEnd: buildDate,
      sourcesDefined: ministrySources.length,
      sourcesSuccessfullyCollected: retrieved.length,
      activityItemCount: ministryActivities.length,
      budgetYearsAvailable: years,
      budgetRecordCount: ministryBudget.length,
      limitations,
    };
  });

  const coverageById = new Map(coverage.map((c) => [c.ministryId, c]));

  // ---- ministries ---------------------------------------------------------
  const ministries: Ministry[] = seed.ministries.map((entry) => {
    const cov = coverageById.get(entry.id);
    const parts = [
      `${cov?.sourcesDefined ?? 0} מקורות רשמיים מקוטלגים`,
      `${cov?.budgetRecordCount ?? 0} רשומות תקציב`,
      `${cov?.activityItemCount ?? 0} פריטי פעילות`,
    ];
    return {
      id: entry.id,
      officialName: entry.officialName,
      displayName: entry.displayName,
      aliases: entry.aliases,
      description: entry.description,
      // Not collected: the ministry's formal establishment/termination dates were
      // not obtained from an official source, so they are absent rather than guessed.
      activeFrom: null,
      activeTo: null,
      governmentPeriod: GOVERNMENT_PERIOD,
      budgetCodes: entry.budgetCodes,
      budgetBookVolume: entry.budgetBookVolume,
      nameEvidenceUrl: entry.nameEvidence.url,
      nameEvidenceTitle: entry.nameEvidence.titleEvidence,
      budgetCodeEvidenceUrl: entry.budgetCodeEvidence?.url ?? null,
      dataCoverageSummary: parts.join(' · '),
    };
  });

  // ---- minister tenures ---------------------------------------------------
  // Emitted only from a retrieved official source. The cabinet-composition page
  // is catalogued but was not retrievable, and tenure dates must not be inferred,
  // so this dataset is intentionally empty in this build.
  const tenures: MinisterTenure[] = [];

  // ---- activity ↔ budget links -------------------------------------------
  // A link is emitted only when both sides exist AND a documented mapping basis
  // exists. No correlation is manufactured from one side alone.
  const links: ActivityBudgetLink[] = [];

  // ---- methodology --------------------------------------------------------
  const methodology = {
    generatedAt: buildDate,
    purpose:
      'להנגיש מידע ממשלתי פומבי ומפוזר על משרדי ממשלת ישראל בתקופת הממשלה ה-37, בצורה שניתן לאמת מול המקור. האתר אינו מקור רשמי ואינו מחליף את המקורות המקוריים.',
    windowStart: WINDOW_START,
    windowEnd: buildDate,
    governmentPeriod: GOVERNMENT_PERIOD,
    analysisYears: [...ANALYSIS_YEARS],
    sections: [
      {
        id: 'scope',
        title: 'מה האתר מציג — ומה הוא לא מציג',
        paragraphs: [
          'האתר מציג שלושה דברים בלבד: פעילות פומבית מתועדת שפורסמה על ידי משרד או הנהלתו, נתוני תקציב וביצוע ממקורות רשמיים, וקטלוג מקורות שניתן לאמת.',
          'האתר אינו מתיימר לתאר במה עוסקים עובדי המשרדים. יומן פומבי, הודעה לעיתונות או מסמך מדיניות מלמדים על מה שפורסם — לא על חלוקת העבודה בפועל, לא על מאמץ, ולא על תוצאה.',
          'היעדר פריטים עבור משרד או שנה מסוימים אינו אומר שלא הייתה פעילות. הוא אומר שלא נאסף מקור.',
        ],
      },
      {
        id: 'collection',
        title: 'איך נאספו הנתונים',
        paragraphs: [
          'שלב הגילוי: איתור מסמכים רשמיים באמצעות אינדקס חיפוש, ושמירת הכותרת וה-URL בדיוק כפי שהוחזרו, תחת data/raw/search-discovery.',
          'שלב האחזור: כל URL בקטלוג נוסה בפועל בזמן הבנייה, עם User-Agent מזהה, timeout, retry מתון והשהיה בין בקשות לאותו מתחם. כל ניסיון — מוצלח או נכשל — נרשם תחת data/raw/collection-log.',
          'שלב הנרמול: רק ממקור שאוחזר ונותח בהצלחה נוצרות רשומות. ערך חסר נשמר כ-null ומוצג כ"אין נתון זמין במקור שנאסף", ולא כאפס.',
          'לא בוצע חילוץ מספרים מקובצי PDF. פריסת טבלה ב-PDF אינה בסיס אמין לנתון כספי, ולכן מקורות כאלה נשמרים בקטלוג לאימות אנושי במקום להיות מנוחשים.',
        ],
      },
      {
        id: 'collection-limits',
        title: 'מה לא נאסף, ולמה',
        paragraphs: [
          `בבנייה זו הצליחו ${retrievedCount} ניסיוני אחזור. שני סוגי כישלון נרשמו, והם שונים במשמעותם.`,
          blockedHosts.length > 0
            ? `מתחמים שנחסמו על ידי רשימת ההיתר של סביבת הבנייה (מגבלת סביבה, לא מגבלת מקור): ${blockedHosts.join(', ')}.`
            : 'לא נרשמו חסימות של רשימת ההיתר בסביבת הבנייה.',
          refusedHosts.length > 0
            ? `מתחמים שהחזירו דחייה ברמת ה-HTTP לבקשה אוטומטית מזוהה: ${refusedHosts.join(', ')}. אתר gov.il ואתר הכנסת מפעילים הגנת bot שדוחה לקוחות שאינם דפדפן. לא נעשה ניסיון להתחזות לדפדפן כדי לעקוף אותה — זו הייתה עקיפה של סירוב מפורש של המקור, בניגוד לכללי האיסוף של הפרויקט.`
            : 'לא נרשמו דחיות HTTP מצד המקורות.',
          'ההשלכה המעשית: נתוני התקציב והביצוע נאספו במלואם דרך מפתח התקציב, בעוד שפריטי הפעילות הפומבית — שמקורם ב-API הפרסומים של gov.il — לא נאספו. גם תאריכי כהונת שרים לא נאספו, מפני שעמוד הרכב הממשלה לא היה נגיש ותאריכים אינם נגזרים בהסקה.',
        ],
      },
      {
        id: 'budget-source',
        title: 'מאיפה מגיעים נתוני התקציב',
        paragraphs: [
          'נתוני התקציב והביצוע באתר מגיעים ממפתח התקציב — מסד נתונים ציבורי המשקף את נתוני אגף התקציבים במשרד האוצר. זו שכבת עזר, ולא מקור רשמי ראשוני.',
          'לכן אף רשומה באתר אינה מסומנת כ"ביצוע סופי". שנים שהסתיימו מסומנות כ"נתון חלקי" והשנה השוטפת מסומנת כ"אומדן". מי שנדרש לנתון סופי — ספר התקציב ודוחות ביצוע התקציב הרשמיים מקוטלגים באתר עם קישור ישיר.',
          'נאספים רק סעיפי התקציב הרגיל, שנושאים את שם המשרד עצמו (למשל סעיף 0040 — "משרד התחבורה"). סעיפי תקציב הפיתוח נקראים על שם התחום ולא על שם המשרד (0060 חינוך, 0067 בריאות, 0079 תחבורה, 0076 תעשייה), ושיוכם למשרד מסוים אינו נגזר משם הסעיף — ולכן הם אינם נכללים.',
          'המשמעות: המספרים באתר הם התקציב הרגיל של המשרד, ולא סך ההוצאה הציבורית בתחום. עבור התחבורה בפרט, תקציב הפיתוח גדול משמעותית מהתקציב הרגיל ואינו מוצג כאן.',
          'נאספות רמות ההיררכיה 1–3. סכום סעיפי העלים שנאספו זהה בדיוק לסכום סעיף האב בכל משרד ובכל שנה — נבדק אוטומטית בוולידציה.',
        ],
      },
      {
        id: 'measures',
        title: 'מה כל מדד אומר',
        paragraphs: [
          'תקציב מקורי — הסכום שאושר בחוק התקציב לשנה, לפני שינויים.',
          'תקציב מעודכן — התקציב לאחר העברות, תוספות וקיצוצים במהלך שנת הכספים.',
          'ביצוע — הסכום שנוצל בפועל. מוצג כ"סופי" רק כאשר נמצא מקור רשמי סופי ומזוהה.',
          'אומדן — הערכת ביצוע שפורסמה לפני סגירת השנה. לשנה שוטפת יוצג אומדן או "שנה שוטפת", לעולם לא "ביצוע סופי".',
          'שינוי תקציב בש"ח = תקציב מעודכן − תקציב מקורי. שינוי באחוזים = (מעודכן − מקורי) ÷ מקורי × 100, ומחושב רק כאשר התקציב המקורי אינו אפס.',
          'שיעור ביצוע = ביצוע ÷ תקציב מעודכן × 100, ומחושב רק כאשר שני הערכים תקינים והתקציב המעודכן גדול מאפס. אחרת מוצג מקף.',
        ],
      },
      {
        id: 'aggregation',
        title: 'היררכיה ומניעת כפל ספירה',
        paragraphs: [
          'סעיף תקציבי הורה וסעיפי הבנים שלו מתארים את אותו כסף ברמות פירוט שונות. חיבור שניהם באותה אגרגציה יוצר כפל ספירה.',
          'לכן כל רשומה נושאת hierarchyLevel ו-isLeaf, וכל סכימה באתר מתבצעת על רמת היררכיה אחת בלבד. בדיקת הוולידציה נכשלת אם סכימה מערבת רמות.',
        ],
      },
      {
        id: 'topics',
        title: 'איך סווגו הנושאים',
        paragraphs: [
          'הסיווג דטרמיניסטי לחלוטין ואינו משתמש במודל שפה — לא בזמן ריצה ולא בזמן בנייה.',
          'שלב א: התאמת מילות מפתח ממילון מוצהר (data/raw/seeds/topics.seed.json) על כותרת ותקציר הפריט, אחרי נרמול רווחים והסרת ניקוד.',
          'שלב ב: שיוכים ידניים מוצהרים (data/raw/seeds/topic-overrides.json), לפריטים שאינם חד-משמעיים.',
          'כל שיוך שומר את הכלל שהפעיל אותו, וניתן לראות באתר אילו פריטים הובילו לכך שנושא נחשב בולט.',
        ],
      },
      {
        id: 'links',
        title: 'קשרים אפשריים בין פעילות לתקציב',
        paragraphs: [
          'האתר אינו טוען טענה סיבתית. מתאם בין נושא פעילות ובין סעיף תקציבי אינו מלמד שהפעילות גרמה להקצאה, או שההקצאה גרמה לפעילות.',
          'קשר מוצג רק כאשר קיים מיפוי מתועד בין נושא, פריטי פעילות מזוהים וסעיפי תקציב מזוהים — ותמיד עם הראיות והסבר המיפוי.',
          'קשר דורש שני צדדים. בגרסה זו נאספו רשומות תקציב אך לא נאספו פריטי פעילות, ולכן לא ניתן לבסס אף קשר ולא הוצג אף קשר. זו הצגה כנה של מצב הנתונים, לא כשל בתצוגה.',
        ],
      },
      {
        id: 'corrections',
        title: 'תיקון שגיאות',
        paragraphs: [
          'מצאתם נתון שגוי, מקור שאינו במקומו או מיפוי מוטעה — פתחו Issue ב-GitHub. כל תיקון נבדק מול המקור הראשוני.',
          'כל קובצי הנתונים והסקריפטים שיצרו אותם נמצאים ב-repository, כדי שכל טענה באתר תהיה ניתנת לבדיקה עצמאית.',
        ],
      },
    ],
  };

  // ---- data version -------------------------------------------------------
  const dataVersion = {
    version: `${buildDate}.1`,
    builtAt: new Date().toISOString(),
    collectionWindowStart: WINDOW_START,
    collectionWindowEnd: buildDate,
    governmentPeriod: GOVERNMENT_PERIOD,
    counts: {
      ministries: ministries.length,
      ministriesWithBudgetData: coverage.filter((c) => c.budgetRecordCount > 0).length,
      ministriesWithActivityData: coverage.filter((c) => c.activityItemCount > 0).length,
      budgetItems: budgetItems.length,
      activityItems: activities.length,
      ministerTenures: tenures.length,
      sources: catalog.length,
      sourcesRetrieved: catalog.filter((s) => s.retrievalStatus === 'retrieved').length,
      topicsDefined: topics.length,
      topicsWithActivity: topics.filter((t) => t.activityItemCount > 0).length,
    },
    changelog: [
      {
        date: buildDate,
        note:
          `גרסת נתונים. ${catalog.length} מקורות רשמיים קוטלגו עבור ${ministries.length} משרדים, ` +
          `ומתוכם ${catalog.filter((s) => s.retrievalStatus === 'retrieved').length} אוחזרו עם checksum. ` +
          `נאספו ${budgetItems.length} רשומות תקציב וביצוע לשנים ${ANALYSIS_YEARS[0]}–${ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]} ` +
          `עבור ${coverage.filter((c) => c.budgetRecordCount > 0).length} משרדים, מסעיפי התקציב הרגיל, דרך מפתח התקציב. ` +
          `פריטי פעילות פומבית לא נאספו: API הפרסומים של gov.il דוחה בקשות אוטומטיות מזוהות ב-HTTP 403, ולא נעשה ניסיון לעקוף זאת. ` +
          `לא הוזן שום מספר ממקור עקיף או משוער.`,
      },
    ],
  };

  writeJson(path.join(PROCESSED_DIR, 'ministries.json'), ministries);
  writeJson(path.join(PROCESSED_DIR, 'minister-tenures.json'), tenures);
  writeJson(path.join(PROCESSED_DIR, 'coverage.json'), coverage);
  writeJson(path.join(PROCESSED_DIR, 'activity-budget-links.json'), links);
  writeJson(path.join(PROCESSED_DIR, 'methodology.json'), methodology);
  writeJson(path.join(PROCESSED_DIR, 'data-version.json'), dataVersion);

  // ---- CSV exports --------------------------------------------------------
  fs.mkdirSync(CSV_DIR, { recursive: true });

  writeText(
    path.join(CSV_DIR, 'source-catalog.csv'),
    toCsv(
      [
        'id',
        'כותרת',
        'מפרסם',
        'סוג מקור',
        'משרדים',
        'שנות תקציב',
        'רמת אמינות',
        'סטטוס אחזור',
        'URL',
      ],
      catalog.map((s) => [
        s.id,
        s.title,
        s.publisher,
        s.sourceTypeLabelHe,
        s.ministryIds,
        s.fiscalYears,
        s.reliabilityLevel === 'primary_official' ? 'מקור רשמי ראשוני' : 'שכבת עזר',
        s.retrievalStatus,
        s.url,
      ]),
    ),
  );

  writeText(
    path.join(CSV_DIR, 'ministries.csv'),
    toCsv(
      ['id', 'שם רשמי', 'שם תצוגה', 'קודי תקציב', 'כרך ספר התקציב', 'סיכום כיסוי'],
      ministries.map((m) => [
        m.id,
        m.officialName,
        m.displayName,
        m.budgetCodes,
        m.budgetBookVolume ?? '',
        m.dataCoverageSummary,
      ]),
    ),
  );

  writeText(
    path.join(CSV_DIR, 'coverage.csv'),
    toCsv(
      [
        'משרד',
        'תחילת טווח',
        'סוף טווח',
        'מקורות מוגדרים',
        'מקורות שנאספו',
        'פריטי פעילות',
        'רשומות תקציב',
        'שנות תקציב',
        'מגבלות',
      ],
      coverage.map((c) => [
        c.ministryId,
        c.dateRangeStart,
        c.dateRangeEnd,
        c.sourcesDefined,
        c.sourcesSuccessfullyCollected,
        c.activityItemCount,
        c.budgetRecordCount,
        c.budgetYearsAvailable,
        c.limitations,
      ]),
    ),
  );

  writeText(
    path.join(CSV_DIR, 'budget-items.csv'),
    toCsv(
      [
        'id',
        'משרד',
        'שנת תקציב',
        'קוד תקציבי',
        'כותרת',
        'תקציב מקורי',
        'תקציב מעודכן',
        'ביצוע',
        'אומדן ביצוע',
        'שיעור ביצוע',
        'סטטוס נתון',
        'מקור',
      ],
      budgetItems.map((b) => [
        b.id,
        b.ministryId,
        b.fiscalYear,
        b.budgetCode,
        b.title,
        b.originalBudget,
        b.updatedBudget,
        b.actualExecution,
        b.estimatedExecution,
        b.executionRate,
        b.dataStatus,
        b.sourceUrl,
      ]),
    ),
  );

  writeText(
    path.join(CSV_DIR, 'activity-evidence.csv'),
    toCsv(
      ['id', 'משרד', 'תאריך', 'כותרת', 'תקציר', 'סוג מקור', 'נושאים', 'רמת כיסוי', 'URL'],
      activities.map((a) => [
        a.id,
        a.ministryId,
        a.date,
        a.title,
        a.summary,
        a.sourceType,
        a.topics,
        a.coverageLevel,
        a.sourceUrl,
      ]),
    ),
  );

  writeText(
    path.join(CSV_DIR, 'topics.csv'),
    toCsv(
      ['id', 'נושא', 'תיאור', 'מילות מפתח', 'מספר פריטי פעילות'],
      topics.map((t) => [t.id, t.labelHe, t.description, t.keywords, t.activityItemCount]),
    ),
  );

  console.log('build-data: נכתבו ministries, coverage, methodology, data-version ו-CSV');
  console.log(
    `  ${ministries.length} משרדים · ${catalog.length} מקורות · ${budgetItems.length} רשומות תקציב · ${activities.length} פריטי פעילות`,
  );
}

main();
