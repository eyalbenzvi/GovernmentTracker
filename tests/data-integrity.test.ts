/**
 * Integrity tests against the *actual* processed data files that ship with the
 * site. These duplicate part of scripts/validate-data.ts on purpose: the script
 * gates the pipeline, and these tests gate the application build, so a dataset
 * cannot reach the bundle without satisfying both.
 */
import { describe, expect, it } from 'vitest';
import activities from '../data/processed/activity-evidence.json';
import budgetItems from '../data/processed/budget-items.json';
import coverage from '../data/processed/coverage.json';
import dataVersion from '../data/processed/data-version.json';
import links from '../data/processed/activity-budget-links.json';
import methodology from '../data/processed/methodology.json';
import ministries from '../data/processed/ministries.json';
import sources from '../data/processed/source-catalog.json';
import tenures from '../data/processed/minister-tenures.json';
import topics from '../data/processed/topics.json';
import type {
  ActivityBudgetLink,
  ActivityEvidence,
  BudgetItem,
  Coverage,
  Ministry,
  SourceCatalogItem,
  Topic,
} from '../src/types/domain';

const ministryList = ministries as Ministry[];
const budgetList = budgetItems as BudgetItem[];
const activityList = activities as ActivityEvidence[];
const sourceList = sources as SourceCatalogItem[];
const topicList = topics as Topic[];
const coverageList = coverage as Coverage[];
// An empty JSON array is inferred as never[]; assert the real element type so the
// referential-integrity checks below still typecheck once links exist.
const linkList = links as ActivityBudgetLink[];

function ids(values: { id: string }[]): string[] {
  return values.map((v) => v.id);
}

describe('identifiers', () => {
  it('are unique in every dataset', () => {
    for (const list of [ministryList, budgetList, activityList, sourceList, topicList]) {
      const seen = ids(list as { id: string }[]);
      expect(new Set(seen).size).toBe(seen.length);
    }
    const ministryIds = coverageList.map((c) => c.ministryId);
    expect(new Set(ministryIds).size).toBe(ministryIds.length);
  });
});

describe('source attribution', () => {
  it('gives every ministry a name-evidence URL', () => {
    for (const ministry of ministryList) {
      expect(ministry.nameEvidenceUrl).toMatch(/^https?:\/\//);
      expect(ministry.nameEvidenceTitle.length).toBeGreaterThan(0);
    }
  });

  it('gives every catalogued source an absolute URL and a publisher', () => {
    for (const source of sourceList) {
      expect(source.url).toMatch(/^https?:\/\//);
      expect(source.publisher.length).toBeGreaterThan(0);
      expect(source.licenseOrUsageNote.length).toBeGreaterThan(0);
    }
  });

  it('gives every budget record and activity item a source URL', () => {
    for (const item of budgetList) expect(item.sourceUrl).toMatch(/^https?:\/\//);
    for (const item of activityList) expect(item.sourceUrl).toMatch(/^https?:\/\//);
  });

  it('never shows a source whose host is absent from the catalogue', () => {
    const hosts = new Set(sourceList.map((s) => new URL(s.url).host));
    for (const item of [...budgetList, ...activityList]) {
      expect(hosts.has(new URL(item.sourceUrl).host)).toBe(true);
    }
  });
});

describe('amounts', () => {
  it('are finite numbers or explicitly null — never NaN', () => {
    for (const item of budgetList) {
      for (const value of [
        item.originalBudget,
        item.updatedBudget,
        item.actualExecution,
        item.estimatedExecution,
        item.executionRate,
      ]) {
        if (value !== null) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('never labels a current-or-future year as a final execution figure', () => {
    const currentYear = new Date().getFullYear();
    for (const item of budgetList) {
      if (item.fiscalYear >= currentYear) {
        expect(item.dataStatus).not.toBe('final');
        expect(item.actualExecution).toBeNull();
      }
    }
  });

  it('stores an execution rate consistent with the stated formula', () => {
    for (const item of budgetList) {
      const execution = item.actualExecution ?? item.estimatedExecution;
      if (item.executionRate === null) continue;
      expect(execution).not.toBeNull();
      expect(item.updatedBudget).not.toBeNull();
      const expected =
        Math.round(((execution as number) / (item.updatedBudget as number)) * 1000) / 10;
      expect(Math.abs(item.executionRate - expected)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe('dates', () => {
  it('are valid ISO calendar dates wherever present', () => {
    const check = (value: string | null): void => {
      if (value === null) return;
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(value))).toBe(false);
    };
    for (const item of budgetList) {
      check(item.sourcePublishedAt);
      check(item.collectedAt);
    }
    for (const item of activityList) {
      check(item.date);
      check(item.collectedAt);
    }
    for (const item of sourceList) check(item.collectedAt);
    for (const row of coverageList) {
      check(row.dateRangeStart);
      check(row.dateRangeEnd);
    }
  });

  it('keeps activity items inside the declared analysis window', () => {
    for (const item of activityList) {
      if (item.date !== null) {
        expect(item.date >= methodology.windowStart).toBe(true);
      }
    }
  });
});

describe('hierarchy', () => {
  it('never marks both a record and its declared parent as leaves', () => {
    const leafCodes = new Map<string, Set<string>>();
    for (const item of budgetList.filter((b) => b.isLeaf)) {
      const key = `${item.ministryId}:${item.fiscalYear}`;
      const bucket = leafCodes.get(key) ?? new Set<string>();
      bucket.add(item.budgetCode);
      leafCodes.set(key, bucket);
    }
    for (const item of budgetList.filter((b) => b.isLeaf && b.parentBudgetCode !== null)) {
      const key = `${item.ministryId}:${item.fiscalYear}`;
      expect(leafCodes.get(key)?.has(item.parentBudgetCode as string)).not.toBe(true);
    }
  });
});

describe('referential integrity', () => {
  it('resolves every ministry, topic, activity and budget reference', () => {
    const ministryIds = new Set(ministryList.map((m) => m.id));
    const topicIds = new Set(topicList.map((t) => t.id));
    const activityIds = new Set(activityList.map((a) => a.id));
    const budgetIds = new Set(budgetList.map((b) => b.id));

    for (const item of budgetList) expect(ministryIds.has(item.ministryId)).toBe(true);
    for (const item of activityList) {
      expect(ministryIds.has(item.ministryId)).toBe(true);
      for (const topicId of item.topics) expect(topicIds.has(topicId)).toBe(true);
    }
    for (const row of coverageList) expect(ministryIds.has(row.ministryId)).toBe(true);
    for (const link of linkList) {
      expect(ministryIds.has(link.ministryId)).toBe(true);
      for (const id of link.activityIds) expect(activityIds.has(id)).toBe(true);
      for (const id of link.budgetItemIds) expect(budgetIds.has(id)).toBe(true);
    }
  });

  it('gives every ministry a coverage row', () => {
    for (const ministry of ministryList) {
      expect(coverageList.some((c) => c.ministryId === ministry.id)).toBe(true);
    }
  });
});

describe('topic counts', () => {
  it('match the number of activity items actually classified', () => {
    const actual = new Map<string, number>();
    for (const item of activityList) {
      for (const topicId of item.topics) {
        actual.set(topicId, (actual.get(topicId) ?? 0) + 1);
      }
    }
    for (const topic of topicList) {
      expect(topic.activityItemCount).toBe(actual.get(topic.id) ?? 0);
    }
  });
});

describe('coverage honesty', () => {
  it('agrees with the record counts it summarises', () => {
    for (const row of coverageList) {
      expect(row.budgetRecordCount).toBe(
        budgetList.filter((b) => b.ministryId === row.ministryId).length,
      );
      expect(row.activityItemCount).toBe(
        activityList.filter((a) => a.ministryId === row.ministryId).length,
      );
      expect(row.sourcesDefined).toBe(
        sourceList.filter((s) => s.ministryIds.includes(row.ministryId)).length,
      );
      expect(row.sourcesSuccessfullyCollected).toBeLessThanOrEqual(row.sourcesDefined);
    }
  });

  it('states a limitation whenever a ministry has no budget data', () => {
    for (const row of coverageList) {
      if (row.budgetRecordCount === 0) expect(row.limitations.length).toBeGreaterThan(0);
    }
  });
});

describe('data version', () => {
  it('reports counts that match the datasets', () => {
    expect(dataVersion.counts.ministries).toBe(ministryList.length);
    expect(dataVersion.counts.budgetItems).toBe(budgetList.length);
    expect(dataVersion.counts.activityItems).toBe(activityList.length);
    expect(dataVersion.counts.sources).toBe(sourceList.length);
    expect(dataVersion.counts.topicsDefined).toBe(topicList.length);
    expect(dataVersion.counts.ministerTenures).toBe(tenures.length);
    expect(dataVersion.counts.topicsWithActivity).toBe(
      topicList.filter((t) => t.activityItemCount > 0).length,
    );
    expect(dataVersion.counts.sourcesRetrieved).toBe(
      sourceList.filter((s) => s.retrievalStatus === 'retrieved').length,
    );
  });

  it('carries at least one changelog entry', () => {
    expect(dataVersion.changelog.length).toBeGreaterThan(0);
  });
});

describe('methodology', () => {
  it('documents the window and the measures', () => {
    expect(methodology.windowStart).toBe('2022-12-29');
    expect(methodology.analysisYears).toEqual([2023, 2024, 2025, 2026]);
    const sectionIds = methodology.sections.map((s) => s.id);
    for (const required of ['scope', 'collection', 'measures', 'aggregation', 'topics', 'links']) {
      expect(sectionIds).toContain(required);
    }
  });
});

describe('aggregation safety', () => {
  it('sums leaves to exactly the section total, per ministry and year', () => {
    for (const ministry of ministryList) {
      const years = [...new Set(budgetList.map((b) => b.fiscalYear))];
      for (const year of years) {
        const rows = budgetList.filter(
          (b) => b.ministryId === ministry.id && b.fiscalYear === year,
        );
        if (rows.length === 0) continue;
        const roots = rows.filter((b) => b.hierarchyLevel === 1);
        const leaves = rows.filter((b) => b.isLeaf);
        if (roots.length === 0 || leaves.length === 0) continue;
        const rootTotal = roots.reduce((sum, b) => sum + (b.updatedBudget ?? 0), 0);
        const leafTotal = leaves.reduce((sum, b) => sum + (b.updatedBudget ?? 0), 0);
        // Any drift here means the hierarchy is inconsistent and every aggregate
        // on the site would be wrong.
        expect(Math.abs(rootTotal - leafTotal)).toBeLessThan(1);
      }
    }
  });

  it('never marks a record as a leaf when another record declares it a parent', () => {
    for (const year of new Set(budgetList.map((b) => b.fiscalYear))) {
      const rows = budgetList.filter((b) => b.fiscalYear === year);
      const declaredParents = new Set(
        rows.map((b) => b.parentBudgetCode).filter((c): c is string => c !== null),
      );
      for (const row of rows.filter((b) => b.isLeaf)) {
        expect(declaredParents.has(row.budgetCode)).toBe(false);
      }
    }
  });
});

describe('execution-figure honesty', () => {
  it('flags every out-of-band execution rate with an explicit outlier note', () => {
    const outliers = budgetList.filter(
      (b) => b.executionRate !== null && (b.executionRate < 0 || b.executionRate > 150),
    );
    for (const item of outliers) {
      expect(item.notes).toContain('חריגה:');
    }
  });

  it('never labels a figure from the secondary budget layer as final', () => {
    for (const item of budgetList) {
      if (new URL(item.sourceUrl).host.includes('obudget.org')) {
        expect(item.dataStatus).not.toBe('final');
      }
    }
  });

  it('records the unit and currency on every figure', () => {
    for (const item of budgetList) {
      expect(item.currency).toBe('ILS');
      expect(['ILS', 'ILS_thousands']).toContain(item.unit);
    }
  });
});
