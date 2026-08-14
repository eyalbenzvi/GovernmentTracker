/**
 * Dataset loading, in two tiers.
 *
 * The published site is fully static: every dataset is a JSON file produced by
 * the build-time pipeline in scripts/ and shipped as its own lazily-loaded
 * chunk. There is no API, no server and no runtime request to any external host.
 *
 * Tier 1 — `getSummary()` loads data/processed/site-summary.json, tens of
 * kilobytes holding the figures the home screen and the layout need. It is the only
 * thing a reader waits for when they open the site.
 *
 * Tier 2 — `getDataset()` loads the full corpus, ~12MB across 18 files. It is
 * fetched only when a screen that needs the underlying rows is opened, and never on
 * first paint. Before this split, opening the home page parsed all of it.
 */
import type { Dataset, DiaryEntry } from '../types/domain';
import type { SiteSummary } from '../types/summary';

let cachedSummary: Promise<SiteSummary> | null = null;
let cachedDataset: Promise<Dataset> | null = null;

async function loadSummary(): Promise<SiteSummary> {
  const module = await import('../../data/processed/site-summary.json');
  return module.default as unknown as SiteSummary;
}

/** Memoised; the summary is small enough to keep for the session. */
export function getSummary(): Promise<SiteSummary> {
  cachedSummary ??= loadSummary();
  return cachedSummary;
}

async function loadAll(): Promise<Dataset> {
  const [
    ministries,
    ministerTenures,
    budgetItems,
    activities,
    topics,
    sources,
    coverage,
    links,
    methodology,
    dataVersion,
    usageBreakdown,
    budgetThemes,
    findings,
    anomalies,
    diariesIndex,
    diaryCategories,
    diaryInsights,
    diaryNameInferences,
  ] = await Promise.all([
    import('../../data/processed/ministries.json'),
    import('../../data/processed/minister-tenures.json'),
    import('../../data/processed/budget-items.json'),
    import('../../data/processed/activity-evidence.json'),
    import('../../data/processed/topics.json'),
    import('../../data/processed/source-catalog.json'),
    import('../../data/processed/coverage.json'),
    import('../../data/processed/activity-budget-links.json'),
    import('../../data/processed/methodology.json'),
    import('../../data/processed/data-version.json'),
    import('../../data/processed/usage-breakdown.json'),
    import('../../data/processed/budget-themes.json'),
    import('../../data/processed/findings.json'),
    import('../../data/processed/anomalies.json'),
    import('../../data/processed/diaries-index.json'),
    import('../../data/processed/diary-categories.json'),
    import('../../data/processed/diary-insights.json'),
    import('../../data/processed/diary-name-inferences.json'),
  ]);

  return {
    ministries: ministries.default as Dataset['ministries'],
    ministerTenures: ministerTenures.default as Dataset['ministerTenures'],
    budgetItems: budgetItems.default as Dataset['budgetItems'],
    activities: activities.default as Dataset['activities'],
    topics: topics.default as Dataset['topics'],
    sources: sources.default as Dataset['sources'],
    coverage: coverage.default as Dataset['coverage'],
    links: links.default as Dataset['links'],
    methodology: methodology.default as Dataset['methodology'],
    dataVersion: dataVersion.default as Dataset['dataVersion'],
    usageBreakdown: usageBreakdown.default as unknown as Dataset['usageBreakdown'],
    budgetThemes: budgetThemes.default as unknown as Dataset['budgetThemes'],
    findings: findings.default as unknown as Dataset['findings'],
    anomalies: anomalies.default as unknown as Dataset['anomalies'],
    diariesIndex: diariesIndex.default as unknown as Dataset['diariesIndex'],
    diaryCategories: diaryCategories.default as unknown as Dataset['diaryCategories'],
    diaryInsights: diaryInsights.default as unknown as Dataset['diaryInsights'],
    diaryNameInferences: diaryNameInferences.default as unknown as Dataset['diaryNameInferences'],
  };
}

/**
 * Diary rows are sharded per budget section (~223k rows in total), so a shard is
 * fetched only when a reader opens that section. import.meta.glob keeps the
 * mapping static, which is what lets Vite emit one cacheable chunk per shard
 * instead of bundling them all into the initial payload.
 */
const diaryShardLoaders = import.meta.glob<{ default: DiaryEntry[] }>(
  '../../data/processed/diaries/*.json',
);

const shardCache = new Map<string, Promise<DiaryEntry[]>>();

export function loadDiaryShard(shardKey: string): Promise<DiaryEntry[]> {
  const cached = shardCache.get(shardKey);
  if (cached !== undefined) return cached;
  const loaderKey = Object.keys(diaryShardLoaders).find((k) => k.endsWith(`/${shardKey}.json`));
  const loader = loaderKey === undefined ? undefined : diaryShardLoaders[loaderKey];
  const promise =
    loader === undefined ? Promise.resolve<DiaryEntry[]>([]) : loader().then((m) => m.default);
  shardCache.set(shardKey, promise);
  return promise;
}

/** Memoised so navigating between screens never re-parses the datasets. */
export function getDataset(): Promise<Dataset> {
  cachedDataset ??= loadAll();
  return cachedDataset;
}
