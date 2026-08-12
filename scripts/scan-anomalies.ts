/**
 * scan-anomalies — builds data/processed/anomalies.json.
 *
 * Fetches the individual regulations (תקנות, hierarchy depth 4) for every
 * collected ministry and runs the deterministic rule set from
 * scripts/lib/anomaly-rules.ts over them. Detection is pure arithmetic with
 * published thresholds; no model is involved. Every finding links to the
 * regulation's page at the source so a reader can inspect the raw line.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson, writeText } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch } from './lib/http.js';
import { toCsv } from './lib/csv.js';
import {
  ANOMALY_RULES,
  scanRegulations,
  type AnomalyFinding,
  type RegulationRow,
} from './lib/anomaly-rules.js';

const ANALYSIS_YEARS = [2023, 2024, 2025, 2026] as const;
const COLLECTED_AT = new Date().toISOString().slice(0, 10);
// Execution figures are treated as actuals only for years that have ended.
const CLOSED_YEAR_MAX = new Date().getFullYear() - 1;

interface MinistrySeed {
  id: string;
  budgetCodes: string[];
}
interface MinistriesSeedFile {
  ministries: MinistrySeed[];
}

interface RawRow {
  code?: unknown;
  title?: unknown;
  year?: unknown;
  econ_cls_title_2?: unknown;
  net_allocated?: unknown;
  net_revised?: unknown;
  net_executed?: unknown;
}

function queryUrl(sectionCode: string): string {
  const sql =
    `select code, title, year, econ_cls_title_2, net_allocated, net_revised, net_executed ` +
    `from raw_budget where code like '${sectionCode}%' and depth = 4 ` +
    `and year >= ${ANALYSIS_YEARS[0]} and year <= ${ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]} ` +
    `and is_proposal = false and budget_kind_code = '1' order by code, year limit 4000`;
  return `https://next.obudget.org/api/query?query=${encodeURIComponent(sql)}`;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function readText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return null;
}

async function main(): Promise<void> {
  const logger = new Logger('scan-anomalies');
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));

  const findings: AnomalyFinding[] = [];
  const scannedCounts: Record<string, number> = {};

  for (const ministry of seed.ministries) {
    for (const sectionCode of ministry.budgetCodes) {
      const result = await politeFetch(queryUrl(sectionCode), {
        purpose: `regulation-level rows for anomaly scan (${ministry.id})`,
        logger,
      });
      if (!result.ok || !result.body) continue;

      let raw: RawRow[] = [];
      try {
        const parsed = JSON.parse(result.body) as { rows?: RawRow[]; success?: boolean };
        if (parsed.success === false) throw new Error('API reported success: false');
        raw = parsed.rows ?? [];
      } catch (err) {
        console.error(`  parse failure for ${ministry.id}: ${String(err)}`);
        continue;
      }

      const rows: RegulationRow[] = [];
      for (const r of raw) {
        const code = readText(r.code);
        const title = readText(r.title);
        const year = readNumber(r.year);
        if (code === null || title === null || year === null) continue;
        rows.push({
          code,
          title,
          year,
          econLevel2: readText(r.econ_cls_title_2),
          allocated: readNumber(r.net_allocated),
          revised: readNumber(r.net_revised),
          executed: readNumber(r.net_executed),
        });
      }
      scannedCounts[ministry.id] = (scannedCounts[ministry.id] ?? 0) + rows.length;
      findings.push(...scanRegulations(rows, ministry.id, CLOSED_YEAR_MAX));
    }
  }

  const output = {
    generatedAt: COLLECTED_AT,
    closedYearMax: CLOSED_YEAR_MAX,
    method:
      'סריקה דטרמיניסטית של תקנות התקציב (רמה 4) לפי כללים קבועים עם ספים מפורסמים. אין מעורבות של מודל שפה בזיהוי. ממצא אינו קביעה שנפל פגם — הוא שורה שמספריה מקיימים נוסחה מוצהרת, מוצגת כדי שקורא יוכל לפתוח את המקור ולשפוט.',
    rules: ANOMALY_RULES,
    scannedCounts,
    findings,
  };

  writeJson(path.join(PROCESSED_DIR, 'anomalies.json'), output);
  writeText(
    path.join(PROCESSED_DIR, 'csv', 'anomalies.csv'),
    toCsv(
      ['כלל', 'משרד', 'שנה', 'קוד תקנה', 'שם התקנה', 'מקורי', 'מעודכן', 'ביצוע', 'ראיה', 'מקור'],
      findings.map((f) => [
        ANOMALY_RULES.find((r) => r.id === f.ruleId)?.labelHe ?? f.ruleId,
        f.ministryId,
        f.year,
        f.code,
        f.title,
        f.allocated,
        f.revised,
        f.executed,
        f.evidenceHe,
        f.sourceUrl,
      ]),
    ),
  );

  logger.flush('סריקת התקנות בוצעה מול המקור בפועל; הכללים והספים מפורסמים בקובץ התוצר.');
  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
  console.log(
    `scan-anomalies: ${Object.values(scannedCounts).reduce((a, b) => a + b, 0)} תקנות נסרקו · ${findings.length} ממצאים`,
  );
  for (const [rule, count] of byRule) console.log(`  ${rule}: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
