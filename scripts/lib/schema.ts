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
};

export type Ministry = z.infer<typeof ministrySchema>;
export type BudgetItem = z.infer<typeof budgetItemSchema>;
export type ActivityEvidence = z.infer<typeof activityEvidenceSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type SourceCatalogItem = z.infer<typeof sourceCatalogItemSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type MinisterTenure = z.infer<typeof ministerTenureSchema>;
export type ActivityBudgetLink = z.infer<typeof activityBudgetLinkSchema>;
