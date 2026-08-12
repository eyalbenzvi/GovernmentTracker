/**
 * collect-activities — builds data/processed/activity-evidence.json.
 *
 * "Activity" here means one thing only: a *published* item attributable to a
 * ministry or its leadership — a ministry news item, an official government
 * page, a policy document, a committee protocol. It is never a claim about what
 * the ministry's staff actually spend their time on. Every emitted record
 * carries isPublicPublicationOnly: true to keep that explicit downstream.
 *
 * Sources attempted:
 *   1. gov.il publication/collector API per ministry (official).
 *   2. The ministry's gov.il landing page (official).
 *
 * The gov.il API request shape is not publicly specified and may change. This
 * collector therefore validates the response shape before use: anything it does
 * not recognise is logged as parse_error and produces no records. It never
 * falls back to inventing an item.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch } from './lib/http.js';
import type { ActivityEvidence } from './lib/schema.js';

const COLLECTED_AT = new Date().toISOString().slice(0, 10);
const WINDOW_START = '2022-12-29';

interface MinistrySeed {
  id: string;
  officialName: string;
  aliases: string[];
}
interface MinistriesSeedFile {
  ministries: MinistrySeed[];
}

/**
 * gov.il unit landing pages. These are the entry points a human would use, and
 * the collector uses them both as a source and as a reachability probe.
 * Only ministries whose landing path was confirmed in the discovery capture are
 * listed; no paths are constructed speculatively.
 */
const GOV_IL_ENTRY_POINTS: Array<{ ministryId: string | null; url: string; title: string }> = [
  {
    ministryId: null,
    url: 'https://www.gov.il/he/departments/topics/subject-state-budget/govil-landing-page',
    title: 'תקציב המדינה — עמוד נושא ב-Gov.il',
  },
  {
    ministryId: null,
    url: 'https://www.gov.il/he/Departments/General/members_of_the_cabinet',
    title: 'חברי הממשלה — Gov.il',
  },
];

const GOV_IL_PUBLICATION_API = 'https://www.gov.il/api/PublicationApi/Index';

interface GovIlPublication {
  Title?: unknown;
  Description?: unknown;
  PublishDate?: unknown;
  UrlName?: unknown;
}

/** Accepts a record only if every field we need is present and of the right type. */
function toActivity(
  raw: GovIlPublication,
  ministryId: string,
  sourceTitle: string,
): ActivityEvidence | null {
  const title = typeof raw.Title === 'string' && raw.Title.trim() !== '' ? raw.Title.trim() : null;
  const urlName = typeof raw.UrlName === 'string' && raw.UrlName.trim() !== '' ? raw.UrlName : null;
  if (title === null || urlName === null) return null;

  const publishedRaw = typeof raw.PublishDate === 'string' ? raw.PublishDate : null;
  const parsed = publishedRaw !== null ? Date.parse(publishedRaw) : Number.NaN;
  const date = Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
  if (date !== null && date < WINDOW_START) return null;

  const summary =
    typeof raw.Description === 'string' && raw.Description.trim() !== ''
      ? raw.Description.trim().slice(0, 600)
      : title;

  return {
    id: `act-${ministryId}-${urlName}`,
    ministryId,
    date,
    title,
    summary,
    sourceType: 'ministry_news',
    sourceUrl: `https://www.gov.il/he/pages/${urlName}`,
    sourceTitle,
    collectedAt: COLLECTED_AT,
    people: [],
    organizations: [],
    topics: [],
    coverageLevel: 'direct',
    extractionNotes:
      'נאסף מ-API הפרסומים הרשמי של gov.il. הכותרת והתקציר הם כפי שפורסמו במקור. שדות אנשים/ארגונים לא חולצו אוטומטית.',
    isPublicPublicationOnly: true,
  };
}

async function main(): Promise<void> {
  const logger = new Logger('collect-activities');
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));
  const activities: ActivityEvidence[] = [];
  const notes: Array<{ ministryId: string | null; source: string; reason: string }> = [];

  // ---- Reachability + official entry points -------------------------------
  for (const entry of GOV_IL_ENTRY_POINTS) {
    const result = await politeFetch(entry.url, { purpose: 'official gov.il page', logger });
    if (!result.ok) {
      notes.push({
        ministryId: entry.ministryId,
        source: entry.url,
        reason: `העמוד לא אוחזר (${result.outcome}). לא נגזרו ממנו פריטי פעילות.`,
      });
    } else {
      notes.push({
        ministryId: entry.ministryId,
        source: entry.url,
        reason:
          'העמוד אוחזר. חילוץ פריטי פעילות מ-HTML של gov.il דורש מיפוי סלקטורים מוצהר שטרם הוגדר, ולכן לא בוצע חילוץ אוטומטי.',
      });
    }
  }

  // ---- gov.il publication API per ministry --------------------------------
  for (const ministry of seed.ministries) {
    // The API is queried by office identifier. We do not hold verified office
    // GUIDs, so the query is issued by free-text ministry name, and an
    // unrecognised response shape yields nothing.
    const url = `${GOV_IL_PUBLICATION_API}?limit=50&skip=0&query=${encodeURIComponent(ministry.officialName)}`;
    const result = await politeFetch(url, {
      purpose: `published activity items for ${ministry.id}`,
      logger,
    });
    if (!result.ok || !result.body) {
      notes.push({
        ministryId: ministry.id,
        source: url,
        reason: `API הפרסומים של gov.il לא נגיש (${result.outcome}). לא נאספו פריטי פעילות עבור משרד זה.`,
      });
      continue;
    }
    let results: unknown;
    try {
      const parsed = JSON.parse(result.body) as { results?: unknown };
      results = parsed.results;
    } catch (err) {
      notes.push({
        ministryId: ministry.id,
        source: url,
        reason: `תשובת ה-API לא נותחה כ-JSON: ${String(err)}`,
      });
      continue;
    }
    if (!Array.isArray(results)) {
      notes.push({
        ministryId: ministry.id,
        source: url,
        reason: 'מבנה התשובה אינו מזוהה (לא נמצא מערך results). לא נגזרו פריטים.',
      });
      continue;
    }
    let accepted = 0;
    for (const raw of results) {
      if (typeof raw !== 'object' || raw === null) continue;
      const activity = toActivity(
        raw as GovIlPublication,
        ministry.id,
        `פרסומי ${ministry.officialName} ב-Gov.il`,
      );
      if (activity !== null) {
        activities.push(activity);
        accepted += 1;
      }
    }
    notes.push({
      ministryId: ministry.id,
      source: url,
      reason: `נאספו ${accepted} פריטים מתוך ${results.length} רשומות שהוחזרו.`,
    });
  }

  // Deduplicate by id, keep deterministic order.
  const unique = new Map<string, ActivityEvidence>();
  for (const activity of activities) unique.set(activity.id, activity);
  const output = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));

  writeJson(path.join(PROCESSED_DIR, 'activity-evidence.json'), output);
  writeJson(path.join(PROCESSED_DIR, 'activity-collection-notes.json'), {
    generatedAt: COLLECTED_AT,
    windowStart: WINDOW_START,
    emitted: output.length,
    notes,
    policy:
      'פריט פעילות נוצר רק מתשובת מקור רשמי שאוחזרה ונותחה בהצלחה. לא נוצרו פריטים משוחזרים, משוערים או מנוסחים מחדש ללא מקור.',
  });

  logger.flush(
    'ניסיונות איסוף הפעילות בוצעו מול gov.il בפועל. כישלונות מתועדים כאן ובקובץ activity-collection-notes.json.',
  );
  console.log(`\nנוצרו ${output.length} פריטי פעילות`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
