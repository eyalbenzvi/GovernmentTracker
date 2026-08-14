/**
 * Builds the home-screen summary from the processed datasets.
 *
 * Pure and deterministic: the same inputs always produce the same file, so the
 * editorial ranking that decides what leads the home screen shows up as a
 * reviewable diff in git rather than changing under a reader.
 *
 * Every insight produced here carries a source URL taken from the row it is
 * derived from, and a `notSayingHe` that states the reading the figure does not
 * support. A generator that cannot produce both does not emit an insight.
 */
import type {
  ActivityEvidence,
  Anomalies,
  BudgetItem,
  Coverage,
  DataVersion,
  DiariesIndex,
  DiaryCategories,
  DiaryInsights,
  Findings,
  Methodology,
  Ministry,
  UsageBreakdown,
} from '../types/domain';
import type {
  MinistrySummary,
  SiteSummary,
  SummaryInsight,
  SummarySlice,
  SummaryYearPoint,
} from '../types/summary';
import { aggregateByYear } from './budgetSeries';
import { sumWithoutDoubleCounting } from './calc';
import { rankOf, shareOf } from './context';
import { hundredShekelBreakdown } from './analysis';
import { formatCountHe, formatCurrencyShort, formatNumber, formatPercent } from './format';
import { anomalyStrength, rankAnomalies } from './insights';
import {
  type PublicationState,
  procurementIndex,
  ruleHygiene,
  subjectMatterShare,
  transparencyScore,
} from './scorecards';
import { DIARY_GROUPS, groupDiaryCounts } from './taxonomy';

export interface SummaryInputs {
  ministries: readonly Ministry[];
  budgetItems: readonly BudgetItem[];
  activities: readonly ActivityEvidence[];
  coverage: readonly Coverage[];
  usageBreakdown: UsageBreakdown;
  findings: Findings;
  anomalies: Anomalies;
  diaryInsights: DiaryInsights;
  diaryCategories: DiaryCategories;
  diariesIndex: DiariesIndex;
  dataVersion: DataVersion;
  methodology: Methodology;
  /** Injected so the output stays deterministic under test. */
  generatedAt: string;
}

function publicationStateOf(
  ministry: Ministry,
  index: DiariesIndex,
): { state: PublicationState; published: number; unread: number } {
  const datasets = index.datasets.filter((d) => d.ministryId === ministry.id);
  if (datasets.length === 0) {
    return {
      state: ministry.sectionKind === 'ministry' ? 'nothing_published' : 'no_diary_expected',
      published: 0,
      unread: 0,
    };
  }
  const unread = datasets.filter((d) => d.machineReadableEntries === 0).length;
  const read = datasets.length - unread;
  return {
    state: read > 0 ? 'published_and_read' : 'published_not_read',
    published: datasets.length,
    unread,
  };
}

function latestYearWith(items: readonly BudgetItem[], years: readonly number[]): number | null {
  for (const year of [...years].sort((a, b) => b - a)) {
    const forYear = items.filter((i) => i.fiscalYear === year);
    if (sumWithoutDoubleCounting(forYear, (i) => i.updatedBudget).total !== null) return year;
  }
  return null;
}

export function buildMinistrySummaries(inputs: SummaryInputs): MinistrySummary[] {
  const years = inputs.methodology.analysisYears;
  const rows: MinistrySummary[] = [];

  // One pass to get every section's latest updated budget, so share and rank are
  // computed against the same population that is displayed.
  const latestUpdated = new Map<string, number | null>();
  for (const ministry of inputs.ministries) {
    const items = inputs.budgetItems.filter((i) => i.ministryId === ministry.id);
    const year = latestYearWith(items, years);
    latestUpdated.set(
      ministry.id,
      year === null
        ? null
        : sumWithoutDoubleCounting(
            items.filter((i) => i.fiscalYear === year),
            (i) => i.updatedBudget,
          ).total,
    );
  }
  const totalUpdated = [...latestUpdated.values()].reduce<number>(
    (acc, v) => (v !== null && v > 0 ? acc + v : acc),
    0,
  );

  for (const ministry of inputs.ministries) {
    const items = inputs.budgetItems.filter((i) => i.ministryId === ministry.id);
    const year = latestYearWith(items, years);
    const forYear = year === null ? [] : items.filter((i) => i.fiscalYear === year);
    const aggregate = year === null ? null : (aggregateByYear(forYear, [year])[0] ?? null);
    const rank = rankOf(ministry.id, latestUpdated);

    const publication = publicationStateOf(ministry, inputs.diariesIndex);
    const transparency = transparencyScore(
      ministry.id,
      inputs.diaryInsights.profiles,
      publication.unread,
    );
    const procurement = procurementIndex(inputs.findings, ministry.id);
    const subject = subjectMatterShare(ministry.id, inputs.diaryInsights.profiles);
    const coverage = inputs.coverage.find((c) => c.ministryId === ministry.id);

    rows.push({
      id: ministry.id,
      officialName: ministry.officialName,
      displayName: ministry.displayName,
      sectionKind: ministry.sectionKind,
      latestBudgetYear: year,
      originalBudget: aggregate?.originalBudget ?? null,
      updatedBudget: aggregate?.updatedBudget ?? null,
      execution: aggregate?.execution ?? null,
      executionIsEstimate: aggregate?.executionIsEstimate ?? false,
      executionRatePercent:
        aggregate === null ? null : shareOf(aggregate.execution, aggregate.updatedBudget),
      shareOfTotalPercent: shareOf(latestUpdated.get(ministry.id) ?? null, totalUpdated),
      budgetRank: rank?.rank ?? null,
      budgetRankOutOf: rank?.outOf ?? null,
      activityCount: inputs.activities.filter((a) => a.ministryId === ministry.id).length,
      diaryEntryCount: transparency.entryCount,
      diaryPeopleCount: transparency.peopleCount,
      transparencyScore: transparency.score,
      procurementScore: procurement.concentrationScore,
      exemptVolumeSharePercent: procurement.exemptVolumeSharePercent,
      top5SharePercent: procurement.top5SharePercent,
      contractCount: procurement.contractCount,
      publicationState: publication.state,
      publishedDatasets: publication.published,
      unreadDatasets: publication.unread,
      anomalyCount: inputs.anomalies.findings.filter((f) => f.ministryId === ministry.id).length,
      supportRecipientCount: (inputs.findings.supportRecipients[ministry.id] ?? []).length,
      crossMatchCount: inputs.diaryInsights.crossMatches.filter((c) => c.ministryId === ministry.id)
        .length,
      subjectMatterSharePercent: subject.sharePercent,
      limitationCount: coverage?.limitations.length ?? 0,
    });
  }

  return rows.sort(
    (a, b) =>
      (a.sectionKind === 'ministry' ? 0 : 1) - (b.sectionKind === 'ministry' ? 0 : 1) ||
      (b.updatedBudget ?? -1) - (a.updatedBudget ?? -1) ||
      a.displayName.localeCompare(b.displayName, 'he'),
  );
}

/* ------------------------------------------------------------------------- *
 * Insight generators
 * ------------------------------------------------------------------------- */

const BUDGET_SOURCE_TITLE = 'מפתח התקציב — נתוני תקציב וביצוע';

function unusedBalanceInsight(
  inputs: SummaryInputs,
  rows: readonly MinistrySummary[],
): SummaryInsight | null {
  const closedYear = inputs.anomalies.closedYearMax;
  const candidates = inputs.ministries
    .map((ministry) => {
      const forYear = inputs.budgetItems.filter(
        (i) => i.ministryId === ministry.id && i.fiscalYear === closedYear,
      );
      const updated = sumWithoutDoubleCounting(forYear, (i) => i.updatedBudget).total;
      const executed = sumWithoutDoubleCounting(forYear, (i) => i.actualExecution).total;
      if (updated === null || executed === null || updated <= 0) return null;
      const unused = updated - executed;
      if (unused <= 0) return null;
      const source = forYear.find((i) => i.sourceUrl !== '')?.sourceUrl ?? null;
      return { ministry, unused, updated, share: shareOf(unused, updated), source };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.unused - a.unused);

  const top = candidates[0];
  if (top === undefined || top.share === null) return null;
  const row = rows.find((r) => r.id === top.ministry.id);

  return {
    id: `unused-balance-${closedYear}`,
    kind: 'execution',
    headline: formatCurrencyShort(top.unused),
    sentenceHe: `בשנת ${closedYear}, ${top.ministry.displayName} סיים את השנה עם ${formatCurrencyShort(top.unused)} שלא נוצלו מהתקציב המעודכן — ${formatPercent(top.share)} ממנו, הפער הגדול מבין ${formatNumber(candidates.length)} הסעיפים שיש להם נתון ביצוע סופי${row?.budgetRank !== null && row?.budgetRank !== undefined ? ` (הסעיף ה-${row.budgetRank} בגודלו)` : ''}.`,
    notSayingHe:
      'תקציב שלא נוצל אינו בהכרח כסף שהוחזר לאוצר או תקציב מיותר: הוא יכול לשקף התחייבות שטרם שולמה, פרויקט שנדחה, או תוספת שהגיעה בסוף השנה. הנתון אינו קובע אם הפער מוצדק.',
    href: `#/ministry/${top.ministry.id}`,
    sourceUrl: top.source,
    sourceTitleHe: BUDGET_SOURCE_TITLE,
    strength: 92,
  };
}

function inYearGrowthInsight(inputs: SummaryInputs): SummaryInsight | null {
  const years = inputs.methodology.analysisYears;
  const year = Math.max(...years.filter((y) => y <= inputs.anomalies.closedYearMax + 1));
  const candidates = inputs.ministries
    .map((ministry) => {
      const forYear = inputs.budgetItems.filter(
        (i) => i.ministryId === ministry.id && i.fiscalYear === year,
      );
      const original = sumWithoutDoubleCounting(forYear, (i) => i.originalBudget).total;
      const updated = sumWithoutDoubleCounting(forYear, (i) => i.updatedBudget).total;
      if (original === null || updated === null || original <= 0) return null;
      const delta = updated - original;
      const percent = shareOf(delta, original);
      if (percent === null || delta <= 0) return null;
      const requests = inputs.findings.budgetChanges[ministry.id] ?? [];
      return {
        ministry,
        delta,
        percent,
        requestCount: requests.filter((r) => r.year === year).length,
        source: requests.find((r) => r.year === year)?.sourceUrl ?? null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.delta - a.delta);

  const top = candidates[0];
  if (top === undefined) return null;

  return {
    id: `in-year-growth-${year}`,
    kind: 'budget',
    headline: `+${formatPercent(top.percent)}`,
    sentenceHe: `ב-${year} גדל התקציב של ${top.ministry.displayName} ב-${formatCurrencyShort(top.delta)} בין התקציב המקורי למעודכן — ${formatPercent(top.percent)}, התוספת הגדולה בשקלים מבין הסעיפים שנאספו${top.requestCount > 0 ? `, ובאתר ${formatNumber(top.requestCount)} פניות של ועדת הכספים לאותה שנה` : ''}.`,
    notSayingHe:
      'תוספת במהלך השנה היא מנגנון תקציבי שגרתי ולא חריגה: היא נעשית באישור ועדת הכספים או בהודעה לה, ויכולה לנבוע ממלחמה, מהסכם שכר או מהעברה מרזרבה. הנתון אינו מצביע על תקציב שנוצל לא כראוי.',
    href: `#/ministry/${top.ministry.id}`,
    sourceUrl: top.source,
    sourceTitleHe: 'פניות תקציביות לוועדת הכספים',
    strength: 84,
  };
}

function exemptTenderInsight(
  inputs: SummaryInputs,
  rows: readonly MinistrySummary[],
): SummaryInsight | null {
  const MIN_CONTRACTS = 200;
  const candidates = rows
    .filter(
      (r) =>
        r.contractCount >= MIN_CONTRACTS &&
        r.exemptVolumeSharePercent !== null &&
        r.exemptVolumeSharePercent > 0,
    )
    .sort((a, b) => (b.exemptVolumeSharePercent ?? 0) - (a.exemptVolumeSharePercent ?? 0));
  const top = candidates[0];
  if (top === undefined) return null;
  const supplier = (inputs.findings.suppliers[top.id] ?? [])[0] ?? null;

  return {
    id: `exempt-tender-${top.id}`,
    kind: 'procurement',
    headline: formatPercent(top.exemptVolumeSharePercent),
    sentenceHe: `ב${top.displayName}, ${formatPercent(top.exemptVolumeSharePercent)} מנפח ההתקשרויות שנאסף נרכש בפטור ממכרז — הנתח הגבוה מבין ${formatNumber(candidates.length)} הסעיפים עם ${formatNumber(MIN_CONTRACTS)} התקשרויות ומעלה.`,
    notSayingHe:
      'פטור ממכרז הוא הליך חוקי הקבוע בתקנות חובת המכרזים, והוא שכיח במיוחד בהתקשרויות קטנות ובספק יחיד. נתח גבוה אינו ממצא של אי-תקינות, אלא סימן לכך ששווה לבדוק במה מדובר.',
    href: `#/findings?ministry=${top.id}`,
    sourceUrl: supplier?.entityUrl ?? null,
    sourceTitleHe: 'שיקוף ההתקשרויות במפתח התקציב',
    strength: 78,
  };
}

function noTopicInsight(inputs: SummaryInputs): SummaryInsight | null {
  const share = inputs.diaryInsights.totals.noTopicPercent;
  if (share === null) return null;
  return {
    id: 'diary-no-topic',
    kind: 'diary',
    headline: formatPercent(share),
    sentenceHe: `מתוך ${formatNumber(inputs.diaryInsights.totals.entries)} שורות היומן שפורסמו על ידי ${formatNumber(inputs.diaryInsights.totals.people)} שרים, סגני שרים ומנכ"לים, ${formatPercent(share)} מתעדות שהתקיים מפגש — בלי לומר על מה.`,
    notSayingHe:
      'שורה בלי נושא אינה בהכרח הסתרה: היא יכולה לנבוע מניסוח פנימי מקוצר, מתא ריק בקובץ, או מעמודה שהאתר לא הצליח לזהות. חלק מהמקרים הוא פער בקריאה שלנו ולא בפרסום שלהם, והמסך מפריד ביניהם.',
    href: '#/diaries',
    sourceUrl: inputs.diariesIndex.source.url,
    sourceTitleHe: inputs.diariesIndex.source.name,
    strength: 74,
  };
}

function unreadPublicationsInsight(
  inputs: SummaryInputs,
  rows: readonly MinistrySummary[],
): SummaryInsight | null {
  const unreadRows = rows.filter((r) => r.publicationState === 'published_not_read');
  const quarters = inputs.diaryInsights.totals.quartersPublishedButUnread;
  if (unreadRows.length === 0 && quarters === 0) return null;
  return {
    id: 'coverage-unread',
    kind: 'coverage',
    headline: formatNumber(quarters),
    sentenceHe: `${formatNumber(quarters)} רבעונים שמשרדים כן פרסמו לא נקראו על ידי האתר${
      unreadRows.length > 0
        ? `, ובכלל זה ${formatCountHe(unreadRows.length, 'סעיף אחד', 'סעיפים')} שכל פרסומיהם לא נפענחו (${unreadRows
            .map((r) => r.displayName)
            .slice(0, 3)
            .join(', ')})`
        : ''
    }. זהו פער של האתר, לא של המשרדים.`,
    notSayingHe:
      'אין להסיק מכאן דבר על שקיפות המשרדים האלה. פרסום שלא נקרא נובע מקובץ סרוק, מפורמט שלא נתמך או מהורדה שנחסמה — כלומר ממגבלה שלנו. ציון השקיפות אינו מושפע ממנו.',
    href: '#/scorecards',
    sourceUrl: inputs.diariesIndex.source.url,
    sourceTitleHe: inputs.diariesIndex.source.name,
    strength: 70,
  };
}

function topAnomalyInsight(inputs: SummaryInputs): SummaryInsight | null {
  const ranked = rankAnomalies(inputs.anomalies.findings);
  const top = ranked[0];
  if (top === undefined) return null;
  const ministry = inputs.ministries.find((m) => m.id === top.ministryId);
  const rule = inputs.anomalies.rules.find((r) => r.id === top.ruleId);
  if (ministry === undefined || rule === undefined) return null;

  return {
    id: `anomaly-${top.ruleId}-${top.code}-${top.year}`,
    kind: 'budget',
    headline: rule.labelHe,
    sentenceHe: `${ministry.displayName}, ${top.year}: ${top.evidenceHe} (תקנה ${top.code} — ${top.title}).`,
    notSayingHe: `${rule.whyInterestingHe} הכלל מסמן תבנית בנתונים, לא ליקוי: חלק מהמקרים מוסברים במנגנון תקציבי חוקי — רזרבה, הרשאה להתחייב או סעיף מותנה בהכנסה — והאתר אינו מצליב אותם להעברה שמסבירה אותם.`,
    href: `#/findings?ministry=${ministry.id}`,
    sourceUrl: top.sourceUrl,
    sourceTitleHe: BUDGET_SOURCE_TITLE,
    strength: Math.min(90, anomalyStrength(top, inputs.anomalies.findings)),
  };
}

function transparencySpreadInsight(rows: readonly MinistrySummary[]): SummaryInsight | null {
  const scored = rows
    .filter((r) => r.transparencyScore !== null && r.diaryEntryCount > 500)
    .sort((a, b) => (b.transparencyScore ?? 0) - (a.transparencyScore ?? 0));
  if (scored.length < 3) return null;
  const best = scored[0] as MinistrySummary;
  const worst = scored[scored.length - 1] as MinistrySummary;

  return {
    id: 'transparency-spread',
    kind: 'diary',
    headline: `${formatNumber(Math.round((best.transparencyScore ?? 0) - (worst.transparencyScore ?? 0)))} נקודות`,
    sentenceHe: `בין המשרדים יש פער של ${formatNumber(Math.round((best.transparencyScore ?? 0) - (worst.transparencyScore ?? 0)))} נקודות בציון השקיפות של היומנים: ${best.displayName} מוביל עם ${formatNumber(best.transparencyScore)}, ו${worst.displayName} מסיים עם ${formatNumber(worst.transparencyScore)} — מתוך ${formatNumber(scored.length)} סעיפים עם למעלה מ-500 שורות.`,
    notSayingHe:
      'הציון מודד עד כמה הפרסום שימושי — נושא, שעה, ייחוס לאדם — ולא את איכות עבודת המשרד או את תכולת הפגישות. הוא גם אינו מודד את מה שלא פורסם כלל.',
    href: '#/scorecards',
    sourceUrl: null,
    sourceTitleHe: null,
    strength: 66,
  };
}

/** Ranked, deduplicated by kind so the home screen is not five budget cards. */
export function buildInsights(
  inputs: SummaryInputs,
  rows: readonly MinistrySummary[],
): SummaryInsight[] {
  const generated = [
    unusedBalanceInsight(inputs, rows),
    inYearGrowthInsight(inputs),
    exemptTenderInsight(inputs, rows),
    noTopicInsight(inputs),
    unreadPublicationsInsight(inputs, rows),
    topAnomalyInsight(inputs),
    transparencySpreadInsight(rows),
  ].filter((insight): insight is SummaryInsight => insight !== null);

  return generated.sort((a, b) => b.strength - a.strength);
}

/* ------------------------------------------------------------------------- *
 * The file itself
 * ------------------------------------------------------------------------- */

export function buildSiteSummary(inputs: SummaryInputs): SiteSummary {
  const years = inputs.methodology.analysisYears;
  const aggregates = aggregateByYear(inputs.budgetItems, years);
  const trend: SummaryYearPoint[] = aggregates.map((a) => ({
    fiscalYear: a.fiscalYear,
    originalBudget: a.originalBudget,
    updatedBudget: a.updatedBudget,
    execution: a.execution,
    executionIsEstimate: a.executionIsEstimate,
    executionStatus: a.executionStatus,
  }));

  const ministries = buildMinistrySummaries(inputs);

  const usageYears = [...new Set(inputs.usageBreakdown.rows.map((r) => r.fiscalYear))].sort(
    (a, b) => b - a,
  );
  let hundredShekelYear: number | null = null;
  let hundredShekel: SummarySlice[] = [];
  for (const year of usageYears) {
    const slices = hundredShekelBreakdown(inputs.usageBreakdown.rows, 'all', year);
    if (slices.length > 0) {
      hundredShekelYear = year;
      hundredShekel = slices.map((s) => ({ label: s.label, value: s.perHundred, color: s.color }));
      break;
    }
  }

  const groups = groupDiaryCounts(
    inputs.diaryInsights.categoryTotals,
    inputs.diaryCategories.categories,
  );

  return {
    generatedAt: inputs.generatedAt,
    dataVersion: {
      version: inputs.dataVersion.version,
      builtAt: inputs.dataVersion.builtAt,
      governmentPeriod: inputs.dataVersion.governmentPeriod,
      collectionWindowStart: inputs.dataVersion.collectionWindowStart,
      collectionWindowEnd: inputs.dataVersion.collectionWindowEnd,
      changelog: inputs.dataVersion.changelog,
    },
    counts: {
      ministries: inputs.ministries.length,
      ministrySections: inputs.ministries.filter((m) => m.sectionKind === 'ministry').length,
      otherSections: inputs.ministries.filter((m) => m.sectionKind === 'other').length,
      budgetItems: inputs.budgetItems.length,
      activityItems: inputs.activities.length,
      diaryEntries: inputs.diaryInsights.totals.entries,
      diaryPeople: inputs.diaryInsights.totals.people,
      sources: inputs.dataVersion.counts.sources,
      sourcesRetrieved: inputs.dataVersion.counts.sourcesRetrieved,
      ministerTenures: inputs.dataVersion.counts.ministerTenures,
      anomalyFindings: inputs.anomalies.findings.length,
      diaryFindings: inputs.diaryInsights.findings.length,
      crossMatches: inputs.diaryInsights.crossMatches.length,
      quartersPublishedButUnread: inputs.diaryInsights.totals.quartersPublishedButUnread,
    },
    analysisYears: years,
    latestClosedYear: inputs.anomalies.closedYearMax,
    windowStart: inputs.methodology.windowStart,
    windowEnd: inputs.methodology.windowEnd,
    trend,
    hundredShekel,
    hundredShekelYear,
    insights: buildInsights(inputs, ministries),
    ministries,
    diaryGroups: groups.map((g) => ({
      id: g.group.id,
      labelHe: g.group.labelHe,
      color: g.group.color,
      count: g.count,
      sharePercent: g.sharePercent,
    })),
    diaryCategories: [...inputs.diaryCategories.categories].sort(
      (a, b) => b.entryCount - a.entryCount,
    ),
    diaryTotals: {
      classifiedPercent: inputs.diaryInsights.totals.classifiedPercent,
      noTopicPercent: inputs.diaryInsights.totals.noTopicPercent,
      unclassifiedPercent: inputs.diaryInsights.totals.unclassifiedPercent,
      unspecifiedPercent: inputs.diaryInsights.totals.unspecifiedPercent,
    },
    hygiene: ruleHygiene(inputs.anomalies),
  };
}

/** The eight reading groups, exported so a screen can render the legend. */
export const SUMMARY_DIARY_GROUPS = DIARY_GROUPS;
