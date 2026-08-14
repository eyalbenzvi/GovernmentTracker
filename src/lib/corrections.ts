/**
 * The corrections log.
 *
 * A site that publishes measures about named office-holders needs a visible record
 * of what it got wrong and when it was fixed. Each entry below is a correction that
 * actually shipped, traceable to the commit that made it and to the review that
 * found it — the log is not a promise of future diligence, it is a record.
 *
 * Entries are appended, never edited or removed. `whatChanged` describes the effect
 * on what a reader saw, not the code change.
 */

export interface Correction {
  id: string;
  date: string;
  /** What a reader saw before the fix. */
  wasShownHe: string;
  /** What is shown now. */
  nowShownHe: string;
  /** Who or what surfaced it. */
  foundByHe: string;
  /** The module that changed, so the fix can be inspected. */
  whereFixed: string;
}

export const CORRECTIONS: readonly Correction[] = [
  {
    id: 'night-meetings-markers',
    date: '2026-08-13',
    wasShownHe:
      'שורות יומן שסומנו 00:00 כסמן "יום שלם" נספרו כפגישות לילה. בעל תפקיד אחד הוצג כמי שקיים 984 פגישות חצות, מהן 943 סמנים.',
    nowShownHe:
      'כלל פגישות הלילה סופר רק שורות שיש בהן שעה אמיתית. מספר השורות שאין בהן שעה שמישה מדווח בנפרד.',
    foundByHe: 'ביקורת חיצונית — סוקר שקיפות',
    whereFixed: 'scripts/analyze-diaries.ts — hasUsableClockTime',
  },
  {
    id: 'weekend-rule-scope',
    date: '2026-08-13',
    wasShownHe:
      'כלל "פגישות בסוף שבוע" ספר תפילות, ארוחות, נסיעות ו-71 כותרות טבלה שנסרקו כטקסט, ופגע בעיקר בבעלי תפקידים דתיים.',
    nowShownHe: 'הכלל סופר רק שורות שהן פגישה לפי אוצר המילים המוצהר.',
    foundByHe: 'ביקורת חיצונית — חבר כנסת לשעבר',
    whereFixed: 'scripts/analyze-diaries.ts — isMeetingRow',
  },
  {
    id: 'publication-gap-blame',
    date: '2026-08-13',
    wasShownHe:
      'כלל פערי הפרסום ייחס למשרדים רבעונים שהם כן פרסמו והאתר לא הצליח לקרוא — שלושה קבצים של 2025 הוצגו כפער של השר.',
    nowShownHe:
      'רבעון שפורסם ולא נקרא על ידינו מדווח כמצב נפרד, ואינו נספר לחובת המשרד ואינו משפיע על ציון השקיפות.',
    foundByHe: 'ביקורת חיצונית — מנהל ציבורי',
    whereFixed: 'scripts/analyze-diaries.ts — publishedQuartersOf',
  },
  {
    id: 'enacted-jump-baseline',
    date: '2026-08-13',
    wasShownHe:
      'כלל השינוי הרב-שנתי השווה יתרה שלאחר העברות להקצאה חדשה, ופרסם "מ-1 מיליון ל-63.5 מיליון" על תקנה שההקצאה שלה כמעט לא זזה.',
    nowShownHe: 'הכללים משווים בסיס להקצאה מקורית, ותנועה בתוך השנה נמדדת בנפרד.',
    foundByHe: 'ביקורת חיצונית — מנהל ציבורי',
    whereFixed: 'scripts/lib/anomaly-rules.ts — enacted_jump, in_year_reinforcement',
  },
  {
    id: 'tenures-declared-uncollectable',
    date: '2026-08-14',
    wasShownHe: 'האתר הצהיר שכהונות שרים אינן ניתנות לאיסוף.',
    nowShownHe: 'הכהונות נאספות משירות ה-OData הפתוח של הכנסת ומוצגות בכל ציר זמן.',
    foundByHe: 'ביקורת חיצונית — חבר כנסת לשעבר',
    whereFixed: 'scripts/collect-minister-tenures.ts',
  },
  {
    id: 'archive-provenance-claim',
    date: '2026-08-14',
    wasShownHe:
      'התיעוד טען שכל שורת יומן נושאת את כתובת הארכיון שממנה נקראה. אף שורה לא נשאה אותה.',
    nowShownHe: 'כתובת הארכיון נרשמת לכל פרסום, והשורות הקיימות הושלמו למפרע.',
    foundByHe: 'ביקורת חיצונית — סוקר שקיפות',
    whereFixed: 'scripts/backfill-diary-archive-provenance.ts',
  },
  {
    id: 'methodology-contradiction',
    date: '2026-08-14',
    wasShownHe:
      'מסך המתודולוגיה הציג "אין באתר נתוני תקציב" ומיד אחר כך "נאספו 2,725 רשומות תקציב".',
    nowShownHe: 'המסך מציג את מספר הרשומות שנאספו בפועל.',
    foundByHe: 'ביקורת חיצונית — מנהל ציבורי',
    whereFixed: 'src/pages/MethodologyPage.tsx',
  },
  {
    id: 'excluded-budget-disclosure',
    date: '2026-08-14',
    wasShownHe:
      'רק תקציב הפיתוח דווח כמוחרג מהסכימות. מפעלים עסקיים, שירות חוב והרזרבה הכללית לא הוזכרו.',
    nowShownHe: 'כל ההחרגות מפורטות במסך המתודולוגיה ובתיעוד.',
    foundByHe: 'ביקורת חיצונית — שלושת הסוקרים',
    whereFixed: 'scripts/build-data.ts, README',
  },
  {
    id: 'disputed-foi-count',
    date: '2026-08-14',
    wasShownHe:
      'סוקר דיווח ש-67 שורות הן הודעות השחרה לפי סעיף 9(א)(3) לחוק חופש המידע, והמלצתו הייתה לבנות כלל.',
    nowShownHe:
      'הבדיקה מול הקורפוס מצאה שלוש שורות כאלה. לא נבנה כלל, והמחלוקת מתועדת במסמכי הביקורת.',
    foundByHe: 'בדיקה חוזרת של צוות האתר',
    whereFixed: 'docs/reviews/README.md — פרק "במחלוקת"',
  },
];

export const CORRECTIONS_POLICY_HE =
  'כל תיקון מתועד כאן עם תאריך, מה הוצג לפני, ומה מוצג אחרי. רשומה אינה נמחקת ואינה נערכת בדיעבד. תיקון שנובע מפנייה של גוף שנמדד יצוין ככזה.';

export const RIGHT_OF_REPLY_HE =
  'לכל גוף או בעל תפקיד שמופיע באתר יש זכות תגובה. תגובה שתישלח תוצג לצד הממצא עצמו, בלשונה, ולא במסך נפרד. אם התגובה מצביעה על טעות — הממצא יתוקן והתיקון יירשם ביומן הזה. אם היא חולקת על הפרשנות בלי לחלוק על הנתון, יוצגו שני הדברים זה לצד זה.';

export const OPERATOR_HE =
  'האתר מופעל כפרויקט קוד פתוח, ואינו גוף רשמי, ארגון מדיה או עמותה רשומה. הוא אינו ממומן על ידי גוף ממשלתי או מפלגתי. אין לו מערכת עיתונאית: כל שורה בו נגזרת מקובץ נתונים שפורסם, וכל חישוב פתוח לבדיקה בקוד. מי שמזהה טעות מוזמן לפנות דרך מערכת הפניות של המאגר, וכל פנייה מטופלת בפומבי.';
