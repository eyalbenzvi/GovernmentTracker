import { describe, expect, it } from 'vitest';
import {
  budgetChangeAbsolute,
  budgetChangePercent,
  executionBasis,
  executionRate,
  isLargeChange,
  sumWithoutDoubleCounting,
} from '../src/lib/calc';
import type { BudgetItem } from '../src/types/domain';

function item(overrides: Partial<BudgetItem>): BudgetItem {
  return {
    id: 'x',
    ministryId: 'transport',
    fiscalYear: 2025,
    budgetCode: '0040',
    parentBudgetCode: null,
    title: 'סעיף',
    hierarchyPath: ['משרד', 'סעיף'],
    hierarchyLevel: 0,
    isLeaf: true,
    originalBudget: null,
    updatedBudget: null,
    actualExecution: null,
    estimatedExecution: null,
    executionRate: null,
    currency: 'ILS',
    unit: 'ILS',
    dataStatus: 'partial',
    sourceUrl: 'https://example.gov.il/a',
    sourceTitle: 'מקור',
    sourcePublishedAt: null,
    collectedAt: '2026-08-12',
    rawReference: 'ref',
    notes: '',
    ...overrides,
  };
}

describe('budgetChangeAbsolute', () => {
  it('subtracts original from updated', () => {
    expect(budgetChangeAbsolute({ originalBudget: 100, updatedBudget: 130 })).toBe(30);
    expect(budgetChangeAbsolute({ originalBudget: 100, updatedBudget: 70 })).toBe(-30);
  });

  it('returns null when either side is missing', () => {
    expect(budgetChangeAbsolute({ originalBudget: null, updatedBudget: 130 })).toBeNull();
    expect(budgetChangeAbsolute({ originalBudget: 100, updatedBudget: null })).toBeNull();
  });

  it('returns null for non-finite input rather than NaN', () => {
    expect(budgetChangeAbsolute({ originalBudget: Number.NaN, updatedBudget: 1 })).toBeNull();
    expect(budgetChangeAbsolute({ originalBudget: 1, updatedBudget: Infinity })).toBeNull();
  });
});

describe('budgetChangePercent', () => {
  it('computes a one-decimal percentage', () => {
    expect(budgetChangePercent({ originalBudget: 200, updatedBudget: 250 })).toBe(25);
    expect(budgetChangePercent({ originalBudget: 300, updatedBudget: 200 })).toBeCloseTo(-33.3, 1);
  });

  it('refuses to divide by a zero original budget', () => {
    expect(budgetChangePercent({ originalBudget: 0, updatedBudget: 500 })).toBeNull();
  });
});

describe('executionRate', () => {
  it('divides execution by the updated budget', () => {
    expect(
      executionRate({ actualExecution: 90, estimatedExecution: null, updatedBudget: 100 }),
    ).toBe(90);
  });

  it('falls back to the estimate when there is no actual figure', () => {
    expect(
      executionRate({ actualExecution: null, estimatedExecution: 50, updatedBudget: 200 }),
    ).toBe(25);
  });

  it('is null when the denominator is zero or negative', () => {
    expect(
      executionRate({ actualExecution: 10, estimatedExecution: null, updatedBudget: 0 }),
    ).toBeNull();
    expect(
      executionRate({ actualExecution: 10, estimatedExecution: null, updatedBudget: -5 }),
    ).toBeNull();
  });

  it('is null when no execution figure exists — never 0', () => {
    expect(
      executionRate({ actualExecution: null, estimatedExecution: null, updatedBudget: 100 }),
    ).toBeNull();
  });
});

describe('executionBasis', () => {
  it('reports which figure a rate was derived from', () => {
    expect(executionBasis({ actualExecution: 1, estimatedExecution: 2 })).toBe('actual');
    expect(executionBasis({ actualExecution: null, estimatedExecution: 2 })).toBe('estimate');
    expect(executionBasis({ actualExecution: null, estimatedExecution: null })).toBe('none');
  });
});

describe('sumWithoutDoubleCounting', () => {
  it('sums only leaf records when leaves exist', () => {
    const items = [
      item({
        id: 'parent',
        budgetCode: '00',
        isLeaf: false,
        hierarchyLevel: 0,
        updatedBudget: 1000,
      }),
      item({
        id: 'child-a',
        budgetCode: '0001',
        isLeaf: true,
        hierarchyLevel: 1,
        updatedBudget: 600,
      }),
      item({
        id: 'child-b',
        budgetCode: '0002',
        isLeaf: true,
        hierarchyLevel: 1,
        updatedBudget: 400,
      }),
    ];
    const result = sumWithoutDoubleCounting(items, (i) => i.updatedBudget);
    // 1000 (the parent) must not be added on top of 600 + 400.
    expect(result.total).toBe(1000);
    expect(result.level).toBe('leaf');
    expect(result.countedRecords).toBe(2);
  });

  it('falls back to the shallowest level when nothing is marked as a leaf', () => {
    const items = [
      item({ id: 'a', isLeaf: false, hierarchyLevel: 0, updatedBudget: 500 }),
      item({ id: 'b', isLeaf: false, hierarchyLevel: 1, updatedBudget: 300 }),
    ];
    const result = sumWithoutDoubleCounting(items, (i) => i.updatedBudget);
    expect(result.total).toBe(500);
    expect(result.level).toBe(0);
  });

  it('returns null rather than 0 for an empty set', () => {
    expect(sumWithoutDoubleCounting([], (i) => i.updatedBudget).total).toBeNull();
  });

  it('returns null rather than 0 when no record carries the measure', () => {
    const items = [item({ id: 'a', updatedBudget: null })];
    expect(sumWithoutDoubleCounting(items, (i) => i.updatedBudget).total).toBeNull();
  });
});

describe('isLargeChange', () => {
  it('requires both the relative and the absolute threshold', () => {
    // 25% but only 25M — below the absolute threshold.
    expect(isLargeChange({ originalBudget: 100_000_000, updatedBudget: 125_000_000 })).toBe(false);
    // 100M but only 10% — below the relative threshold.
    expect(isLargeChange({ originalBudget: 1_000_000_000, updatedBudget: 1_100_000_000 })).toBe(
      false,
    );
    // 25% and 250M — both satisfied.
    expect(isLargeChange({ originalBudget: 1_000_000_000, updatedBudget: 1_250_000_000 })).toBe(
      true,
    );
  });

  it('is false when the change cannot be computed', () => {
    expect(isLargeChange({ originalBudget: null, updatedBudget: 1_000_000_000 })).toBe(false);
    expect(isLargeChange({ originalBudget: 0, updatedBudget: 1_000_000_000 })).toBe(false);
  });
});
