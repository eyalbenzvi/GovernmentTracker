/**
 * analyze-diaries — turns diary entries into published, checkable measures.
 *
 * Input:  data/processed/diaries-index.json + data/processed/diaries/*.json
 *         data/processed/findings.json          (suppliers + support recipients)
 * Output: data/processed/diary-insights.json
 *
 * Everything here is arithmetic over the collected rows. No language model runs
 * in this script or in the published site; the only model involvement in the
 * diaries layer is the category vocabulary in
 * data/raw/seeds/diary-categories.seed.json, applied deterministically by
 * classify-diary-categories.ts.
 *
 * Every measure carries its formula, and every threshold is a declared
 * constant, printed next to the finding on the screen. A finding is a numeric
 * pattern with a link to its source — never an accusation. Two guards are
 * deliberate:
 *   - a person's counts are only reported against what that person published,
 *     so a sparse diary cannot masquerade as a light workload;
 *   - the cross-reference to suppliers and support recipients matches company
 *     names as text, which can collide, so each match ships with the matched
 *     string and an explicit "similar name is not proof" caveat.
 */
import path from 'node:path';
import { PROCESSED_DIR, readJson, writeJson } from './lib/paths.js';

// ---- thresholds (published verbatim on the screen) -------------------------
const OPACITY_MIN_ENTRIES = 20;
const OPACITY_SHARE = 50;
const PRIVATE_SECTOR_SHARE = 25;
const MEDIA_SHARE = 15;
const LATE_NIGHT_FROM = 22;
const LATE_NIGHT_UNTIL = 5;
const LATE_NIGHT_MIN_COUNT = 3;
const WEEKEND_MIN_COUNT = 3;
const MARATHON_MIN_ENTRIES = 12;
const MARATHON_MIN_SPAN_HOURS = 14;
const LONG_MEETING_HOURS = 4;
const DOUBLE_BOOKED_MIN = 5;
const REPEATED_SUBJECT_MIN = 3;
const CROSS_REF_MIN_NAME_LENGTH = 6;
const TOP_LIST_SIZE = 15;

interface ShardEntry {
  id: string;
  datasetId: string;
  subject: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  participants: string | null;
  extractionMethod: 'datastore' | 'spreadsheet' | 'pdf_text' | 'pdf_ocr';
  categoryId?: string;
}

interface DiaryDatasetMeta {
  datasetId: string;
  title: string;
  url: string;
  ministryId: string | null;
  personLabel: string | null;
  personRole: 'minister' | 'deputy_minister' | 'director_general' | 'other_senior';
  roleLabelHe: string;
  /** The period the publication says it covers, e.g. "2025 (רבעון ראשון ושני)". */
  periodLabel: string | null;
}

interface DiariesIndex {
  shards: Array<{ shardKey: string; ministryId: string | null; file: string; entryCount: number }>;
  datasets: DiaryDatasetMeta[];
  totals: { entries: number };
}

/** An entry joined with its publication metadata — the shape every measure uses. */
interface DiaryEntry {
  id: string;
  ministryId: string | null;
  personLabel: string | null;
  personRole: DiaryDatasetMeta['personRole'];
  roleLabelHe: string;
  subject: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  participants: string | null;
  datasetId: string;
  categoryId: string;
  extractionMethod: ShardEntry['extractionMethod'];
  sourceUrl: string;
  sourceTitle: string;
}

interface FindingsFile {
  suppliers: Record<
    string,
    Array<{ name: string; entityUrl: string; totalVolume: number; contractCount: number }>
  >;
  supportRecipients: Record<
    string,
    Array<{ name: string; entityUrl: string; totalApproved: number; requestCount: number }>
  >;
}

export function personKeyOf(entry: {
  ministryId: string | null;
  roleLabelHe: string;
  personLabel: string | null;
}): string {
  return [entry.ministryId ?? 'unattributed', entry.roleLabelHe, entry.personLabel ?? '—'].join(
    '|',
  );
}

/**
 * Whether one published file holds the diaries of more than one person.
 *
 * Offices routinely publish a minister's and their director-general's diaries
 * as a single file, and one file covers "the diaries of the ministers of the
 * government" outright. Every row in such a file gets the publication's single
 * identity, which produces two wrongs: one named person is credited with
 * another's meetings, and the behavioural rules — overlapping meetings, marathon
 * days, night meetings — fire on what is really several people's calendars laid
 * on top of each other. The largest "874 overlapping meetings" finding in the
 * first run was of exactly this kind.
 *
 * Detected on strong signals only. The plural "יומני" is deliberately NOT one:
 * offices use it for a single person's several quarters ("יומני שר החוץ, אלי
 * כהן"), so treating it as multi-person would suppress real profiles.
 */
export function coversMultiplePeople(title: string): boolean {
  const t = title.replace(/[״”“]/g, '"').replace(/\s+/g, ' ');
  const secondDiary = /ויומן|ו יומן/.test(t) || (t.match(/יומן/g) ?? []).length >= 2;
  const pluralOffice = /(^|\s)שרי\s|(^|\s)סגני\s|מנכ"לים/.test(t);
  const joinedRole = /\sו(מנכ"ל|מנכ"לית|סמנכ"ל|יו"ר|סגן|ראש)/.test(t);
  return secondDiary || pluralOffice || joinedRole;
}

/**
 * Whether a row states a clock time that a rule about clock times may use.
 *
 * These exports write an all-day or date-only entry as 00:00, and often as
 * 00:00–00:00. Read literally, that is a meeting at midnight lasting no time,
 * and it was read literally: 64% of every row this site published as a
 * "night meeting" started at 00:xx, and 59% also ended at 00:00 — fast days,
 * birthdays, "מושב חורף בכנסת", "יום ירושלים". The site was publishing, against
 * named people, that they held hundreds of meetings in the middle of the night.
 *
 * Two exclusions, both narrow:
 *   - start equal to end: no duration, so nothing about duration or overlap can
 *     be read from it;
 *   - start exactly 00:00: indistinguishable from the all-day marker these
 *     files use, so it is not treated as a midnight meeting. A stated 00:20 —
 *     an overnight flight, for instance — is a real time and is kept.
 *
 * The row itself stays in the corpus, in its category and in the day's count.
 * Only the clock-time rules refuse it.
 */
export function hasUsableClockTime(entry: {
  startTime: string | null;
  endTime: string | null;
}): boolean {
  if (entry.startTime === null) return false;
  if (entry.startTime === entry.endTime) return false;
  if (entry.startTime === '00:00') return false;
  return true;
}

/**
 * Categories that are not a meeting with anyone.
 *
 * A rule about when someone met people must count meetings. The weekend rule
 * counted every dated row, and what it actually published was prayers, lunches,
 * travel, birthdays, "סגור", and 71 OCR'd day-of-week table headers from scanned
 * diaries ("שבת ש", "שישי ו"). Against a religious office-holder, "28 רשומות
 * בשישי או בשבת" then reads as an accusation of working on Shabbat when the rows
 * are his afternoon prayers.
 */
const NON_MEETING_CATEGORIES = new Set([
  'personal_private',
  'holidays_calendar',
  'religious_lifecycle',
  'travel_logistics',
  'calendar_admin',
  'meeting_without_subject',
  'named_person_meeting',
  'unclassified',
  'unspecified',
  'no_subject_recorded',
]);

export function isMeetingRow(entry: { categoryId: string }): boolean {
  return !NON_MEETING_CATEGORIES.has(entry.categoryId);
}

/**
 * The quarters a publication says it covers, read from its own period label
 * ("2025 (רבעון ראשון ושני)"). A label naming only a year covers all four.
 *
 * This exists because the gap rule asked the wrong question. It compared the
 * quarters with *rows* against the range of quarters with rows, so a diary that
 * was published and that this site failed to read became a hole in the
 * office-holder's publication record: the Environmental Protection Minister
 * published three 2025 files, all three were refused with no archived copy, and
 * the site published "no records in 2024-Q3, 2024-Q4, 2025-Q1" under her name.
 * A gap in what we could read is not a gap in what they published.
 */
export function publishedQuartersOf(periodLabel: string | null): string[] {
  if (periodLabel === null) return [];
  const year = /(\d{4})/.exec(periodLabel);
  if (year === null) return [];
  const y = year[1];
  const words: Array<[RegExp, number]> = [
    [/ראשון/, 1],
    [/שני(?!ם)/, 2],
    [/שלישי/, 3],
    [/רביעי/, 4],
  ];
  const quarters = words.filter(([re]) => re.test(periodLabel)).map(([, q]) => q);
  if (quarters.length === 0) return [1, 2, 3, 4].map((q) => `${y}-Q${q}`);
  // "רבעון שלישי ורביעי" names its endpoints; everything between them is covered.
  const min = Math.min(...quarters);
  const max = Math.max(...quarters);
  const out: string[] = [];
  for (let q = min; q <= max; q += 1) out.push(`${y}-Q${q}`);
  return out;
}

function minutesOf(time: string | null): number | null {
  if (time === null) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Israeli weekend: Friday (5) and Saturday (6) in JS getUTCDay terms. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

export function quarterOf(date: string): string {
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-Q${String(Math.floor((month - 1) / 3) + 1)}`;
}

/**
 * Normalises a company or association name for substring search inside a diary
 * subject: corporate suffixes, quotes and punctuation carry no signal and vary
 * between registries.
 */
export function normalizeEntityName(name: string): string {
  return name
    .replace(/בע["״']?מ/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/["'״׳.,\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Government bodies are excluded: a meeting with one is not a supplier finding.
 *
 * The boundary is written as a lookahead, not `\b`: JavaScript word boundaries
 * are defined against [A-Za-z0-9_], so every Hebrew letter counts as a
 * non-word character and `\b` after a Hebrew prefix never matches what it
 * looks like it matches.
 */
export function isGovernmentEntityName(name: string): boolean {
  return /^(?:משרד|המשרד|מדינת ישראל|רשות|הרשות|לשכת|נציבות)(?=\s|$)/.test(name.trim());
}

interface PersonProfile {
  key: string;
  ministryId: string | null;
  personLabel: string | null;
  personRole: DiaryEntry['personRole'];
  roleLabelHe: string;
  entryCount: number;
  datedEntryCount: number;
  timedEntryCount: number;
  /** Rows whose stated time a clock-time rule may use — see hasUsableClockTime. */
  usableClockTimeCount: number;
  firstDate: string | null;
  lastDate: string | null;
  datasetIds: string[];
  sourceUrl: string;
  sourceTitle: string;
  unspecifiedCount: number;
  opacityPercent: number | null;
  noSubjectCount: number;
  noSubjectPercent: number | null;
  unclassifiedCount: number;
  unclassifiedPercent: number | null;
  coversMultiplePeople: boolean;
  categoryCounts: Record<string, number>;
  monthly: Array<{ period: string; count: number; byCategory: Record<string, number> }>;
  quarterly: Array<{ period: string; count: number; byCategory: Record<string, number> }>;
  weekendCount: number;
  /** Friday and Saturday are different days in Israel and are reported apart. */
  fridayMeetingCount: number;
  saturdayMeetingCount: number;
  /** Weekend rows that are not meetings — prayers, meals, travel, markers. */
  weekendNonMeetingCount: number;
  lateNightCount: number;
  longMeetingCount: number;
  marathonDays: string[];
  doubleBookedCount: number;
  busiestDay: { date: string; count: number } | null;
  repeatedSubjects: Array<{ subject: string; count: number }>;
}

interface DiaryFinding {
  ruleId: string;
  personKey: string;
  ministryId: string | null;
  personLabel: string | null;
  roleLabelHe: string;
  evidenceHe: string;
  value: number | null;
  sourceUrl: string;
  sourceTitle: string;
}

const RULES = [
  {
    id: 'opaque_diary',
    labelHe: 'יומן ללא נושאים',
    formulaHe: `שיעור הרשומות שנושאן גנרי או מושחר ≥ ${OPACITY_SHARE}%, בקרב בעלי תפקיד עם ${OPACITY_MIN_ENTRIES}+ רשומות`,
    whyInterestingHe:
      'פרסום שאינו מגלה במה עסקה הפגישה מקיים את הנוהל בצורתו אך לא בתכליתו: אי אפשר לבקר מה שלא נכתב.',
  },
  {
    id: 'private_sector_heavy',
    labelHe: 'נתח גבוה למגזר הפרטי',
    formulaHe: `שיעור הרשומות בקטגוריית "מגזר פרטי, תאגידים ובעלי עניין" ≥ ${PRIVATE_SECTOR_SHARE}%, עם ${OPACITY_MIN_ENTRIES}+ רשומות`,
    whyInterestingHe:
      'הרכב הגישה למקבל ההחלטות הוא נתון ציבורי. אין בכך פסול, אך יש בו מידע שאינו זמין ממקור אחר.',
  },
  {
    id: 'media_heavy',
    labelHe: 'נתח גבוה לתקשורת ותדמית',
    formulaHe: `שיעור הרשומות בקטגוריית "תקשורת, ראיונות ותדמית" ≥ ${MEDIA_SHARE}%, עם ${OPACITY_MIN_ENTRIES}+ רשומות`,
    whyInterestingHe: 'כמה מזמן בעל התפקיד מוקדש להופעות תקשורתיות לעומת עבודת מדיניות.',
  },
  {
    id: 'publication_gap',
    labelHe: 'רבעון חסר בתוך תקופת הפרסום',
    formulaHe:
      'רבעון שאין בו אף רשומה, בין הרבעון הראשון והאחרון שבהם כן פורסמו רשומות לאותו בעל תפקיד',
    whyInterestingHe:
      'חור באמצע רצף הפרסום מלמד על פרסום חלקי, ולא על רבעון שבו לא התקיימו פגישות.',
  },
  {
    id: 'late_night_meetings',
    labelHe: 'פגישות בשעות הלילה',
    formulaHe: `${LATE_NIGHT_MIN_COUNT}+ רשומות שהחלו מ-${LATE_NIGHT_FROM}:00 ואילך או עד ${LATE_NIGHT_UNTIL}:00`,
    whyInterestingHe: 'שעה חריגה אינה פסולה, אך היא מסמנת פגישות שראוי לבדוק את הקשרן.',
  },
  {
    id: 'weekend_meetings',
    labelHe: 'פגישות בשישי-שבת',
    formulaHe: `${WEEKEND_MIN_COUNT}+ רשומות שתאריכן חל בשישי או בשבת`,
    whyInterestingHe: 'פעילות בסוף השבוע מסמנת דחיפות, אירועים ייצוגיים או מפגשים בלתי פורמליים.',
  },
  {
    id: 'marathon_day',
    labelHe: 'יום מרתון',
    formulaHe: `יום עם ${MARATHON_MIN_ENTRIES}+ רשומות, או יום שבו הפער בין תחילת הפגישה הראשונה לסוף האחרונה ≥ ${MARATHON_MIN_SPAN_HOURS} שעות`,
    whyInterestingHe: 'מציג את הימים העמוסים ביותר בפועל, כפי שנרשמו.',
  },
  {
    id: 'double_booked',
    labelHe: 'פגישות חופפות',
    formulaHe: `${DOUBLE_BOOKED_MIN}+ מקרים שבהם שתי רשומות באותו יום נחתכות בזמן`,
    whyInterestingHe:
      'חפיפה שיטתית מעידה שהיומן שפורסם הוא רישום לשכה גולמי, ולכן משך פגישה אינו מדד מדויק.',
  },
  {
    id: 'supplier_meeting',
    labelHe: 'פגישה עם ספק של המשרד',
    formulaHe: `נושא הפגישה מכיל שם של ספק מדוחות ההתקשרויות של אותו משרד (שם באורך ${CROSS_REF_MIN_NAME_LENGTH}+ תווים אחרי נרמול, ללא גופי ממשלה)`,
    whyInterestingHe:
      'הצלבה בין היומן לבין כספי ההתקשרויות. אינה קביעה שנעשה דבר פסול — פגישה עם ספק היא חלק מעבודה תקינה — אך היא הקשר שהציבור זכאי לראות.',
  },
  {
    id: 'support_recipient_meeting',
    labelHe: 'פגישה עם מקבל תמיכות',
    formulaHe: `נושא הפגישה מכיל שם של מקבל תמיכה ממסד התמיכות של אותו משרד (אותו כלל נרמול)`,
    whyInterestingHe: 'מי שמקבל כספי תמיכות ונפגש עם מקבלי ההחלטות — הצלבה, לא האשמה.',
  },
] as const;

function main(): void {
  const index = readJson<DiariesIndex>(path.join(PROCESSED_DIR, 'diaries-index.json'));
  const findings = readJson<FindingsFile>(path.join(PROCESSED_DIR, 'findings.json'));
  const datasetMeta = new Map(index.datasets.map((d) => [d.datasetId, d]));
  // Publications grouped by the office-holder they belong to, including the ones
  // that yielded no rows. Keyed exactly as the profiles are, so the two line up.
  const datasetsByPersonKey = new Map<string, DiaryDatasetMeta[]>();
  for (const dataset of index.datasets) {
    const dataKey = personKeyOf(dataset);
    datasetsByPersonKey.set(dataKey, [...(datasetsByPersonKey.get(dataKey) ?? []), dataset]);
  }

  // Join every shard row with its publication metadata. Rows whose dataset is
  // missing from the index would have no known author, so they are skipped and
  // counted rather than shown with an invented owner.
  const entries: DiaryEntry[] = [];
  let orphanRows = 0;
  for (const shard of index.shards) {
    const rows = readJson<ShardEntry[]>(path.join(PROCESSED_DIR, shard.file));
    for (const row of rows) {
      const meta = datasetMeta.get(row.datasetId);
      if (meta === undefined) {
        orphanRows += 1;
        continue;
      }
      entries.push({
        id: row.id,
        ministryId: meta.ministryId,
        personLabel: meta.personLabel,
        personRole: meta.personRole,
        roleLabelHe: meta.roleLabelHe,
        subject: row.subject,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        location: row.location,
        participants: row.participants,
        datasetId: row.datasetId,
        categoryId: row.categoryId ?? 'unspecified',
        extractionMethod: row.extractionMethod,
        sourceUrl: meta.url,
        sourceTitle: meta.title,
      });
    }
  }
  if (orphanRows > 0) {
    console.warn(`  אזהרה: ${orphanRows} רשומות דולגו — המאגר שלהן אינו מופיע באינדקס`);
  }

  const byPerson = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const key = personKeyOf(entry);
    const bucket = byPerson.get(key) ?? [];
    bucket.push(entry);
    byPerson.set(key, bucket);
  }

  const profiles: PersonProfile[] = [];
  const diaryFindings: DiaryFinding[] = [];
  let sharedFileProfiles = 0;
  // Quarters an office published that this site could not read. Counted so the
  // site reports its own reach instead of implying a publication failure.
  let quartersPublishedButUnreadTotal = 0;

  for (const [key, personEntries] of byPerson) {
    const first = personEntries[0];
    if (first === undefined) continue;
    const dated = personEntries.filter((e) => e.date !== null);
    const dates = dated.map((e) => e.date as string).sort((a, b) => a.localeCompare(b));

    const categoryCounts: Record<string, number> = {};
    for (const entry of personEntries) {
      categoryCounts[entry.categoryId] = (categoryCounts[entry.categoryId] ?? 0) + 1;
    }

    const periodSeries = (
      keyOf: (date: string) => string,
    ): Array<{ period: string; count: number; byCategory: Record<string, number> }> => {
      const buckets = new Map<string, { count: number; byCategory: Record<string, number> }>();
      for (const entry of dated) {
        const period = keyOf(entry.date as string);
        const bucket = buckets.get(period) ?? { count: 0, byCategory: {} };
        bucket.count += 1;
        bucket.byCategory[entry.categoryId] = (bucket.byCategory[entry.categoryId] ?? 0) + 1;
        buckets.set(period, bucket);
      }
      return [...buckets.entries()]
        .map(([period, v]) => ({ period, count: v.count, byCategory: v.byCategory }))
        .sort((a, b) => a.period.localeCompare(b.period));
    };

    // ---- per-day measures --------------------------------------------------
    const byDay = new Map<string, DiaryEntry[]>();
    for (const entry of dated) {
      const day = entry.date as string;
      const bucket = byDay.get(day) ?? [];
      bucket.push(entry);
      byDay.set(day, bucket);
    }

    let lateNightCount = 0;
    let longMeetingCount = 0;
    let doubleBookedCount = 0;
    const marathonDays: string[] = [];
    let busiestDay: { date: string; count: number } | null = null;

    for (const [day, dayEntries] of byDay) {
      if (busiestDay === null || dayEntries.length > busiestDay.count) {
        busiestDay = { date: day, count: dayEntries.length };
      }
      // Only rows that state a real clock time may feed a rule about clock
      // times — see hasUsableClockTime. Everything else keeps its place in the
      // day's count, so a marathon day by volume is unaffected.
      const spans = dayEntries
        .filter(hasUsableClockTime)
        .map((e) => ({ start: minutesOf(e.startTime), end: minutesOf(e.endTime) }))
        .filter((s): s is { start: number; end: number | null } => s.start !== null);
      for (const span of spans) {
        const startHour = Math.floor(span.start / 60);
        if (startHour >= LATE_NIGHT_FROM || startHour <= LATE_NIGHT_UNTIL) lateNightCount += 1;
        if (span.end !== null && span.end - span.start >= LONG_MEETING_HOURS * 60) {
          longMeetingCount += 1;
        }
      }
      const starts = spans.map((s) => s.start);
      const ends = spans.map((s) => s.end ?? s.start);
      const meetingsThatDay = dayEntries.filter(isMeetingRow).length;
      if (
        meetingsThatDay >= MARATHON_MIN_ENTRIES ||
        (starts.length > 1 &&
          Math.max(...ends) - Math.min(...starts) >= MARATHON_MIN_SPAN_HOURS * 60)
      ) {
        marathonDays.push(day);
      }
      // Overlap counting on pairs that both declare a start and a later end. A
      // zero-length span cannot overlap anything, and counting it did: a day of
      // all-day markers produced a pair for every combination of them.
      const closed = spans.filter(
        (s): s is { start: number; end: number } => s.end !== null && s.end > s.start,
      );
      for (let i = 0; i < closed.length; i += 1) {
        for (let j = i + 1; j < closed.length; j += 1) {
          const a = closed[i];
          const b = closed[j];
          if (a === undefined || b === undefined) continue;
          if (a.start < b.end && b.start < a.end) doubleBookedCount += 1;
        }
      }
    }

    const subjectCounts = new Map<string, number>();
    for (const entry of personEntries) {
      const subject = entry.subject.trim();
      if (subject.length < 4) continue;
      subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
    }

    const unspecifiedCount = categoryCounts.unspecified ?? 0;
    // Kept apart from the opacity measure on purpose: a row with no subject text
    // may be the source's empty cell, but it may equally be a subject column
    // this site failed to identify, and a transparency score must not absorb our
    // own extraction gaps.
    const noSubjectCount = categoryCounts.no_subject_recorded ?? 0;
    // Rows whose subject our keyword vocabulary does not cover. Reported as our
    // coverage, never as the office-holder's opacity — see the classifier.
    const unclassifiedCount = categoryCounts.unclassified ?? 0;
    const shared = coversMultiplePeople(first.sourceTitle);
    const profile: PersonProfile = {
      key,
      ministryId: first.ministryId,
      // A file covering several people must not be attributed to one of them by
      // name, even when the title happens to name one.
      personLabel: shared ? null : first.personLabel,
      personRole: first.personRole,
      roleLabelHe: first.roleLabelHe,
      entryCount: personEntries.length,
      datedEntryCount: dated.length,
      timedEntryCount: personEntries.filter((e) => e.startTime !== null).length,
      usableClockTimeCount: personEntries.filter(hasUsableClockTime).length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      datasetIds: [...new Set(personEntries.map((e) => e.datasetId))].sort(),
      sourceUrl: first.sourceUrl,
      sourceTitle: first.sourceTitle,
      unspecifiedCount,
      opacityPercent:
        personEntries.length === 0
          ? null
          : Math.round((unspecifiedCount / personEntries.length) * 1000) / 10,
      noSubjectCount,
      noSubjectPercent:
        personEntries.length === 0
          ? null
          : Math.round((noSubjectCount / personEntries.length) * 1000) / 10,
      unclassifiedCount,
      unclassifiedPercent:
        personEntries.length === 0
          ? null
          : Math.round((unclassifiedCount / personEntries.length) * 1000) / 10,
      coversMultiplePeople: shared,
      categoryCounts,
      monthly: periodSeries((d) => d.slice(0, 7)),
      quarterly: periodSeries(quarterOf),
      weekendCount: dated.filter((e) => isWeekend(e.date as string) && isMeetingRow(e)).length,
      fridayMeetingCount: dated.filter(
        (e) => isMeetingRow(e) && new Date(`${e.date as string}T12:00:00Z`).getUTCDay() === 5,
      ).length,
      saturdayMeetingCount: dated.filter(
        (e) => isMeetingRow(e) && new Date(`${e.date as string}T12:00:00Z`).getUTCDay() === 6,
      ).length,
      weekendNonMeetingCount: dated.filter((e) => isWeekend(e.date as string) && !isMeetingRow(e))
        .length,
      lateNightCount,
      longMeetingCount,
      marathonDays: marathonDays.sort(),
      doubleBookedCount,
      busiestDay,
      repeatedSubjects: [...subjectCounts.entries()]
        .filter(([, count]) => count >= REPEATED_SUBJECT_MIN)
        .map(([subject, count]) => ({ subject, count }))
        .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject))
        .slice(0, TOP_LIST_SIZE),
    };
    profiles.push(profile);

    // ---- findings ---------------------------------------------------------
    // Every rule below describes one person's conduct. On a file that holds
    // several people's diaries there is no such person, so no finding is
    // published from it — the rows still count in the totals and the topic mix,
    // which remain true of the file as a whole.
    if (shared) {
      sharedFileProfiles += 1;
      continue;
    }
    const push = (ruleId: string, evidenceHe: string, value: number | null): void => {
      diaryFindings.push({
        ruleId,
        personKey: key,
        ministryId: profile.ministryId,
        personLabel: profile.personLabel,
        roleLabelHe: profile.roleLabelHe,
        evidenceHe,
        value,
        sourceUrl: profile.sourceUrl,
        sourceTitle: profile.sourceTitle,
      });
    };

    const share = (categoryId: string): number =>
      profile.entryCount === 0 ? 0 : ((categoryCounts[categoryId] ?? 0) / profile.entryCount) * 100;

    if (
      profile.entryCount >= OPACITY_MIN_ENTRIES &&
      (profile.opacityPercent ?? 0) >= OPACITY_SHARE
    ) {
      push(
        'opaque_diary',
        `${profile.opacityPercent}% מהרשומות (${unspecifiedCount} מתוך ${profile.entryCount}) ללא נושא מפורט`,
        profile.opacityPercent,
      );
    }
    if (
      profile.entryCount >= OPACITY_MIN_ENTRIES &&
      share('private_sector') >= PRIVATE_SECTOR_SHARE
    ) {
      push(
        'private_sector_heavy',
        `${Math.round(share('private_sector') * 10) / 10}% מהרשומות (${categoryCounts.private_sector ?? 0}) סווגו כמפגשים עם המגזר הפרטי`,
        Math.round(share('private_sector') * 10) / 10,
      );
    }
    if (profile.entryCount >= OPACITY_MIN_ENTRIES && share('media_pr') >= MEDIA_SHARE) {
      push(
        'media_heavy',
        `${Math.round(share('media_pr') * 10) / 10}% מהרשומות (${categoryCounts.media_pr ?? 0}) סווגו כתקשורת ותדמית`,
        Math.round(share('media_pr') * 10) / 10,
      );
    }
    if (profile.quarterly.length > 1) {
      const firstQ = profile.quarterly[0]?.period;
      const lastQ = profile.quarterly[profile.quarterly.length - 1]?.period;
      if (firstQ !== undefined && lastQ !== undefined) {
        const present = new Set(profile.quarterly.map((q) => q.period));
        // What this office-holder's publications say they cover, whether or not
        // this site managed to read them. Resolved through the publication list
        // and not through the rows: a publication this site could not read
        // produces no rows at all, so a profile's own datasetIds cannot see it —
        // which is exactly how the quarters it covers came to be published as
        // the office-holder's failure.
        const publishedQuarters = new Set(
          (datasetsByPersonKey.get(key) ?? []).flatMap((d) => publishedQuartersOf(d.periodLabel)),
        );
        const missing: string[] = [];
        const publishedButUnread: string[] = [];
        const [fy, fq] = firstQ.split('-Q').map(Number);
        const [ly, lq] = lastQ.split('-Q').map(Number);
        if (fy !== undefined && fq !== undefined && ly !== undefined && lq !== undefined) {
          for (let y = fy; y <= ly; y += 1) {
            for (let q = 1; q <= 4; q += 1) {
              if (y === fy && q < fq) continue;
              if (y === ly && q > lq) continue;
              const period = `${y}-Q${q}`;
              if (present.has(period)) continue;
              // A quarter this office published, which this site could not read,
              // is our failure and is counted as ours.
              if (publishedQuarters.has(period)) publishedButUnread.push(period);
              else missing.push(period);
            }
          }
        }
        quartersPublishedButUnreadTotal += publishedButUnread.length;
        if (missing.length > 0) {
          push(
            'publication_gap',
            `לא פורסם יומן ברבעונים ${missing.join(', ')}, למרות פרסום ב-${firstQ} ועד ${lastQ}` +
              (publishedButUnread.length > 0
                ? `. בנוסף, ${publishedButUnread.length} רבעונים כן פורסמו אך האתר לא הצליח לקרוא אותם (${publishedButUnread.join(', ')}) — פער של האתר, לא של הלשכה`
                : ''),
            missing.length,
          );
        }
      }
    }
    if (lateNightCount >= LATE_NIGHT_MIN_COUNT) {
      push('late_night_meetings', `${lateNightCount} רשומות שהחלו בשעות הלילה`, lateNightCount);
    }
    if (profile.weekendCount >= WEEKEND_MIN_COUNT) {
      push(
        'weekend_meetings',
        `${profile.weekendCount} פגישות בשישי או בשבת (${profile.fridayMeetingCount} בשישי, ${profile.saturdayMeetingCount} בשבת). ` +
          `${profile.weekendNonMeetingCount} רשומות סוף שבוע נוספות אינן פגישות — תפילות, ארוחות, נסיעות וסימני יומן — ואינן נספרות כאן`,
        profile.weekendCount,
      );
    }
    if (marathonDays.length > 0) {
      push(
        'marathon_day',
        `${marathonDays.length} ימי מרתון, למשל ${marathonDays.slice(0, 3).join(', ')}`,
        marathonDays.length,
      );
    }
    if (doubleBookedCount >= DOUBLE_BOOKED_MIN) {
      push('double_booked', `${doubleBookedCount} זוגות רשומות חופפות בזמן`, doubleBookedCount);
    }
  }

  // ---- cross-reference with contracts and supports -------------------------
  interface CrossMatch {
    ruleId: 'supplier_meeting' | 'support_recipient_meeting';
    entryId: string;
    ministryId: string | null;
    personLabel: string | null;
    roleLabelHe: string;
    date: string | null;
    subject: string;
    matchedName: string;
    entityUrl: string;
    amount: number;
    amountLabelHe: string;
    diarySourceUrl: string;
  }
  const crossMatches: CrossMatch[] = [];

  const namePools = new Map<
    string,
    Array<{
      needle: string;
      name: string;
      entityUrl: string;
      amount: number;
      kind: 'supplier' | 'support';
    }>
  >();
  const addPool = (
    ministryId: string,
    rows: Array<{ name: string; entityUrl: string; amount: number }>,
    kind: 'supplier' | 'support',
  ): void => {
    const pool = namePools.get(ministryId) ?? [];
    for (const row of rows) {
      if (isGovernmentEntityName(row.name)) continue;
      const needle = normalizeEntityName(row.name);
      if (needle.length < CROSS_REF_MIN_NAME_LENGTH) continue;
      pool.push({ needle, name: row.name, entityUrl: row.entityUrl, amount: row.amount, kind });
    }
    namePools.set(ministryId, pool);
  };
  for (const [ministryId, rows] of Object.entries(findings.suppliers)) {
    addPool(
      ministryId,
      rows.map((r) => ({ name: r.name, entityUrl: r.entityUrl, amount: r.totalVolume })),
      'supplier',
    );
  }
  for (const [ministryId, rows] of Object.entries(findings.supportRecipients)) {
    addPool(
      ministryId,
      rows.map((r) => ({ name: r.name, entityUrl: r.entityUrl, amount: r.totalApproved })),
      'support',
    );
  }

  for (const entry of entries) {
    if (entry.ministryId === null) continue;
    const pool = namePools.get(entry.ministryId);
    if (pool === undefined) continue;
    const haystack = normalizeEntityName(entry.subject);
    if (haystack.length < CROSS_REF_MIN_NAME_LENGTH) continue;
    for (const candidate of pool) {
      if (!haystack.includes(candidate.needle)) continue;
      crossMatches.push({
        ruleId: candidate.kind === 'supplier' ? 'supplier_meeting' : 'support_recipient_meeting',
        entryId: entry.id,
        ministryId: entry.ministryId,
        // The row is real, but on a file covering several people it cannot be
        // attributed to the one the title happens to name.
        personLabel: coversMultiplePeople(entry.sourceTitle) ? null : entry.personLabel,
        roleLabelHe: entry.roleLabelHe,
        date: entry.date,
        subject: entry.subject,
        matchedName: candidate.name,
        entityUrl: candidate.entityUrl,
        amount: candidate.amount,
        amountLabelHe:
          candidate.kind === 'supplier'
            ? 'היקף התקשרויות מצטבר (רב-שנתי)'
            : 'סך תמיכות שאושרו (מ-2023)',
        diarySourceUrl: entry.sourceUrl,
      });
    }
  }
  crossMatches.sort((a, b) => b.amount - a.amount || a.entryId.localeCompare(b.entryId));

  // ---- portfolio-wide aggregates ------------------------------------------
  const categoryTotals: Record<string, number> = {};
  for (const entry of entries) {
    categoryTotals[entry.categoryId] = (categoryTotals[entry.categoryId] ?? 0) + 1;
  }
  const monthlyAll = new Map<string, number>();
  for (const entry of entries) {
    if (entry.date === null) continue;
    const month = entry.date.slice(0, 7);
    monthlyAll.set(month, (monthlyAll.get(month) ?? 0) + 1);
  }

  const output = {
    generatedAt: new Date().toISOString().slice(0, 10),
    method:
      'חישוב אריתמטי על רשומות היומן שנאספו. הסיווג לקטגוריות דטרמיניסטי לפי מילון מוצהר; אין מודל שפה בזמן ריצה ואין מודל שפה בזיהוי החריגים. כל כלל מוצג עם הנוסחה והסף שלו.',
    caveats: [
      'מדד מחושב רק מול מה שאותו בעל תפקיד פרסם. יומן דל אינו עדות לעומס עבודה נמוך, אלא לפרסום חלקי.',
      'מדד השקיפות סופר רק רשומות שבהן נכתב טקסט גנרי או מושחר. שני מצבים אחרים נספרים בנפרד ואינם נכנסים למדד: רשומה שפורסמה בלי טקסט נושא כלל ("נושא לא נרשם כלל"), שיכולה לנבוע גם מעמודה שהאתר לא זיהה בקובץ; ורשומה שיש בה טקסט אמיתי שמילון הקטגוריות של האתר אינו מכסה ("נושא שלא סווג"), שהיא פער בכיסוי שלנו. ייחוס פער כזה לאטימות של בעל תפקיד היה מדד שגוי.',
      'פרסום שמאגד את יומניהם של כמה בעלי תפקיד באותו קובץ אינו יומן של אדם אחד. רשומותיו נספרות בסך הכולל ובתמהיל הנושאים, אך לא מופק ממנו שום ממצא אישי ולא מיוחס לו שם — פגישות חופפות או יום עמוס בקובץ כזה הם לוחות זמנים של אנשים שונים זה על גב זה.',
      'קטגוריה נקבעת לפי מילות הנושא כפי שנרשמו ביומן, ואינה קביעה על מהות הפגישה.',
      'ההצלבה עם ספקים ומקבלי תמיכות מבוססת על התאמת שם כטקסט. שם דומה אינו הוכחה לזהות, ופגישה עם ספק אינה טענה לפגם. כל התאמה מוצגת עם השם שהותאם ועם קישור לשתי הישויות, לבדיקה עצמאית.',
      'שעות ומשכים מופיעים רק כאשר היומן פרסם אותם. חפיפות זמן מלמדות שהרישום גולמי.',
    ],
    rules: RULES,
    thresholds: {
      OPACITY_MIN_ENTRIES,
      OPACITY_SHARE,
      PRIVATE_SECTOR_SHARE,
      MEDIA_SHARE,
      LATE_NIGHT_FROM,
      LATE_NIGHT_UNTIL,
      LATE_NIGHT_MIN_COUNT,
      WEEKEND_MIN_COUNT,
      MARATHON_MIN_ENTRIES,
      MARATHON_MIN_SPAN_HOURS,
      LONG_MEETING_HOURS,
      DOUBLE_BOOKED_MIN,
      REPEATED_SUBJECT_MIN,
      CROSS_REF_MIN_NAME_LENGTH,
    },
    totals: {
      entries: entries.length,
      people: profiles.length,
      ministries: new Set(profiles.map((p) => p.ministryId).filter((id) => id !== null)).size,
      findings: diaryFindings.length,
      crossMatches: crossMatches.length,
      sharedFileProfiles,
      quartersPublishedButUnread: quartersPublishedButUnreadTotal,
      unspecifiedPercent:
        entries.length === 0
          ? null
          : Math.round(((categoryTotals.unspecified ?? 0) / entries.length) * 1000) / 10,
      unclassifiedPercent:
        entries.length === 0
          ? null
          : Math.round(((categoryTotals.unclassified ?? 0) / entries.length) * 1000) / 10,
      // Five categories describe the absence of a subject rather than a subject,
      // so none of them may be counted as a topic. Leaving the two newer ones out
      // of this subtraction would have reported "a meeting happened" and "a name,
      // no topic" as if the office had disclosed what the meeting was about.
      noTopicPercent:
        entries.length === 0
          ? null
          : Math.round(
              (((categoryTotals.meeting_without_subject ?? 0) +
                (categoryTotals.named_person_meeting ?? 0)) /
                entries.length) *
                1000,
            ) / 10,
      classifiedPercent:
        entries.length === 0
          ? null
          : Math.round(
              ((entries.length -
                (categoryTotals.unclassified ?? 0) -
                (categoryTotals.unspecified ?? 0) -
                (categoryTotals.no_subject_recorded ?? 0) -
                (categoryTotals.meeting_without_subject ?? 0) -
                (categoryTotals.named_person_meeting ?? 0)) /
                entries.length) *
                1000,
            ) / 10,
      noSubjectPercent:
        entries.length === 0
          ? null
          : Math.round(((categoryTotals.no_subject_recorded ?? 0) / entries.length) * 1000) / 10,
    },
    categoryTotals,
    monthlyAll: [...monthlyAll.entries()]
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    profiles: profiles.sort((a, b) => b.entryCount - a.entryCount),
    findings: diaryFindings,
    crossMatches,
  };

  writeJson(path.join(PROCESSED_DIR, 'diary-insights.json'), output);
  console.log(
    `analyze-diaries: ${profiles.length} בעלי תפקיד · ${diaryFindings.length} ממצאים · ${crossMatches.length} הצלבות עם ספקים/תמיכות`,
  );
  const byRule = new Map<string, number>();
  for (const finding of diaryFindings) {
    byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);
  }
  for (const [ruleId, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ruleId}: ${count}`);
  }
}

import { pathToFileURL } from 'node:url';
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
