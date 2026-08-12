/**
 * collect-activities — builds data/processed/activity-evidence.json.
 *
 * "Activity" here means one thing only: a *published* item attributable to a
 * ministry — never a claim about what its staff spend their time on. Every
 * record carries isPublicPublicationOnly: true.
 *
 * Sources (all via Budget Key's public mirror of gov.il datasets; gov.il itself
 * refuses identified automated clients, and no browser impersonation is done):
 *   A. Government decisions of the 37th government (government_decisions with
 *      the government tag), one item per decision.
 *   B. Ministry publications on gov.il in the analysis window — policy pages,
 *      procedures, guidelines (same table, office-level rows).
 *   C. Calls for bids (קולות קוראים) published by the ministries.
 *
 * Attribution rule: a publication is attached to a ministry only when its
 * `office`/`publisher` name matches one of the ministry's declared aliases
 * (containment match on normalised names). Offices that match no ministry are
 * counted and listed in the collection notes — never guessed onto a ministry.
 *
 * Volume rule: at most MAX_PER_FEED items per ministry per feed (newest first).
 * The cap and what it dropped are disclosed in the collection notes; nothing is
 * truncated silently.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { queryAllPages } from './lib/obudget.js';
import type { ActivityEvidence } from './lib/schema.js';

const COLLECTED_AT = new Date().toISOString().slice(0, 10);
const WINDOW_START = '2022-12-29';
const MAX_PER_FEED = 200;

interface MinistrySeed {
  id: string;
  officialName: string;
  aliases: string[];
  sectionKind: 'ministry' | 'other';
}
interface MinistriesSeedFile {
  ministries: MinistrySeed[];
}

function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/["'״׳]/g, '')
    .trim();
}

/** office ↔ alias containment match, both directions, on normalised names. */
export function matchOffice(office: string, aliases: readonly string[]): boolean {
  const normalizedOffice = normalizeName(office);
  return aliases.some((alias) => {
    const normalizedAlias = normalizeName(alias);
    return (
      normalizedAlias.length >= 4 &&
      (normalizedOffice.includes(normalizedAlias) || normalizedAlias.includes(normalizedOffice))
    );
  });
}

function readText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function decisionUrl(urlId: string): string {
  return `https://www.gov.il/he/departments/policies/${urlId}`;
}

async function main(): Promise<void> {
  const logger = new Logger('collect-activities');
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));
  const activities: ActivityEvidence[] = [];
  const notes: Array<{ ministryId: string | null; source: string; reason: string }> = [];

  // ---- Feed A+B: gov.il publications, fetched once and attributed locally ---
  // A: decisions tagged with the 37th government. B: office publications in the
  // window (procedures, policy pages) regardless of the government tag.
  const decisionRows = await queryAllPages(
    logger,
    'government decisions of the 37th government',
    `select publish_date, office, title, url_id, policy_type, procedure_number_str ` +
      `from government_decisions where government like '%37%' ` +
      `and title is not null and url_id is not null order by publish_date desc limit 5000`,
  );
  const publicationRows = await queryAllPages(
    logger,
    'ministry publications on gov.il in the analysis window',
    `select publish_date, office, title, url_id, policy_type ` +
      `from government_decisions where (government is null or government not like '%3_%') ` +
      `and publish_date >= '${WINDOW_START}' and office is not null ` +
      `and title is not null and url_id is not null order by publish_date desc limit 20000`,
  );

  const ministryOf = (office: string | null): MinistrySeed | null => {
    if (office === null) return null;
    return seed.ministries.find((m) => matchOffice(office, m.aliases)) ?? null;
  };

  const unmatchedOffices = new Map<string, number>();
  const perFeedCounts = new Map<string, { kept: number; droppedByCap: number }>();

  function pushItem(
    ministryId: string,
    feed: string,
    item: Omit<
      ActivityEvidence,
      | 'ministryId'
      | 'collectedAt'
      | 'people'
      | 'organizations'
      | 'topics'
      | 'coverageLevel'
      | 'isPublicPublicationOnly'
    >,
  ): void {
    const key = `${ministryId}:${feed}`;
    const counts = perFeedCounts.get(key) ?? { kept: 0, droppedByCap: 0 };
    if (counts.kept >= MAX_PER_FEED) {
      counts.droppedByCap += 1;
      perFeedCounts.set(key, counts);
      return;
    }
    counts.kept += 1;
    perFeedCounts.set(key, counts);
    activities.push({
      ...item,
      ministryId,
      collectedAt: COLLECTED_AT,
      people: [],
      organizations: [],
      topics: [],
      coverageLevel: 'direct',
      isPublicPublicationOnly: true,
    });
  }

  for (const [feed, rows, sourceType, sourceTitle] of [
    ['decisions', decisionRows, 'policy_document', 'החלטות הממשלה ה-37 — gov.il'],
    ['publications', publicationRows, 'government_page', 'פרסומי המשרד ב-gov.il'],
  ] as const) {
    for (const row of rows) {
      const office = readText(row.office);
      const ministry = ministryOf(office);
      if (ministry === null) {
        if (office !== null) unmatchedOffices.set(office, (unmatchedOffices.get(office) ?? 0) + 1);
        continue;
      }
      const title = readText(row.title);
      const urlId = readText(row.url_id);
      const date = toIsoDate(row.publish_date);
      if (title === null || urlId === null) continue;
      if (date !== null && date < WINDOW_START) continue;
      const policyType = readText(row.policy_type);
      const procedure = readText(row.procedure_number_str);
      pushItem(ministry.id, feed, {
        id: `act-${feed}-${ministry.id}-${urlId}`.slice(0, 120),
        date,
        title,
        summary:
          feed === 'decisions'
            ? `החלטת ממשלה${procedure !== null ? ` (${procedure})` : ''}${policyType !== null ? ` · ${policyType}` : ''} שפורסמה באתר gov.il. הטקסט המלא בקישור המקור.`
            : `פרסום רשמי של ${office ?? 'המשרד'} באתר gov.il${policyType !== null ? ` (${policyType})` : ''}. התוכן המלא בקישור המקור.`,
        sourceType,
        sourceUrl: decisionUrl(urlId),
        sourceTitle,
        extractionNotes:
          'נאסף ממראה ציבורית (מפתח התקציב) של מאגר הפרסומים של gov.il. הכותרת כלשונה במקור; התקציר הוא תיאור סוג הפריט ואינו תוכן מנוסח. שיוך למשרד לפי התאמת שם היחידה המפרסמת לכינויי המשרד.',
      });
    }
  }

  // ---- Feed C: calls for bids (קולות קוראים) -------------------------------
  const bidRows = await queryAllPages(
    logger,
    'calls for bids published in the window',
    `select page_title, page_url, publisher, start_date, claim_date, tender_type_he ` +
      `from calls_for_bids where start_date >= '${WINDOW_START}' ` +
      `and page_title is not null and page_url is not null order by start_date desc limit 20000`,
  );
  for (const row of bidRows) {
    const publisher = readText(row.publisher);
    const ministry = ministryOf(publisher);
    if (ministry === null) {
      if (publisher !== null) {
        unmatchedOffices.set(publisher, (unmatchedOffices.get(publisher) ?? 0) + 1);
      }
      continue;
    }
    const title = readText(row.page_title);
    const pageUrl = readText(row.page_url);
    if (title === null || pageUrl === null || !pageUrl.startsWith('http')) continue;
    const date = toIsoDate(row.start_date);
    const claim = toIsoDate(row.claim_date);
    const kind = readText(row.tender_type_he) ?? 'קול קורא';
    pushItem(ministry.id, 'bids', {
      id: `act-bid-${ministry.id}-${Buffer.from(pageUrl).toString('base64url').slice(0, 40)}`,
      date,
      title,
      summary: `${kind} שפרסם ${publisher ?? 'המשרד'}${claim !== null ? `, מועד אחרון להגשה ${claim}` : ''}. הפרטים המלאים בקישור המקור.`,
      sourceType: 'other_official',
      sourceUrl: pageUrl,
      sourceTitle: 'קולות קוראים ומכרזי תמיכה — gov.il',
      extractionNotes:
        'נאסף ממראה ציבורית (מפתח התקציב) של מאגר הקולות הקוראים של gov.il. שיוך למשרד לפי שם המפרסם.',
    });
  }

  // ---- dedupe by source URL per ministry, deterministic order --------------
  const unique = new Map<string, ActivityEvidence>();
  for (const activity of activities) {
    unique.set(`${activity.ministryId}|${activity.sourceUrl}`, activity);
  }
  const output = [...unique.values()].sort(
    (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id),
  );

  const dropped = [...perFeedCounts.entries()]
    .filter(([, counts]) => counts.droppedByCap > 0)
    .map(
      ([key, counts]) => `${key}: ${counts.droppedByCap} פריטים ישנים נחתכו בתקרת ${MAX_PER_FEED}`,
    );

  notes.push({
    ministryId: null,
    source: 'government_decisions + calls_for_bids (Budget Key mirror)',
    reason:
      `נאספו ${output.length} פריטים. תקרה: עד ${MAX_PER_FEED} פריטים למשרד לכל מקור (החדשים ראשונים); ` +
      (dropped.length > 0
        ? `נחתכו: ${dropped.join(' | ')}. `
        : 'אף משרד לא הגיע לתקרה בחלק מהמקורות. ') +
      `יחידות מפרסמות שלא שויכו לאף סעיף (לא ננחשו): ${unmatchedOffices.size}. הבולטות: ` +
      [...unmatchedOffices.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([office, count]) => `${office} (${count})`)
        .join(', '),
  });

  writeJson(path.join(PROCESSED_DIR, 'activity-evidence.json'), output);
  writeJson(path.join(PROCESSED_DIR, 'activity-collection-notes.json'), {
    generatedAt: COLLECTED_AT,
    windowStart: WINDOW_START,
    maxPerFeed: MAX_PER_FEED,
    emitted: output.length,
    notes,
    policy:
      'פריט פעילות נוצר רק מרשומת מקור שאוחזרה בפועל, עם כותרת, תאריך פרסום וקישור לעמוד המקורי ב-gov.il. שיוך למשרד נעשה רק בהתאמת שם מפורשת; יחידות לא-מזוהות נשארות מחוץ למאגר ונרשמות כאן. gov.il עצמו דוחה לקוחות אוטומטיים מזוהים, ולכן האיסוף נעשה דרך המראה הציבורית של מפתח התקציב, ללא התחזות לדפדפן.',
  });

  logger.flush('איסוף הפעילות בוצע דרך המראה הציבורית של פרסומי gov.il במפתח התקציב.');
  const byMinistry = new Map<string, number>();
  for (const activity of output) {
    byMinistry.set(activity.ministryId, (byMinistry.get(activity.ministryId) ?? 0) + 1);
  }
  console.log(`\nנוצרו ${output.length} פריטי פעילות עבור ${byMinistry.size} משרדים`);
}

// Run only when invoked directly (tsx scripts/...): test files import helpers
// from this module, and importing must never trigger network collection.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
