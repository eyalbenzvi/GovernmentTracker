/**
 * generate-data-report — writes data/processed/DATA-REPORT.md.
 *
 * A human-readable snapshot of what this data version actually contains: which
 * ministries are covered, what was retrieved, what was blocked, and which
 * limitations are still open. It is generated from the processed files so it can
 * never drift from them.
 */
import path from 'node:path';
import { COLLECTION_LOG_DIR, PROCESSED_DIR, listFiles, readJson, writeText } from './lib/paths.js';
import type { CollectionLog } from './lib/log.js';
import type { Coverage, Ministry, SourceCatalogItem, Topic } from './lib/schema.js';

interface DataVersion {
  version: string;
  builtAt: string;
  collectionWindowStart: string;
  collectionWindowEnd: string;
  counts: Record<string, number>;
}

function main(): void {
  const p = (f: string): string => path.join(PROCESSED_DIR, f);
  const version = readJson<DataVersion>(p('data-version.json'));
  const ministries = readJson<Ministry[]>(p('ministries.json'));
  const coverage = readJson<Coverage[]>(p('coverage.json'));
  const catalog = readJson<SourceCatalogItem[]>(p('source-catalog.json'));
  const topics = readJson<Topic[]>(p('topics.json'));
  const logs = listFiles(COLLECTION_LOG_DIR, '.json').map((f) => readJson<CollectionLog>(f));

  const attempts = logs.flatMap((l) => l.attempts);
  const blockedHosts = new Map<string, number>();
  for (const attempt of attempts.filter((a) => a.outcome === 'blocked')) {
    const host = new URL(attempt.url).host;
    blockedHosts.set(host, (blockedHosts.get(host) ?? 0) + 1);
  }

  const byPublisher = new Map<string, number>();
  for (const source of catalog) {
    byPublisher.set(source.publisher, (byPublisher.get(source.publisher) ?? 0) + 1);
  }

  const lines: string[] = [
    '# דוח איכות נתונים',
    '',
    `גרסת נתונים: **${version.version}** · נבנתה: ${version.builtAt}`,
    '',
    `טווח הניתוח: ${version.collectionWindowStart} עד ${version.collectionWindowEnd}`,
    '',
    '> דוח זה נוצר אוטומטית מקובצי הנתונים המעובדים. אין בו מספר שאינו ספירה של רשומות קיימות.',
    '',
    '## מספרים בגרסה זו',
    '',
    '| מדד | ערך |',
    '| --- | --- |',
    ...Object.entries(version.counts).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## כיסוי לפי משרד',
    '',
    '| משרד | מקורות מוגדרים | מקורות שאוחזרו | רשומות תקציב | פריטי פעילות | שנות תקציב |',
    '| --- | --- | --- | --- | --- | --- |',
    ...coverage.map((c) => {
      const ministry = ministries.find((m) => m.id === c.ministryId);
      return `| ${ministry?.displayName ?? c.ministryId} | ${c.sourcesDefined} | ${c.sourcesSuccessfullyCollected} | ${c.budgetRecordCount} | ${c.activityItemCount} | ${c.budgetYearsAvailable.join(', ') || '—'} |`;
    }),
    '',
    '## מקורות לפי מפרסם',
    '',
    ...[...byPublisher.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([publisher, count]) => `- ${publisher}: ${count}`),
    '',
    '## ניסיונות אחזור',
    '',
    `סך ניסיונות רשת: ${attempts.length} · הצליחו: ${attempts.filter((a) => a.outcome === 'ok').length} · נחסמו: ${attempts.filter((a) => a.outcome === 'blocked').length} · נכשלו אחרת: ${attempts.filter((a) => a.outcome !== 'ok' && a.outcome !== 'blocked').length}`,
    '',
  ];

  if (blockedHosts.size > 0) {
    lines.push('### מתחמים שנחסמו על ידי מדיניות ה-egress של סביבת הבנייה', '');
    lines.push('| מתחם | ניסיונות שנחסמו |', '| --- | --- |');
    for (const [host, count] of [...blockedHosts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${host} | ${count} |`);
    }
    lines.push(
      '',
      'כל אחד מהמתחמים הללו הוא מקור רשמי. החסימה היא מגבלת סביבה, לא מגבלת מקור: הרצת `npm run data:refresh` מסביבה עם גישה רגילה תאכלס את הנתונים.',
      '',
    );
  }

  lines.push('## נושאים', '');
  const withActivity = topics.filter((t) => t.activityItemCount > 0);
  lines.push(
    `${topics.length} נושאים מוגדרים בטקסונומיה · ${withActivity.length} מגובים בפריטי פעילות בפועל.`,
    '',
  );
  if (withActivity.length === 0) {
    lines.push(
      'הטקסונומיה מוצגת באתר כמוגדרת-אך-לא-מאוכלסת. אין באתר תצוגת התפלגות נושאים, מפני שאין פריטים לספור.',
      '',
    );
  }

  lines.push('## מגבלות פתוחות', '');
  for (const cov of coverage) {
    const ministry = ministries.find((m) => m.id === cov.ministryId);
    if (cov.limitations.length === 0) continue;
    lines.push(`### ${ministry?.displayName ?? cov.ministryId}`, '');
    for (const limitation of cov.limitations) lines.push(`- ${limitation}`);
    lines.push('');
  }

  writeText(path.join(PROCESSED_DIR, 'DATA-REPORT.md'), lines.join('\n'));
  console.log('generate-data-report: נכתב data/processed/DATA-REPORT.md');
}

main();
