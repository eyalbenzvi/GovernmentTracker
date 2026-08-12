/**
 * Turns budget records into chart-ready series, without double counting.
 *
 * Aggregation always goes through sumWithoutDoubleCounting, so a parent line and
 * its children are never added together. A year with no usable record yields null
 * for that measure — which the chart renders as a gap, not as zero.
 */
import type { BudgetItem } from '../types/domain';
import { sumWithoutDoubleCounting } from './calc';
import type { SeriesPoint } from '../components/charts';

export interface YearAggregate {
  fiscalYear: number;
  originalBudget: number | null;
  updatedBudget: number | null;
  execution: number | null;
  executionIsEstimate: boolean;
  recordCount: number;
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

    return {
      fiscalYear: year,
      originalBudget: original.total,
      updatedBudget: updated.total,
      execution: useEstimate ? estimate.total : actual.total,
      executionIsEstimate: useEstimate,
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
