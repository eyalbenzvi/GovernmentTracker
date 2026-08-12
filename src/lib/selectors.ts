/**
 * Read-only selectors over the loaded dataset.
 *
 * Two rules are enforced here rather than in the components, so they cannot be
 * bypassed by a new screen:
 *
 *   - `dataBackedTopics` never returns a topic with zero activity items. A topic
 *     with no items is a declared taxonomy entry, not a finding, and must not
 *     appear in any chart, count or distribution.
 *   - search and filtering are pure functions over already-loaded data, so they
 *     work offline and require no index service.
 */
import type {
  ActivityEvidence,
  BudgetItem,
  Coverage,
  Dataset,
  Ministry,
  SourceCatalogItem,
  Topic,
} from '../types/domain';

/** Collapses whitespace and strips niqqud so Hebrew search matches reliably. */
export function normalizeSearchText(text: string): string {
  return text.replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function matchesQuery(
  haystackParts: readonly (string | null | undefined)[],
  query: string,
): boolean {
  const q = normalizeSearchText(query);
  if (q === '') return true;
  const haystack = normalizeSearchText(haystackParts.filter(Boolean).join(' '));
  // Every whitespace-separated term must appear, so multi-word queries narrow.
  return q.split(' ').every((term) => haystack.includes(term));
}

export function ministryById(dataset: Dataset, id: string | undefined): Ministry | undefined {
  if (id === undefined) return undefined;
  return dataset.ministries.find((m) => m.id === id);
}

export function coverageFor(dataset: Dataset, ministryId: string): Coverage | undefined {
  return dataset.coverage.find((c) => c.ministryId === ministryId);
}

export function budgetItemsFor(
  dataset: Dataset,
  ministryId: string,
  fiscalYear?: number,
): BudgetItem[] {
  return dataset.budgetItems.filter(
    (b) => b.ministryId === ministryId && (fiscalYear === undefined || b.fiscalYear === fiscalYear),
  );
}

export function activitiesFor(dataset: Dataset, ministryId: string): ActivityEvidence[] {
  return dataset.activities.filter((a) => a.ministryId === ministryId);
}

export function sourcesFor(dataset: Dataset, ministryId: string): SourceCatalogItem[] {
  return dataset.sources.filter((s) => s.ministryIds.includes(ministryId));
}

/** Sources not attributable to a single ministry — budget-wide documents. */
export function crossCuttingSources(dataset: Dataset): SourceCatalogItem[] {
  return dataset.sources.filter((s) => s.ministryIds.length === 0);
}

/**
 * Only topics that actually have at least one classified activity item.
 * See the module docstring: a zero-count topic is taxonomy, not data.
 */
export function dataBackedTopics(dataset: Dataset): Topic[] {
  return dataset.topics
    .filter((t) => t.activityItemCount > 0)
    .sort((a, b) => b.activityItemCount - a.activityItemCount);
}

export function budgetYearsAvailable(dataset: Dataset): number[] {
  return [...new Set(dataset.budgetItems.map((b) => b.fiscalYear))].sort((a, b) => a - b);
}

export interface ActivityFilters {
  ministryId: string;
  year: string;
  topicId: string;
  sourceType: string;
  query: string;
}

export function filterActivities(
  activities: readonly ActivityEvidence[],
  filters: ActivityFilters,
): ActivityEvidence[] {
  return activities.filter((activity) => {
    if (filters.ministryId !== 'all' && activity.ministryId !== filters.ministryId) return false;
    if (filters.year !== 'all') {
      if (activity.date === null) return false;
      if (!activity.date.startsWith(filters.year)) return false;
    }
    if (filters.topicId !== 'all' && !activity.topics.includes(filters.topicId)) return false;
    if (filters.sourceType !== 'all' && activity.sourceType !== filters.sourceType) return false;
    return matchesQuery(
      [
        activity.title,
        activity.summary,
        ...activity.topics,
        ...activity.people,
        ...activity.organizations,
      ],
      filters.query,
    );
  });
}

export interface SourceFilters {
  ministryId: string;
  year: string;
  sourceType: string;
  publisher: string;
  query: string;
}

export function filterSources(
  sources: readonly SourceCatalogItem[],
  filters: SourceFilters,
): SourceCatalogItem[] {
  return sources.filter((source) => {
    if (filters.ministryId !== 'all') {
      if (filters.ministryId === 'cross-cutting') {
        if (source.ministryIds.length > 0) return false;
      } else if (!source.ministryIds.includes(filters.ministryId)) {
        return false;
      }
    }
    if (filters.year !== 'all' && !source.fiscalYears.includes(Number(filters.year))) return false;
    if (filters.sourceType !== 'all' && source.sourceType !== filters.sourceType) return false;
    if (filters.publisher !== 'all' && source.publisher !== filters.publisher) return false;
    return matchesQuery(
      [source.title, source.publisher, source.sourceTypeLabelHe, source.url],
      filters.query,
    );
  });
}

export function uniqueSorted<T>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), 'he'));
}
