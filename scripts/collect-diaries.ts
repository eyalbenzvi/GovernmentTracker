/**
 * Ministers'/senior-officials' diaries collector — stage 1: PROBE.
 *
 * Israeli ministers, deputy ministers and director-generals must publish
 * their meeting diaries quarterly (Attorney-General directive 3.1102 and
 * government FOI procedures). The diaries are published as files on:
 *
 *  1. foi.gov.il — the Government FOI Unit's central diaries page
 *     (https://foi.gov.il/he/node/6747), official source.
 *  2. www.gov.il — per-ministry FOI pages. Refuses identified automated
 *     clients (HTTP 403); we do not impersonate a browser.
 *  3. odata.org.il ("מידע לעם") — the Freedom of Information Movement's
 *     public CKAN repository of documents obtained under FOI. Civic helper
 *     layer, same trust tier as the Budget Key: never marked `final`.
 *
 * This session's build environment cannot reach hosts 1 and 3 (network
 * egress policy), so this script is designed to run in GitHub Actions
 * (.github/workflows/collect-diaries.yml), where outbound access is the
 * runner's own.
 *
 * `--probe` performs a read-only reconnaissance: it inventories what each
 * source actually offers (page structure, file links, dataset resources)
 * and prints a JSON inventory to stdout between marker lines, so the
 * structure can be reviewed from the workflow log BEFORE any parser is
 * written. It writes nothing under data/processed and never commits.
 * The honesty rule applies to reconnaissance too: what a source refuses is
 * recorded as refused, not worked around.
 */
import { politeFetch, USER_AGENT } from './lib/http.js';
import { Logger } from './lib/log.js';

const FOI_DIARIES_PAGE = 'https://foi.gov.il/he/node/6747';
const GOVIL_DIARIES_PAGE = 'https://www.gov.il/he/pages/minister_diary';
const ODATA_API = 'https://www.odata.org.il/api/3/action/package_search';

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
    const url = `${ODATA_API}?q=${encodeURIComponent(q)}&rows=100`;
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

async function probe(): Promise<void> {
  const logger = new Logger('collect-diaries-probe');
  console.log('Diaries probe — read-only reconnaissance of diary sources.\n');

  const report: ProbeReport = {
    probedAt: new Date().toISOString(),
    userAgent: USER_AGENT,
    foi: await probeFoi(logger),
    govil: await probeGovil(logger),
    odata: await probeOdata(logger),
  };

  console.log('\n===DIARIES-PROBE-BEGIN===');
  console.log(JSON.stringify(report, null, 1));
  console.log('===DIARIES-PROBE-END===');
  console.log(
    `\nSummary: foi=${report.foi.outcome} (${report.foi.fileLinks.length} file links), ` +
      `govil=${report.govil.outcome}, odata datasets=${report.odata.queries
        .map((q) => q.totalDatasets ?? 'n/a')
        .join('/')}`,
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--probe';
  if (mode === '--probe') {
    await probe();
    return;
  }
  console.error(
    `Unknown mode "${mode}". Only --probe is implemented; the collect stage is added ` +
      'after the probe confirms what the sources actually publish.',
  );
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
