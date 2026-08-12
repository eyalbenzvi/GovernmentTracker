/**
 * Pure derivation logic for the analysis screen.
 *
 * Everything here is deterministic arithmetic over data that was collected and
 * classified at build time. Nothing calls a model, and every function returns
 * enough provenance for the UI to show where each figure came from.
 */
import type { BudgetItem, BudgetTheme, ThemeAssignment, UsageRow } from '../types/domain';
import type { SeriesDefinition, SeriesPoint } from '../components/charts';

/**
 * Fixed colors for the Finance Ministry's economic-classification categories,
 * so a category keeps its color across ministries and years. Unknown labels get
 * a neutral fallback rather than a random hue.
 */
const ECON_COLORS: ReadonlyArray<[string, string]> = [
  ['שכר', '#1b5e8a'],
  ['קניות', '#2f7d54'],
  ['העברות', '#7a5c9e'],
  ['העברות פנים תקציביות', '#8a6a1b'],
  ['הכנסות מיועדות', '#9e6a7a'],
  ['חשבונות מעבר', '#8a8a8a'],
];
const ECON_FALLBACK_COLOR = '#5b6d7a';

export function econColor(label: string): string {
  return ECON_COLORS.find(([name]) => name === label)?.[1] ?? ECON_FALLBACK_COLOR;
}

function scopeRows(rows: readonly UsageRow[], ministryId: string): UsageRow[] {
  return rows.filter((r) => ministryId === 'all' || r.ministryId === ministryId);
}

/** Stacked series: one series per economic level-1 category, revised amounts by year. */
export function usageSeries(
  rows: readonly UsageRow[],
  ministryId: string,
  years: readonly number[],
): { points: SeriesPoint[]; series: SeriesDefinition[] } {
  const scoped = scopeRows(rows, ministryId);
  const totals = new Map<string, number>();
  for (const row of scoped) {
    totals.set(row.econLevel1, (totals.get(row.econLevel1) ?? 0) + (row.revised ?? 0));
  }
  const categories = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);

  const points: SeriesPoint[] = years.map((year) => {
    const values: Record<string, number | null> = {};
    for (const category of categories) {
      const sum = scoped
        .filter((r) => r.fiscalYear === year && r.econLevel1 === category)
        .reduce((acc, r) => acc + (r.revised ?? 0), 0);
      const hasData = scoped.some((r) => r.fiscalYear === year && r.econLevel1 === category);
      values[category] = hasData ? sum : null;
    }
    return { label: String(year), values };
  });

  return {
    points,
    series: categories.map((label) => ({ key: label, label, color: econColor(label) })),
  };
}

export interface UsageDetailRow {
  econLevel1: string;
  econLevel2: string;
  allocated: number | null;
  revised: number | null;
  executed: number | null;
  lineCount: number;
  /** Share of the positive revised total, null for non-positive rows. */
  shareOfRevised: number | null;
  sourceUrl: string;
}

/** Level-2 detail for one year, with each row's share of the positive revised total. */
export function usageDetailForYear(
  rows: readonly UsageRow[],
  ministryId: string,
  year: number,
): UsageDetailRow[] {
  const scoped = scopeRows(rows, ministryId).filter((r) => r.fiscalYear === year);

  const merged = new Map<string, UsageDetailRow>();
  for (const row of scoped) {
    const key = `${row.econLevel1}|${row.econLevel2}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        econLevel1: row.econLevel1,
        econLevel2: row.econLevel2,
        allocated: row.allocated,
        revised: row.revised,
        executed: row.executed,
        lineCount: row.lineCount,
        shareOfRevised: null,
        sourceUrl: row.sourceUrl,
      });
    } else {
      existing.allocated = addNullable(existing.allocated, row.allocated);
      existing.revised = addNullable(existing.revised, row.revised);
      existing.executed = addNullable(existing.executed, row.executed);
      existing.lineCount += row.lineCount;
    }
  }

  const list = [...merged.values()];
  const positiveTotal = list.reduce(
    (acc, r) => acc + (r.revised !== null && r.revised > 0 ? r.revised : 0),
    0,
  );
  for (const row of list) {
    row.shareOfRevised =
      positiveTotal > 0 && row.revised !== null && row.revised > 0
        ? Math.round((row.revised / positiveTotal) * 1000) / 10
        : null;
  }
  return list.sort((a, b) => (b.revised ?? 0) - (a.revised ?? 0));
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export interface HundredShekelSlice {
  label: string;
  /** Whole agorot out of 100 ₪, e.g. 41.7. */
  perHundred: number;
  color: string;
}

/**
 * "מכל 100 ₪": the revised budget decomposed by economic category. Computed on
 * positive components only — earmarked-income and pass-through rows with zero or
 * negative sums are excluded, and the UI states that rule.
 */
export function hundredShekelBreakdown(
  rows: readonly UsageRow[],
  ministryId: string,
  year: number,
): HundredShekelSlice[] {
  const scoped = scopeRows(rows, ministryId).filter((r) => r.fiscalYear === year);
  const byCategory = new Map<string, number>();
  for (const row of scoped) {
    if (row.revised !== null && row.revised > 0) {
      byCategory.set(row.econLevel1, (byCategory.get(row.econLevel1) ?? 0) + row.revised);
    }
  }
  const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, sum]) => ({
      label,
      perHundred: Math.round((sum / total) * 1000) / 10,
      color: econColor(label),
    }));
}

export interface ThemeAggregate {
  theme: BudgetTheme;
  originalBudget: number | null;
  updatedBudget: number | null;
  execution: number | null;
  shareOfRevised: number | null;
  members: Array<{
    item: BudgetItem;
    assignment: ThemeAssignment;
  }>;
}

/**
 * Aggregates leaf budget lines by their build-time theme. Leaves only, so a
 * parent and its children are never both counted; the theme comes from the
 * audited assignment file and each member carries its reasoning.
 */
export function themeAggregates(
  items: readonly BudgetItem[],
  assignments: readonly ThemeAssignment[],
  themes: readonly BudgetTheme[],
  ministryId: string,
  year: number,
): ThemeAggregate[] {
  const assignmentByKey = new Map(
    assignments.map((a) => [`${a.ministryId}:${a.budgetCode}`, a] as const),
  );
  const leaves = items.filter(
    (i) =>
      i.isLeaf && i.fiscalYear === year && (ministryId === 'all' || i.ministryId === ministryId),
  );

  const buckets = new Map<string, ThemeAggregate>();
  for (const theme of themes) {
    buckets.set(theme.id, {
      theme,
      originalBudget: null,
      updatedBudget: null,
      execution: null,
      shareOfRevised: null,
      members: [],
    });
  }

  for (const item of leaves) {
    const assignment = assignmentByKey.get(`${item.ministryId}:${item.budgetCode}`);
    if (assignment === undefined) continue; // validation guarantees this never happens
    const bucket = buckets.get(assignment.themeId);
    if (bucket === undefined) continue;
    bucket.originalBudget = addNullable(bucket.originalBudget, item.originalBudget);
    bucket.updatedBudget = addNullable(bucket.updatedBudget, item.updatedBudget);
    bucket.execution = addNullable(
      bucket.execution,
      item.actualExecution ?? item.estimatedExecution,
    );
    bucket.members.push({ item, assignment });
  }

  const list = [...buckets.values()].filter((b) => b.members.length > 0);
  const positiveTotal = list.reduce(
    (acc, b) => acc + (b.updatedBudget !== null && b.updatedBudget > 0 ? b.updatedBudget : 0),
    0,
  );
  for (const bucket of list) {
    bucket.shareOfRevised =
      positiveTotal > 0 && bucket.updatedBudget !== null && bucket.updatedBudget > 0
        ? Math.round((bucket.updatedBudget / positiveTotal) * 1000) / 10
        : null;
    bucket.members.sort((a, b) => (b.item.updatedBudget ?? 0) - (a.item.updatedBudget ?? 0));
  }
  return list.sort((a, b) => (b.updatedBudget ?? 0) - (a.updatedBudget ?? 0));
}

export interface BudgetShift {
  item: BudgetItem;
  assignment: ThemeAssignment | null;
  deltaAbsolute: number;
  deltaPercent: number | null;
}

/**
 * The largest original→revised shifts among leaf lines, by absolute size.
 * Purely a sort — the threshold is the reader's own judgement, so the list
 * states its rule ("N הגדולות בערך מוחלט") instead of hiding a cutoff.
 */
export function topBudgetShifts(
  items: readonly BudgetItem[],
  assignments: readonly ThemeAssignment[],
  ministryId: string,
  year: number,
  limit: number,
): BudgetShift[] {
  const assignmentByKey = new Map(
    assignments.map((a) => [`${a.ministryId}:${a.budgetCode}`, a] as const),
  );
  const shifts: BudgetShift[] = [];
  for (const item of items) {
    if (!item.isLeaf || item.fiscalYear !== year) continue;
    if (ministryId !== 'all' && item.ministryId !== ministryId) continue;
    if (item.originalBudget === null || item.updatedBudget === null) continue;
    const delta = item.updatedBudget - item.originalBudget;
    if (delta === 0) continue;
    shifts.push({
      item,
      assignment: assignmentByKey.get(`${item.ministryId}:${item.budgetCode}`) ?? null,
      deltaAbsolute: delta,
      deltaPercent:
        item.originalBudget !== 0 ? Math.round((delta / item.originalBudget) * 1000) / 10 : null,
    });
  }
  return shifts
    .sort((a, b) => Math.abs(b.deltaAbsolute) - Math.abs(a.deltaAbsolute))
    .slice(0, limit);
}

export interface VolatilityIndex {
  ministryId: string;
  sumAbsoluteDelta: number;
  sumOriginal: number;
  /** Σ|מעודכן − מקורי| ÷ Σמקורי × 100, leaves only. */
  indexPercent: number | null;
  leafCount: number;
}

/**
 * מדד אי-יציבות תקציבית: how much of the ministry's original budget was
 * rewritten during the year, regardless of direction. A deterministic formula,
 * stated wherever it is displayed.
 */
export function volatilityIndex(
  items: readonly BudgetItem[],
  ministryId: string,
  year: number,
): VolatilityIndex {
  const leaves = items.filter(
    (i) =>
      i.isLeaf &&
      i.fiscalYear === year &&
      i.ministryId === ministryId &&
      i.originalBudget !== null &&
      i.updatedBudget !== null,
  );
  const sumAbsoluteDelta = leaves.reduce(
    (acc, i) => acc + Math.abs((i.updatedBudget as number) - (i.originalBudget as number)),
    0,
  );
  const sumOriginal = leaves.reduce((acc, i) => acc + Math.abs(i.originalBudget as number), 0);
  return {
    ministryId,
    sumAbsoluteDelta,
    sumOriginal,
    indexPercent: sumOriginal > 0 ? Math.round((sumAbsoluteDelta / sumOriginal) * 1000) / 10 : null,
    leafCount: leaves.length,
  };
}
