/**
 * All derived figures the site displays.
 *
 * Every function here is deterministic and returns null rather than a fallback
 * when the inputs do not support a calculation. Nothing is estimated, smoothed
 * or filled in.
 */
import type { BudgetItem } from '../types/domain';

/** שינוי תקציב בש"ח = תקציב מעודכן − תקציב מקורי */
export function budgetChangeAbsolute(
  item: Pick<BudgetItem, 'originalBudget' | 'updatedBudget'>,
): number | null {
  const { originalBudget, updatedBudget } = item;
  if (originalBudget === null || updatedBudget === null) return null;
  if (!Number.isFinite(originalBudget) || !Number.isFinite(updatedBudget)) return null;
  return updatedBudget - originalBudget;
}

/**
 * שינוי תקציב באחוזים = (מעודכן − מקורי) ÷ מקורי × 100
 * Computed only when the original budget is non-zero, so the ratio is defined.
 */
export function budgetChangePercent(
  item: Pick<BudgetItem, 'originalBudget' | 'updatedBudget'>,
): number | null {
  const { originalBudget, updatedBudget } = item;
  if (originalBudget === null || updatedBudget === null) return null;
  if (!Number.isFinite(originalBudget) || !Number.isFinite(updatedBudget)) return null;
  if (originalBudget === 0) return null;
  return Math.round(((updatedBudget - originalBudget) / originalBudget) * 1000) / 10;
}

/**
 * שיעור ביצוע = ביצוע ÷ תקציב מעודכן × 100
 * Uses actual execution when present, otherwise the estimate — and the caller is
 * expected to surface which one it was, via executionBasis below.
 */
export function executionRate(
  item: Pick<BudgetItem, 'actualExecution' | 'estimatedExecution' | 'updatedBudget'>,
): number | null {
  const execution = item.actualExecution ?? item.estimatedExecution;
  const { updatedBudget } = item;
  if (execution === null || updatedBudget === null) return null;
  if (!Number.isFinite(execution) || !Number.isFinite(updatedBudget)) return null;
  if (updatedBudget <= 0) return null;
  return Math.round((execution / updatedBudget) * 1000) / 10;
}

export type ExecutionBasis = 'actual' | 'estimate' | 'none';

export function executionBasis(
  item: Pick<BudgetItem, 'actualExecution' | 'estimatedExecution'>,
): ExecutionBasis {
  if (item.actualExecution !== null) return 'actual';
  if (item.estimatedExecution !== null) return 'estimate';
  return 'none';
}

/**
 * Sums a measure across budget records **without double counting**.
 *
 * A parent budget line and its children describe the same money at different
 * levels of detail, so they must never be added together. This function sums a
 * single hierarchy level: leaf records when any exist, otherwise the shallowest
 * level present. It returns null when no record carries the measure, so an empty
 * dataset yields "no data" rather than a misleading 0.
 */
export function sumWithoutDoubleCounting(
  items: readonly BudgetItem[],
  measure: (item: BudgetItem) => number | null,
): { total: number | null; level: 'leaf' | number | null; countedRecords: number } {
  if (items.length === 0) return { total: null, level: null, countedRecords: 0 };

  const leaves = items.filter((i) => i.isLeaf);
  let scope: BudgetItem[];
  let level: 'leaf' | number;

  if (leaves.length > 0) {
    scope = leaves;
    level = 'leaf';
  } else {
    const shallowest = Math.min(...items.map((i) => i.hierarchyLevel));
    scope = items.filter((i) => i.hierarchyLevel === shallowest);
    level = shallowest;
  }

  const values = scope.map(measure).filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return { total: null, level, countedRecords: 0 };
  return {
    total: values.reduce((a, b) => a + b, 0),
    level,
    countedRecords: values.length,
  };
}

/**
 * Flags a large original→updated change using one fixed, stated rule, so the
 * threshold is never a matter of interpretation.
 *
 * Rule: |שינוי באחוזים| ≥ 20% AND |שינוי מוחלט| ≥ 50 מיליון ש"ח.
 * Both conditions must hold, so a large percentage swing on a tiny line and a
 * small percentage swing on a huge line are both excluded.
 */
export const LARGE_CHANGE_RULE_HE =
  'שינוי מסומן כגדול כאשר מתקיימים שני התנאים יחד: שינוי יחסי של 20% ומעלה בין התקציב המקורי לתקציב המעודכן, וגם שינוי מוחלט של 50 מיליון ש"ח ומעלה.';
export const LARGE_CHANGE_PERCENT_THRESHOLD = 20;
export const LARGE_CHANGE_ABSOLUTE_THRESHOLD = 50_000_000;

export function isLargeChange(item: Pick<BudgetItem, 'originalBudget' | 'updatedBudget'>): boolean {
  const pct = budgetChangePercent(item);
  const abs = budgetChangeAbsolute(item);
  if (pct === null || abs === null) return false;
  return (
    Math.abs(pct) >= LARGE_CHANGE_PERCENT_THRESHOLD &&
    Math.abs(abs) >= LARGE_CHANGE_ABSOLUTE_THRESHOLD
  );
}
