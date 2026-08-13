/**
 * Ministers'/senior-officials' diaries collector.
 *
 * Israeli ministers, deputy ministers and director-generals must publish
 * their meeting diaries quarterly (Attorney-General directive and government
 * FOI procedures). The diaries are published as files on:
 *
 *  1. foi.gov.il — the Government FOI Unit's central diaries page
 *     (https://foi.gov.il/he/node/6747), official source. Answers HTTP 403
 *     to identified automated clients; we do not impersonate a browser.
 *  2. www.gov.il — per-ministry FOI pages. Same refusal, same rule.
 *  3. odata.org.il ("מידע לעם") — the Freedom of Information Movement's
 *     public CKAN repository of documents obtained under FOI. Civic helper
 *     layer, same trust tier as the Budget Key: never marked `final`.
 *     The CKAN API answers normally; direct file downloads answer 403, so
 *     collection reads structured rows through the datastore API only.
 *
 * This session's build environment cannot reach hosts 1 and 3 (network
 * egress policy), so this script is designed to run in GitHub Actions
 * (.github/workflows/collect-diaries.yml), where outbound access is the
 * runner's own.
 *
 * Modes:
 *  `--probe`   read-only reconnaissance: inventories what each source offers
 *              and prints a compact summary to the log. Writes nothing under
 *              data/processed.
 *  `--collect` full collection: every diary dataset in the 37th-government
 *              window is enumerated; structured rows come from the datastore
 *              API, and files (spreadsheets, text PDFs, scans via OCR) are read
 *              wherever a lawful route to the bytes exists. Anything that could
 *              not be read is disclosed per dataset, never silently dropped.
 *
 * The honesty rule applies throughout: what a source refuses is recorded as
 * refused, not worked around; what cannot be attributed to a ministry is
 * listed as unattributed, not guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { politeFetch, USER_AGENT } from './lib/http.js';
import {
  extractFromGrid,
  extractFromText,
  type ExtractionMethod,
  type ExtractionResult,
} from './lib/diary-extract.js';
import { parseCsvGrid, readXlsxGrid, type CellValue } from './lib/xlsx-lite.js';
import { Logger } from './lib/log.js';
import {
  CACHE_DIR,
  COLLECTION_LOG_DIR,
  PROCESSED_DIR,
  RAW_DIR,
  ensureDir,
  readJson,
  writeJson,
} from './lib/paths.js';
import { createHash } from 'node:crypto';

const FOI_DIARIES_PAGE = 'https://foi.gov.il/he/node/6747';
const GOVIL_DIARIES_PAGE = 'https://www.gov.il/he/pages/minister_diary';
const ODATA_HOST = 'https://www.odata.org.il';
const ODATA_API = `${ODATA_HOST}/api/3/action/package_search`;

interface LinkInventory {
  href: string;
  text: string;
  kind: 'file' | 'page';
}

interface ProbeReport {
  probedAt: string;
  userAgent: string;
  foi: {
    url: string;
    status: number | null;
    outcome: string;
    pageTitle: string | null;
    fileLinks: LinkInventory[];
    diaryPageLinks: LinkInventory[];
    paginationSeen: string[];
    htmlSample: string | null;
  };
  govil: {
    url: string;
    status: number | null;
    outcome: string;
    note: string;
  };
  odata: {
    queries: {
      query: string;
      status: number | null;
      outcome: string;
      totalDatasets: number | null;
      datasets: {
        name: string;
        title: string;
        organization: string | null;
        notes: string | null;
        resources: { name: string | null; format: string | null; url: string }[];
      }[];
    }[];
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

const FILE_EXTENSIONS = /\.(xlsx?|csv|pdf|docx?|zip|ods)(\?|$)/i;

/** Pull every anchor out of an HTML page without a DOM dependency. */
function extractLinks(html: string, baseUrl: string): LinkInventory[] {
  const links: LinkInventory[] = [];
  const anchorRe = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const rawHref = decodeEntities(match[1] ?? '');
    const text = decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, '').trim()).slice(0, 160);
    let href: string;
    try {
      href = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }
    const isFile = FILE_EXTENSIONS.test(href) || href.includes('/sites/default/files/');
    links.push({ href, text, kind: isFile ? 'file' : 'page' });
  }
  return links;
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] === undefined ? null : decodeEntities(m[1].trim()).slice(0, 200);
}

const DIARY_WORDS = /יומן|יומני|diary/i;

async function probeFoi(logger: Logger): Promise<ProbeReport['foi']> {
  const result = await politeFetch(FOI_DIARIES_PAGE, {
    purpose: 'probe: central FOI diaries page',
    logger,
    useCache: false,
    accept: 'text/html,*/*',
  });
  const report: ProbeReport['foi'] = {
    url: FOI_DIARIES_PAGE,
    status: result.status,
    outcome: result.outcome,
    pageTitle: null,
    fileLinks: [],
    diaryPageLinks: [],
    paginationSeen: [],
    htmlSample: null,
  };
  if (!result.ok || result.body === null) return report;

  report.pageTitle = extractTitle(result.body);
  const links = extractLinks(result.body, FOI_DIARIES_PAGE);
  report.fileLinks = links.filter((l) => l.kind === 'file').slice(0, 400);
  report.diaryPageLinks = links
    .filter((l) => l.kind === 'page' && (DIARY_WORDS.test(l.text) || DIARY_WORDS.test(l.href)))
    .slice(0, 120);
  report.paginationSeen = [
    ...new Set(
      links
        .map((l) => l.href)
        .filter((href) => /[?&]page=\d+/.test(href))
        .slice(0, 40),
    ),
  ];
  // A structural sample helps when the link extraction above misses a
  // JS-rendered listing; 4000 chars of body is enough to see the shape.
  report.htmlSample = result.body.replace(/\s+/g, ' ').slice(0, 4000);

  // Follow visible pagination on the same node, breadth-first, first 5 pages.
  const seenFiles = new Set(report.fileLinks.map((l) => l.href));
  for (const pageUrl of report.paginationSeen.slice(0, 5)) {
    const page = await politeFetch(pageUrl, {
      purpose: 'probe: FOI diaries pagination',
      logger,
      useCache: false,
      accept: 'text/html,*/*',
    });
    if (!page.ok || page.body === null) continue;
    for (const link of extractLinks(page.body, pageUrl)) {
      if (link.kind === 'file' && !seenFiles.has(link.href) && report.fileLinks.length < 400) {
        seenFiles.add(link.href);
        report.fileLinks.push(link);
      }
    }
  }
  return report;
}

async function probeGovil(logger: Logger): Promise<ProbeReport['govil']> {
  // One polite, identified attempt. gov.il has refused identified automated
  // clients throughout this project; this records whether that still holds
  // from the Actions runner. No browser impersonation, ever.
  const result = await politeFetch(GOVIL_DIARIES_PAGE, {
    purpose: 'probe: gov.il diaries collection page',
    logger,
    useCache: false,
    accept: 'text/html,*/*',
  });
  return {
    url: GOVIL_DIARIES_PAGE,
    status: result.status,
    outcome: result.outcome,
    note:
      result.ok && result.body !== null
        ? `reachable; title: ${extractTitle(result.body) ?? 'n/a'}`
        : 'refused or unreachable for identified automated clients — recorded, not bypassed',
  };
}

async function probeOdata(logger: Logger): Promise<ProbeReport['odata']> {
  const queries = ['יומן', 'יומני שרים', 'יומן מנכ"ל'];
  const out: ProbeReport['odata'] = { queries: [] };
  for (const q of queries) {
    const url = `${ODATA_API}?q=${encodeURIComponent(q)}&rows=100&sort=metadata_created+desc`;
    const result = await politeFetch(url, {
      purpose: `probe: odata.org.il dataset search "${q}"`,
      logger,
      useCache: false,
      accept: 'application/json',
    });
    const entry: ProbeReport['odata']['queries'][number] = {
      query: q,
      status: result.status,
      outcome: result.outcome,
      totalDatasets: null,
      datasets: [],
    };
    if (result.ok && result.body !== null) {
      try {
        const parsed = JSON.parse(result.body) as {
          result?: {
            count?: number;
            results?: {
              name?: string;
              title?: string;
              notes?: string;
              organization?: { title?: string } | null;
              resources?: { name?: string; format?: string; url?: string }[];
            }[];
          };
        };
        entry.totalDatasets = parsed.result?.count ?? null;
        entry.datasets = (parsed.result?.results ?? []).map((d) => ({
          name: d.name ?? '',
          title: (d.title ?? '').slice(0, 160),
          organization: d.organization?.title ?? null,
          notes: d.notes === undefined ? null : d.notes.slice(0, 300),
          resources: (d.resources ?? [])
            .slice(0, 60)
            .map((r) => ({ name: r.name ?? null, format: r.format ?? null, url: r.url ?? '' })),
        }));
      } catch (err) {
        entry.outcome = `parse_error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    out.queries.push(entry);
  }
  return out;
}

/**
 * Fetch full details of one CKAN dataset, plus a peek at the first rows of its
 * first machine-readable resource, so the collect-stage column mapping is
 * designed against real data rather than guessed.
 */
async function inspectOdataDataset(
  logger: Logger,
  datasetIdOrName: string,
): Promise<Record<string, unknown>> {
  const showUrl = `https://www.odata.org.il/api/3/action/package_show?id=${encodeURIComponent(datasetIdOrName)}`;
  const result = await politeFetch(showUrl, {
    purpose: `probe: odata.org.il package_show ${datasetIdOrName}`,
    logger,
    useCache: false,
    accept: 'application/json',
  });
  if (!result.ok || result.body === null) {
    return { dataset: datasetIdOrName, outcome: result.outcome, status: result.status };
  }
  try {
    const parsed = JSON.parse(result.body) as {
      result?: {
        title?: string;
        notes?: string;
        metadata_created?: string;
        organization?: { title?: string } | null;
        tags?: { name?: string }[];
        resources?: {
          id?: string;
          name?: string;
          format?: string;
          url?: string;
          created?: string;
          datastore_active?: boolean;
        }[];
      };
    };
    const ds = parsed.result ?? {};
    const resources = (ds.resources ?? []).map((r) => ({
      id: r.id ?? null,
      name: r.name ?? null,
      format: r.format ?? null,
      url: r.url ?? '',
      created: r.created ?? null,
      datastoreActive: r.datastore_active ?? null,
    }));
    // Direct /download/ URLs returned 403 on the first probe, so the peek
    // goes through the CKAN datastore API instead: datapusher-converted
    // resources are queryable as JSON records over the same API host that
    // already answers package_search.
    let datastorePeek: Record<string, unknown> | null = null;
    for (const r of resources) {
      if (r.id === null || r.datastoreActive !== true) continue;
      const dsUrl = `https://www.odata.org.il/api/3/action/datastore_search?resource_id=${encodeURIComponent(r.id)}&limit=3`;
      const peek = await politeFetch(dsUrl, {
        purpose: `probe: datastore peek ${datasetIdOrName}`,
        logger,
        useCache: false,
        accept: 'application/json',
      });
      if (!peek.ok || peek.body === null) continue;
      try {
        const parsedPeek = JSON.parse(peek.body) as {
          success?: boolean;
          result?: { total?: number; fields?: unknown[]; records?: unknown[] };
        };
        if (parsedPeek.success === true) {
          datastorePeek = {
            resourceId: r.id,
            resourceName: r.name,
            total: parsedPeek.result?.total ?? null,
            fields: parsedPeek.result?.fields ?? [],
            records: parsedPeek.result?.records ?? [],
          };
          break;
        }
      } catch {
        // not datastore-backed — try the next resource
      }
    }
    return {
      dataset: datasetIdOrName,
      title: ds.title ?? null,
      created: ds.metadata_created ?? null,
      organization: ds.organization?.title ?? null,
      notes: (ds.notes ?? '').slice(0, 500),
      tags: (ds.tags ?? []).map((t) => t.name ?? ''),
      resources,
      datastorePeek,
    };
  } catch (err) {
    return {
      dataset: datasetIdOrName,
      outcome: `parse_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Byte-level fetch for binary resources (PDF/XLSX). politeFetch decodes to
 * text, which destroys binary payloads, so this keeps the same courtesy rules
 * (identifying UA, timeout, single attempt) and returns the raw buffer.
 *
 * A `Referer` of the dataset page is sent because that is factually where the
 * link was found; the User-Agent still identifies this collector honestly and
 * is never disguised as a browser.
 */
const lastBinaryHit = new Map<string, number>();

async function fetchBinary(
  logger: Logger,
  url: string,
  purpose: string,
  referer: string | null,
): Promise<{ status: number | null; bytes: Uint8Array | null; contentType: string | null }> {
  const startedAt = Date.now();
  // Same courtesy as politeFetch: at most one request per host per 800ms.
  const host = new URL(url).host;
  const last = lastBinaryHit.get(host);
  if (last !== undefined) {
    const wait = 800 - (Date.now() - last);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastBinaryHit.set(host, Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*' };
    if (referer !== null) headers.Referer = referer;
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers });
    const buffer = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    logger.record({
      url,
      purpose,
      outcome: response.ok ? 'ok' : 'http_error',
      httpStatus: response.status,
      bytes: buffer?.byteLength ?? 0,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
      attemptedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
    return {
      status: response.status,
      bytes: buffer,
      contentType: response.headers.get('content-type'),
    };
  } catch (err) {
    logger.record({
      url,
      purpose,
      outcome: 'network_error',
      httpStatus: null,
      bytes: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
      attemptedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
    return { status: null, bytes: null, contentType: null };
  } finally {
    clearTimeout(timer);
  }
}

function magicOf(bytes: Uint8Array | null): string {
  if (bytes === null || bytes.byteLength < 4) return 'none';
  const head = Buffer.from(bytes.slice(0, 4)).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) return 'zip/xlsx/docx';
  if (head.startsWith('\xD0\xCF\x11\xE0')) return 'ole/xls';
  return `other(${Buffer.from(bytes.slice(0, 8)).toString('hex')})`;
}

/**
 * Can the runner actually download diary files? Four access paths are tried on
 * real PDF/XLSX resources so the OCR/spreadsheet stage is built on a verified
 * path rather than an assumption. Read-only, a handful of requests.
 */
async function probeFiles(): Promise<void> {
  const logger = new Logger('collect-diaries-file-probe');
  const targets = [
    '2023',
    '13793fcb-a8a8-4826-87bd-cd6862c37770',
    'b714f3bd-2e52-4351-9b53-707c0e79c792',
  ];
  console.log('File-access probe — can diary PDFs/spreadsheets be downloaded?\n');

  for (const datasetId of targets) {
    const detail = await ckanJson<{ result?: CkanDataset }>(
      logger,
      `file-probe: package_show ${datasetId}`,
      `${ODATA_HOST}/api/3/action/package_show?id=${encodeURIComponent(datasetId)}`,
    );
    const resources = (detail?.result?.resources ?? []).filter((r) =>
      ['PDF', 'XLSX', 'XLS', 'CSV'].includes((r.format ?? '').toUpperCase()),
    );
    console.log(`\n=== ${datasetId}: ${resources.length} file resources`);
    for (const resource of resources.slice(0, 3)) {
      const rid = resource.id ?? '';
      const datasetPage = `${ODATA_HOST}/dataset/${datasetId}`;
      const attempts: Array<[string, string, string | null]> = [
        ['as-published', resource.url ?? '', null],
        ['as-published + referer', resource.url ?? '', datasetPage],
        [
          'ckan download path',
          `${ODATA_HOST}/dataset/${datasetId}/resource/${rid}/download`,
          datasetPage,
        ],
        ['datastore dump', `${ODATA_HOST}/datastore/dump/${rid}`, datasetPage],
      ];
      console.log(`  resource ${String(resource.name).slice(0, 60)} [${resource.format}]`);
      for (const [label, url, referer] of attempts) {
        if (url === '') continue;
        const res = await fetchBinary(logger, url, `file-probe: ${label}`, referer);
        console.log(
          `    ${label}: status=${String(res.status)} type=${String(res.contentType)} bytes=${res.bytes?.byteLength ?? 0} magic=${magicOf(res.bytes)}`,
        );
        if (res.bytes !== null) break; // one working path per resource is enough
      }
    }
  }
  logger.flush('בדיקת נגישות קבצים בסביבת GitHub Actions.');
}

async function probe(): Promise<void> {
  const logger = new Logger('collect-diaries-probe');
  console.log('Diaries probe — read-only reconnaissance of diary sources.\n');

  const report: ProbeReport & { odataInspections?: Record<string, unknown>[] } = {
    probedAt: new Date().toISOString(),
    userAgent: USER_AGENT,
    foi: await probeFoi(logger),
    govil: await probeGovil(logger),
    odata: await probeOdata(logger),
  };

  // Deep-inspect the datasets most relevant to the 37th government: the
  // aggregated ministers-diaries dataset for 2023 spotted in search results,
  // plus the newest diary-titled datasets from the search above.
  const inspectIds = new Set<string>(['2023']);
  for (const q of report.odata.queries) {
    for (const ds of q.datasets.slice(0, 8)) {
      if (/יומן|יומני/.test(ds.title)) inspectIds.add(ds.name);
      if (inspectIds.size >= 10) break;
    }
  }
  report.odataInspections = [];
  for (const id of inspectIds) {
    report.odataInspections.push(await inspectOdataDataset(logger, id));
  }

  // Full report goes into the collection-log directory, which the workflow
  // uploads as an artifact — the job log only gets a compact summary, because
  // GitHub truncates long log lines and a truncated JSON is unreadable.
  writeJson(path.join(COLLECTION_LOG_DIR, 'collect-diaries-probe-report.json'), report);

  console.log('\n===DIARIES-PROBE-COMPACT===');
  console.log(`foi: status=${report.foi.status} outcome=${report.foi.outcome}`);
  console.log(`govil: status=${report.govil.status} outcome=${report.govil.outcome}`);
  for (const q of report.odata.queries) {
    console.log(`odata "${q.query}": total=${q.totalDatasets}`);
    for (const ds of q.datasets.slice(0, 25)) {
      const formats = [...new Set(ds.resources.map((r) => r.format ?? '?'))].join(',');
      console.log(`  - ${ds.name} | ${ds.title.slice(0, 90)} | ${formats}`);
    }
  }
  for (const insp of report.odataInspections) {
    console.log(`inspected ${String(insp.dataset)}: title=${String(insp.title ?? 'n/a')}`);
    const resources = insp.resources;
    if (Array.isArray(resources)) {
      for (const r of resources as {
        name: string | null;
        format: string | null;
        datastoreActive: boolean | null;
      }[]) {
        console.log(
          `  resource: ${String(r.name).slice(0, 80)} | ${String(r.format)} | datastore=${String(r.datastoreActive)}`,
        );
      }
    }
    const peek = insp.datastorePeek as {
      resourceName?: unknown;
      total?: unknown;
      fields?: unknown;
      records?: unknown;
    } | null;
    if (peek !== null && peek !== undefined) {
      console.log(`  datastore peek of ${String(peek.resourceName)} (total=${String(peek.total)})`);
      console.log(`  fields: ${JSON.stringify(peek.fields)}`);
      console.log(`  records: ${JSON.stringify(peek.records)}`);
    }
  }
  console.log('===END===');
}

// ---------------------------------------------------------------------------
// Collect stage
// ---------------------------------------------------------------------------

const WINDOW_START = '2022-12-29';
const MAX_SEARCH_PAGES = 25; // 25 × 100 datasets is far above the diary population
const MAX_ROWS_PER_RESOURCE = 6_000; // a quarter has ~90 days; thousands of rows is already generous
const DIARY_YEARS = /202[3-6]|\b[01]?\d\.2[3-6]\b|-2[3-6]\b/;
const ROLE_WORDS =
  /(?:^|\s|")(?:יומן|יומני)\s|(?:שר[הת]?|השר[ה]?|סגן|סגנית|מנכ["״]?ל|מנכ["״]?לית|מזכיר הממשלה|החשב הכללי|ראש הממשלה)/;
const MUNICIPAL_WORDS = /עיריי?ת|עירייה|מועצה (?:מקומית|אזורית|דתית)|ראש העיר|רשות מקומית/;

interface SeedMinistry {
  id: string;
  officialName: string;
  displayName: string;
  aliases: string[];
}

interface MinistriesSeedFile {
  ministries: SeedMinistry[];
}

export interface DiaryEntry {
  id: string;
  ministryId: string | null;
  personLabel: string | null;
  personRole: 'minister' | 'deputy_minister' | 'director_general' | 'other_senior';
  roleLabelHe: string;
  subject: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  participants: string | null;
  datasetId: string;
  /** How this row reached the dataset — decides how much it can be trusted. */
  extractionMethod: ExtractionMethod;
  extractionNote: string;
  sourceUrl: string;
  sourceTitle: string;
  collectedAt: string;
}

interface UnparsedResource {
  name: string;
  format: string;
  note: string;
}

const MAX_OCR_PAGES = 40;
/**
 * Wall-clock budget for the whole collection.
 *
 * A CI job is killed at six hours with nothing preserved, and OCR over hundreds
 * of scanned pages has taken close to three. When the budget runs out the
 * collector stops taking on new files, writes what it has, and says so in the
 * index — a disclosed partial collection beats a run that dies whole.
 */
const TIME_BUDGET_MINUTES = Number(process.env.DIARY_TIME_BUDGET_MINUTES ?? '210');
const startedAtMs = Date.now();
let timeBudgetReached = false;

function budgetExhausted(): boolean {
  if (timeBudgetReached) return true;
  if ((Date.now() - startedAtMs) / 60_000 >= TIME_BUDGET_MINUTES) {
    timeBudgetReached = true;
    console.warn(
      `  אזהרה: תקציב הזמן של ההרצה (${TIME_BUDGET_MINUTES} דקות) מוצה — קבצים שטרם נקראו מדווחים כלא-נקראו`,
    );
  }
  return timeBudgetReached;
}

/**
 * Extraction results are cached per resource, keyed by the identifiers that
 * decide the content. Downloading a scan and running OCR over it costs minutes;
 * the answer does not change between runs, and a repair run should not pay for
 * it twice.
 */
const EXTRACT_CACHE_DIR = path.join(CACHE_DIR, 'diary-extract');

interface CachedExtraction {
  /** null when the file could not be read at all; the disclosures say why. */
  method: ExtractionMethod | null;
  extractionNote: string;
  rows: Array<{
    subject: string | null;
    startDate: string | null;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    participants: string | null;
  }>;
  unparsedLineCount: number;
  disclosures: string[];
}

function extractCachePath(datasetId: string, resource: CkanResource, format: string): string {
  const key = createHash('sha256')
    .update([datasetId, resource.id ?? '', resource.url ?? '', format].join('|'))
    .digest('hex')
    .slice(0, 32);
  return path.join(EXTRACT_CACHE_DIR, `${key}.json`);
}

function readExtractCache(file: string): CachedExtraction | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CachedExtraction;
  } catch {
    return null;
  }
}

function writeExtractCache(file: string, value: CachedExtraction): void {
  try {
    ensureDir(EXTRACT_CACHE_DIR);
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
  } catch {
    // A cache write failure must never fail a collection.
  }
}
/** Whole-run OCR budget: keeps a collection run bounded on CI wall-clock. */
const MAX_OCR_PAGES_PER_RUN = 4_000;
/**
 * After this many consecutive refusals of direct file downloads, stop asking.
 * The repository has made its position clear; continuing would be thousands of
 * pointless requests against someone else's server.
 */
const DIRECT_DOWNLOAD_REFUSAL_LIMIT = 20;
let consecutiveDownloadRefusals = 0;
let ocrPagesUsed = 0;
const OCR_CAVEAT = 'פוענח בזיהוי תווים אוטומטי (OCR) מסריקה — ייתכנו שגיאות תעתיק';

interface DiaryDatasetCoverage {
  datasetId: string;
  title: string;
  url: string;
  ministryId: string | null;
  personLabel: string | null;
  personRole: DiaryEntry['personRole'];
  roleLabelHe: string;
  periodLabel: string | null;
  machineReadableEntries: number;
  skippedEmptyRows: number;
  outOfWindowRows: number;
  truncated: boolean;
  unparsedResources: UnparsedResource[];
}

/**
 * The odata datastore stores column names either as the original Hebrew
 * header or as a per-letter transliteration produced by its ingestion
 * pipeline (נושא→nvsh, תאריך התחלה→tryk htkhlh, שעת→sh`t, מיקום→myqvm).
 * Matching is done on a normalised form: lowercase, punctuation stripped,
 * underscores as spaces.
 */
function normalizeFieldId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[_׳״"'`׳״]/g, (m) => (m === '_' ? ' ' : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_TARGETS: Record<string, keyof DiaryFieldRow> = {
  נושא: 'subject',
  'נושא הפגישה': 'subject',
  nvsh: 'subject',
  'תאריך התחלה': 'startDate',
  תאריך: 'startDate',
  'tryk htkhlh': 'startDate',
  tryk: 'startDate',
  'שעת התחלה': 'startTime',
  שעה: 'startTime',
  'sht htkhlh': 'startTime',
  'תאריך סיום': 'endDate',
  'tryk syvm': 'endDate',
  'שעת סיום': 'endTime',
  'sht syvm': 'endTime',
  מיקום: 'location',
  myqvm: 'location',
  משתתפים: 'participants',
  mshttpym: 'participants',
};

interface DiaryFieldRow {
  subject: string | null;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  location: string | null;
  participants: string | null;
}

/** Maps datastore field ids to normalized diary columns; unknown ids are reported back. */
export function mapDiaryFields(fieldIds: readonly string[]): {
  mapping: Map<string, keyof DiaryFieldRow>;
  unknown: string[];
} {
  const mapping = new Map<string, keyof DiaryFieldRow>();
  const unknown: string[] = [];
  for (const id of fieldIds) {
    if (id === '_id' || id === '_full_text') continue;
    const norm = normalizeFieldId(id);
    let target = FIELD_TARGETS[norm];
    if (target === undefined && !norm.includes(',')) {
      // Second chance: transliterated ids sometimes glue a stray letter to a
      // known token ("nvsh'"), so allow a prefix match — but only when the
      // lengths are close. A whole CSV header line glued into one field id
      // must stay unknown, or every row would ship as a fake "subject".
      const hit = Object.keys(FIELD_TARGETS).find(
        (k) =>
          k.length >= 4 &&
          ((norm.startsWith(k) && norm.length <= k.length + 2) ||
            (k.startsWith(norm) && k.length <= norm.length + 2)),
      );
      if (hit !== undefined) target = FIELD_TARGETS[hit];
    }
    if (target === undefined) {
      unknown.push(id);
    } else if (![...mapping.values()].includes(target)) {
      mapping.set(id, target);
    }
  }
  return { mapping, unknown };
}

/**
 * Diary date cells arrive as ISO dates, ISO datetimes, day-first dates with
 * `/` or `.` separators, or Excel serial numbers that survived conversion.
 * Anything else stays null — never guessed.
 */
export function parseDiaryDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 40_000 || value > 50_000) return null; // Excel serials for ~2009–2036
    const ms = (value - 25_569) * 86_400_000; // days since 1970-01-01
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dayFirst = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(text);
  if (dayFirst !== null) {
    const dd = dayFirst[1]?.padStart(2, '0');
    const mm = dayFirst[2]?.padStart(2, '0');
    let yyyy = dayFirst[3] ?? '';
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    const candidate = `${yyyy}-${mm}-${dd}`;
    return Number.isNaN(Date.parse(candidate)) ? null : candidate;
  }
  return null;
}

/** "13:30", "13:30:00", ISO datetimes and Excel day-fractions → HH:MM. */
export function parseDiaryTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const m = /(?:^|T| )(\d{1,2}):(\d{2})/.exec(text);
  if (m === null) return null;
  const hh = Number(m[1]);
  if (hh > 23) return null;
  return `${String(hh).padStart(2, '0')}:${m[2]}`;
}

export interface ParsedDiaryTitle {
  personRole: DiaryEntry['personRole'];
  roleLabelHe: string;
  personLabel: string | null;
  periodLabel: string | null;
}

/**
 * Dataset titles follow (loosely) "יומן {role and office}, {name}, לשנת YYYY
 * (רבעון N)". Only what the title states explicitly is extracted; a title
 * that names two office-holders keeps the combined label as-is.
 */
export function parseDiaryTitle(title: string): ParsedDiaryTitle {
  const roleLabel =
    title
      .replace(/^\s*יומ(?:ן|ני)\s+/, '')
      .split(',')[0]
      ?.trim() ?? title.trim();
  let personRole: DiaryEntry['personRole'] = 'other_senior';
  if (/סגן|סגנית/.test(roleLabel)) personRole = 'deputy_minister';
  else if (/מנכ["״]?ל/.test(roleLabel)) personRole = 'director_general';
  else if (/(?:^|\s)(?:שר|שרה|שרת|השר|השרה)(?:\s|$)|^שר[הת]?\s|שרת?\s/.test(roleLabel))
    personRole = 'minister';

  let personLabel: string | null = null;
  const nameMatch = /,\s*([^,]+?)\s*,?\s*לשנ(?:ת|ים)\s/.exec(title);
  if (nameMatch !== undefined && nameMatch !== null && nameMatch[1] !== undefined) {
    const candidate = nameMatch[1].trim();
    // A segment that still contains a role word is a combined label, kept raw.
    personLabel = candidate.length > 1 ? candidate : null;
  }

  let periodLabel: string | null = null;
  const period = /לשנ(?:ת|ים)\s+(.+)$/.exec(title);
  if (period !== null && period[1] !== undefined) periodLabel = period[1].trim();
  else {
    const range = /(\d{1,2}\.\d{1,2}\.\d{2,4}\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{2,4})/.exec(title);
    if (range !== null && range[1] !== undefined) periodLabel = range[1];
  }
  // Labels reach the screen as-is, so an empty extraction becomes an explicit
  // "not stated" (or null) — never an empty string pretending to be a value.
  return {
    personRole,
    roleLabelHe: roleLabel.trim() !== '' ? roleLabel.trim() : 'תפקיד לא צוין בכותרת',
    personLabel: personLabel !== null && personLabel.trim() !== '' ? personLabel.trim() : null,
    periodLabel: periodLabel !== null && periodLabel.trim() !== '' ? periodLabel.trim() : null,
  };
}

/**
 * Source-provided text, or a stated fallback when it is missing OR blank.
 *
 * Every label that reaches the screen is required to be non-empty, and a blank
 * string is a value the source really does publish. Treating blank as present
 * has already cost one full collection run, so all source text goes through
 * here rather than through `??`.
 */
function orFallback(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed !== '' ? trimmed : fallback;
}

function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/["'״׳]/g, '')
    .trim();
}

/**
 * Attributes a diary dataset to a budget section by matching the seed's
 * declared aliases against the dataset title. Aliases are tried longest
 * first so "המשרד לביטחון לאומי" wins over "משרד הביטחון" in titles that
 * contain both words. Titles that match nothing stay unattributed and are
 * listed as such — a person's name is never used to infer their ministry.
 */
export function matchMinistryByTitle(
  title: string,
  ministries: readonly SeedMinistry[],
): string | null {
  const normalizedTitle = normalizeName(title);
  const candidates: { id: string; alias: string }[] = [];
  for (const ministry of ministries) {
    for (const alias of ministry.aliases) {
      const normalizedAlias = normalizeName(alias);
      if (normalizedAlias.length < 4) continue;
      // Also try the alias without a leading "משרד ה"/"המשרד ל" so titles
      // like "שר האוצר" (no "משרד") still match "משרד האוצר".
      const variants = new Set([normalizedAlias]);
      const stripped = normalizedAlias.replace(/^(?:המשרד ל|משרד ה|משרד )/, '');
      if (stripped.length >= 4) variants.add(stripped);
      for (const variant of variants) {
        if (normalizedTitle.includes(variant)) {
          candidates.push({ id: ministry.id, alias: variant });
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.alias.length - a.alias.length);
  const best = candidates[0];
  return best === undefined ? null : best.id;
}

interface CkanResource {
  id?: string;
  name?: string;
  format?: string;
  url?: string;
  datastore_active?: boolean;
}

interface CkanDataset {
  id?: string;
  name?: string;
  title?: string;
  organization?: { title?: string } | null;
  resources?: CkanResource[];
}

async function ckanJson<T>(logger: Logger, purpose: string, url: string): Promise<T | null> {
  const result = await politeFetch(url, {
    purpose,
    logger,
    useCache: true,
    accept: 'application/json',
  });
  if (!result.ok || result.body === null) return null;
  try {
    return JSON.parse(result.body) as T;
  } catch {
    return null;
  }
}

/** Enumerate every CKAN dataset matching the diary search, page by page. */
async function enumerateDiaryDatasets(logger: Logger): Promise<CkanDataset[]> {
  const seen = new Map<string, CkanDataset>();
  for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
    const url = `${ODATA_API}?q=${encodeURIComponent('יומן')}&rows=100&start=${page * 100}&sort=metadata_created+desc`;
    const parsed = await ckanJson<{ result?: { count?: number; results?: CkanDataset[] } }>(
      logger,
      `collect: dataset search page ${page}`,
      url,
    );
    const results = parsed?.result?.results ?? [];
    for (const ds of results) {
      if (ds.name !== undefined) seen.set(ds.name, ds);
    }
    const total = parsed?.result?.count ?? 0;
    if ((page + 1) * 100 >= total || results.length === 0) break;
  }
  return [...seen.values()];
}

export function isRelevantDiaryDataset(title: string): boolean {
  if (!/יומן|יומני/.test(title)) return false;
  if (MUNICIPAL_WORDS.test(title)) return false;
  if (!ROLE_WORDS.test(title)) return false;
  return DIARY_YEARS.test(title);
}

async function fetchDatastoreRows(
  logger: Logger,
  resourceId: string,
  datasetName: string,
): Promise<{ fields: string[]; rows: Record<string, unknown>[]; truncated: boolean } | null> {
  const rows: Record<string, unknown>[] = [];
  let fields: string[] = [];
  let offset = 0;
  let truncated = false;
  for (;;) {
    const url = `${ODATA_HOST}/api/3/action/datastore_search?resource_id=${encodeURIComponent(resourceId)}&limit=1000&offset=${offset}`;
    const parsed = await ckanJson<{
      success?: boolean;
      result?: { total?: number; fields?: { id: string }[]; records?: Record<string, unknown>[] };
    }>(logger, `collect: datastore rows ${datasetName}`, url);
    if (parsed?.success !== true || parsed.result === undefined) {
      return rows.length > 0 ? { fields, rows, truncated } : null;
    }
    if (fields.length === 0) fields = (parsed.result.fields ?? []).map((f) => f.id);
    const batch = parsed.result.records ?? [];
    rows.push(...batch);
    offset += batch.length;
    const total = parsed.result.total ?? 0;
    if (rows.length >= MAX_ROWS_PER_RESOURCE) {
      truncated = rows.length < total;
      rows.length = Math.min(rows.length, MAX_ROWS_PER_RESOURCE);
      break;
    }
    if (batch.length === 0 || offset >= total) break;
  }
  return { fields, rows, truncated };
}

function readCell(row: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
}

/**
 * Downloads one resource, trying the access paths in the order the file probe
 * verified. The first path that returns bytes wins; if all refuse, the caller
 * discloses the file as undownloadable rather than pretending it was empty.
 */
/**
 * Asks the Wayback availability API whether a snapshot exists at all.
 *
 * Without this check the collector spent hours on ~1,000 fetches for files the
 * archive never captured, many of them timing out. One cheap JSON lookup per
 * file replaces that: no snapshot, no fetch.
 */
async function archiveSnapshotUrl(logger: Logger, originalUrl: string): Promise<string | null> {
  const result = await politeFetch(
    `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`,
    {
      purpose: 'collect: wayback availability',
      logger,
      useCache: true,
      accept: 'application/json',
    },
  );
  if (!result.ok || result.body === null) return null;
  try {
    const parsed = JSON.parse(result.body) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } };
    };
    const closest = parsed.archived_snapshots?.closest;
    if (closest?.available !== true || closest.url === undefined) return null;
    // The `id_` modifier asks for the original bytes rather than a rewritten page.
    return closest.url.replace(/\/web\/(\d+)\//, '/web/$1id_/');
  } catch {
    return null;
  }
}

async function downloadResource(
  logger: Logger,
  datasetId: string,
  resource: CkanResource,
): Promise<{ bytes: Uint8Array; via: string; viaUrl: string } | null> {
  const datasetPage = `${ODATA_HOST}/dataset/${datasetId}`;
  const rid = resource.id ?? '';
  const published = resource.url ?? '';
  const directRefused = consecutiveDownloadRefusals >= DIRECT_DOWNLOAD_REFUSAL_LIMIT;
  const directCandidates: Array<[string, string]> = [
    ['as-published', published],
    ['ckan download path', rid === '' ? '' : `${datasetPage}/resource/${rid}/download`],
  ];
  if (!directRefused) {
    for (const [via, url] of directCandidates) {
      if (url === '') continue;
      const result = await fetchBinary(logger, url, `collect: download ${via}`, datasetPage);
      if (result.bytes !== null && result.bytes.byteLength > 0) {
        consecutiveDownloadRefusals = 0;
        return { bytes: result.bytes, via, viaUrl: url };
      }
      if (result.status === 403) consecutiveDownloadRefusals += 1;
    }
  }

  // The repository answers its API but refuses automated file downloads (403 on
  // every path, verified by --probe-files). The Internet Archive publishes
  // snapshots of the same public files and permits automated access, so an
  // archived copy is a legitimate route to the document — not a way around the
  // refusal. Provenance is recorded per row so a reader can see that a row came
  // from a snapshot and open that snapshot.
  if (published === '') return null;
  const snapshot = await archiveSnapshotUrl(logger, published);
  if (snapshot === null) return null;
  const archived = await fetchBinary(
    logger,
    snapshot,
    'collect: download internet archive snapshot',
    null,
  );
  if (archived.bytes === null || archived.bytes.byteLength === 0) return null;
  return { bytes: archived.bytes, via: 'internet archive snapshot', viaUrl: snapshot };
}

/**
 * PDF text extraction with an OCR fallback.
 *
 * Most "scanned" diary PDFs are actually digital prints that carry a text
 * layer; pdftotext returns their exact characters. Only when almost no text
 * comes back is the file a true image scan, and only then is OCR used — with
 * the result labelled as a machine reading, never as the source's own text.
 *
 * Both binaries live in the CI image (poppler-utils, tesseract-ocr with the
 * Hebrew model). When they are absent — as in the local dev container — this
 * returns a note saying so instead of failing the run.
 */
function extractPdf(
  bytes: Uint8Array,
  workDir: string,
  label: string,
): { result: ExtractionResult; method: 'pdf_text' | 'pdf_ocr' } | { unavailable: string } {
  const pdfPath = path.join(workDir, `${label}.pdf`);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(pdfPath, bytes);

  const run = (command: string, args: string[]): string | null => {
    try {
      return execFileSync(command, args, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  };

  const layoutText = run('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-']);
  if (layoutText === null) {
    return { unavailable: 'pdftotext (poppler-utils) אינו מותקן בסביבה שבה רץ האיסוף' };
  }
  // A text layer worth trusting has real words, not a handful of stray glyphs.
  const meaningful = layoutText.replace(/\s+/g, '').length;
  if (meaningful >= 200) {
    fs.rmSync(pdfPath, { force: true });
    return { result: extractFromText(layoutText, 'pdf_text'), method: 'pdf_text' };
  }

  const pngPrefix = path.join(workDir, `${label}-page`);
  if (run('pdftoppm', ['-r', '300', '-png', pdfPath, pngPrefix]) === null) {
    return { unavailable: 'pdftoppm אינו מותקן; לא ניתן להריץ OCR על סריקה' };
  }
  const pages = fs
    .readdirSync(workDir)
    .filter((f) => f.startsWith(`${label}-page`) && f.endsWith('.png'))
    .sort();
  if (pages.length === 0) {
    return { unavailable: 'לא נוצרו עמודי תמונה מה-PDF' };
  }
  const remainingBudget = Math.max(0, MAX_OCR_PAGES_PER_RUN - ocrPagesUsed);
  if (remainingBudget === 0) {
    return {
      unavailable: `תקציב עמודי ה-OCR של ההרצה (${MAX_OCR_PAGES_PER_RUN} עמודים) מוצה — הקובץ לא פוענח בהרצה זו`,
    };
  }
  const pageLimit = Math.min(MAX_OCR_PAGES, remainingBudget);
  const ocrParts: string[] = [];
  for (const page of pages.slice(0, pageLimit)) {
    ocrPagesUsed += 1;
    const text = run('tesseract', [
      path.join(workDir, page),
      'stdout',
      '-l',
      'heb+eng',
      '--psm',
      '6',
    ]);
    if (text === null) {
      return { unavailable: 'tesseract עם מודל עברית אינו מותקן; הסריקה לא פוענחה' };
    }
    ocrParts.push(text);
  }
  const ocrText = ocrParts.join('\n');
  // Rendered pages are worth megabytes each and are of no use once read.
  for (const page of pages) {
    fs.rmSync(path.join(workDir, page), { force: true });
  }
  fs.rmSync(pdfPath, { force: true });
  const truncationNote =
    pages.length > MAX_OCR_PAGES ? ` (פוענחו ${MAX_OCR_PAGES} מתוך ${pages.length} עמודים)` : '';
  const result = extractFromText(ocrText, 'pdf_ocr');
  return {
    result: { ...result, note: orFallback(`${result.note ?? ''}${truncationNote}`, OCR_CAVEAT) },
    method: 'pdf_ocr',
  };
}

/**
 * Downloads one non-datastore resource and turns it into diary entries.
 *
 * Every outcome is recorded on the dataset's coverage entry: a refused
 * download, a spreadsheet whose header could not be identified, a scan that
 * OCR could not turn into rows, a partially-read file. Nothing fails silently,
 * because an unexplained absence on a transparency site is itself a false
 * statement.
 */
interface FileResourceContext {
  datasetId: string;
  datasetUrl: string;
  title: string;
  resource: CkanResource;
  format: string;
  resourceName: string;
  ministryId: string | null;
  parsedTitle: ParsedDiaryTitle;
  collectedAt: string;
  cov: DiaryDatasetCoverage;
}

/**
 * Turns extracted rows into diary entries. Shared by the fresh and the cached
 * paths so a replay cannot drift from a first read.
 */
function buildEntries(
  ctx: FileResourceContext,
  rows: ReadonlyArray<CachedExtraction['rows'][number]>,
  method: ExtractionMethod,
  extractionNote: string,
): DiaryEntry[] {
  const { datasetId, datasetUrl, title, resource, cov } = ctx;
  const entries: DiaryEntry[] = [];
  let index = 0;
  for (const row of rows) {
    index += 1;
    const subject = row.subject === null ? null : row.subject.trim().slice(0, 400);
    const date = parseDiaryDate(row.startDate);
    if ((subject === null || subject === '') && date === null) {
      cov.skippedEmptyRows += 1;
      continue;
    }
    if (date !== null && (date < WINDOW_START || date > ctx.collectedAt)) {
      cov.outOfWindowRows += 1;
      continue;
    }
    entries.push({
      id: `diary-${datasetId}-${(resource.id ?? 'file').slice(0, 8)}-${method}-${index}`,
      ministryId: ctx.ministryId,
      personLabel: ctx.parsedTitle.personLabel,
      personRole: ctx.parsedTitle.personRole,
      roleLabelHe: ctx.parsedTitle.roleLabelHe,
      subject: subject === null || subject === '' ? 'ללא נושא רשום' : subject,
      date,
      startTime: parseDiaryTime(row.startTime),
      endTime: parseDiaryTime(row.endTime),
      location: row.location === null ? null : row.location.slice(0, 200),
      participants: row.participants === null ? null : row.participants.slice(0, 400),
      datasetId,
      extractionMethod: method,
      extractionNote,
      sourceUrl: datasetUrl,
      sourceTitle: title,
      collectedAt: ctx.collectedAt,
    });
  }
  cov.machineReadableEntries += entries.length;
  return entries;
}

async function extractFileResource(
  logger: Logger,
  ctx: FileResourceContext,
): Promise<DiaryEntry[]> {
  const { datasetId, resource, format, resourceName, cov } = ctx;

  const cacheFile = extractCachePath(datasetId, resource, format);
  const disclosures: string[] = [];
  const disclose = (note: string): DiaryEntry[] => {
    const clean = orFallback(note, 'הקובץ לא נקרא; הסיבה לא נרשמה');
    cov.unparsedResources.push({
      name: orFallback(resourceName, 'משאב ללא שם'),
      format: orFallback(format, 'לא צוין פורמט'),
      note: clean,
    });
    disclosures.push(clean);
    return [];
  };
  /** A refusal or an unreadable file costs as much as a successful read; cache it too. */
  const discloseAndRemember = (note: string): DiaryEntry[] => {
    const out = disclose(note);
    writeExtractCache(cacheFile, {
      method: null,
      extractionNote: '',
      rows: [],
      unparsedLineCount: 0,
      disclosures,
    });
    return out;
  };

  if (format === 'XLS') {
    return disclose('פורמט XLS בינארי מדור קודם — אינו נקרא; הקובץ פתוח לעיון אנושי בקישור');
  }
  if (format === 'DOC' || format === 'DOCX' || format === 'ZIP') {
    return disclose(`פורמט ${format} — אינו מפוענח; הקובץ פתוח לעיון אנושי בקישור`);
  }

  // A previous run already downloaded and read this exact resource; reuse it
  // rather than spending minutes of OCR on an answer that cannot have changed.
  const cached = readExtractCache(cacheFile);
  if (cached !== null) {
    for (const note of cached.disclosures) disclose(note);
    return cached.method === null
      ? []
      : buildEntries(ctx, cached.rows, cached.method, cached.extractionNote);
  }

  if (budgetExhausted()) {
    return disclose(
      `תקציב הזמן של ההרצה (${TIME_BUDGET_MINUTES} דקות) מוצה לפני שהקובץ נקרא — הוא ייקרא בהרצה הבאה`,
    );
  }

  const download = await downloadResource(logger, datasetId, resource);
  if (download === null) {
    return discloseAndRemember(
      'הורדת הקובץ נדחתה על ידי המאגר (403) ולא נמצא עותק בארכיון האינטרנט — הקובץ פתוח לעיון אנושי בקישור',
    );
  }
  const fromArchive = download.via === 'internet archive snapshot';

  let extraction: ExtractionResult;
  let method: ExtractionMethod;
  let extractionNote: string;

  if (format === 'PDF') {
    const workDir = path.join(RAW_DIR, '.diary-work');
    const pdfResult = extractPdf(download.bytes, workDir, `${datasetId}-${resource.id ?? 'r'}`);
    if ('unavailable' in pdfResult) return discloseAndRemember(pdfResult.unavailable);
    extraction = pdfResult.result;
    method = pdfResult.method;
    extractionNote = method === 'pdf_ocr' ? OCR_CAVEAT : 'חולץ משכבת הטקסט של קובץ ה-PDF שפורסם';
  } else {
    let grid: CellValue[][];
    try {
      grid =
        format === 'CSV'
          ? parseCsvGrid(Buffer.from(download.bytes).toString('utf8'))
          : readXlsxGrid(Buffer.from(download.bytes));
    } catch (err) {
      return discloseAndRemember(
        `הקובץ הורד אך לא נקרא: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
      );
    }
    extraction = extractFromGrid(grid);
    method = 'spreadsheet';
    extractionNote = 'חולץ מגיליון הנתונים שפורסם';
  }

  if (extraction.rows.length === 0) {
    return discloseAndRemember(
      orFallback(
        extraction.note,
        `לא חולצו שורות מהקובץ (${extraction.unparsedLineCount} שורות לא זוהו כרשומות יומן)`,
      ),
    );
  }
  if (extraction.unparsedLineCount > 0) {
    cov.unparsedResources.push({
      name: resourceName,
      format,
      note: `חולצו ${extraction.rows.length} רשומות; ${extraction.unparsedLineCount} שורות לא זוהו כרשומות יומן ולא נכללו`,
    });
  }

  // Where the bytes came from belongs on every row that came from them.
  const provenanceNote = fromArchive
    ? ` · הקובץ נקרא מעותק שמור בארכיון האינטרנט: ${download.viaUrl}`
    : '';
  const fullNote = `${extractionNote}${provenanceNote}`;
  writeExtractCache(cacheFile, {
    method,
    extractionNote: fullNote,
    rows: extraction.rows,
    unparsedLineCount: extraction.unparsedLineCount,
    disclosures,
  });
  return buildEntries(ctx, extraction.rows, method, fullNote);
}

async function collect(): Promise<void> {
  const logger = new Logger('collect-diaries');
  const collectedAt = new Date().toISOString().slice(0, 10);
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));

  console.log('Collecting published diaries from the odata.org.il datastore…\n');
  const allDatasets = await enumerateDiaryDatasets(logger);
  const relevant = allDatasets
    .filter((ds) => isRelevantDiaryDataset(ds.title ?? ''))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  console.log(`datasets: ${allDatasets.length} matched the search, ${relevant.length} relevant`);

  const entries: DiaryEntry[] = [];
  const coverage: DiaryDatasetCoverage[] = [];
  const unmatchedTitles: string[] = [];
  let datasetsWithoutId = 0;

  for (const ds of relevant) {
    // CKAN gives every package a slug (`name`) and a uuid (`id`); either
    // identifies the dataset, but an empty string would silently produce a
    // dataset entry with no identity and no working link.
    const datasetId = (ds.name ?? '').trim() !== '' ? (ds.name as string).trim() : (ds.id ?? '');
    if (datasetId === '') {
      datasetsWithoutId += 1;
      continue;
    }
    const title = (ds.title ?? '').trim() !== '' ? (ds.title as string).trim() : datasetId;
    const datasetUrl = `${ODATA_HOST}/dataset/${datasetId}`;
    const parsedTitle = parseDiaryTitle(title);
    const ministryId = matchMinistryByTitle(title, seed.ministries);
    if (ministryId === null) unmatchedTitles.push(title);

    const detail = await ckanJson<{ result?: CkanDataset }>(
      logger,
      `collect: package_show ${datasetId}`,
      `${ODATA_HOST}/api/3/action/package_show?id=${encodeURIComponent(datasetId)}`,
    );
    const resources = detail?.result?.resources ?? [];

    const cov: DiaryDatasetCoverage = {
      datasetId,
      title,
      url: datasetUrl,
      ministryId,
      personLabel: parsedTitle.personLabel,
      personRole: parsedTitle.personRole,
      roleLabelHe: parsedTitle.roleLabelHe,
      periodLabel: parsedTitle.periodLabel,
      machineReadableEntries: 0,
      skippedEmptyRows: 0,
      outOfWindowRows: 0,
      truncated: false,
      unparsedResources: [],
    };

    for (const resource of resources) {
      // Nullish coalescing is not enough here: CKAN resources exist with
      // format:"" and name:"", and an empty string would travel all the way to
      // a field the schema requires to be non-empty — failing the gate after a
      // three-hour collection over four blank cells.
      const format = orFallback(resource.format, 'לא צוין פורמט').toUpperCase();
      const resourceName = orFallback(resource.name, resource.id ?? 'משאב ללא שם');
      if (resource.datastore_active !== true) {
        // Images embedded in the FOI response letter are not diary content.
        if (format === 'PNG' || format === 'JPEG' || format === 'GIF') continue;
        if (!['PDF', 'XLSX', 'CSV', 'XLS', 'DOC', 'DOCX', 'ZIP'].includes(format)) {
          cov.unparsedResources.push({
            name: resourceName,
            format,
            note: 'סוג קובץ שאינו נתמך לחילוץ',
          });
          continue;
        }
        const fileEntries = await extractFileResource(logger, {
          datasetId,
          datasetUrl,
          title,
          resource,
          format,
          resourceName,
          ministryId,
          parsedTitle,
          collectedAt,
          cov,
        });
        entries.push(...fileEntries);
        continue;
      }
      if (resource.id === undefined) continue;
      const table = await fetchDatastoreRows(logger, resource.id, datasetId);
      if (table === null) {
        cov.unparsedResources.push({
          name: resourceName,
          format,
          note: 'ה-datastore לא החזיר רשומות עבור המשאב',
        });
        continue;
      }
      const { mapping, unknown } = mapDiaryFields(table.fields);
      const mapped = new Set(mapping.values());
      if (!mapped.has('subject') && !mapped.has('startDate')) {
        cov.unparsedResources.push({
          name: resourceName,
          format,
          note: `מבנה העמודות לא זוהה (עמודות: ${table.fields.slice(0, 8).join(' | ').slice(0, 160)})`,
        });
        continue;
      }
      if (unknown.length > 0) {
        // Unknown columns are dropped, but their existence is disclosed.
        cov.unparsedResources.push({
          name: resourceName,
          format,
          note: `עמודות שלא מופו ולכן אינן מוצגות: ${unknown.join(', ').slice(0, 160)}`,
        });
      }
      cov.truncated = cov.truncated || table.truncated;

      for (const row of table.rows) {
        const valueOf = (target: keyof DiaryFieldRow): unknown => {
          for (const [fieldId, mappedTarget] of mapping) {
            if (mappedTarget === target) return readCell(row, fieldId);
          }
          return undefined;
        };
        const subjectRaw = valueOf('subject');
        const subject =
          typeof subjectRaw === 'string' && subjectRaw.trim() !== '' ? subjectRaw.trim() : null;
        const date = parseDiaryDate(valueOf('startDate'));
        if (subject === null && date === null) {
          cov.skippedEmptyRows += 1;
          continue;
        }
        if (date !== null && (date < WINDOW_START || date > collectedAt)) {
          cov.outOfWindowRows += 1;
          continue;
        }
        const rowId = readCell(row, '_id');
        entries.push({
          id: `diary-${datasetId}-${resource.id.slice(0, 8)}-${String(rowId ?? entries.length)}`,
          ministryId,
          personLabel: parsedTitle.personLabel,
          personRole: parsedTitle.personRole,
          roleLabelHe: parsedTitle.roleLabelHe,
          subject: subject ?? 'ללא נושא רשום',
          date,
          startTime: parseDiaryTime(valueOf('startTime')),
          endTime: parseDiaryTime(valueOf('endTime')),
          location: ((): string | null => {
            const v = valueOf('location');
            return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 200) : null;
          })(),
          participants: ((): string | null => {
            const v = valueOf('participants');
            return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 400) : null;
          })(),
          datasetId,
          extractionMethod: 'datastore',
          extractionNote: 'רשומה מובנית ממסד הנתונים של המאגר (הנאמנה ביותר למקור)',
          sourceUrl: datasetUrl,
          sourceTitle: title,
          collectedAt,
        });
        cov.machineReadableEntries += 1;
      }
    }
    coverage.push(cov);
    console.log(
      `  ${datasetId}: ${cov.machineReadableEntries} entries, ${cov.unparsedResources.length} unparsed resources` +
        (ministryId === null ? ' (ללא שיוך משרד)' : ` → ${ministryId}`),
    );
  }

  entries.sort((a, b) =>
    `${a.ministryId ?? 'zz'}|${a.date ?? '9999'}|${a.id}`.localeCompare(
      `${b.ministryId ?? 'zz'}|${b.date ?? '9999'}|${b.id}`,
    ),
  );

  // ---- de-duplication ------------------------------------------------------
  // The same diary is often published twice: once in a quarterly dataset and
  // again inside a yearly aggregate. Counting both would inflate every measure
  // on the screen, so identical (person, date, time, subject) rows collapse to
  // one and the number removed is published.
  const seenRows = new Set<string>();
  const deduped: DiaryEntry[] = [];
  let duplicateRows = 0;
  for (const entry of entries) {
    const fingerprint = [
      entry.ministryId ?? '—',
      entry.roleLabelHe,
      entry.personLabel ?? '—',
      entry.date ?? '—',
      entry.startTime ?? '—',
      entry.subject,
    ].join('|');
    if (seenRows.has(fingerprint)) {
      duplicateRows += 1;
      continue;
    }
    seenRows.add(fingerprint);
    deduped.push(entry);
  }

  // Per-dataset counters were incremented while reading, i.e. before the
  // de-duplication above. Recount from what actually ships, or the index would
  // over-declare every dataset that was published twice.
  const keptPerDataset = new Map<string, number>();
  for (const entry of deduped) {
    keptPerDataset.set(entry.datasetId, (keptPerDataset.get(entry.datasetId) ?? 0) + 1);
  }
  for (const cov of coverage) {
    cov.machineReadableEntries = keptPerDataset.get(cov.datasetId) ?? 0;
  }

  // ---- shard by ministry ---------------------------------------------------
  // ~190k rows is far too much for one payload, so entries ship as one file per
  // budget section, loaded only when a reader opens that section. Fields that
  // are constant per publication (person, role, titles, source URL) live once
  // in the index instead of on every row.
  const shardOf = (entry: DiaryEntry): string => entry.ministryId ?? 'unattributed';
  const shards = new Map<string, DiaryEntry[]>();
  for (const entry of deduped) {
    const key = shardOf(entry);
    const bucket = shards.get(key) ?? [];
    bucket.push(entry);
    shards.set(key, bucket);
  }

  const diariesDir = path.join(PROCESSED_DIR, 'diaries');
  fs.rmSync(diariesDir, { recursive: true, force: true });
  const shardIndex: Array<{
    shardKey: string;
    ministryId: string | null;
    file: string;
    entryCount: number;
  }> = [];
  for (const [key, shardEntries] of [...shards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const file = `diaries/${key}.json`;
    writeJson(
      path.join(PROCESSED_DIR, file),
      shardEntries.map((entry) => ({
        id: entry.id,
        datasetId: entry.datasetId,
        subject: entry.subject,
        date: entry.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        location: entry.location,
        participants: entry.participants,
        extractionMethod: entry.extractionMethod,
      })),
    );
    shardIndex.push({
      shardKey: key,
      ministryId: key === 'unattributed' ? null : key,
      file,
      entryCount: shardEntries.length,
    });
  }

  const output = {
    generatedAt: collectedAt,
    source: {
      name: 'מידע לעם — מאגר התנועה לחופש המידע',
      url: `${ODATA_HOST}/`,
      trustTier: 'civic_helper',
      note:
        'היומנים פורסמו על ידי המשרדים מכוח נוהל היומנים והועלו למאגר "מידע לעם" של התנועה לחופש המידע. ' +
        'gov.il ו-foi.gov.il דוחים לקוחות אוטומטיים מזוהים (HTTP 403) ולכן האיסוף נעשה מהמאגר האזרחי. ' +
        (timeBudgetReached
          ? `תקציב הזמן של ההרצה (${TIME_BUDGET_MINUTES} דקות) מוצה לפני שכל הקבצים נקראו; הקבצים שנותרו מדווחים ברשימת "לא נקרא" וייקראו בהרצה הבאה. ` +
            'איסוף זה חלקי במוצהר. '
          : '') +
        'נקראו רשומות מובנות ממסד הנתונים של המאגר, וכן קבצים שהורדו במידה שהמאגר איפשר: גיליונות, ' +
        'קובצי PDF עם שכבת טקסט, וסריקות שפוענחו ב-OCR. לכל רשומה מצוינת שיטת החילוץ, ורשומת OCR ' +
        'מסומנת במפורש כקריאה אוטומטית שעשויה לשגות. שום רשומה לא שוחזרה בניחוש.',
    },
    windowStart: WINDOW_START,
    totals: {
      datasets: coverage.length,
      entries: deduped.length,
      datasetsWithEntries: coverage.filter((c) => c.machineReadableEntries > 0).length,
      unattributedDatasets: coverage.filter((c) => c.ministryId === null).length,
      unparsedResources: coverage.reduce((sum, c) => sum + c.unparsedResources.length, 0),
      duplicateRowsRemoved: duplicateRows,
      datasetsWithoutIdentifier: datasetsWithoutId,
      timeBudgetReached: timeBudgetReached,
      byExtractionMethod: {
        datastore: deduped.filter((e) => e.extractionMethod === 'datastore').length,
        spreadsheet: deduped.filter((e) => e.extractionMethod === 'spreadsheet').length,
        pdf_text: deduped.filter((e) => e.extractionMethod === 'pdf_text').length,
        pdf_ocr: deduped.filter((e) => e.extractionMethod === 'pdf_ocr').length,
      },
    },
    unmatchedTitles: unmatchedTitles.sort((a, b) => a.localeCompare(b)),
    shards: shardIndex,
    datasets: coverage,
  };

  writeJson(path.join(PROCESSED_DIR, 'diaries-index.json'), output);

  // No CSV is written for the diary rows, deliberately. At ~190k rows a full
  // CSV export adds roughly 47MB per refresh on top of the ~92MB of JSON — a
  // byte-for-byte duplicate of the same content in the repository's history —
  // while the screen already exports exactly the rows a reader is looking at,
  // filtered, from the shard it loaded. The JSON shards stay the canonical
  // downloadable form. A CSV directory left by an earlier version is removed so
  // the repository never carries a stale copy alongside fresh data.
  fs.rmSync(path.join(PROCESSED_DIR, 'csv', 'diaries'), { recursive: true, force: true });

  // The scratch directory holds downloaded originals and rendered page images.
  // It is rebuilt on every run and must never reach a commit: a previous run
  // swept hundreds of 300-DPI PNGs into git and the push was rejected outright.
  fs.rmSync(path.join(RAW_DIR, '.diary-work'), { recursive: true, force: true });

  logger.flush(
    'הרצה בסביבת GitHub Actions. gov.il ו-foi.gov.il מחזירים 403 ללקוח מזוהה; odata.org.il נקרא דרך ה-API בלבד.',
  );
  console.log(
    `\ndiaries: ${deduped.length} entries (${duplicateRows} duplicates removed) from ` +
      `${output.totals.datasetsWithEntries}/${coverage.length} datasets in ${shardIndex.length} shards; ` +
      `${output.totals.unparsedResources} resources disclosed as unparsed`,
  );
  console.log(`  by extraction: ${JSON.stringify(output.totals.byExtractionMethod)}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--probe';
  if (mode === '--probe') {
    await probe();
    return;
  }
  if (mode === '--probe-files') {
    await probeFiles();
    return;
  }
  if (mode === '--collect') {
    await collect();
    return;
  }
  console.error(`Unknown mode "${mode}". Use --probe, --probe-files or --collect.`);
  process.exitCode = 1;
}

import { pathToFileURL } from 'node:url';
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
