/**
 * collect-usage-breakdown — builds data/processed/usage-breakdown.json.
 *
 * "Usage type" here is the Ministry of Finance's own economic classification
 * (סיווג כלכלי): wages, procurement, transfers, earmarked income and so on. At
 * hierarchy depth 4 (individual תקנות) every line carries exactly one such
 * classification, so aggregating depth-4 lines by classification yields an
 * official answer to "what is the money used for" — no model is involved in
 * this file at all.
 *
 * Honesty rules:
 *   - Aggregates are computed only from rows actually returned by the source.
 *   - Coverage is reported per ministry-year: the sum of classified depth-4
 *     lines divided by the ministry's section total. For a current year the
 *     two can legitimately differ (allocations not yet distributed to תקנות),
 *     and the UI must show that gap, not hide it.
 *   - Figures inherit the same caveat as the rest of the budget data: the
 *     source is a secondary helper layer mirroring Finance Ministry data, so
 *     nothing here is labelled final.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson, writeText } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch } from './lib/http.js';
import { toCsv } from './lib/csv.js';

const ANALYSIS_YEARS = [2023, 2024, 2025, 2026] as const;
const COLLECTED_AT = new Date().toISOString().slice(0, 10);

interface MinistrySeed {
  id: string;
  officialName: string;
  budgetCodes: string[];
}
interface MinistriesSeedFile {
  ministries: MinistrySeed[];
}

interface AggregateRow {
  year?: unknown;
  econ_cls_title_1?: unknown;
  econ_cls_title_2?: unknown;
  alloc?: unknown;
  rev?: unknown;
  exec?: unknown;
  n?: unknown;
}

export interface UsageRow {
  ministryId: string;
  fiscalYear: number;
  econLevel1: string;
  econLevel2: string;
  allocated: number | null;
  revised: number | null;
  executed: number | null;
  lineCount: number;
  sourceUrl: string;
}

export interface UsageCoverage {
  ministryId: string;
  fiscalYear: number;
  classifiedRevisedSum: number;
  sectionRevisedTotal: number | null;
  coveragePercent: number | null;
}

/**
 * The source returns classification titles as single-element arrays at depth 4.
 * Anything that is not a clean single label is rejected rather than guessed.
 */
function readLabel(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim().replace(/\s+/g, ' ');
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0].trim().replace(/\s+/g, ' ');
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function queryUrl(sectionCode: string): string {
  const sql =
    `select year, econ_cls_title_1, econ_cls_title_2, ` +
    `sum(net_allocated) as alloc, sum(net_revised) as rev, sum(net_executed) as exec, count(1) as n ` +
    `from raw_budget where code like '${sectionCode}%' and depth = 4 ` +
    `and year >= ${ANALYSIS_YEARS[0]} and year <= ${ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]} ` +
    `and is_proposal = false and budget_kind_code = '1' ` +
    `group by year, econ_cls_title_1, econ_cls_title_2 order by year limit 400`;
  return `https://next.obudget.org/api/query?query=${encodeURIComponent(sql)}`;
}

async function main(): Promise<void> {
  const logger = new Logger('collect-usage-breakdown');
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));
  const budgetItems = readJson<
    Array<{
      ministryId: string;
      fiscalYear: number;
      hierarchyLevel: number;
      updatedBudget: number | null;
    }>
  >(path.join(PROCESSED_DIR, 'budget-items.json'));

  const rows: UsageRow[] = [];
  const rejected: Array<{ ministryId: string; reason: string }> = [];

  for (const ministry of seed.ministries) {
    for (const sectionCode of ministry.budgetCodes) {
      const url = queryUrl(sectionCode);
      const result = await politeFetch(url, {
        purpose: `official economic classification for ${ministry.id}`,
        logger,
      });
      if (!result.ok || !result.body) {
        rejected.push({
          ministryId: ministry.id,
          reason: `האגרגציה לפי סיווג כלכלי אינה נגישה (${result.outcome}).`,
        });
        continue;
      }
      let parsed: { rows?: AggregateRow[]; success?: boolean };
      try {
        parsed = JSON.parse(result.body) as { rows?: AggregateRow[]; success?: boolean };
        if (parsed.success === false) throw new Error('the API reported success: false');
      } catch (err) {
        rejected.push({ ministryId: ministry.id, reason: `תשובת ה-API לא נותחה: ${String(err)}` });
        continue;
      }

      for (const raw of parsed.rows ?? []) {
        const year = readNumber(raw.year);
        const level1 = readLabel(raw.econ_cls_title_1);
        const level2 = readLabel(raw.econ_cls_title_2);
        const lineCount = readNumber(raw.n);
        if (year === null || level1 === null || level2 === null || lineCount === null) {
          rejected.push({
            ministryId: ministry.id,
            reason: `שורת אגרגציה נדחתה: סיווג לא חד-משמעי (${JSON.stringify(raw).slice(0, 120)})`,
          });
          continue;
        }
        if (!ANALYSIS_YEARS.includes(year as (typeof ANALYSIS_YEARS)[number])) continue;
        rows.push({
          ministryId: ministry.id,
          fiscalYear: year,
          econLevel1: level1,
          econLevel2: level2,
          allocated: readNumber(raw.alloc),
          revised: readNumber(raw.rev),
          executed: readNumber(raw.exec),
          lineCount,
          sourceUrl: `https://next.obudget.org/i/budget/${sectionCode}/${year}`,
        });
      }
    }
  }

  rows.sort(
    (a, b) =>
      a.ministryId.localeCompare(b.ministryId) ||
      a.fiscalYear - b.fiscalYear ||
      a.econLevel1.localeCompare(b.econLevel1, 'he') ||
      a.econLevel2.localeCompare(b.econLevel2, 'he'),
  );

  // Coverage: classified depth-4 sum vs the ministry's section total (level 1)
  // from the already-collected budget items.
  const coverage: UsageCoverage[] = [];
  for (const ministry of seed.ministries) {
    for (const year of ANALYSIS_YEARS) {
      const classified = rows
        .filter((r) => r.ministryId === ministry.id && r.fiscalYear === year)
        .reduce((sum, r) => sum + (r.revised ?? 0), 0);
      const section = budgetItems.find(
        (b) => b.ministryId === ministry.id && b.fiscalYear === year && b.hierarchyLevel === 1,
      );
      const total = section?.updatedBudget ?? null;
      coverage.push({
        ministryId: ministry.id,
        fiscalYear: year,
        classifiedRevisedSum: classified,
        sectionRevisedTotal: total,
        coveragePercent:
          total !== null && total > 0 ? Math.round((classified / total) * 1000) / 10 : null,
      });
    }
  }

  const output = {
    generatedAt: COLLECTED_AT,
    method:
      'אגרגציה של תקנות (רמה 4) לפי הסיווג הכלכלי הרשמי של אגף התקציבים (econ_cls), כפי שהוא משתקף במפתח התקציב. אין כאן סיווג של מודל שפה: הקטגוריות הן של משרד האוצר. המקור הוא שכבת עזר, ולכן הנתונים אינם מסומנים כסופיים.',
    rows,
    coverage,
    rejected,
  };

  writeJson(path.join(PROCESSED_DIR, 'usage-breakdown.json'), output);
  writeText(
    path.join(PROCESSED_DIR, 'csv', 'usage-breakdown.csv'),
    toCsv(
      [
        'משרד',
        'שנה',
        'סיווג ראשי',
        'סיווג משני',
        'תקציב מקורי',
        'תקציב מעודכן',
        'ביצוע/אומדן',
        'מספר תקנות',
        'מקור',
      ],
      rows.map((r) => [
        r.ministryId,
        r.fiscalYear,
        r.econLevel1,
        r.econLevel2,
        r.allocated,
        r.revised,
        r.executed,
        r.lineCount,
        r.sourceUrl,
      ]),
    ),
  );

  logger.flush(
    'אגרגציית הסיווג הכלכלי בוצעה בצד המקור (group by), כדי לא למשוך אלפי שורות תקנות בודדות.',
  );
  console.log(
    `collect-usage-breakdown: ${rows.length} שורות סיווג · ${rejected.length} נדחו · ${coverage.filter((c) => c.coveragePercent !== null).length} שורות כיסוי`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
