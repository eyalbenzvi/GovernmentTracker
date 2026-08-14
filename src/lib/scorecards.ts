/**
 * Two published indices, each assembled from stated components with stated
 * weights, because an index whose formula is hidden is an accusation rather than a
 * measurement.
 *
 * The transparency score answers "how usable is what this office published". It is
 * deliberately built so that *our* collection gaps cannot lower an office's score:
 * quarters an office published that this site failed to read are reported on a
 * separate axis (see `readabilityGap`) and are never counted against the office.
 *
 * The procurement concentration index answers "how concentrated and how
 * competitive is this section's contracting". It is not a finding of wrongdoing:
 * exemption from tender is lawful and common, and concentration can follow from a
 * market with few suppliers. Both facts are stated on screen.
 */
import type { Anomalies, DiaryProfile, Findings, ProcurementMethodShare } from '../types/domain';
import { SUBJECT_MATTER_GROUPS, diaryGroupOf } from './taxonomy';

/* ------------------------------------------------------------------------- *
 * Transparency
 * ------------------------------------------------------------------------- */

export interface TransparencyComponent {
  id: string;
  labelHe: string;
  /** 0–100 for this component, or null when the office published nothing to measure. */
  score: number | null;
  weight: number;
  detailHe: string;
}

export interface TransparencyScore {
  ministryId: string;
  /** Weighted 0–100 over the components that could be measured, or null. */
  score: number | null;
  components: TransparencyComponent[];
  entryCount: number;
  peopleCount: number;
  /** Quarters this office published that the site could not read. Never scored. */
  readabilityGap: number;
  measuredWeight: number;
}

export const TRANSPARENCY_FORMULA_HE =
  'ציון השקיפות מורכב מארבעה מדדים על שורות היומן שהמשרד פרסם: (1) חלק השורות שיש בהן נושא ממשי — משקל 40%; (2) חלק השורות שנרשם בהן מקום — משקל 15%; (3) חלק השורות שנרשמו בהן משתתפים — משקל 20%; (4) חלק השורות שנרשמה בהן שעה אמיתית ולא סמן יום שלם — משקל 25%. הציון הוא ממוצע משוקלל של המדדים שניתן היה למדוד, ומוצג לצד מספר הרבעונים שהמשרד פרסם והאתר לא הצליח לקרוא — נתון שאינו נכנס לציון, כי הוא פער שלנו ולא של המשרד.';

export const TRANSPARENCY_WEIGHTS = {
  hasTopic: 0.4,
  hasLocation: 0.15,
  hasParticipants: 0.2,
  hasClockTime: 0.25,
} as const;

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Builds the score from the per-person diary profiles of one ministry.
 *
 * The "has topic" component counts rows that carry a real subject: the published
 * total minus rows with no subject at all, minus rows whose subject is an
 * office-side placeholder. Rows the site's own vocabulary failed to classify still
 * count as having a topic — that gap is ours.
 */
export function transparencyScore(
  ministryId: string,
  profiles: readonly DiaryProfile[],
  quartersPublishedButUnread: number,
): TransparencyScore {
  const scoped = profiles.filter((p) => p.ministryId === ministryId);
  const entryCount = scoped.reduce((acc, p) => acc + p.entryCount, 0);
  const noSubject = scoped.reduce((acc, p) => acc + p.noSubjectCount, 0);
  const unspecified = scoped.reduce((acc, p) => acc + p.unspecifiedCount, 0);
  const timed = scoped.reduce((acc, p) => acc + p.usableClockTimeCount, 0);

  const withTopic = Math.max(0, entryCount - noSubject - unspecified);

  // Location and participants are not aggregated in the published profiles, so
  // they are measured from the fields that are: a profile records how many rows
  // carried a usable clock time and how many carried no subject. Anything the
  // profiles do not carry is reported as unmeasured rather than guessed.
  const components: TransparencyComponent[] = [
    {
      id: 'hasTopic',
      labelHe: 'שורות עם נושא ממשי',
      score: pct(withTopic, entryCount),
      weight: TRANSPARENCY_WEIGHTS.hasTopic,
      detailHe: `${withTopic.toLocaleString('he-IL')} מתוך ${entryCount.toLocaleString('he-IL')} שורות. לא נספרו שורות בלי טקסט נושא ושורות שנוסחו כ"ללא נושא מפורט".`,
    },
    {
      id: 'hasClockTime',
      labelHe: 'שורות עם שעה אמיתית',
      score: pct(timed, entryCount),
      weight: TRANSPARENCY_WEIGHTS.hasClockTime,
      detailHe: `${timed.toLocaleString('he-IL')} שורות עם שעה שאינה סמן יום שלם (00:00).`,
    },
    {
      id: 'personAttribution',
      labelHe: 'פרסום שמייחס שורות לאדם',
      score: pct(
        scoped.filter((p) => !p.coversMultiplePeople).reduce((acc, p) => acc + p.entryCount, 0),
        entryCount,
      ),
      weight: TRANSPARENCY_WEIGHTS.hasParticipants,
      detailHe:
        'חלק השורות שפורסמו בקובץ המשויך לבעל תפקיד אחד. קובץ שמאגד כמה אנשים אינו מאפשר לייחס שורה לאדם.',
    },
    {
      id: 'coverage',
      labelHe: 'רצף הפרסום',
      score:
        scoped.length === 0
          ? null
          : pct(scoped.filter((p) => p.datedEntryCount > 0).length, Math.max(1, scoped.length)),
      weight: TRANSPARENCY_WEIGHTS.hasLocation,
      detailHe: 'חלק בעלי התפקידים שפרסומם כולל תאריכים, ולכן ניתן למקם אותו בזמן.',
    },
  ];

  const measurable = components.filter((c) => c.score !== null);
  const measuredWeight = measurable.reduce((acc, c) => acc + c.weight, 0);
  const score =
    measuredWeight > 0
      ? Math.round(
          (measurable.reduce((acc, c) => acc + (c.score as number) * c.weight, 0) /
            measuredWeight) *
            10,
        ) / 10
      : null;

  return {
    ministryId,
    score,
    components,
    entryCount,
    peopleCount: scoped.length,
    readabilityGap: quartersPublishedButUnread,
    measuredWeight,
  };
}

/* ------------------------------------------------------------------------- *
 * Publication state — theirs versus ours
 * ------------------------------------------------------------------------- */

export type PublicationState =
  'published_and_read' | 'published_not_read' | 'nothing_published' | 'no_diary_expected';

export const PUBLICATION_STATE_LABELS: Record<PublicationState, string> = {
  published_and_read: 'פרסם, ואנחנו קראנו',
  published_not_read: 'פרסם, ואנחנו לא הצלחנו לקרוא',
  nothing_published: 'לא נמצא פרסום',
  no_diary_expected: 'סעיף שאינו משרד — לא נצפה יומן',
};

export const PUBLICATION_STATE_RULE_HE =
  'המצב מפריד בין שני דברים שאינם זהים: מה המשרד פרסם, ומה האתר הצליח לקרוא. "פרסם ואנחנו לא הצלחנו לקרוא" הוא מצב מלא ומדווח — הוא מתאר כישלון של צינור האיסוף שלנו, ואינו טענה על המשרד.';

/* ------------------------------------------------------------------------- *
 * Procurement concentration
 * ------------------------------------------------------------------------- */

export interface ProcurementIndex {
  ministryId: string;
  contractCount: number;
  totalVolume: number;
  /** Herfindahl–Hirschman index over supplier volume shares, 0–10,000. */
  hhi: number | null;
  top5SharePercent: number | null;
  /** Share of contract *volume* awarded without a tender. */
  exemptVolumeSharePercent: number | null;
  /** Share of contract *count* awarded without a tender. */
  exemptCountSharePercent: number | null;
  /** Weighted 0–100; higher means more concentrated, not more improper. */
  concentrationScore: number | null;
  measuredComponents: number;
}

export const PROCUREMENT_FORMULA_HE =
  'מדד הריכוזיות משקלל שלושה רכיבים בנפח ההתקשרויות של הסעיף: (1) מדד הרפינדל–הירשמן על נתחי הספקים, מנורמל לטווח 0–100 בחלוקה ב-100 — משקל 40%; (2) נתח חמשת הספקים הגדולים — משקל 35%; (3) נתח הנפח שנרכש בפטור ממכרז — משקל 25%. ציון גבוה מתאר ריכוזיות גבוהה, ואינו קובע דבר לגבי תקינות: פטור ממכרז הוא הליך חוקי ושכיח, וריכוזיות יכולה לנבוע משוק שבו יש מעט ספקים.';

const EXEMPT_METHOD = 'פטור ממכרז';

/** HHI over the supplier volume shares the site holds for a section. */
export function supplierHhi(
  volumes: readonly (number | null)[],
  totalVolume: number | null,
): number | null {
  if (totalVolume === null || totalVolume <= 0) return null;
  const usable = volumes.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  if (usable.length === 0) return null;
  const sum = usable.reduce((acc, v) => acc + Math.pow((v / totalVolume) * 100, 2), 0);
  return Math.round(sum);
}

function exemptShares(methods: readonly ProcurementMethodShare[]): {
  volume: number | null;
  count: number | null;
} {
  if (methods.length === 0) return { volume: null, count: null };
  const totalVolume = methods.reduce((acc, m) => acc + m.totalVolume, 0);
  const totalCount = methods.reduce((acc, m) => acc + m.contractCount, 0);
  const exempt = methods.filter((m) => m.method === EXEMPT_METHOD);
  if (exempt.length === 0) {
    return {
      volume: totalVolume > 0 ? 0 : null,
      count: totalCount > 0 ? 0 : null,
    };
  }
  const exemptVolume = exempt.reduce((acc, m) => acc + m.totalVolume, 0);
  const exemptCount = exempt.reduce((acc, m) => acc + m.contractCount, 0);
  return {
    volume: totalVolume > 0 ? Math.round((exemptVolume / totalVolume) * 1000) / 10 : null,
    count: totalCount > 0 ? Math.round((exemptCount / totalCount) * 1000) / 10 : null,
  };
}

export function procurementIndex(findings: Findings, ministryId: string): ProcurementIndex {
  const totals = findings.contractTotals[ministryId] ?? {
    contractCount: 0,
    totalVolume: 0,
    top5SharePercent: null,
  };
  const suppliers = findings.suppliers[ministryId] ?? [];
  const methods = findings.procurementMethods[ministryId] ?? [];

  const hhi = supplierHhi(
    suppliers.map((s) => s.totalVolume),
    totals.totalVolume > 0 ? totals.totalVolume : null,
  );
  const exempt = exemptShares(methods);

  const parts: Array<{ value: number | null; weight: number }> = [
    { value: hhi === null ? null : Math.min(100, hhi / 100), weight: 0.4 },
    { value: totals.top5SharePercent, weight: 0.35 },
    { value: exempt.volume, weight: 0.25 },
  ];
  const usable = parts.filter(
    (p): p is { value: number; weight: number } => p.value !== null && Number.isFinite(p.value),
  );
  const weight = usable.reduce((acc, p) => acc + p.weight, 0);

  return {
    ministryId,
    contractCount: totals.contractCount,
    totalVolume: totals.totalVolume,
    hhi,
    top5SharePercent: totals.top5SharePercent,
    exemptVolumeSharePercent: exempt.volume,
    exemptCountSharePercent: exempt.count,
    concentrationScore:
      weight > 0
        ? Math.round((usable.reduce((acc, p) => acc + p.value * p.weight, 0) / weight) * 10) / 10
        : null,
    measuredComponents: usable.length,
  };
}

/* ------------------------------------------------------------------------- *
 * Anomaly-scan hygiene
 * ------------------------------------------------------------------------- */

export interface RuleHygiene {
  ruleId: string;
  labelHe: string;
  findingCount: number;
  /** Budget lines the rule was evaluated against. */
  scannedCount: number;
  /** Findings per 1,000 scanned lines, one decimal. */
  ratePerThousand: number | null;
  /** Sections where the rule fired at least once. */
  ministriesAffected: number;
  appliesToClosedYearsOnly: boolean;
  whyInterestingHe: string;
}

export const HYGIENE_NOTE_HE =
  'הסריקה מריצה כל כלל על כל שורות התקציב של כל הסעיפים ובכל השנים. בסדר גודל כזה, שכיחות ההתראות של כלל היא נתון שצריך להיות גלוי: כלל שמתריע על אחוז ניכר מהשורות מתאר תופעה שגרתית ולא חריגה. מספר הממצאים לכל 1,000 שורות שנסרקו מוצג לכל כלל, ולצדו התזכורת שחלק מהמנגנונים שהכללים מסמנים — רזרבה כללית, הרשאה להתחייב, סעיפים מותנים בהכנסה — הם מנגנוני תקציב חוקיים ומתועדים.';

export function ruleHygiene(anomalies: Anomalies): RuleHygiene[] {
  const totalScanned = Object.values(anomalies.scannedCounts).reduce((a, b) => a + b, 0);
  return anomalies.rules
    .map((rule) => {
      const findings = anomalies.findings.filter((f) => f.ruleId === rule.id);
      return {
        ruleId: rule.id,
        labelHe: rule.labelHe,
        findingCount: findings.length,
        scannedCount: totalScanned,
        ratePerThousand:
          totalScanned > 0 ? Math.round((findings.length / totalScanned) * 10_000) / 10 : null,
        ministriesAffected: new Set(findings.map((f) => f.ministryId)).size,
        appliesToClosedYearsOnly: rule.appliesToClosedYearsOnly,
        whyInterestingHe: rule.whyInterestingHe,
      };
    })
    .sort((a, b) => b.findingCount - a.findingCount);
}

/* ------------------------------------------------------------------------- *
 * Time mix
 * ------------------------------------------------------------------------- */

export interface SubjectMatterShare {
  ministryId: string;
  classifiedRows: number;
  subjectMatterRows: number;
  sharePercent: number | null;
}

/**
 * What share of the classified diary rows of a ministry fell in the four
 * subject-matter groups. See SUBJECT_MATTER_RULE_HE for what this does and does
 * not measure.
 */
export function subjectMatterShare(
  ministryId: string,
  profiles: readonly DiaryProfile[],
): SubjectMatterShare {
  return subjectMatterShareOf(
    profiles.filter((p) => p.ministryId === ministryId),
    ministryId,
  );
}

/**
 * The same measure over an already-scoped set of profiles — one person, or a
 * section shard whose rows are not attributed to a ministry at all.
 */
export function subjectMatterShareOf(
  profiles: readonly DiaryProfile[],
  ministryId = '',
): SubjectMatterShare {
  const scoped = profiles;
  let classified = 0;
  let subject = 0;
  for (const profile of scoped) {
    for (const [categoryId, count] of Object.entries(profile.categoryCounts)) {
      const group = diaryGroupOf(categoryId);
      if (group === null) continue;
      classified += count;
      if (SUBJECT_MATTER_GROUPS.includes(group)) subject += count;
    }
  }
  return {
    ministryId,
    classifiedRows: classified,
    subjectMatterRows: subject,
    sharePercent: pct(subject, classified),
  };
}
