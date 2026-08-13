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
  firstDate: string | null;
  lastDate: string | null;
  datasetIds: string[];
  sourceUrl: string;
  sourceTitle: string;
  unspecifiedCount: number;
  opacityPercent: number | null;
  noSubjectCount: number;
  noSubjectPercent: number | null;
  categoryCounts: Record<string, number>;
  monthly: Array<{ period: string; count: number; byCategory: Record<string, number> }>;
  quarterly: Array<{ period: string; count: number; byCategory: Record<string, number> }>;
  weekendCount: number;
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
      const spans = dayEntries
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
      if (
        dayEntries.length >= MARATHON_MIN_ENTRIES ||
        (starts.length > 1 &&
          Math.max(...ends) - Math.min(...starts) >= MARATHON_MIN_SPAN_HOURS * 60)
      ) {
        marathonDays.push(day);
      }
      // Overlap counting on pairs that both declare a start and an end.
      const closed = spans.filter((s): s is { start: number; end: number } => s.end !== null);
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
    const profile: PersonProfile = {
      key,
      ministryId: first.ministryId,
      personLabel: first.personLabel,
      personRole: first.personRole,
      roleLabelHe: first.roleLabelHe,
      entryCount: personEntries.length,
      datedEntryCount: dated.length,
      timedEntryCount: personEntries.filter((e) => e.startTime !== null).length,
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
      categoryCounts,
      monthly: periodSeries((d) => d.slice(0, 7)),
      quarterly: periodSeries(quarterOf),
      weekendCount: dated.filter((e) => isWeekend(e.date as string)).length,
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
        const missing: string[] = [];
        const [fy, fq] = firstQ.split('-Q').map(Number);
        const [ly, lq] = lastQ.split('-Q').map(Number);
        if (fy !== undefined && fq !== undefined && ly !== undefined && lq !== undefined) {
          for (let y = fy; y <= ly; y += 1) {
            for (let q = 1; q <= 4; q += 1) {
              if (y === fy && q < fq) continue;
              if (y === ly && q > lq) continue;
              const period = `${y}-Q${q}`;
              if (!present.has(period)) missing.push(period);
            }
          }
        }
        if (missing.length > 0) {
          push(
            'publication_gap',
            `אין רשומות ברבעונים ${missing.join(', ')}, למרות פרסום ב-${firstQ} ועד ${lastQ}`,
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
        `${profile.weekendCount} רשומות בשישי או בשבת`,
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
        personLabel: entry.personLabel,
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
      'מדד השקיפות סופר רק רשומות שבהן נכתב טקסט גנרי או מושחר. רשומות שפורסמו בלי טקסט נושא כלל נספרות בנפרד ("נושא לא נרשם כלל"), מפני שהיעדר טקסט יכול לנבוע גם מעמודה שהאתר לא זיהה בקובץ — ולא רק מהמקור.',
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
      unspecifiedPercent:
        entries.length === 0
          ? null
          : Math.round(((categoryTotals.unspecified ?? 0) / entries.length) * 1000) / 10,
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
