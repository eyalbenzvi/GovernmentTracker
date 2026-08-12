/**
 * collect-sources — builds data/processed/source-catalog.json.
 *
 * Input:  data/raw/search-discovery/*.json — the raw discovery captures
 *         (title + URL pairs exactly as returned by the search index).
 * Output: data/processed/source-catalog.json
 *         data/raw/collection-log/collect-sources.json
 *         data/raw/manifest.json
 *
 * For every discovered source the collector:
 *   1. classifies it deterministically (publisher / type / ministry / years);
 *   2. attempts an actual retrieval, so the catalog records whether the
 *      document body was obtainable in this environment, and its checksum if so.
 *
 * Idempotent: same inputs + same reachability produce a byte-identical output.
 */
import path from 'node:path';
import {
  PROCESSED_DIR,
  RAW_DIR,
  SEARCH_DISCOVERY_DIR,
  listFiles,
  readJson,
  writeJson,
} from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch, sha256 } from './lib/http.js';
import { classifySource, periodCoveredLabel } from './lib/classify-source.js';
import type { SourceCatalogItem } from './lib/schema.js';

interface DiscoveryResult {
  title: string;
  url: string;
}
interface DiscoveryQuery {
  queryId: string;
  query: string;
  domainFilter: string[] | null;
  results: DiscoveryResult[];
}
interface DiscoveryCapture {
  captureId: string;
  capturedAt: string;
  collectionTool: string;
  queries: DiscoveryQuery[];
}

const LICENSE_NOTE =
  'פרסום ממשלתי/פרלמנטרי פומבי. באתר זה נשמרים כותרת וקישור בלבד; גוף המסמך אינו משוכפל. השימוש הוא לצורכי הפניה ואימות.';

function slugify(url: string): string {
  return sha256(url).slice(0, 12);
}

async function main(): Promise<void> {
  const logger = new Logger('collect-sources');
  const captures = listFiles(SEARCH_DISCOVERY_DIR, '.json').map((f) =>
    readJson<DiscoveryCapture>(f),
  );

  if (captures.length === 0) {
    throw new Error('לא נמצאו קבצי גילוי ב-data/raw/search-discovery');
  }

  // Deduplicate by URL, remembering the first query that surfaced it.
  const seen = new Map<string, { title: string; queryId: string; capturedAt: string }>();
  for (const capture of captures) {
    for (const query of capture.queries) {
      for (const result of query.results) {
        if (!seen.has(result.url)) {
          seen.set(result.url, {
            title: result.title,
            queryId: query.queryId,
            capturedAt: capture.capturedAt,
          });
        }
      }
    }
  }

  console.log(`collect-sources: ${seen.size} מקורות ייחודיים לאחר ניכוי כפילויות\n`);

  const catalog: SourceCatalogItem[] = [];

  for (const [url, meta] of [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const classification = classifySource(url, meta.title);

    // Attempt real retrieval. A failure here is recorded, never hidden.
    const result = await politeFetch(url, {
      purpose: 'retrieve source document body for extraction',
      logger,
    });

    const retrievalStatus: SourceCatalogItem['retrievalStatus'] = result.ok
      ? 'retrieved'
      : result.outcome === 'blocked'
        ? 'not_retrieved_egress_blocked'
        : 'not_retrieved_error';

    const retrievalNote = result.ok
      ? `גוף המסמך אוחזר בהצלחה (${result.bytes} בתים) ונשמר checksum לאימות.`
      : result.outcome === 'blocked'
        ? `גוף המסמך לא אוחזר: המתחם ${new URL(url).host} חסום על ידי מדיניות ה-egress של סביבת הבנייה. הקישור עצמו תקף ומפנה למקור הרשמי.`
        : `גוף המסמך לא אוחזר: ${result.errorMessage ?? 'שגיאה לא מזוהה'}.`;

    catalog.push({
      id: `src-${slugify(url)}`,
      title: meta.title,
      publisher: classification.publisher,
      url,
      sourceType: classification.sourceType,
      sourceTypeLabelHe: classification.sourceTypeLabelHe,
      ministryIds: classification.ministryIds,
      fiscalYears: classification.fiscalYears,
      periodCovered: periodCoveredLabel(classification.fiscalYears),
      collectedAt: meta.capturedAt,
      licenseOrUsageNote: LICENSE_NOTE,
      reliabilityLevel: classification.reliabilityLevel,
      extractionMethod: result.ok
        ? 'גילוי דרך אינדקס חיפוש + אחזור גוף המסמך בזמן בנייה'
        : 'גילוי דרך אינדקס חיפוש (כותרת + URL בלבד); גוף המסמך לא אוחזר',
      discoveryQueryId: meta.queryId,
      mappingRule: classification.mappingRule,
      retrievalStatus,
      retrievalNote,
      checksumSha256: result.ok && result.body ? sha256(result.body) : null,
    });
  }

  catalog.sort((a, b) => a.id.localeCompare(b.id));
  writeJson(path.join(PROCESSED_DIR, 'source-catalog.json'), catalog);

  const log = logger.flush(
    'לסביבת הבנייה יש allowlist לתעבורה יוצאת. מתחמי המקורות הרשמיים (gov.il, knesset.gov.il, mevaker.gov.il, data.gov.il, obudget.org) אינם ב-allowlist, והבקשות אליהם נענות ב-HTTP 403 עם ההודעה "Host not in allowlist". זו מגבלת סביבה ולא מגבלה של המקורות עצמם.',
  );

  writeJson(path.join(RAW_DIR, 'manifest.json'), {
    manifestVersion: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    note: 'קובצי מקור לא הורדו לתוך ה-repository. עבור כל מקור נשמרים כותרת, URL, מסלול הגילוי, סטטוס אחזור ו-checksum (כאשר האחזור הצליח). הסיבה מתועדת בשדה retrievalNote של כל פריט בקטלוג.',
    sources: catalog.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      publisher: item.publisher,
      downloadedAt: item.retrievalStatus === 'retrieved' ? log.finishedAt.slice(0, 10) : null,
      checksumSha256: item.checksumSha256,
      retrievalStatus: item.retrievalStatus,
    })),
  });

  console.log(`\nנכתבו ${catalog.length} פריטים ל-source-catalog.json`);
  console.log(
    `אחזור בפועל: ${catalog.filter((c) => c.retrievalStatus === 'retrieved').length} מתוך ${catalog.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
