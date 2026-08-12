/**
 * Turns budget records into chart-ready series, without double counting.
 *
 * Aggregation always goes through sumWithoutDoubleCounting, so a parent line and
 * its children are never added together. A year with no usable record yields null
 * for that measure — which the chart renders as a gap, not as zero.
 */
import type { BudgetItem, DataStatus } from '../types/domain';
import { sumWithoutDoubleCounting } from './calc';
import type { SeriesPoint } from '../components/charts';

export interface YearAggregate {
  fiscalYear: number;
  originalBudget: number | null;
  updatedBudget: number | null;
  execution: number | null;
  executionIsEstimate: boolean;
  /**
   * The status of the aggregated execution figure, taken as the most cautious
   * status among the records that contributed to it. An aggregate must never
   * claim more certainty than its weakest input: one estimate makes the whole
   * sum an estimate, and anything short of every record being final keeps it
   * partial.
   */
  executionStatus: DataStatus;
  recordCount: number;
}

function weakestStatus(items: readonly BudgetItem[]): DataStatus {
  if (items.length === 0) return 'unavailable';
  if (items.some((i) => i.dataStatus === 'estimate')) return 'estimate';
  if (items.every((i) => i.dataStatus === 'final')) return 'final';
  return 'partial';
}

export function aggregateByYear(
  items: readonly BudgetItem[],
  years: readonly number[],
): YearAggregate[] {
  return years.map((year) => {
    const forYear = items.filter((item) => item.fiscalYear === year);
    const original = sumWithoutDoubleCounting(forYear, (i) => i.originalBudget);
    const updated = sumWithoutDoubleCounting(forYear, (i) => i.updatedBudget);
    const actual = sumWithoutDoubleCounting(forYear, (i) => i.actualExecution);
    const estimate = sumWithoutDoubleCounting(forYear, (i) => i.estimatedExecution);

    // Prefer actual execution; fall back to the estimate and flag it as such.
    const useEstimate = actual.total === null && estimate.total !== null;

    const execution = useEstimate ? estimate.total : actual.total;

    return {
      fiscalYear: year,
      originalBudget: original.total,
      updatedBudget: updated.total,
      execution,
      executionIsEstimate: useEstimate,
      executionStatus: execution === null ? 'unavailable' : weakestStatus(forYear),
      recordCount: forYear.length,
    };
  });
}

export function toSeriesPoints(aggregates: readonly YearAggregate[]): SeriesPoint[] {
  return aggregates.map((aggregate) => ({
    label: String(aggregate.fiscalYear),
    values: {
      originalBudget: aggregate.originalBudget,
      updatedBudget: aggregate.updatedBudget,
      execution: aggregate.execution,
    },
  }));
}
