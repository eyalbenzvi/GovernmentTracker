/**
 * Domain types for the published site.
 *
 * These mirror the build-time zod schemas in scripts/lib/schema.ts. The
 * duplication is deliberate: zod stays a devDependency so it never ships to the
 * browser, while tests/data-integrity.test.ts asserts that the processed JSON
 * really satisfies these shapes.
 */

export type DataStatus = 'final' | 'partial' | 'estimate' | 'unavailable';

export interface Ministry {
  id: string;
  officialName: string;
  displayName: string;
  aliases: string[];
  description: string;
  activeFrom: string | null;
  activeTo: string | null;
  governmentPeriod: string;
  budgetCodes: string[];
  budgetBookVolume: string | null;
  nameEvidenceUrl: string;
  nameEvidenceTitle: string;
  budgetCodeEvidenceUrl: string | null;
  dataCoverageSummary: string;
}

export interface MinisterTenure {
  id: string;
  personName: string;
  role: string;
  ministryId: string;
  startDate: string | null;
  endDate: string | null;
  sourceUrl: string;
  sourceTitle: string;
}

export interface BudgetItem {
  id: string;
  ministryId: string;
  fiscalYear: number;
  budgetCode: string;
  parentBudgetCode: string | null;
  title: string;
  hierarchyPath: string[];
  hierarchyLevel: number;
  isLeaf: boolean;
  originalBudget: number | null;
  updatedBudget: number | null;
  actualExecution: number | null;
  estimatedExecution: number | null;
  executionRate: number | null;
  currency: 'ILS';
  unit: 'ILS' | 'ILS_thousands';
  dataStatus: DataStatus;
  sourceUrl: string;
  sourceTitle: string;
  sourcePublishedAt: string | null;
  collectedAt: string;
  rawReference: string;
  notes: string;
}

export type ActivitySourceType =
  | 'calendar'
  | 'ministry_news'
  | 'government_page'
  | 'committee_protocol'
  | 'policy_document'
  | 'other_official';

export interface ActivityEvidence {
  id: string;
  ministryId: string;
  date: string | null;
  title: string;
  summary: string;
  sourceType: ActivitySourceType;
  sourceUrl: string;
  sourceTitle: string;
  collectedAt: string;
  people: string[];
  organizations: string[];
  topics: string[];
  coverageLevel: 'direct' | 'indirect' | 'partial';
  extractionNotes: string;
  isPublicPublicationOnly: true;
}

export interface Topic {
  id: string;
  labelHe: string;
  description: string;
  keywords: string[];
  classificationRule: string;
  color: string;
  activityItemCount: number;
}

export interface SourceCatalogItem {
  id: string;
  title: string;
  publisher: string;
  url: string;
  sourceType: string;
  sourceTypeLabelHe: string;
  ministryIds: string[];
  fiscalYears: number[];
  periodCovered: string;
  collectedAt: string;
  licenseOrUsageNote: string;
  reliabilityLevel: 'primary_official' | 'secondary_helper';
  extractionMethod: string;
  discoveryQueryId: string;
  mappingRule: string;
  retrievalStatus: 'retrieved' | 'not_retrieved_egress_blocked' | 'not_retrieved_error';
  retrievalNote: string;
  checksumSha256: string | null;
}

export interface Coverage {
  ministryId: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  sourcesDefined: number;
  sourcesSuccessfullyCollected: number;
  activityItemCount: number;
  budgetYearsAvailable: number[];
  budgetRecordCount: number;
  limitations: string[];
}

export interface ActivityBudgetLink {
  id: string;
  ministryId: string;
  topicId: string;
  activityIds: string[];
  budgetItemIds: string[];
  mappingBasis: string;
  caveat: string;
}

export interface MethodologySection {
  id: string;
  title: string;
  paragraphs: string[];
}

export interface Methodology {
  generatedAt: string;
  purpose: string;
  windowStart: string;
  windowEnd: string;
  governmentPeriod: string;
  analysisYears: number[];
  sections: MethodologySection[];
}

export interface DataVersion {
  version: string;
  builtAt: string;
  collectionWindowStart: string;
  collectionWindowEnd: string;
  governmentPeriod: string;
  counts: {
    ministries: number;
    ministriesWithBudgetData: number;
    ministriesWithActivityData: number;
    budgetItems: number;
    activityItems: number;
    ministerTenures: number;
    sources: number;
    sourcesRetrieved: number;
    topicsDefined: number;
    topicsWithActivity: number;
  };
  changelog: Array<{ date: string; note: string }>;
}

export interface UsageRow {
  ministryId: string;
  fiscalYear: number;
  econLevel1: string;
  econLevel2: string;
  allocated: number | null;
  revised: number | null;
  executed: number | null;
  lineCount: number;
  sourceUrl: string;
}

export interface UsageCoverageRow {
  ministryId: string;
  fiscalYear: number;
  classifiedRevisedSum: number;
  sectionRevisedTotal: number | null;
  coveragePercent: number | null;
}

export interface UsageBreakdown {
  generatedAt: string;
  method: string;
  rows: UsageRow[];
  coverage: UsageCoverageRow[];
  rejected: Array<{ ministryId: string; reason: string }>;
}

export interface BudgetTheme {
  id: string;
  labelHe: string;
  description: string;
  color: string;
  assignedLineCount: number;
}

export interface ThemeAssignment {
  ministryId: string;
  budgetCode: string;
  title: string;
  themeId: string;
  confidence: 'high' | 'medium';
  reasoning: string;
}

export interface BudgetThemes {
  method: 'llm_build_time';
  methodNote: string;
  confidenceNote: string;
  themes: BudgetTheme[];
  assignments: ThemeAssignment[];
}

export interface Dataset {
  ministries: Ministry[];
  ministerTenures: MinisterTenure[];
  budgetItems: BudgetItem[];
  activities: ActivityEvidence[];
  topics: Topic[];
  sources: SourceCatalogItem[];
  coverage: Coverage[];
  links: ActivityBudgetLink[];
  methodology: Methodology;
  dataVersion: DataVersion;
  usageBreakdown: UsageBreakdown;
  budgetThemes: BudgetThemes;
}
