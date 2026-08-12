/**
 * Build-time validation schemas.
 *
 * zod is a devDependency used only by the data pipeline; it is never imported
 * by the app, so it does not reach the published bundle. The app declares the
 * same shapes as plain TypeScript interfaces in src/types/domain.ts, and
 * tests/data-integrity.test.ts asserts the processed files satisfy them.
 */
import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'not a real calendar date');

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'not a valid timestamp');

const httpUrl = z.string().url().startsWith('http');

/** A money-ish value: either a finite number, or explicitly absent. Never 0-as-unknown. */
const measure = z.number().finite().nullable();

export const dataStatusSchema = z.enum(['final', 'partial', 'estimate', 'unavailable']);

export const ministrySchema = z.object({
  id: z.string().min(1),
  officialName: z.string().min(1),
  displayName: z.string().min(1),
  aliases: z.array(z.string()),
  description: z.string().min(1),
  activeFrom: isoDate.nullable(),
  activeTo: isoDate.nullable(),
  governmentPeriod: z.string().min(1),
  budgetCodes: z.array(z.string()),
  budgetBookVolume: z.string().nullable(),
  nameEvidenceUrl: httpUrl,
  nameEvidenceTitle: z.string().min(1),
  budgetCodeEvidenceUrl: httpUrl.nullable(),
  dataCoverageSummary: z.string().min(1),
});

export const ministerTenureSchema = z.object({
  id: z.string().min(1),
  personName: z.string().min(1),
  role: z.string().min(1),
  ministryId: z.string().min(1),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  sourceUrl: httpUrl,
  sourceTitle: z.string().min(1),
});

export const budgetItemSchema = z.object({
  id: z.string().min(1),
  ministryId: z.string().min(1),
  fiscalYear: z.number().int().min(2023).max(2026),
  budgetCode: z.string().min(1),
  parentBudgetCode: z.string().nullable(),
  title: z.string().min(1),
  hierarchyPath: z.array(z.string()),
  hierarchyLevel: z.number().int().min(0),
  isLeaf: z.boolean(),
  originalBudget: measure,
  updatedBudget: measure,
  actualExecution: measure,
  estimatedExecution: measure,
  executionRate: measure,
  currency: z.literal('ILS'),
  unit: z.literal('ILS_thousands').or(z.literal('ILS')),
  dataStatus: dataStatusSchema,
  sourceUrl: httpUrl,
  sourceTitle: z.string().min(1),
  sourcePublishedAt: isoDate.nullable(),
  collectedAt: isoDate,
  rawReference: z.string().min(1),
  notes: z.string(),
});

export const activityEvidenceSchema = z.object({
  id: z.string().min(1),
  ministryId: z.string().min(1),
  date: isoDate.nullable(),
  title: z.string().min(1),
  summary: z.string().min(1),
  sourceType: z.enum([
    'calendar',
    'ministry_news',
    'government_page',
    'committee_protocol',
    'policy_document',
    'other_official',
  ]),
  sourceUrl: httpUrl,
  sourceTitle: z.string().min(1),
  collectedAt: isoDate,
  people: z.array(z.string()),
  organizations: z.array(z.string()),
  topics: z.array(z.string()),
  coverageLevel: z.enum(['direct', 'indirect', 'partial']),
  extractionNotes: z.string(),
  isPublicPublicationOnly: z.literal(true),
});

export const topicSchema = z.object({
  id: z.string().min(1),
  labelHe: z.string().min(1),
  description: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  classificationRule: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  activityItemCount: z.number().int().min(0),
});

export const sourceCatalogItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: httpUrl,
  sourceType: z.string().min(1),
  sourceTypeLabelHe: z.string().min(1),
  ministryIds: z.array(z.string()),
  fiscalYears: z.array(z.number().int()),
  periodCovered: z.string().min(1),
  collectedAt: isoDate,
  licenseOrUsageNote: z.string().min(1),
  reliabilityLevel: z.enum(['primary_official', 'secondary_helper']),
  extractionMethod: z.string().min(1),
  discoveryQueryId: z.string().min(1),
  mappingRule: z.string().min(1),
  retrievalStatus: z.enum(['retrieved', 'not_retrieved_egress_blocked', 'not_retrieved_error']),
  retrievalNote: z.string().min(1),
  checksumSha256: z.string().nullable(),
});

export const coverageSchema = z.object({
  ministryId: z.string().min(1),
  dateRangeStart: isoDate,
  dateRangeEnd: isoDate,
  sourcesDefined: z.number().int().min(0),
  sourcesSuccessfullyCollected: z.number().int().min(0),
  activityItemCount: z.number().int().min(0),
  budgetYearsAvailable: z.array(z.number().int()),
  budgetRecordCount: z.number().int().min(0),
  limitations: z.array(z.string().min(1)),
});

export const dataVersionSchema = z.object({
  version: z.string().min(1),
  builtAt: isoDateTime,
  collectionWindowStart: isoDate,
  collectionWindowEnd: isoDate,
  governmentPeriod: z.string().min(1),
  counts: z.object({
    ministries: z.number().int().min(0),
    ministriesWithBudgetData: z.number().int().min(0),
    ministriesWithActivityData: z.number().int().min(0),
    budgetItems: z.number().int().min(0),
    activityItems: z.number().int().min(0),
    ministerTenures: z.number().int().min(0),
    sources: z.number().int().min(0),
    sourcesRetrieved: z.number().int().min(0),
    topicsDefined: z.number().int().min(0),
    topicsWithActivity: z.number().int().min(0),
  }),
  changelog: z.array(z.object({ date: isoDate, note: z.string().min(1) })).min(1),
});

export const activityBudgetLinkSchema = z.object({
  id: z.string().min(1),
  ministryId: z.string().min(1),
  topicId: z.string().min(1),
  activityIds: z.array(z.string()).min(1),
  budgetItemIds: z.array(z.string()).min(1),
  mappingBasis: z.string().min(1),
  caveat: z.string().min(1),
});

export const usageRowSchema = z.object({
  ministryId: z.string().min(1),
  fiscalYear: z.number().int().min(2023).max(2026),
  econLevel1: z.string().min(1),
  econLevel2: z.string().min(1),
  allocated: z.number().finite().nullable(),
  revised: z.number().finite().nullable(),
  executed: z.number().finite().nullable(),
  lineCount: z.number().int().min(1),
  sourceUrl: httpUrl,
});

export const usageBreakdownSchema = z.object({
  generatedAt: isoDate,
  method: z.string().min(1),
  rows: z.array(usageRowSchema),
  coverage: z.array(
    z.object({
      ministryId: z.string().min(1),
      fiscalYear: z.number().int(),
      classifiedRevisedSum: z.number().finite(),
      sectionRevisedTotal: z.number().finite().nullable(),
      coveragePercent: z.number().finite().nullable(),
    }),
  ),
  rejected: z.array(z.object({ ministryId: z.string(), reason: z.string() })),
});

export const budgetThemesSchema = z.object({
  method: z.literal('llm_build_time'),
  methodNote: z.string().min(1),
  confidenceNote: z.string().min(1),
  themes: z
    .array(
      z.object({
        id: z.string().min(1),
        labelHe: z.string().min(1),
        description: z.string().min(1),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        assignedLineCount: z.number().int().min(0),
      }),
    )
    .min(1),
  assignments: z
    .array(
      z.object({
        ministryId: z.string().min(1),
        budgetCode: z.string().min(1),
        title: z.string().min(1),
        themeId: z.string().min(1),
        confidence: z.enum(['high', 'medium']),
        reasoning: z.string().min(10),
      }),
    )
    .min(1),
});

const findingsSupplierSchema = z.object({
  name: z.string().min(1),
  entityId: z.string().nullable(),
  entityKind: z.string().nullable(),
  contractCount: z.number().int().min(0),
  totalVolume: z.number().finite().nullable(),
  totalExecuted: z.number().finite().nullable(),
  entityUrl: httpUrl.nullable(),
});

export const findingsSchema = z.object({
  generatedAt: isoDate,
  fromYear: z.number().int(),
  method: z.string().min(1),
  volumeNote: z.string().min(1),
  suppliers: z.record(z.array(findingsSupplierSchema)),
  contractTotals: z.record(
    z.object({
      contractCount: z.number().int().min(0),
      totalVolume: z.number().finite(),
      top5SharePercent: z.number().finite().nullable(),
    }),
  ),
  procurementMethods: z.record(
    z.array(
      z.object({
        method: z.string().min(1),
        contractCount: z.number().int().min(0),
        totalVolume: z.number().finite(),
        sharePercent: z.number().finite().nullable(),
      }),
    ),
  ),
  notableContracts: z.record(
    z.array(
      z.object({
        supplier: z.string().nullable(),
        entityUrl: httpUrl.nullable(),
        purpose: z.string().nullable(),
        volume: z.number().finite().nullable(),
        executed: z.number().finite().nullable(),
        orderDate: z.string().nullable(),
        method: z.string().min(1),
        budgetCode: z.string().nullable(),
        budgetTitle: z.string().nullable(),
        isActive: z.boolean().nullable(),
      }),
    ),
  ),
  supportRecipients: z.record(
    z.array(
      z.object({
        name: z.string().min(1),
        entityId: z.string().nullable(),
        entityKind: z.string().nullable(),
        requestCount: z.number().int().min(0),
        totalApproved: z.number().finite().nullable(),
        totalPaid: z.number().finite().nullable(),
        exampleTitle: z.string().nullable(),
        entityUrl: httpUrl.nullable(),
      }),
    ),
  ),
  budgetChanges: z.record(
    z.array(
      z.object({
        year: z.number().int().nullable(),
        date: z.string().nullable(),
        reqTitle: z.string().nullable(),
        changeTypeName: z.string().nullable(),
        netExpenseDiff: z.number().finite().nullable(),
        transactionId: z.string().nullable(),
        explanation: z.string(),
        sourceUrl: httpUrl,
      }),
    ),
  ),
});

export const anomaliesSchema = z.object({
  generatedAt: isoDate,
  closedYearMax: z.number().int(),
  method: z.string().min(1),
  rules: z
    .array(
      z.object({
        id: z.string().min(1),
        labelHe: z.string().min(1),
        formulaHe: z.string().min(1),
        whyInterestingHe: z.string().min(1),
        appliesToClosedYearsOnly: z.boolean(),
      }),
    )
    .min(1),
  scannedCounts: z.record(z.number().int().min(0)),
  findings: z.array(
    z.object({
      ruleId: z.string().min(1),
      ministryId: z.string().min(1),
      code: z.string().min(1),
      title: z.string().min(1),
      year: z.number().int(),
      allocated: z.number().finite().nullable(),
      revised: z.number().finite().nullable(),
      executed: z.number().finite().nullable(),
      evidenceHe: z.string().min(1),
      sourceUrl: httpUrl,
    }),
  ),
});

export const schemas = {
  ministries: z.array(ministrySchema),
  ministerTenures: z.array(ministerTenureSchema),
  budgetItems: z.array(budgetItemSchema),
  activityEvidence: z.array(activityEvidenceSchema),
  topics: z.array(topicSchema),
  sourceCatalog: z.array(sourceCatalogItemSchema),
  coverage: z.array(coverageSchema),
  dataVersion: dataVersionSchema,
  activityBudgetLinks: z.array(activityBudgetLinkSchema),
  usageBreakdown: usageBreakdownSchema,
  budgetThemes: budgetThemesSchema,
  findings: findingsSchema,
  anomalies: anomaliesSchema,
};

export type Ministry = z.infer<typeof ministrySchema>;
export type BudgetItem = z.infer<typeof budgetItemSchema>;
export type ActivityEvidence = z.infer<typeof activityEvidenceSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type SourceCatalogItem = z.infer<typeof sourceCatalogItemSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type MinisterTenure = z.infer<typeof ministerTenureSchema>;
export type ActivityBudgetLink = z.infer<typeof activityBudgetLinkSchema>;
