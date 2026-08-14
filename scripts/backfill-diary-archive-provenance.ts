/**
 * backfill-diary-archive-provenance — records which archived copy each diary
 * publication was actually read from.
 *
 * Input:  data/raw/collection-log/collect-diaries.json (every HTTP attempt)
 *         data/processed/diaries-index.json
 * Output: data/processed/diary-archive-reads.json — every archived copy the
 *         collector actually read, with its size and the date it was read.
 *
 * Why this exists. The repository that mirrors these files answers its API but
 * refuses every file-download path, so files are read from a public web archive
 * copy instead. The README claimed each row carried the address of the copy it
 * was read from. It did not: the collector logged those addresses, and nothing
 * carried them into the published data. An unverifiable provenance claim is
 * worse than no claim, so this closes the gap rather than deleting the sentence.
 *
 * What this can and cannot do. The archive URL embeds the original file URL,
 * and that URL carries CKAN's package *id*. The index identifies a publication
 * by its package *name*, which on this repository is a different UUID, and the
 * mapping between them lives behind the repository's API — unreachable from the
 * build environment. So the reads are published as their own list, honestly
 * unattributed to individual publications, rather than attached to publications
 * by a guess. Attribution per publication is a change to the collector, which
 * knows both identifiers at collection time; it will appear on the next run.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';

interface Attempt {
  url: string;
  purpose: string;
  outcome: string;
  httpStatus: number | null;
  bytes: number | null;
  attemptedAt: string;
}

interface CollectionLog {
  attempts: Attempt[];
}

interface ArchiveCopy {
  resourceUrl: string;
  archiveUrl: string;
  bytes: number | null;
  readAt: string;
}

/**
 * The archive's raw-bytes route is `/web/<timestamp>id_/<original url>`. Pull
 * the original back out, and the dataset id out of that.
 */
export function parseArchiveAttempt(
  url: string,
): { resourceUrl: string; datasetId: string } | null {
  const marker = url.indexOf('id_/');
  if (marker < 0) return null;
  const resourceUrl = url.slice(marker + 'id_/'.length);
  const dataset = /\/dataset\/([^/]+)\//.exec(resourceUrl);
  if (dataset === null) return null;
  const datasetId = dataset[1];
  if (datasetId === undefined || datasetId === '') return null;
  return { resourceUrl, datasetId };
}

function main(): void {
  const log = readJson<CollectionLog>(path.join(RAW_DIR, 'collection-log', 'collect-diaries.json'));

  const byDataset = new Map<string, ArchiveCopy[]>();
  let successfulReads = 0;
  for (const attempt of log.attempts) {
    if (!attempt.purpose.includes('internet archive snapshot')) continue;
    if (attempt.outcome !== 'ok') continue;
    const parsed = parseArchiveAttempt(attempt.url);
    if (parsed === null) continue;
    successfulReads += 1;
    const copies = byDataset.get(parsed.datasetId) ?? [];
    // A resource read more than once is recorded once.
    if (!copies.some((c) => c.archiveUrl === attempt.url)) {
      copies.push({
        resourceUrl: parsed.resourceUrl,
        archiveUrl: attempt.url,
        bytes: attempt.bytes,
        readAt: attempt.attemptedAt.slice(0, 10),
      });
    }
    byDataset.set(parsed.datasetId, copies);
  }

  const reads = [...byDataset.values()]
    .flat()
    .sort((a, b) => a.archiveUrl.localeCompare(b.archiveUrl));

  writeJson(path.join(PROCESSED_DIR, 'diary-archive-reads.json'), {
    generatedAt: new Date().toISOString().slice(0, 10),
    method:
      'המאגר שבו מרוכזים קבצי היומנים עונה ל-API שלו אך דוחה כל דרך להורדת קובץ (403). לכן הקבצים נקראו מעותקים שמורים בארכיון האינטרנט — מתחם אחר, שמפרסם עותקים ציבוריים ומתיר גישה אוטומטית. זו הרשימה המלאה של העותקים שנקראו בפועל.',
    limitation:
      'הרשימה אינה משויכת לפרסומים בודדים. כתובת העותק בארכיון מכילה את כתובת הקובץ המקורית, ובה מזהה החבילה (id) של CKAN, בעוד המפתח שהאתר משתמש בו הוא שם החבילה (name) — שני מזהים שונים, והתרגום ביניהם נמצא מאחורי ה-API של המאגר, שאינו נגיש מסביבת הבנייה. שיוך לכל פרסום הוא שינוי בשלב האיסוף, שיודע את שני המזהים, ויופיע בהרצה הבאה. עד אז מדווח כאן מה שניתן לאמת: כל העותקים שנקראו.',
    totals: { archiveCopiesRead: successfulReads, distinctCopies: reads.length },
    reads,
  });

  console.log(
    `backfill-diary-archive-provenance: ${successfulReads} קריאות מהארכיון · ` +
      `${reads.length} עותקים שונים נרשמו ב-diary-archive-reads.json`,
  );
}

if (process.argv[1]?.includes('backfill-diary-archive-provenance')) main();
