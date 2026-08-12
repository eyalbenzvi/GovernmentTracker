/**
 * normalize-budget — builds data/processed/budget-items.json.
 *
 * Sources attempted, in the priority order declared in scripts/README.md:
 *   1. gov.il / Ministry of Finance budget-execution report pages (official).
 *   2. data.gov.il CKAN catalogue (official open-data).
 *   3. Budget Key (obudget) query API — secondary helper layer only, and any
 *      figure derived from it is never labelled `final`.
 *
 * Hard rules encoded here:
 *   - A figure is emitted only if it arrives as a finite number from a source we
 *     actually retrieved. Missing values are emitted as null, never as 0.
 *   - PDF and spreadsheet budget books are NOT parsed heuristically. If a source
 *     is only available as a PDF, the failure is logged and the source stays in
 *     the catalogue for human follow-up. Guessing numbers out of a PDF layout is
 *     explicitly out of scope.
 *   - Execution rate is computed, never copied.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch } from './lib/http.js';
import type { BudgetItem } from './lib/schema.js';

const ANALYSIS_YEARS = [2023, 2024, 2025, 2026] as const;
const COLLECTED_AT = new Date().toISOString().slice(0, 10);
const CURRENT_FISCAL_YEAR = new Date().getFullYear();

interface MinistrySeed {
  id: string;
  officialName: string;
  budgetCodes: string[];
}
interface MinistriesSeedFile {
  ministries: MinistrySeed[];
}

/** Official pages that hold the authoritative execution data (HTML/PDF landing pages). */
const OFFICIAL_EXECUTION_SOURCES = [
  {
    url: 'https://www.gov.il/he/pages/budget-execution-reports-2024',
    title: 'דוחות על ביצוע התקציב לשנת 2024 — משרד האוצר',
    note: 'עמוד ריכוז רשמי של דוחות ביצוע התקציב.',
  },
  {
    url: 'https://mof.gov.il/AG/BudgetExecution/Pages/default.aspx',
    title: 'ביצוע התקציב — החשב הכללי, משרד האוצר',
    note: 'עמוד ביצוע התקציב של החשב הכללי.',
  },
];

const CKAN_SEARCH_URL =
  'https://data.gov.il/api/3/action/package_search?q=%D7%AA%D7%A7%D7%A6%D7%99%D7%91&rows=25';

function obudgetQueryUrl(code: string): string {
  const sql = `select year, code, title, net_allocated, net_revised, net_executed from raw_budget where code like '${code}%' and year >= 2023 order by year, code limit 500`;
  return `https://next.obudget.org/api/query?query=${encodeURIComponent(sql)}`;
}

/** Reads a numeric field defensively: only finite numbers pass; anything else is absent. */
function readMeasure(row: Record<string, unknown>, key: string): number | null {
  const raw = row[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** שיעור ביצוע = ביצוע / תקציב מעודכן × 100, only when both are valid and the denominator is positive. */
export function computeExecutionRate(
  execution: number | null,
  updatedBudget: number | null,
): number | null {
  if (execution === null || updatedBudget === null) return null;
  if (!Number.isFinite(execution) || !Number.isFinite(updatedBudget)) return null;
  if (updatedBudget <= 0) return null;
  return Math.round((execution / updatedBudget) * 1000) / 10;
}

async function main(): Promise<void> {
  const logger = new Logger('normalize-budget');
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));
  const items: BudgetItem[] = [];
  const skipped: Array<{ source: string; reason: string }> = [];

  // ---- Priority 1: official execution report pages -------------------------
  for (const source of OFFICIAL_EXECUTION_SOURCES) {
    const result = await politeFetch(source.url, {
      purpose: 'official budget execution figures',
      logger,
    });
    if (!result.ok) {
      skipped.push({
        source: source.url,
        reason: `לא ניתן לאחזר את העמוד (${result.outcome}). לא נגזרו ממנו נתונים.`,
      });
      continue;
    }
    // The landing pages expose the data as PDF/XLSX attachments. Parsing budget
    // tables out of a PDF layout is not reliable, so we deliberately stop here
    // and record the limitation instead of guessing.
    skipped.push({
      source: source.url,
      reason:
        'העמוד אוחזר, אך נתוני הביצוע מתפרסמים בו כקובצי PDF/Excel. חילוץ טבלאות תקציב מפריסת PDF אינו אמין ולכן לא בוצע. המקור נשמר בקטלוג לאימות אנושי.',
    });
  }

  // ---- Priority 2: data.gov.il open-data catalogue ------------------------
  const ckan = await politeFetch(CKAN_SEARCH_URL, {
    purpose: 'discover official budget datasets on data.gov.il',
    logger,
  });
  if (ckan.ok && ckan.body) {
    try {
      const parsed = JSON.parse(ckan.body) as {
        result?: { results?: Array<{ title?: string; resources?: Array<{ url?: string }> }> };
      };
      const found = parsed.result?.results?.length ?? 0;
      console.log(`  data.gov.il: ${found} מאגרים נמצאו (נדרש מיפוי ידני לפני חילוץ)`);
      skipped.push({
        source: CKAN_SEARCH_URL,
        reason: `נמצאו ${found} מאגרים. מיפוי עמודות של כל מאגר לסכמת BudgetItem טרם הוגדר, ולכן לא נגזרו נתונים אוטומטית.`,
      });
    } catch (err) {
      skipped.push({
        source: CKAN_SEARCH_URL,
        reason: `תשובת CKAN לא נותחה: ${String(err)}`,
      });
    }
  } else {
    skipped.push({
      source: CKAN_SEARCH_URL,
      reason: `לא ניתן לאחזר את קטלוג data.gov.il (${ckan.outcome}).`,
    });
  }

  // ---- Priority 3: Budget Key (secondary helper layer) --------------------
  for (const ministry of seed.ministries) {
    for (const code of ministry.budgetCodes) {
      const url = obudgetQueryUrl(code);
      const result = await politeFetch(url, {
        purpose: `secondary budget layer for ${ministry.id} code ${code}`,
        logger,
      });
      if (!result.ok || !result.body) {
        skipped.push({
          source: url,
          reason: `שכבת העזר התקציבית אינה נגישה (${result.outcome}).`,
        });
        continue;
      }
      let rows: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(result.body) as { rows?: Array<Record<string, unknown>> };
        rows = parsed.rows ?? [];
      } catch (err) {
        skipped.push({ source: url, reason: `תשובת ה-API לא נותחה: ${String(err)}` });
        continue;
      }

      for (const row of rows) {
        const year = readMeasure(row, 'year');
        const rowCode = typeof row['code'] === 'string' ? row['code'] : null;
        const title = typeof row['title'] === 'string' ? row['title'] : null;
        if (year === null || rowCode === null || title === null) continue;
        if (!ANALYSIS_YEARS.includes(year as (typeof ANALYSIS_YEARS)[number])) continue;

        const originalBudget = readMeasure(row, 'net_allocated');
        const updatedBudget = readMeasure(row, 'net_revised');
        const execution = readMeasure(row, 'net_executed');

        // A secondary layer is never presented as a final figure.
        const isCurrentYear = year >= CURRENT_FISCAL_YEAR;
        const dataStatus: BudgetItem['dataStatus'] =
          execution === null ? 'partial' : isCurrentYear ? 'estimate' : 'partial';

        const hierarchyLevel = Math.max(0, Math.floor(rowCode.length / 2) - 1);

        items.push({
          id: `budget-${ministry.id}-${year}-${rowCode}`,
          ministryId: ministry.id,
          fiscalYear: year,
          budgetCode: rowCode,
          parentBudgetCode: rowCode.length > 2 ? rowCode.slice(0, -2) : null,
          title,
          hierarchyPath: [ministry.officialName, title],
          hierarchyLevel,
          isLeaf: false,
          originalBudget,
          updatedBudget,
          actualExecution: isCurrentYear ? null : execution,
          estimatedExecution: isCurrentYear ? execution : null,
          executionRate: computeExecutionRate(isCurrentYear ? null : execution, updatedBudget),
          currency: 'ILS',
          unit: 'ILS',
          dataStatus,
          sourceUrl: `https://next.obudget.org/i/budget/${rowCode}/${year}`,
          sourceTitle: `מפתח התקציב — סעיף ${rowCode}, שנת ${year}`,
          sourcePublishedAt: null,
          collectedAt: COLLECTED_AT,
          rawReference: url,
          notes:
            'הנתון מגיע משכבת עזר תקציבית (מפתח התקציב) ולא ממקור רשמי ראשוני. הוא מסומן כחלקי/אומדן וטעון אימות מול ספר התקציב או דוח ביצוע רשמי לפני שימוש כנתון סופי.',
        });
      }
    }
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  writeJson(path.join(PROCESSED_DIR, 'budget-items.json'), items);
  writeJson(path.join(PROCESSED_DIR, 'budget-collection-notes.json'), {
    generatedAt: COLLECTED_AT,
    emitted: items.length,
    skipped,
    policy:
      'לא נוצרו רשומות תקציב ללא מקור שאוחזר בפועל. ערך חסר נשמר כ-null ולא כאפס. חילוץ מ-PDF לא בוצע.',
  });

  logger.flush(
    'ניסיונות איסוף התקציב בוצעו מול המקורות הרשמיים בפועל. כישלונות אחזור מתועדים כאן ובקובץ budget-collection-notes.json.',
  );
  console.log(`\nנוצרו ${items.length} רשומות תקציב · ${skipped.length} מקורות לא נוצלו`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
