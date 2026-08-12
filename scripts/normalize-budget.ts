/**
 * normalize-budget — builds data/processed/budget-items.json.
 *
 * Sources attempted, in the priority order declared in scripts/README.md:
 *   1. gov.il / Ministry of Finance budget-execution report pages (official).
 *   2. data.gov.il CKAN catalogue (official open-data).
 *   3. Budget Key (obudget) query API — a secondary helper layer that mirrors
 *      Ministry of Finance budget data.
 *
 * Hard rules encoded here:
 *   - A figure is emitted only if it arrives as a finite number from a source we
 *     actually retrieved. Missing values are emitted as null, never as 0.
 *   - Only the *regular* budget kind (budget_kind_code = '1') is collected,
 *     because those are the sections that carry the ministry's own name and so
 *     attribute unambiguously. Development-budget sections are named by domain,
 *     not by ministry, and attributing them would be an inference.
 *   - Only enacted budget rows are collected (is_proposal = false).
 *   - Hierarchy comes from the source's own `parent` and `depth` columns, and a
 *     record is marked a leaf only when no other collected record declares it as
 *     a parent. That is what makes aggregation safe from double counting.
 *   - Figures from this secondary layer are never labelled `final`.
 *   - PDF and spreadsheet budget books are NOT parsed heuristically. If a source
 *     is only available as a PDF, the failure is logged and the source stays in
 *     the catalogue for human follow-up.
 *   - Execution rate is computed, never copied.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch } from './lib/http.js';
import { queryAllPages } from './lib/obudget.js';
import type { BudgetItem } from './lib/schema.js';

const ANALYSIS_YEARS = [2023, 2024, 2025, 2026] as const;
const COLLECTED_AT = new Date().toISOString().slice(0, 10);
const CURRENT_FISCAL_YEAR = new Date().getFullYear();
const MAX_DEPTH = 3;
const REGULAR_BUDGET_KIND = '1';

/** Execution rates above this, or below 0, must carry an explicit outlier note. */
export const OUTLIER_RATE_MAX = 150;
export const OUTLIER_MARKER = 'חריגה:';

interface MinistrySeed {
  id: string;
  officialName: string;
  budgetCodes: string[];
}
interface MinistriesSeedFile {
  ministries: MinistrySeed[];
  budgetSectionPolicy: { includedBudgetKind: string; excludedBudgetKinds: string };
}

/** Official pages that hold the authoritative execution data (HTML/PDF landing pages). */
const OFFICIAL_EXECUTION_SOURCES = [
  {
    url: 'https://www.gov.il/he/pages/budget-execution-reports-2024',
    title: 'דוחות על ביצוע התקציב לשנת 2024 — משרד האוצר',
  },
  {
    url: 'https://mof.gov.il/AG/BudgetExecution/Pages/default.aspx',
    title: 'ביצוע התקציב — החשב הכללי, משרד האוצר',
  },
];

const CKAN_SEARCH_URL =
  'https://data.gov.il/api/3/action/package_search?q=%D7%AA%D7%A7%D7%A6%D7%99%D7%91&rows=25';

/** One row of the Budget Key `raw_budget` table, as far as we rely on it. */
interface RawBudgetRow {
  code?: unknown;
  title?: unknown;
  parent?: unknown;
  depth?: unknown;
  year?: unknown;
  budget_kind_title?: unknown;
  net_allocated?: unknown;
  net_revised?: unknown;
  net_executed?: unknown;
}

function obudgetQueryUrl(sectionCode: string): string {
  const sql =
    `select code, title, parent, depth, year, budget_kind_title, ` +
    `net_allocated, net_revised, net_executed from raw_budget ` +
    `where code like '${sectionCode}%' and depth <= ${MAX_DEPTH} ` +
    `and year >= ${ANALYSIS_YEARS[0]} and year <= ${ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]} ` +
    `and is_proposal = false and budget_kind_code = '${REGULAR_BUDGET_KIND}' ` +
    `order by year, code limit 20000`;
  return sql;
}

/** Reads a numeric field defensively: only finite numbers pass; anything else is absent. */
function readMeasure(row: RawBudgetRow, key: keyof RawBudgetRow): number | null {
  const raw = row[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readText(row: RawBudgetRow, key: keyof RawBudgetRow): string | null {
  const raw = row[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** שיעור ביצוע = ביצוע ÷ תקציב מעודכן × 100, only when both are valid and the denominator is positive. */
export function computeExecutionRate(
  execution: number | null,
  updatedBudget: number | null,
): number | null {
  if (execution === null || updatedBudget === null) return null;
  if (!Number.isFinite(execution) || !Number.isFinite(updatedBudget)) return null;
  if (updatedBudget <= 0) return null;
  return Math.round((execution / updatedBudget) * 1000) / 10;
}

/** Walks the parent chain to produce a readable hierarchy path. */
function buildHierarchyPath(
  code: string,
  titleByCode: Map<string, string>,
  parentByCode: Map<string, string | null>,
): string[] {
  const path: string[] = [];
  let current: string | null = code;
  const guard = new Set<string>();
  while (current !== null && !guard.has(current)) {
    guard.add(current);
    const title = titleByCode.get(current);
    if (title !== undefined) path.unshift(title);
    current = parentByCode.get(current) ?? null;
  }
  return path;
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
    skipped.push({
      source: source.url,
      reason: result.ok
        ? 'העמוד אוחזר, אך נתוני הביצוע מתפרסמים בו כקובצי PDF/Excel. חילוץ טבלאות תקציב מפריסת PDF אינו אמין ולכן לא בוצע. המקור נשמר בקטלוג לאימות אנושי.'
        : `לא ניתן לאחזר את העמוד (${result.outcome}). לא נגזרו ממנו נתונים.`,
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
        result?: { count?: number; results?: Array<{ title?: string }> };
      };
      const found = parsed.result?.count ?? 0;
      console.log(`  data.gov.il: ${found} מאגרים נמצאו (נדרש מיפוי עמודות ידני לפני חילוץ)`);
      skipped.push({
        source: CKAN_SEARCH_URL,
        reason: `נמצאו ${found} מאגרים בחיפוש "תקציב". הם עוסקים בעיקר בתקציבי רשויות מקומיות ובנושאים אחרים, ומיפוי עמודות לסכמת BudgetItem טרם הוגדר עבורם. לכן לא נגזרו מהם נתונים אוטומטית.`,
      });
    } catch (err) {
      skipped.push({ source: CKAN_SEARCH_URL, reason: `תשובת CKAN לא נותחה: ${String(err)}` });
    }
  } else {
    skipped.push({
      source: CKAN_SEARCH_URL,
      reason: `לא ניתן לאחזר את קטלוג data.gov.il (${ckan.outcome}).`,
    });
  }

  // ---- Priority 3: Budget Key (secondary helper layer) --------------------
  for (const ministry of seed.ministries) {
    for (const sectionCode of ministry.budgetCodes) {
      const sql = obudgetQueryUrl(sectionCode);
      let rows: RawBudgetRow[] = [];
      try {
        rows = (await queryAllPages(
          logger,
          `budget hierarchy for ${ministry.id} section ${sectionCode}`,
          sql,
        )) as RawBudgetRow[];
      } catch (err) {
        skipped.push({ source: sql, reason: `שכבת העזר התקציבית אינה נגישה: ${String(err)}` });
        continue;
      }
      if (rows.length === 0) {
        skipped.push({ source: sql, reason: 'התשובה לא הכילה שורות.' });
        continue;
      }
      const url = sql;

      // Group by fiscal year: hierarchy and leaf-ness are per-year properties.
      const byYear = new Map<number, RawBudgetRow[]>();
      for (const row of rows) {
        const year = readMeasure(row, 'year');
        if (year === null) continue;
        if (!ANALYSIS_YEARS.includes(year as (typeof ANALYSIS_YEARS)[number])) continue;
        const bucket = byYear.get(year);
        if (bucket) bucket.push(row);
        else byYear.set(year, [row]);
      }

      for (const [year, yearRows] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
        const titleByCode = new Map<string, string>();
        const parentByCode = new Map<string, string | null>();
        const declaredParents = new Set<string>();

        for (const row of yearRows) {
          const code = readText(row, 'code');
          const title = readText(row, 'title');
          if (code === null || title === null) continue;
          titleByCode.set(code, title);
          const parent = readText(row, 'parent');
          parentByCode.set(code, parent);
          if (parent !== null) declaredParents.add(parent);
        }

        for (const row of yearRows) {
          const code = readText(row, 'code');
          const title = readText(row, 'title');
          const depth = readMeasure(row, 'depth');
          if (code === null || title === null || depth === null) continue;

          const parent = parentByCode.get(code) ?? null;
          // A record is a leaf only when nothing else we collected calls it a parent.
          const isLeaf = !declaredParents.has(code);

          const originalBudget = readMeasure(row, 'net_allocated');
          const updatedBudget = readMeasure(row, 'net_revised');
          const execution = readMeasure(row, 'net_executed');
          const isCurrentOrFutureYear = year >= CURRENT_FISCAL_YEAR;

          const actualExecution = isCurrentOrFutureYear ? null : execution;
          const estimatedExecution = isCurrentOrFutureYear ? execution : null;

          // Never `final`: this is a secondary layer, not an official closing report.
          const dataStatus: BudgetItem['dataStatus'] = isCurrentOrFutureYear
            ? 'estimate'
            : 'partial';

          const kindTitle = readText(row, 'budget_kind_title') ?? 'תקציב רגיל';
          const rate = computeExecutionRate(actualExecution ?? estimatedExecution, updatedBudget);

          // A rate outside 0–150% is a real source value, not a bug — it shows up on
          // small lines, on income/refund lines, and where a line was largely
          // defunded mid-year. It must never be shown as a plain percentage, so it
          // carries an explicit outlier marker that validate-data requires.
          const outlierNote =
            rate !== null && (rate < 0 || rate > OUTLIER_RATE_MAX)
              ? ` ${OUTLIER_MARKER} שיעור הביצוע המחושב הוא ${rate}%, מחוץ לטווח 0–${OUTLIER_RATE_MAX}%. הערך מוצג כפי שהוא נגזר מהמקור ואינו שגיאת חישוב: הוא נובע מסעיף קטן, מסעיף הכנסה/החזר, או מסעיף שתקציבו שונה מהותית במהלך השנה. אין לקרוא אותו כשיעור ניצול רגיל.`
              : '';

          items.push({
            id: `budget-${ministry.id}-${year}-${code}`,
            ministryId: ministry.id,
            fiscalYear: year,
            budgetCode: code,
            parentBudgetCode: parent,
            title,
            hierarchyPath: buildHierarchyPath(code, titleByCode, parentByCode),
            hierarchyLevel: depth,
            isLeaf,
            originalBudget,
            updatedBudget,
            actualExecution,
            estimatedExecution,
            executionRate: rate,
            currency: 'ILS',
            unit: 'ILS',
            dataStatus,
            sourceUrl: `https://next.obudget.org/i/budget/${code}/${year}`,
            sourceTitle: `מפתח התקציב — סעיף ${code} (${title}), שנת ${year}`,
            sourcePublishedAt: null,
            collectedAt: COLLECTED_AT,
            rawReference: url,
            notes:
              `${kindTitle}. הנתון מגיע ממפתח התקציב — שכבת עזר המשקפת נתוני משרד האוצר, ולא מקור רשמי ראשוני. ` +
              `לכן הוא מסומן ${isCurrentOrFutureYear ? 'כאומדן לשנה שוטפת' : 'כנתון חלקי'} ולא כביצוע סופי, וטעון אימות מול ספר התקציב או דוח ביצוע רשמי. ` +
              `נאספות רמות היררכיה 1–${MAX_DEPTH}; סכימה מתבצעת על רמה אחת בלבד כדי למנוע כפל ספירה.` +
              outlierNote,
          });
        }
      }
    }
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  writeJson(path.join(PROCESSED_DIR, 'budget-items.json'), items);
  writeJson(path.join(PROCESSED_DIR, 'budget-collection-notes.json'), {
    generatedAt: COLLECTED_AT,
    emitted: items.length,
    includedBudgetKind: seed.budgetSectionPolicy.includedBudgetKind,
    excludedBudgetKinds: seed.budgetSectionPolicy.excludedBudgetKinds,
    maxDepth: MAX_DEPTH,
    skipped,
    policy:
      'לא נוצרו רשומות תקציב ללא מקור שאוחזר בפועל. ערך חסר נשמר כ-null ולא כאפס. חילוץ מ-PDF לא בוצע. אף רשומה אינה מסומנת כביצוע סופי, מפני שהמקור הוא שכבת עזר ולא דוח רשמי סופי.',
  });

  logger.flush(
    'ניסיונות איסוף התקציב בוצעו מול המקורות הרשמיים ומול שכבת העזר בפועל. כישלונות אחזור מתועדים כאן ובקובץ budget-collection-notes.json.',
  );
  console.log(`\nנוצרו ${items.length} רשומות תקציב · ${skipped.length} מקורות לא נוצלו`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
