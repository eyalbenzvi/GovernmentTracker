import { describe, expect, it } from 'vitest';
import {
  econColor,
  hundredShekelBreakdown,
  themeAggregates,
  topBudgetShifts,
  usageDetailForYear,
  usageSeries,
  volatilityIndex,
} from '../src/lib/analysis';
import type { BudgetItem, BudgetTheme, ThemeAssignment, UsageRow } from '../src/types/domain';

function usageRow(overrides: Partial<UsageRow>): UsageRow {
  return {
    ministryId: 'transport',
    fiscalYear: 2024,
    econLevel1: 'שכר',
    econLevel2: 'שכר בארץ',
    allocated: 100,
    revised: 100,
    executed: 90,
    lineCount: 3,
    sourceUrl: 'https://next.obudget.org/i/budget/0040/2024',
    ...overrides,
  };
}

function leaf(overrides: Partial<BudgetItem>): BudgetItem {
  return {
    id: `x-${Math.abs(JSON.stringify(overrides).length)}-${overrides.budgetCode ?? 'c'}`,
    ministryId: 'transport',
    fiscalYear: 2024,
    budgetCode: '00405001',
    parentBudgetCode: '004050',
    title: 'תוכנית',
    hierarchyPath: [],
    hierarchyLevel: 3,
    isLeaf: true,
    originalBudget: 100,
    updatedBudget: 120,
    actualExecution: null,
    estimatedExecution: null,
    executionRate: null,
    currency: 'ILS',
    unit: 'ILS',
    dataStatus: 'partial',
    sourceUrl: 'https://next.obudget.org/i/budget/00405001/2024',
    sourceTitle: 'מקור',
    sourcePublishedAt: null,
    collectedAt: '2026-08-12',
    rawReference: 'ref',
    notes: '',
    ...overrides,
  };
}

const THEMES: BudgetTheme[] = [
  { id: 'a', labelHe: 'א', description: 'ד', color: '#111111', assignedLineCount: 0 },
  { id: 'b', labelHe: 'ב', description: 'ד', color: '#222222', assignedLineCount: 0 },
];

function assignment(code: string, themeId: string): ThemeAssignment {
  return {
    ministryId: 'transport',
    budgetCode: code,
    title: 'תוכנית',
    themeId,
    confidence: 'high',
    reasoning: 'נימוק לצורך בדיקה בלבד.',
  };
}

describe('econColor', () => {
  it('keeps a fixed color per official category and a fallback for unknowns', () => {
    expect(econColor('שכר')).toBe(econColor('שכר'));
    expect(econColor('קטגוריה חדשה')).toBe(econColor('קטגוריה אחרת'));
  });
});

describe('usageSeries', () => {
  it('builds one stacked series per category, ordered by total size', () => {
    const rows = [
      usageRow({ econLevel1: 'שכר', revised: 100 }),
      usageRow({ econLevel1: 'קניות', econLevel2: 'קניות בארץ', revised: 300 }),
    ];
    const { series, points } = usageSeries(rows, 'transport', [2024]);
    expect(series.map((s) => s.key)).toEqual(['קניות', 'שכר']);
    expect(points[0]?.values['שכר']).toBe(100);
  });

  it('yields null (a gap), not zero, for a year with no data', () => {
    const { points } = usageSeries([usageRow({})], 'transport', [2024, 2025]);
    expect(points[1]?.values['שכר']).toBeNull();
  });
});

describe('usageDetailForYear', () => {
  it('computes shares only over positive revised sums', () => {
    const rows = [
      usageRow({ econLevel1: 'שכר', revised: 75 }),
      usageRow({ econLevel1: 'קניות', econLevel2: 'קניות בארץ', revised: 25 }),
      usageRow({ econLevel1: 'הכנסות מיועדות', econLevel2: 'הכנסות', revised: -40 }),
    ];
    const detail = usageDetailForYear(rows, 'transport', 2024);
    expect(detail.find((d) => d.econLevel1 === 'שכר')?.shareOfRevised).toBe(75);
    expect(detail.find((d) => d.econLevel1 === 'הכנסות מיועדות')?.shareOfRevised).toBeNull();
  });
});

describe('hundredShekelBreakdown', () => {
  it('splits 100 shekels across positive categories', () => {
    const rows = [
      usageRow({ econLevel1: 'שכר', revised: 60 }),
      usageRow({ econLevel1: 'קניות', econLevel2: 'ק', revised: 40 }),
      usageRow({ econLevel1: 'חשבונות מעבר', econLevel2: 'ח', revised: 0 }),
    ];
    const slices = hundredShekelBreakdown(rows, 'transport', 2024);
    expect(slices.map((s) => s.perHundred)).toEqual([60, 40]);
    expect(slices.reduce((a, s) => a + s.perHundred, 0)).toBeCloseTo(100, 1);
  });

  it('returns empty for a year with no positive amounts', () => {
    expect(hundredShekelBreakdown([usageRow({ revised: 0 })], 'transport', 2024)).toEqual([]);
  });
});

describe('themeAggregates', () => {
  it('aggregates leaves only, per theme, with shares of the positive total', () => {
    const items = [
      leaf({ budgetCode: '00405001', updatedBudget: 300 }),
      leaf({ budgetCode: '00405101', updatedBudget: 100 }),
      // A parent line must not be counted even if assigned.
      leaf({ budgetCode: '004050', isLeaf: false, hierarchyLevel: 2, updatedBudget: 999 }),
    ];
    const assignments = [
      assignment('00405001', 'a'),
      assignment('00405101', 'b'),
      assignment('004050', 'a'),
    ];
    const result = themeAggregates(items, assignments, THEMES, 'transport', 2024);
    expect(result.find((r) => r.theme.id === 'a')?.updatedBudget).toBe(300);
    expect(result.find((r) => r.theme.id === 'a')?.shareOfRevised).toBe(75);
    expect(result.find((r) => r.theme.id === 'b')?.shareOfRevised).toBe(25);
  });

  it('drops themes with no members instead of showing empty rows', () => {
    const result = themeAggregates(
      [leaf({ budgetCode: '00405001' })],
      [assignment('00405001', 'a')],
      THEMES,
      'transport',
      2024,
    );
    expect(result.map((r) => r.theme.id)).toEqual(['a']);
  });
});

describe('topBudgetShifts', () => {
  it('orders by absolute delta and computes percent only for nonzero originals', () => {
    const items = [
      leaf({ budgetCode: '00405001', originalBudget: 100, updatedBudget: 400 }),
      leaf({ budgetCode: '00405101', originalBudget: 1000, updatedBudget: 900 }),
      leaf({ budgetCode: '00405201', originalBudget: 0, updatedBudget: 50 }),
    ];
    const shifts = topBudgetShifts(items, [], 'transport', 2024, 10);
    expect(shifts[0]?.item.budgetCode).toBe('00405001');
    expect(shifts[0]?.deltaPercent).toBe(300);
    expect(shifts.find((s) => s.item.budgetCode === '00405201')?.deltaPercent).toBeNull();
  });

  it('skips lines missing either figure — no invented deltas', () => {
    const shifts = topBudgetShifts(
      [leaf({ originalBudget: null, updatedBudget: 500 })],
      [],
      'transport',
      2024,
      10,
    );
    expect(shifts).toHaveLength(0);
  });
});

describe('volatilityIndex', () => {
  it('implements Σ|revised−original| ÷ Σoriginal × 100 over leaves', () => {
    const items = [
      leaf({ budgetCode: 'a1', originalBudget: 100, updatedBudget: 150 }),
      leaf({ budgetCode: 'a2', originalBudget: 100, updatedBudget: 60 }),
    ];
    const index = volatilityIndex(items, 'transport', 2024);
    // (50 + 40) / 200 = 45%
    expect(index.indexPercent).toBe(45);
    expect(index.leafCount).toBe(2);
  });

  it('returns null rather than dividing by a zero base', () => {
    const index = volatilityIndex(
      [leaf({ originalBudget: 0, updatedBudget: 10 })],
      'transport',
      2024,
    );
    expect(index.indexPercent).toBeNull();
  });
});
