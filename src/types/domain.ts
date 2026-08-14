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
  sectionKind: 'ministry' | 'other';
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
    diaryEntries: number;
    diaryDatasets: number;
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
  coveredMinistryIds: string[];
  methodNote: string;
  confidenceNote: string;
  themes: BudgetTheme[];
  assignments: ThemeAssignment[];
}

export interface TopSupplier {
  name: string;
  entityId: string | null;
  entityKind: string | null;
  contractCount: number;
  totalVolume: number | null;
  totalExecuted: number | null;
  entityUrl: string | null;
}

export interface ProcurementMethodShare {
  method: string;
  contractCount: number;
  totalVolume: number;
  sharePercent: number | null;
}

export interface NotableContract {
  supplier: string | null;
  entityUrl: string | null;
  purpose: string | null;
  volume: number | null;
  executed: number | null;
  orderDate: string | null;
  method: string;
  budgetCode: string | null;
  budgetTitle: string | null;
  isActive: boolean | null;
}

export interface SupportRecipient {
  name: string;
  entityId: string | null;
  entityKind: string | null;
  requestCount: number;
  totalApproved: number | null;
  totalPaid: number | null;
  exampleTitle: string | null;
  entityUrl: string | null;
}

export interface BudgetChangeRequest {
  year: number | null;
  date: string | null;
  reqTitle: string | null;
  changeTypeName: string | null;
  netExpenseDiff: number | null;
  transactionId: string | null;
  explanation: string;
  sourceUrl: string;
}

export interface ExcludedContracts {
  rule: string;
  excludedCount: number;
  excludedVolume: number;
  dataSuspect: boolean;
  examples: Array<{
    name: string | null;
    purpose: string | null;
    volume: number | null;
    budgetCode: string | null;
    budgetTitle: string | null;
  }>;
}

export interface Findings {
  generatedAt: string;
  fromYear: number;
  method: string;
  volumeNote: string;
  suppliers: Record<string, TopSupplier[]>;
  excludedContracts: Record<string, ExcludedContracts>;
  contractTotals: Record<
    string,
    { contractCount: number; totalVolume: number; top5SharePercent: number | null }
  >;
  procurementMethods: Record<string, ProcurementMethodShare[]>;
  notableContracts: Record<string, NotableContract[]>;
  supportRecipients: Record<string, SupportRecipient[]>;
  budgetChanges: Record<string, BudgetChangeRequest[]>;
}

export interface AnomalyRule {
  id: string;
  labelHe: string;
  formulaHe: string;
  whyInterestingHe: string;
  appliesToClosedYearsOnly: boolean;
}

export interface AnomalyFinding {
  ruleId: string;
  ministryId: string;
  code: string;
  title: string;
  year: number;
  allocated: number | null;
  revised: number | null;
  executed: number | null;
  evidenceHe: string;
  sourceUrl: string;
}

export interface Anomalies {
  generatedAt: string;
  closedYearMax: number;
  method: string;
  rules: AnomalyRule[];
  scannedCounts: Record<string, number>;
  findings: AnomalyFinding[];
}

export type DiaryPersonRole = 'minister' | 'deputy_minister' | 'director_general' | 'other_senior';

export type DiaryExtractionMethod = 'datastore' | 'spreadsheet' | 'pdf_text' | 'pdf_ocr';

/**
 * A single diary row as shipped inside a per-section shard. Publication-level
 * facts (who, which role, source URL) live once in DiariesIndex.datasets and are
 * joined by datasetId, so ~190k rows stay small enough to load a section at a time.
 */
export interface DiaryEntry {
  id: string;
  datasetId: string;
  subject: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  participants: string | null;
  extractionMethod: DiaryExtractionMethod;
  categoryId?: string;
  matchedKeyword?: string | null;
  /** How firm the keyword behind this assignment is, as its author stated it. */
  matchedConfidence?: 'high' | 'medium' | 'low' | null;
}

export interface DiaryCategory {
  id: string;
  labelHe: string;
  description: string;
  color: string;
  reasoning: string;
  keywordCount: number;
  entryCount: number;
}

export interface DiaryCategories {
  generatedAt: string;
  method: 'llm_authored_rules_build_time';
  methodNote: string;
  classifierRule: string;
  limitations: string[];
  categories: DiaryCategory[];
  totals: { classifiedEntries: number };
}

export interface DiaryPeriodBucket {
  period: string;
  count: number;
  byCategory: Record<string, number>;
}

export interface DiaryProfile {
  key: string;
  ministryId: string | null;
  personLabel: string | null;
  personRole: DiaryPersonRole;
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
  /** Rows with real subject text that the declared vocabulary does not cover. */
  unclassifiedCount: number;
  unclassifiedPercent: number | null;
  /** True when one published file holds several people's diaries. */
  coversMultiplePeople: boolean;
  categoryCounts: Record<string, number>;
  monthly: DiaryPeriodBucket[];
  quarterly: DiaryPeriodBucket[];
  weekendCount: number;
  lateNightCount: number;
  longMeetingCount: number;
  marathonDays: string[];
  doubleBookedCount: number;
  busiestDay: { date: string; count: number } | null;
  repeatedSubjects: Array<{ subject: string; count: number }>;
}

export interface DiaryFinding {
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

export interface DiaryCrossMatch {
  ruleId: 'supplier_meeting' | 'support_recipient_meeting';
  entryId: string;
  ministryId: string;
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

export interface DiaryInsights {
  generatedAt: string;
  method: string;
  caveats: string[];
  rules: Array<{
    id: string;
    labelHe: string;
    formulaHe: string;
    whyInterestingHe: string;
  }>;
  thresholds: Record<string, number>;
  totals: {
    entries: number;
    people: number;
    ministries: number;
    findings: number;
    crossMatches: number;
    /** Profiles skipped by the person-level rules because their file is shared. */
    sharedFileProfiles: number;
    unspecifiedPercent: number | null;
    unclassifiedPercent: number | null;
    classifiedPercent: number | null;
    noSubjectPercent: number | null;
  };
  categoryTotals: Record<string, number>;
  monthlyAll: Array<{ period: string; count: number }>;
  profiles: DiaryProfile[];
  findings: DiaryFinding[];
  crossMatches: DiaryCrossMatch[];
}

export interface DiaryUnparsedResource {
  name: string;
  format: string;
  note: string;
}

export interface DiaryDatasetMeta {
  datasetId: string;
  title: string;
  url: string;
  ministryId: string | null;
  personLabel: string | null;
  personRole: DiaryPersonRole;
  roleLabelHe: string;
  periodLabel: string | null;
  machineReadableEntries: number;
  skippedEmptyRows: number;
  outOfWindowRows: number;
  truncated: boolean;
  unparsedResources: DiaryUnparsedResource[];
}

export interface DiariesIndex {
  generatedAt: string;
  source: {
    name: string;
    url: string;
    trustTier: 'civic_helper';
    note: string;
  };
  windowStart: string;
  totals: {
    datasets: number;
    entries: number;
    datasetsWithEntries: number;
    unattributedDatasets: number;
    unparsedResources: number;
    duplicateRowsRemoved: number;
    datasetsWithoutIdentifier: number;
    timeBudgetReached?: boolean;
    byExtractionMethod: Record<DiaryExtractionMethod, number>;
  };
  unmatchedTitles: string[];
  shards: Array<{
    shardKey: string;
    ministryId: string | null;
    file: string;
    entryCount: number;
  }>;
  datasets: DiaryDatasetMeta[];
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
  findings: Findings;
  anomalies: Anomalies;
  diariesIndex: DiariesIndex;
  diaryCategories: DiaryCategories;
  diaryInsights: DiaryInsights;
}
