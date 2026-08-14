/**
 * Emits data/processed/site-summary.json — the small file the first screen loads.
 *
 * This script does IO only. Every figure it writes is computed by pure functions in
 * src/lib, which are unit-tested, so the summary cannot drift from what the deep
 * screens show: both read the same code.
 *
 * Run after the datasets are built:  npm run data:summary
 */
import path from 'node:path';
import type {
  ActivityEvidence,
  Anomalies,
  BudgetItem,
  Coverage,
  DataVersion,
  DiariesIndex,
  DiaryCategories,
  DiaryInsights,
  Findings,
  Methodology,
  Ministry,
  UsageBreakdown,
} from '../src/types/domain';
import { buildSiteSummary } from '../src/lib/summaryBuild';
import { PROCESSED_DIR, readJson, writeJson } from './lib/paths';
import { siteSummarySchema } from './lib/schema';

function load<T>(file: string): T {
  return readJson<T>(path.join(PROCESSED_DIR, file));
}

function main(): void {
  const summary = buildSiteSummary({
    ministries: load<Ministry[]>('ministries.json'),
    budgetItems: load<BudgetItem[]>('budget-items.json'),
    activities: load<ActivityEvidence[]>('activity-evidence.json'),
    coverage: load<Coverage[]>('coverage.json'),
    usageBreakdown: load<UsageBreakdown>('usage-breakdown.json'),
    findings: load<Findings>('findings.json'),
    anomalies: load<Anomalies>('anomalies.json'),
    diaryInsights: load<DiaryInsights>('diary-insights.json'),
    diaryCategories: load<DiaryCategories>('diary-categories.json'),
    diariesIndex: load<DiariesIndex>('diaries-index.json'),
    dataVersion: load<DataVersion>('data-version.json'),
    methodology: load<Methodology>('methodology.json'),
    // Taken from the dataset build rather than the clock, so re-running this
    // script on unchanged inputs produces a byte-identical file.
    generatedAt: load<DataVersion>('data-version.json').builtAt,
  });

  const parsed = siteSummarySchema.safeParse(summary);
  if (!parsed.success) {
    console.error('site-summary.json failed validation:');
    console.error(JSON.stringify(parsed.error.issues.slice(0, 12), null, 2));
    process.exit(1);
  }

  const file = path.join(PROCESSED_DIR, 'site-summary.json');
  writeJson(file, summary);

  const sizeKb = Math.round(JSON.stringify(summary).length / 1024);
  console.log(`site-summary.json written — ${sizeKb}KB`);
  console.log(`  ${summary.ministries.length} sections, ${summary.insights.length} insights`);
  for (const insight of summary.insights) {
    console.log(
      `  · [${insight.strength}] ${insight.headline} — ${insight.sentenceHe.slice(0, 90)}…`,
    );
  }
}

main();
