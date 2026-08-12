/**
 * Deterministic classification of a discovered source URL.
 *
 * Every rule here is pure and auditable: given the same URL and title, it
 * always produces the same publisher, source type, ministry mapping and fiscal
 * years, and it records which rule fired in `mappingRule`. Nothing is guessed
 * from prose — only from the URL structure and the source's own title.
 */

export interface SourceClassification {
  publisher: string;
  sourceType: string;
  sourceTypeLabelHe: string;
  reliabilityLevel: 'primary_official' | 'secondary_helper';
  ministryIds: string[];
  fiscalYears: number[];
  mappingRule: string;
}

const PUBLISHER_BY_HOST: ReadonlyArray<[string, string]> = [
  ['m.knesset.gov.il', 'הכנסת'],
  ['main.knesset.gov.il', 'הכנסת'],
  ['fs.knesset.gov.il', 'הכנסת'],
  ['knesset.gov.il', 'הכנסת'],
  ['mof.gov.il', 'משרד האוצר'],
  ['library.mevaker.gov.il', 'מבקר המדינה'],
  ['media.mevaker.gov.il', 'מבקר המדינה'],
  ['data.gov.il', 'data.gov.il — מאגרי מידע ממשלתיים'],
  ['www.gov.il', 'מדינת ישראל — Gov.il'],
  ['next.obudget.org', 'מפתח התקציב — הסדנא לידע ציבורי'],
  ['foi.gov.il', 'היחידה הממשלתית לחופש המידע'],
  ['odata.org.il', 'מידע לעם — התנועה לחופש המידע'],
];

interface TypeRule {
  test: (url: string) => boolean;
  type: string;
  labelHe: string;
}

const TYPE_RULES: readonly TypeRule[] = [
  {
    test: (u) => /\/about\/documents\/budget\/.*\.pdf$/i.test(u),
    type: 'budget_book',
    labelHe: 'ספר התקציב — הצעת תקציב ודברי הסבר',
  },
  {
    test: (u) => /\/about\/pages\/budget\//i.test(u),
    type: 'budget_portal',
    labelHe: 'עמוד ריכוז מסמכי תקציב',
  },
  {
    test: (u) => /globaldocs\/MMM\//i.test(u) || /_cs_mmm_/i.test(u) || /MMMSummaries/i.test(u),
    type: 'knesset_research',
    labelHe: 'מרכז המחקר והמידע של הכנסת',
  },
  {
    test: (u) => /globaldocs\/FINANCE\//i.test(u),
    type: 'finance_committee_document',
    labelHe: 'מסמך שהוגש לוועדת הכספים',
  },
  { test: (u) => /SecondaryLaw/i.test(u), type: 'secondary_legislation', labelHe: 'חקיקת משנה' },
  { test: (u) => /_cs_bg_/i.test(u), type: 'committee_document', labelHe: 'מסמך ועדה' },
  {
    test: (u) => /\/News\/PressReleases\//i.test(u),
    type: 'press_release',
    labelHe: 'הודעה לעיתונות',
  },
  {
    test: (u) => /budget-execution-reports/i.test(u) || /BudgetExecution/i.test(u),
    type: 'budget_execution_report',
    labelHe: 'דוח ביצוע תקציב',
  },
  {
    test: (u) => /mevaker\.gov\.il/i.test(u),
    type: 'state_comptroller_report',
    labelHe: 'דוח מבקר המדינה',
  },
  {
    test: (u) => /data\.gov\.il/i.test(u),
    type: 'open_data_catalog',
    labelHe: 'קטלוג נתונים פתוחים',
  },
  {
    test: (u) => /obudget\.org/i.test(u),
    type: 'secondary_budget_layer',
    labelHe: 'שכבת עזר תקציבית (לא מקור רשמי)',
  },
  {
    test: (u) => /foi\.gov\.il\/he\/node/i.test(u),
    type: 'diaries_portal',
    labelHe: 'עמוד היומנים המרוכז — היחידה הממשלתית לחופש המידע',
  },
  {
    test: (u) => /odata\.org\.il/i.test(u),
    type: 'foi_repository',
    labelHe: 'מאגר מסמכי חופש מידע (שכבת עזר אזרחית)',
  },
  {
    test: (u) => /\/mk\/government\//i.test(u) || /GovtByNumber/i.test(u),
    type: 'government_composition',
    labelHe: 'הרכב הממשלה',
  },
  {
    test: (u) => /gov\.il\/(he\/)?(departments|pages)/i.test(u),
    type: 'government_page',
    labelHe: 'עמוד ממשלתי רשמי',
  },
];

/** Budget-book filenames encode the ministry; this is the strongest signal available. */
const VOLUME_TO_MINISTRY: ReadonlyArray<[RegExp, string]> = [
  [/Budget\d+-Transportation/i, 'transport'],
  [/Budget\d+-Education/i, 'education'],
  [/Budget\d+-Health/i, 'health'],
  [/Budget\d+-Environment/i, 'environment'],
  [/Budget\d+-Economics-Industry/i, 'economy'],
];

/** Ministry names appearing in the source's own title. */
const TITLE_TO_MINISTRY: ReadonlyArray<[RegExp, string]> = [
  [/משרד התחבורה/, 'transport'],
  [/תקציבי? התחבורה הציבורית/, 'transport'],
  [/משרד החינוך/, 'education'],
  [/תקציב החינוך/, 'education'],
  [/מערכת החינוך/, 'education'],
  [/משרד הבריאות/, 'health'],
  [/מערכת הבריאות/, 'health'],
  [/בתחום הבריאות/, 'health'],
  [/להגנת הסביבה/, 'environment'],
  [/איכות הסביבה/, 'environment'],
  [/משרד הכלכלה/, 'economy'],
];

const ANALYSIS_YEARS = [2023, 2024, 2025, 2026] as const;

function extractFiscalYears(url: string, title: string): number[] {
  const haystack = `${url} ${title}`;
  const found = new Set<number>();
  for (const year of ANALYSIS_YEARS) {
    if (haystack.includes(String(year))) found.add(year);
  }
  return [...found].sort((a, b) => a - b);
}

export function classifySource(url: string, title: string): SourceClassification {
  const host = new URL(url).host.toLowerCase();
  const publisher =
    PUBLISHER_BY_HOST.find(([h]) => host === h || host.endsWith(`.${h}`))?.[1] ?? host;

  const typeRule = TYPE_RULES.find((r) => r.test(url));
  const rules: string[] = [];

  const ministryIds = new Set<string>();
  for (const [pattern, id] of VOLUME_TO_MINISTRY) {
    if (pattern.test(url)) {
      ministryIds.add(id);
      rules.push(`שם קובץ ספר התקציב תואם ${pattern.source} → ${id}`);
    }
  }
  if (ministryIds.size === 0) {
    for (const [pattern, id] of TITLE_TO_MINISTRY) {
      if (pattern.test(title)) {
        ministryIds.add(id);
        rules.push(`כותרת המקור מכילה "${pattern.source}" → ${id}`);
      }
    }
  }
  if (ministryIds.size === 0) {
    rules.push('לא נמצאה התאמה חד-משמעית למשרד; המקור מסומן כרוחבי (כל המשרדים)');
  }

  const fiscalYears = extractFiscalYears(url, title);
  rules.push(
    fiscalYears.length > 0
      ? `שנות תקציב זוהו מהופעת המספרים ${fiscalYears.join(', ')} ב-URL או בכותרת`
      : 'לא זוהתה שנת תקציב בטווח 2023–2026',
  );

  return {
    publisher,
    sourceType: typeRule?.type ?? 'other_official',
    sourceTypeLabelHe: typeRule?.labelHe ?? 'מקור רשמי אחר',
    reliabilityLevel:
      host.includes('obudget.org') || host.includes('odata.org.il')
        ? 'secondary_helper'
        : 'primary_official',
    ministryIds: [...ministryIds].sort(),
    fiscalYears,
    mappingRule: rules.join(' | '),
  };
}

export function periodCoveredLabel(fiscalYears: number[]): string {
  if (fiscalYears.length === 0) return 'לא זוהתה שנת תקציב בטווח הניתוח';
  if (fiscalYears.length === 1) return `שנת תקציב ${fiscalYears[0]}`;
  return `שנות תקציב ${fiscalYears[0]}–${fiscalYears[fiscalYears.length - 1]}`;
}
