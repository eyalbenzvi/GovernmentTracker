/**
 * Paged access to the Budget Key query API.
 *
 * The API caps every response at 1,000 rows and exposes `page`/`pages`/`total`.
 * Ignoring that cap silently truncates result sets — an earlier build scanned
 * only 3,299 of 4,226 regulations because of exactly this — so every collector
 * that can exceed one page must go through queryAllPages, which follows the
 * pagination to the end and *fails loudly* if the total row count does not
 * match what the API declared.
 */
import { politeFetch } from './http.js';
import type { Logger } from './log.js';

const MAX_PAGES = 60;

export async function queryAllPages(
  logger: Logger,
  purpose: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let declaredTotal: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `https://next.obudget.org/api/query?query=${encodeURIComponent(sql)}` +
      (page > 0 ? `&page=${page}` : '');
    const result = await politeFetch(url, { purpose: `${purpose} (page ${page})`, logger });
    if (!result.ok || !result.body) {
      throw new Error(`page ${page} of "${purpose}" could not be retrieved (${result.outcome})`);
    }
    let parsed: {
      rows?: Array<Record<string, unknown>>;
      pages?: number;
      total?: number;
      success?: boolean;
    };
    try {
      parsed = JSON.parse(result.body) as typeof parsed;
    } catch (err) {
      throw new Error(`page ${page} of "${purpose}" is not valid JSON: ${String(err)}`);
    }
    if (parsed.success === false) throw new Error(`API reported failure for "${purpose}"`);

    rows.push(...(parsed.rows ?? []));
    if (typeof parsed.total === 'number') declaredTotal = parsed.total;
    const pages = typeof parsed.pages === 'number' ? parsed.pages : 1;
    if (page >= pages - 1) break;
  }

  if (declaredTotal !== null && rows.length !== declaredTotal) {
    throw new Error(
      `"${purpose}": collected ${rows.length} rows but the API declared ${declaredTotal} — refusing to continue with a silently truncated set`,
    );
  }
  return rows;
}
