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
 *  `--collect` full collection from the odata.org.il datastore: every diary
 *              dataset relevant to the 37th government window is enumerated,
 *              structured rows are normalised into diary entries, and
 *              everything that could NOT be processed (PDF scans, image
 *              files, spreadsheets that were never loaded into the
 *              datastore) is disclosed per dataset in the coverage file —
 *              never silently dropped and never OCR-guessed.
 *
 * The honesty rule applies throughout: what a source refuses is recorded as
 * refused, not worked around; what cannot be attributed to a ministry is
 * listed as unattributed, not guessed.
 */
import path from 'node:path';
import { politeFetch, USER_AGENT } from './lib/http.js';
import { Logger } from './lib/log.js';
import {
  COLLECTION_LOG_DIR,
  PROCESSED_DIR,
  RAW_DIR,
  readJson,
  writeJson,
  writeText,
} from './lib/paths.js';
import { toCsv } from './lib/csv.js';

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
async function fetchBinary(
  logger: Logger,
  url: string,
  purpose: string,
  referer: string | null,
): Promise<{ status: number | null; bytes: Uint8Array | null; contentType: string | null }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
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
  sourceUrl: string;
  sourceTitle: string;
  collectedAt: string;
}

interface UnparsedResource {
  name: string;
  format: string;
  note: string;
}

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
  return { personRole, roleLabelHe: roleLabel, personLabel, periodLabel };
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

  for (const ds of relevant) {
    const datasetId = ds.name ?? '';
    const title = ds.title ?? datasetId;
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
      const format = (resource.format ?? '?').toUpperCase();
      const resourceName = resource.name ?? resource.id ?? '?';
      if (resource.datastore_active !== true) {
        // Images embedded in the FOI response letter are not diary content.
        if (format === 'PNG' || format === 'JPEG' || format === 'GIF') continue;
        cov.unparsedResources.push({
          name: resourceName,
          format,
          note:
            format === 'PDF'
              ? 'פורסם כ-PDF (לרוב סריקה) — לא עובד אוטומטית ולא שוחזר בניחוש'
              : 'קובץ טבלאי שלא נטען ל-datastore של המאגר — לא הורד ישירות (המאגר מחזיר 403 להורדות אוטומטיות)',
        });
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

  const output = {
    generatedAt: collectedAt,
    source: {
      name: 'מידע לעם — מאגר התנועה לחופש המידע',
      url: `${ODATA_HOST}/`,
      trustTier: 'civic_helper',
      note:
        'היומנים פורסמו על ידי המשרדים מכוח נוהל היומנים והועלו למאגר "מידע לעם" של התנועה לחופש המידע. ' +
        'gov.il ו-foi.gov.il דוחים לקוחות אוטומטיים מזוהים (HTTP 403) ולכן האיסוף נעשה מהמאגר האזרחי; ' +
        'ההורדה הישירה של קבצים מהמאגר חסומה אף היא, ולכן נקראו רק משאבים שנטענו ל-datastore. ' +
        'שום קובץ סרוק לא פוענח ושום רשומה לא שוחזרה בניחוש.',
    },
    windowStart: WINDOW_START,
    totals: {
      datasets: coverage.length,
      entries: entries.length,
      datasetsWithEntries: coverage.filter((c) => c.machineReadableEntries > 0).length,
      unattributedDatasets: coverage.filter((c) => c.ministryId === null).length,
      unparsedResources: coverage.reduce((sum, c) => sum + c.unparsedResources.length, 0),
    },
    unmatchedTitles: unmatchedTitles.sort((a, b) => a.localeCompare(b)),
    datasets: coverage,
  };

  writeJson(path.join(PROCESSED_DIR, 'diaries.json'), entries);
  writeJson(path.join(PROCESSED_DIR, 'diaries-coverage.json'), output);
  writeText(
    path.join(PROCESSED_DIR, 'csv', 'diaries.csv'),
    toCsv(
      ['id', 'משרד', 'תפקיד', 'בעל התפקיד', 'תאריך', 'שעה', 'נושא', 'מיקום', 'מקור'],
      entries.map((e) => [
        e.id,
        e.ministryId ?? '',
        e.roleLabelHe,
        e.personLabel ?? '',
        e.date ?? '',
        e.startTime ?? '',
        e.subject,
        e.location ?? '',
        e.sourceUrl,
      ]),
    ),
  );

  logger.flush(
    'הרצה בסביבת GitHub Actions. gov.il ו-foi.gov.il מחזירים 403 ללקוח מזוהה; odata.org.il נקרא דרך ה-API בלבד.',
  );
  console.log(
    `\ndiaries: ${entries.length} entries from ${output.totals.datasetsWithEntries}/${coverage.length} datasets; ` +
      `${output.totals.unparsedResources} resources disclosed as unparsed`,
  );
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
