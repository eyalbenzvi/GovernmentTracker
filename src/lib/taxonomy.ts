/**
 * Authored groupings, kept in one place because each one is an editorial decision
 * that the site must be able to state on screen.
 *
 * Nothing here is collected data. Each grouping exposes a `RULE_HE` string that
 * the UI is expected to print next to any figure derived from it, so a reader can
 * disagree with the grouping rather than having to guess at it.
 */
import type { DiaryCategory } from '../types/domain';

/* ------------------------------------------------------------------------- *
 * Diary categories → eight reading groups
 * ------------------------------------------------------------------------- */

export type DiaryGroupId =
  | 'governing'
  | 'policy_field'
  | 'stakeholders'
  | 'public_facing'
  | 'internal'
  | 'travel_personal'
  | 'no_topic'
  | 'unclassified';

export interface DiaryGroup {
  id: DiaryGroupId;
  labelHe: string;
  /** What belongs in the group, in the reader's terms. */
  descriptionHe: string;
  color: string;
}

/**
 * The published vocabulary has 30 categories, which is more than a single chart
 * can carry. These eight groups exist for reading, and every screen that uses
 * them also offers the 30 underlying categories on demand — the grouping never
 * replaces the classification, it only summarises it.
 */
export const DIARY_GROUPS: readonly DiaryGroup[] = [
  {
    id: 'governing',
    labelHe: 'ממשל וחקיקה',
    descriptionHe: 'ממשלה וקבינט, ועדות שרים, כנסת וחקיקה, תקציב ואוצר, משפט ורגולציה.',
    color: '#1b5e8a',
  },
  {
    id: 'policy_field',
    labelHe: 'תחומי מדיניות',
    descriptionHe:
      'ביטחון וחירום, דיפלומטיה, רשויות מקומיות, התיישבות ופריפריה, מדיניות מגזרית, שיקום ותקומה, יהדות התפוצות, רגולציית תקשורת.',
    color: '#2f7d54',
  },
  {
    id: 'stakeholders',
    labelHe: 'בעלי עניין',
    descriptionHe: 'מגזר פרטי ותאגידים, חברה אזרחית ועמותות, ופגישות עם אדם ששמו נקוב בלי נושא.',
    color: '#7a5c9e',
  },
  {
    id: 'public_facing',
    labelHe: 'פנים אל הציבור',
    descriptionHe: 'תקשורת וראיונות, טקסים וכנסים, סיורים וביקורים.',
    color: '#8f5f13',
  },
  {
    id: 'internal',
    labelHe: 'ניהול המשרד',
    descriptionHe: 'ניהול פנימי ומטה, ניהול יומן וחסימות, ופוליטיקה סיעתית ומפלגתית.',
    color: '#5b6d7a',
  },
  {
    id: 'travel_personal',
    labelHe: 'נסיעות, דת ואישי',
    descriptionHe: 'נסיעות והסעות, דת ואירועי מחזור חיים, חגים ומועדים, ורשומות אישיות ופרטיות.',
    color: '#9e6a7a',
  },
  {
    id: 'no_topic',
    labelHe: 'ללא נושא',
    descriptionHe:
      'שורות שמתעדות מפגש בלי לומר על מה: נרשם מפגש בלי נושא, ניסוח ללא נושא מפורט, ונושא שלא נרשם כלל.',
    color: '#8a8a8a',
  },
  {
    id: 'unclassified',
    labelHe: 'לא סווג על ידינו',
    descriptionHe: 'שורות עם נושא אמיתי שאוצר המילים המוצהר של האתר אינו מכסה. פער שלנו, לא שלהם.',
    color: '#b7c7d2',
  },
];

/**
 * Category → group. Explicit rather than pattern-matched, so adding a category to
 * the published vocabulary surfaces as a missing key in a test instead of being
 * silently absorbed into a group.
 */
export const DIARY_CATEGORY_GROUP: Readonly<Record<string, DiaryGroupId>> = {
  government_cabinet: 'governing',
  knesset_legislation: 'governing',
  budget_finance: 'governing',
  legal_judicial: 'governing',
  regulation_licensing: 'governing',

  security_emergency: 'policy_field',
  diplomacy: 'policy_field',
  local_government: 'policy_field',
  settlement_periphery: 'policy_field',
  sectoral_affairs: 'policy_field',
  war_recovery: 'policy_field',
  diaspora_jewish_world: 'policy_field',
  comms_telecom_regulation: 'policy_field',

  private_sector: 'stakeholders',
  civil_society: 'stakeholders',
  named_person_meeting: 'stakeholders',

  media_pr: 'public_facing',
  ceremonies: 'public_facing',
  field_visits: 'public_facing',

  internal_management: 'internal',
  calendar_admin: 'internal',
  politics_party: 'internal',

  travel_logistics: 'travel_personal',
  religious_lifecycle: 'travel_personal',
  holidays_calendar: 'travel_personal',
  personal_private: 'travel_personal',

  meeting_without_subject: 'no_topic',
  unspecified: 'no_topic',
  no_subject_recorded: 'no_topic',

  unclassified: 'unclassified',
};

export const DIARY_GROUP_RULE_HE =
  'אוצר המילים המפורסם מכיל 30 קטגוריות. לצורך קריאה הן מקובצות לשמונה קבוצות לפי שיוך מוצהר וקבוע, שאינו נגזר מהנתונים; הקטגוריות המקוריות זמינות בכל מסך שמציג קבוצה. שלוש קטגוריות של היעדר נושא נשמרות בקבוצה נפרדת ואינן מעורבבות בתחומי תוכן, וקטגוריית "לא סווג" מסומנת כפער של האתר ולא כאטימות של בעל התפקיד.';

export function diaryGroupOf(categoryId: string): DiaryGroupId | null {
  return DIARY_CATEGORY_GROUP[categoryId] ?? null;
}

export function diaryGroupById(id: DiaryGroupId): DiaryGroup {
  const group = DIARY_GROUPS.find((g) => g.id === id);
  if (group === undefined) throw new Error(`unknown diary group: ${id}`);
  return group;
}

export interface DiaryGroupCount {
  group: DiaryGroup;
  count: number;
  /** Share of all counted rows, one decimal, or null when nothing was counted. */
  sharePercent: number | null;
  /** The published categories that fed this group, largest first. */
  categories: Array<{ id: string; labelHe: string; count: number }>;
}

/** Rolls per-category counts up to the eight reading groups. */
export function groupDiaryCounts(
  categoryCounts: Readonly<Record<string, number>>,
  categories: readonly DiaryCategory[],
): DiaryGroupCount[] {
  const labelById = new Map(categories.map((c) => [c.id, c.labelHe] as const));
  const buckets = new Map<DiaryGroupId, DiaryGroupCount>();
  for (const group of DIARY_GROUPS) {
    buckets.set(group.id, { group, count: 0, sharePercent: null, categories: [] });
  }

  for (const [categoryId, count] of Object.entries(categoryCounts)) {
    if (count <= 0) continue;
    const groupId = diaryGroupOf(categoryId);
    if (groupId === null) continue;
    const bucket = buckets.get(groupId);
    if (bucket === undefined) continue;
    bucket.count += count;
    bucket.categories.push({
      id: categoryId,
      labelHe: labelById.get(categoryId) ?? categoryId,
      count,
    });
  }

  const list = [...buckets.values()].filter((b) => b.count > 0);
  const total = list.reduce((acc, b) => acc + b.count, 0);
  for (const bucket of list) {
    bucket.sharePercent = total > 0 ? Math.round((bucket.count / total) * 1000) / 10 : null;
    bucket.categories.sort((a, b) => b.count - a.count);
  }
  return list.sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------------- *
 * How the time mix is read
 * ------------------------------------------------------------------------- */

/**
 * The groups that count as time on the ministry's subject matter, as opposed to
 * running the office, moving between places, or rows that never said what the
 * meeting was about.
 */
export const SUBJECT_MATTER_GROUPS: readonly DiaryGroupId[] = [
  'governing',
  'policy_field',
  'stakeholders',
  'public_facing',
];

export const SUBJECT_MATTER_RULE_HE =
  'חלק העיסוק בתוכן = סכום ארבע הקבוצות ממשל וחקיקה, תחומי מדיניות, בעלי עניין ופנים אל הציבור, חלקי כל השורות המסווגות. ניהול המשרד, נסיעות ואישי, שורות ללא נושא ושורות שלא סווגו — אינן נספרות במונה. זו מידה של הרכב היומן שפורסם, לא של עבודת המשרד: היומן מתעד פגישות של דרג בכיר בלבד, ופגישה ארוכה ופגישה קצרה נספרות אותו דבר.';

/**
 * Why this site does not publish a "money versus time" comparison, even though
 * it holds both a budget mix and a time mix. Printed on the screen that shows the
 * time mix, so the absence is a stated decision and not an oversight.
 */
export const NO_MONEY_VS_TIME_HE =
  'אין באתר השוואה בין תמהיל הזמן לתמהיל התקציב. הסיבה אינה טכנית: התקציב מסווג לפי מבנה — שכר, קניות, העברות, רזרבות — ולא לפי תחום מדיניות, והסיווג התמטי הקיים מכסה 5 מתוך 43 סעיפים. מיפוי בין קבוצות היומן לתמות התקציב היה יוצר פער מדיד למראה בין שני צירים שאינם מודדים אותו דבר. השוואה כזו תתאפשר רק לאחר סיווג תחומי מדיניות של שורות התקציב, בכיסוי מלא.';
