/**
 * collect-findings — builds data/processed/findings.json.
 *
 * The depth layer of the site: suppliers, procurement methods, notable
 * contracts, support recipients and mid-year budget transfers, per ministry.
 * All of it comes from Budget Key's public mirror of official datasets
 * (procurement reports of the Accountant General, the supports database, and
 * Finance Committee transfer requests).
 *
 * Framing rules encoded here:
 *   - Contract `volume` is the multi-year committed total of an engagement and
 *     `executed` is the amount actually paid to date. They are labelled as
 *     such and never presented as an annual expenditure.
 *   - Recipients and suppliers are corporations, associations, municipalities
 *     and government companies — public registry entities. Rows without a
 *     resolvable entity are kept only when the supplier name is clearly an
 *     organisation-style record from the procurement report.
 *   - Everything is a secondary-helper source: never labelled final, always
 *     linked back for verification.
 *   - Sanity rule: a single contract whose volume exceeds 3x the maximum annual
 *     revised budget of the level-2 program its budget code belongs to is
 *     presumed to be a source data error (the mirror contains rows like a
 *     seminar-catering order recorded at half a billion shekels). Such rows are
 *     excluded from every ranking and disclosed separately with the rule and
 *     examples — set aside in the open, not hidden.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson, writeText } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch } from './lib/http.js';
import { toCsv } from './lib/csv.js';

const COLLECTED_AT = new Date().toISOString().slice(0, 10);
const FROM_YEAR = 2023;
const TOP_SUPPLIERS = 15;
const TOP_CONTRACTS = 10;
const TOP_RECIPIENTS = 15;
const TOP_CHANGES = 8;

interface MinistrySeed {
  id: string;
  budgetCodes: string[];
}
interface MinistriesSeedFile {
  ministries: MinistrySeed[];
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function readText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (Array.isArray(value) && value.length >= 1 && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return null;
}

function entityUrl(kind: string | null, id: string | null): string | null {
  if (kind === null || id === null) return null;
  return `https://next.obudget.org/i/org/${kind}/${id}`;
}

async function queryRows(
  logger: Logger,
  purpose: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const url = `https://next.obudget.org/api/query?query=${encodeURIComponent(sql)}`;
  const result = await politeFetch(url, { purpose, logger });
  if (!result.ok || !result.body) return [];
  try {
    const parsed = JSON.parse(result.body) as {
      rows?: Array<Record<string, unknown>>;
      success?: boolean;
    };
    if (parsed.success === false) throw new Error('API reported success: false');
    return parsed.rows ?? [];
  } catch (err) {
    console.error(`  parse failure (${purpose}): ${String(err)}`);
    return [];
  }
}

/** Normalises reported purchase methods into a small set of honest buckets. */
export function normalizeMethod(method: string | null): string {
  if (method === null || method === 'ILS') return 'לא דווח / אחר';
  if (method === 'אחר') return 'לא דווח / אחר';
  if (method.includes('פטור')) return 'פטור ממכרז';
  if (method.includes('מכרז')) return method;
  return method;
}

const VOLUME_CAP_FACTOR = 1.5;

interface BudgetItemSlim {
  ministryId: string;
  budgetCode: string;
  hierarchyLevel: number;
  updatedBudget: number | null;
}

/**
 * Builds the per-program volume caps for one ministry and renders them as a SQL
 * CASE expression over the contract's level-2 code prefix, so the sanity rule
 * runs server-side inside the aggregation queries.
 */
function buildCapSql(
  items: readonly BudgetItemSlim[],
  ministryId: string,
): {
  capSql: string;
  capsNote: string;
} {
  const level2Max = new Map<string, number>();
  let sectionMax = 0;
  for (const item of items) {
    if (item.ministryId !== ministryId || item.updatedBudget === null) continue;
    if (item.hierarchyLevel === 1) sectionMax = Math.max(sectionMax, item.updatedBudget);
    if (item.hierarchyLevel === 2) {
      level2Max.set(
        item.budgetCode,
        Math.max(level2Max.get(item.budgetCode) ?? 0, item.updatedBudget),
      );
    }
  }
  const fallbackCap = Math.max(1, Math.round(sectionMax * VOLUME_CAP_FACTOR));
  const whens = [...level2Max.entries()]
    .map(([code, max]) => `when '${code}' then ${Math.max(1, Math.round(max * VOLUME_CAP_FACTOR))}`)
    .join(' ');
  return {
    capSql: `(volume is null or volume <= case substring(budget_code,1,6) ${whens} else ${fallbackCap} end)`,
    capsNote: `תקרת שפיות: פי ${VOLUME_CAP_FACTOR} מהתקציב השנתי המרבי של התוכנית (רמה 2) שאליה משויך קוד ההתקשרות; בהיעדר תוכנית מזוהה — פי ${VOLUME_CAP_FACTOR} מתקציב הסעיף כולו.`,
  };
}

async function main(): Promise<void> {
  const logger = new Logger('collect-findings');
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));
  const budgetItems = readJson<BudgetItemSlim[]>(path.join(PROCESSED_DIR, 'budget-items.json'));

  const suppliersByMinistry: Record<string, unknown[]> = {};
  const methodsByMinistry: Record<string, unknown[]> = {};
  const contractsByMinistry: Record<string, unknown[]> = {};
  const recipientsByMinistry: Record<string, unknown[]> = {};
  const changesByMinistry: Record<string, unknown[]> = {};
  const contractTotals: Record<
    string,
    { contractCount: number; totalVolume: number; top5SharePercent: number | null }
  > = {};
  const excludedContracts: Record<
    string,
    {
      rule: string;
      excludedCount: number;
      excludedVolume: number;
      dataSuspect: boolean;
      examples: unknown[];
    }
  > = {};

  for (const ministry of seed.ministries) {
    const section = ministry.budgetCodes[0];
    if (section === undefined) continue;
    const like = `${section}%`;
    // The two-digit leading item of the section, e.g. '0040' -> 40.
    const leadingItem = Number(section.replace(/^0+/, '').slice(0, 2));
    const { capSql, capsNote } = buildCapSql(budgetItems, ministry.id);

    // ---- top suppliers ------------------------------------------------------
    const supplierRows = await queryRows(
      logger,
      `top suppliers for ${ministry.id}`,
      `select coalesce(entity_name, supplier_name->>0) as name, entity_id, entity_kind, ` +
        `count(1) as n, sum(volume) as vol, sum(executed) as exe ` +
        `from contract_spending where budget_code like '${like}' and max_year >= ${FROM_YEAR} ` +
        `and ${capSql} ` +
        `and coalesce(entity_name, supplier_name->>0) is not null ` +
        `group by coalesce(entity_name, supplier_name->>0), entity_id, entity_kind ` +
        `order by vol desc nulls last limit ${TOP_SUPPLIERS}`,
    );
    suppliersByMinistry[ministry.id] = supplierRows
      .map((r) => ({
        name: readText(r.name),
        entityId: readText(r.entity_id),
        entityKind: readText(r.entity_kind),
        contractCount: readNumber(r.n) ?? 0,
        totalVolume: readNumber(r.vol),
        totalExecuted: readNumber(r.exe),
        entityUrl: entityUrl(readText(r.entity_kind), readText(r.entity_id)),
      }))
      .filter((r) => r.name !== null);

    // ---- totals + concentration --------------------------------------------
    const totalRows = await queryRows(
      logger,
      `contract totals for ${ministry.id}`,
      `select count(1) as n, sum(volume) as vol from contract_spending ` +
        `where budget_code like '${like}' and max_year >= ${FROM_YEAR} and ${capSql}`,
    );
    const totalVolume = readNumber(totalRows[0]?.vol) ?? 0;
    const top5 = (suppliersByMinistry[ministry.id] as Array<{ totalVolume: number | null }>)
      .slice(0, 5)
      .reduce((acc, s) => acc + (s.totalVolume ?? 0), 0);
    contractTotals[ministry.id] = {
      contractCount: readNumber(totalRows[0]?.n) ?? 0,
      totalVolume,
      top5SharePercent: totalVolume > 0 ? Math.round((top5 / totalVolume) * 1000) / 10 : null,
    };

    // ---- procurement methods ------------------------------------------------
    const methodRows = await queryRows(
      logger,
      `purchase methods for ${ministry.id}`,
      `select purchase_method->>0 as method, count(1) as n, sum(volume) as vol ` +
        `from contract_spending where budget_code like '${like}' and max_year >= ${FROM_YEAR} ` +
        `and ${capSql} ` +
        `group by purchase_method->>0 order by vol desc nulls last limit 30`,
    );
    const buckets = new Map<string, { contractCount: number; totalVolume: number }>();
    for (const r of methodRows) {
      const bucket = normalizeMethod(readText(r.method));
      const existing = buckets.get(bucket) ?? { contractCount: 0, totalVolume: 0 };
      existing.contractCount += readNumber(r.n) ?? 0;
      existing.totalVolume += readNumber(r.vol) ?? 0;
      buckets.set(bucket, existing);
    }
    const methodTotal = [...buckets.values()].reduce((a, b) => a + b.totalVolume, 0);
    methodsByMinistry[ministry.id] = [...buckets.entries()]
      .map(([method, agg]) => ({
        method,
        contractCount: agg.contractCount,
        totalVolume: agg.totalVolume,
        sharePercent:
          methodTotal > 0 ? Math.round((agg.totalVolume / methodTotal) * 1000) / 10 : null,
      }))
      .sort((a, b) => b.totalVolume - a.totalVolume);

    // ---- notable contracts ---------------------------------------------------
    const contractRows = await queryRows(
      logger,
      `notable contracts for ${ministry.id}`,
      `select coalesce(entity_name, supplier_name->>0) as name, entity_id, entity_kind, purpose, ` +
        `volume, executed, order_date, purchase_method->>0 as method, budget_code, budget_title, contract_is_active ` +
        `from contract_spending where budget_code like '${like}' and max_year >= ${FROM_YEAR} ` +
        `and ${capSql} and volume is not null order by volume desc limit ${TOP_CONTRACTS}`,
    );
    contractsByMinistry[ministry.id] = contractRows.map((r) => ({
      supplier: readText(r.name),
      entityUrl: entityUrl(readText(r.entity_kind), readText(r.entity_id)),
      purpose: readText(r.purpose),
      volume: readNumber(r.volume),
      executed: readNumber(r.executed),
      orderDate: readText(r.order_date),
      method: normalizeMethod(readText(r.method)),
      budgetCode: readText(r.budget_code),
      budgetTitle: readText(r.budget_title),
      isActive: typeof r.contract_is_active === 'boolean' ? r.contract_is_active : null,
    }));

    // ---- excluded (suspected-erroneous) contract records ----------------------
    const excludedAggRows = await queryRows(
      logger,
      `excluded contract records for ${ministry.id}`,
      `select count(1) as n, sum(volume) as vol from contract_spending ` +
        `where budget_code like '${like}' and max_year >= ${FROM_YEAR} and not ${capSql}`,
    );
    const excludedExampleRows = await queryRows(
      logger,
      `excluded contract examples for ${ministry.id}`,
      `select coalesce(entity_name, supplier_name->>0) as name, purpose, volume, budget_code, budget_title ` +
        `from contract_spending where budget_code like '${like}' and max_year >= ${FROM_YEAR} ` +
        `and not ${capSql} order by volume desc nulls last limit 6`,
    );
    const excludedVolume = readNumber(excludedAggRows[0]?.vol) ?? 0;
    excludedContracts[ministry.id] = {
      rule: capsNote,
      excludedCount: readNumber(excludedAggRows[0]?.n) ?? 0,
      excludedVolume,
      // When more volume was set aside as suspect than survived the cap, the
      // ministry's whole contracts feed is unreliable at the source, and no
      // ranking derived from it may be presented as fact.
      dataSuspect: excludedVolume > totalVolume,
      examples: excludedExampleRows.map((r) => ({
        name: readText(r.name),
        purpose: readText(r.purpose),
        volume: readNumber(r.volume),
        budgetCode: readText(r.budget_code),
        budgetTitle: readText(r.budget_title),
      })),
    };

    // ---- support recipients ---------------------------------------------------
    const recipientRows = await queryRows(
      logger,
      `support recipients for ${ministry.id}`,
      `select coalesce(entity_name, recipient) as name, entity_id, entity_kind, ` +
        `count(1) as n, sum(amount_approved) as approved, sum(amount_paid) as paid, ` +
        `max(support_title) as example_title ` +
        `from _elasticsearch_mirror__supports where budget_code like '${like}' ` +
        `and year_requested >= ${FROM_YEAR} and coalesce(entity_name, recipient) is not null ` +
        `group by coalesce(entity_name, recipient), entity_id, entity_kind ` +
        `order by paid desc nulls last limit ${TOP_RECIPIENTS}`,
    );
    recipientsByMinistry[ministry.id] = recipientRows
      .map((r) => ({
        name: readText(r.name),
        entityId: readText(r.entity_id),
        entityKind: readText(r.entity_kind),
        requestCount: readNumber(r.n) ?? 0,
        totalApproved: readNumber(r.approved),
        totalPaid: readNumber(r.paid),
        exampleTitle: readText(r.example_title),
        entityUrl: entityUrl(readText(r.entity_kind), readText(r.entity_id)),
      }))
      .filter((r) => r.name !== null);

    // ---- mid-year budget transfers -------------------------------------------
    const changeRows = await queryRows(
      logger,
      `budget transfer requests for ${ministry.id}`,
      `select year, date, req_title, change_type_name, net_expense_diff, transaction_id, explanation ` +
        `from _elasticsearch_mirror__national_budget_changes ` +
        `where leading_item = ${leadingItem} and year >= ${FROM_YEAR} ` +
        `order by abs(net_expense_diff) desc nulls last limit ${TOP_CHANGES}`,
    );
    changesByMinistry[ministry.id] = changeRows.map((r) => {
      const year = readNumber(r.year);
      return {
        year,
        date: readText(r.date),
        reqTitle: readText(r.req_title),
        changeTypeName: readText(r.change_type_name),
        netExpenseDiff: readNumber(r.net_expense_diff),
        transactionId: readText(r.transaction_id),
        explanation: (readText(r.explanation) ?? '').replace(/\s+/g, ' ').slice(0, 600),
        sourceUrl:
          year !== null
            ? `https://next.obudget.org/i/budget/${section}/${year}`
            : `https://next.obudget.org/i/budget/${section}/2025`,
      };
    });
  }

  const output = {
    generatedAt: COLLECTED_AT,
    fromYear: FROM_YEAR,
    method:
      'הנתונים ממפתח התקציב — מראה ציבורית של דוחות ההתקשרויות של החשב הכללי, מסד התמיכות והעברות התקציב שאושרו בוועדת הכספים. זו שכבת עזר: כל שורה מקושרת חזרה לאימות, ואף נתון אינו מסומן כסופי. שמות הספקים והמקבלים הם רשומות תאגידיות פומביות (חברות, עמותות, רשויות).',
    volumeNote:
      'היקף התקשרות (volume) הוא הסכום הרב-שנתי המחויב של ההסכם, לא הוצאה שנתית. "שולם" (executed) הוא התשלום המצטבר עד מועד העדכון. רשומות שהיקפן חורג מתקרת שפיות מוצהרת (פי 1.5 מהתקציב השנתי המרבי של התוכנית) הוצאו מהדירוגים ומוצגות בנפרד כחשודות כשגויות במקור.',
    suppliers: suppliersByMinistry,
    contractTotals,
    excludedContracts,
    procurementMethods: methodsByMinistry,
    notableContracts: contractsByMinistry,
    supportRecipients: recipientsByMinistry,
    budgetChanges: changesByMinistry,
  };

  writeJson(path.join(PROCESSED_DIR, 'findings.json'), output);

  const supplierCsvRows: unknown[][] = [];
  for (const [ministryId, rows] of Object.entries(suppliersByMinistry)) {
    for (const s of rows as Array<Record<string, unknown>>) {
      supplierCsvRows.push([
        ministryId,
        s.name,
        s.entityKind,
        s.contractCount,
        s.totalVolume,
        s.totalExecuted,
        s.entityUrl,
      ]);
    }
  }
  writeText(
    path.join(PROCESSED_DIR, 'csv', 'top-suppliers.csv'),
    toCsv(
      ['משרד', 'ספק', 'סוג ישות', 'מספר התקשרויות', 'היקף רב-שנתי', 'שולם עד כה', 'קישור'],
      supplierCsvRows,
    ),
  );

  logger.flush('איסוף שכבת הממצאים בוצע מול המקור בפועל.');
  for (const ministry of seed.ministries) {
    console.log(
      `  ${ministry.id}: ${(suppliersByMinistry[ministry.id] ?? []).length} ספקים · ` +
        `${(recipientsByMinistry[ministry.id] ?? []).length} מקבלי תמיכות · ` +
        `${(changesByMinistry[ministry.id] ?? []).length} העברות`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
