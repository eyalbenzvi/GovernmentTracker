/**
 * The small file the site loads before anything else.
 *
 * The full datasets are 12MB of JSON; the home screen and the layout need a few
 * hundred figures. This shape is produced at build time by scripts/build-summary.ts
 * so the first screen is not gated on parsing the corpus, and so the editorial
 * ranking that decides what leads the home screen is computed once and reviewable
 * in git rather than recomputed per visitor.
 */
import type { DataStatus, DiaryCategory } from './domain';
import type { PublicationState } from '../lib/scorecards';

export interface SummaryInsight {
  id: string;
  kind: 'budget' | 'execution' | 'procurement' | 'diary' | 'coverage';
  headline: string;
  sentenceHe: string;
  notSayingHe: string;
  href: string;
  sourceUrl: string | null;
  sourceTitleHe: string | null;
  strength: number;
}

export interface SummaryYearPoint {
  fiscalYear: number;
  originalBudget: number | null;
  updatedBudget: number | null;
  execution: number | null;
  executionIsEstimate: boolean;
  executionStatus: DataStatus;
}

export interface SummarySlice {
  label: string;
  value: number;
  color: string;
}

export interface MinistrySummary {
  id: string;
  officialName: string;
  displayName: string;
  sectionKind: 'ministry' | 'other';
  latestBudgetYear: number | null;
  originalBudget: number | null;
  updatedBudget: number | null;
  execution: number | null;
  executionIsEstimate: boolean;
  executionRatePercent: number | null;
  shareOfTotalPercent: number | null;
  budgetRank: number | null;
  budgetRankOutOf: number | null;
  activityCount: number;
  diaryEntryCount: number;
  diaryPeopleCount: number;
  transparencyScore: number | null;
  procurementScore: number | null;
  exemptVolumeSharePercent: number | null;
  top5SharePercent: number | null;
  contractCount: number;
  publicationState: PublicationState;
  publishedDatasets: number;
  unreadDatasets: number;
  anomalyCount: number;
  supportRecipientCount: number;
  crossMatchCount: number;
  subjectMatterSharePercent: number | null;
  limitationCount: number;
}

export interface SummaryDiaryGroup {
  id: string;
  labelHe: string;
  color: string;
  count: number;
  sharePercent: number | null;
}

export interface SummaryRuleHygiene {
  ruleId: string;
  labelHe: string;
  findingCount: number;
  scannedCount: number;
  ratePerThousand: number | null;
  ministriesAffected: number;
  appliesToClosedYearsOnly: boolean;
  whyInterestingHe: string;
}

export interface SiteSummary {
  generatedAt: string;
  dataVersion: {
    version: string;
    builtAt: string;
    governmentPeriod: string;
    collectionWindowStart: string;
    collectionWindowEnd: string;
    changelog: Array<{ date: string; note: string }>;
  };
  counts: {
    ministries: number;
    ministrySections: number;
    otherSections: number;
    budgetItems: number;
    activityItems: number;
    diaryEntries: number;
    diaryPeople: number;
    sources: number;
    sourcesRetrieved: number;
    ministerTenures: number;
    anomalyFindings: number;
    diaryFindings: number;
    crossMatches: number;
    quartersPublishedButUnread: number;
  };
  analysisYears: number[];
  latestClosedYear: number;
  windowStart: string;
  windowEnd: string;
  trend: SummaryYearPoint[];
  hundredShekel: SummarySlice[];
  hundredShekelYear: number | null;
  insights: SummaryInsight[];
  ministries: MinistrySummary[];
  diaryGroups: SummaryDiaryGroup[];
  diaryCategories: DiaryCategory[];
  diaryTotals: {
    classifiedPercent: number | null;
    noTopicPercent: number | null;
    unclassifiedPercent: number | null;
    unspecifiedPercent: number | null;
  };
  hygiene: SummaryRuleHygiene[];
}
