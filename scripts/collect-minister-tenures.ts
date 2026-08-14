/**
 * collect-minister-tenures — who held which ministry, and between which dates.
 *
 * Source: the Knesset's own OData service, ParliamentInfo.svc
 *   KNS_PersonToPosition?$filter=GovernmentNum eq 37   — the appointments
 *   KNS_Person?$filter=PersonID eq …                   — the names
 * Output: data/processed/minister-tenures.json
 *
 * This dataset was declared uncollectable for the entire life of the project.
 * The reason given was that the government-composition page lives on gov.il,
 * which refuses automated clients — true, and beside the point: the Knesset
 * publishes the same facts as an open, documented OData service that answers a
 * plain identified request. An external reviewer pointed that out; the site had
 * been publishing "tenure dates were not obtained from an official source" while
 * a primary official source was one request away.
 *
 * It matters well beyond completeness. Without tenures the site attributes a
 * budget year and a diary quarter to whoever holds the office now, so it
 * published gap findings against a minister for quarters in which he held a
 * different portfolio. Fifty-nine of the ninety-seven appointments in this
 * government ended mid-term.
 *
 * A ministry is matched to a section only through the declared alias list. An
 * appointment whose ministry has no budget section of its own — Jerusalem
 * Affairs, Heritage, ministers without portfolio — is kept with its ministry
 * name and counted as unmatched, never forced into a neighbouring section.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';
import { Logger } from './lib/log.js';
import { politeFetch } from './lib/http.js';
import type { MinisterTenure } from './lib/schema.js';

const ODATA = 'https://knesset.gov.il/Odata/ParliamentInfo.svc';
const GOVERNMENT_NUM = 37;
/** The page a reader should open to check a row, rather than the API call. */
const HUMAN_SOURCE = 'https://main.knesset.gov.il/mk/government/Pages/CurrentGovernment.aspx';

interface PositionRow {
  PersonToPositionID: number;
  PersonID: number;
  StartDate: string | null;
  FinishDate: string | null;
  GovMinistryName: string | null;
  DutyDesc: string | null;
  GovernmentNum: number | null;
}

interface PersonRow {
  PersonID: number;
  FirstName: string | null;
  LastName: string | null;
}

interface MinistrySeedEntry {
  id: string;
  officialName: string;
  displayName: string;
  aliases: string[];
}
interface MinistriesSeedFile {
  ministries: MinistrySeedEntry[];
}

/** One OData collection, or null when the source did not answer. */
async function readOData<T>(logger: Logger, url: string, purpose: string): Promise<T[] | null> {
  const result = await politeFetch(url, { purpose, logger });
  if (!result.ok || result.body === null) return null;
  try {
    const parsed = JSON.parse(result.body) as { value?: T[] };
    return parsed.value ?? [];
  } catch (err) {
    console.error(`  parse failure (${purpose}): ${String(err)}`);
    return null;
  }
}

function isoDay(value: string | null): string | null {
  if (value === null || value === '') return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Ministry names are matched only by declared alias, never by resemblance. */
export function matchMinistryName(
  ministryName: string | null,
  ministries: readonly MinistrySeedEntry[],
): string | null {
  if (ministryName === null) return null;
  const needle = ministryName.replace(/\s+/g, ' ').trim();
  if (needle === '') return null;
  for (const ministry of ministries) {
    const names = [ministry.officialName, ministry.displayName, ...ministry.aliases];
    if (names.some((n) => n.replace(/\s+/g, ' ').trim() === needle)) return ministry.id;
  }
  return null;
}

async function main(): Promise<void> {
  const logger = new Logger('collect-minister-tenures');
  const seed = readJson<MinistriesSeedFile>(path.join(RAW_DIR, 'seeds', 'ministries.seed.json'));

  const positionsUrl = `${ODATA}/KNS_PersonToPosition?$filter=GovernmentNum%20eq%20${GOVERNMENT_NUM}&$format=json`;
  const positions = await readOData<PositionRow>(
    logger,
    positionsUrl,
    'collect: government 37 appointments from the Knesset OData service',
  );
  if (positions === null) {
    console.log('collect-minister-tenures: המקור לא נענה; לא נכתבו רשומות');
    logger.flush('הכנסת לא נענתה. לא נכתבו כהונות, ולא הומצאו תאריכים.');
    return;
  }

  const rows = positions.filter((r) => r.GovernmentNum === GOVERNMENT_NUM);
  const personIds = [...new Set(rows.map((r) => r.PersonID))].sort((a, b) => a - b);

  // Names come in a companion table. Asked in batches so this is a handful of
  // requests rather than one per person.
  const names = new Map<number, string>();
  for (let i = 0; i < personIds.length; i += 20) {
    const batch = personIds.slice(i, i + 20);
    const filter = batch.map((id) => `PersonID%20eq%20${id}`).join('%20or%20');
    const people = await readOData<PersonRow>(
      logger,
      `${ODATA}/KNS_Person?$filter=${filter}&$format=json`,
      'collect: office-holder names from the Knesset OData service',
    );
    for (const person of people ?? []) {
      const full = [person.FirstName, person.LastName]
        .filter((part): part is string => part !== null && part.trim() !== '')
        .join(' ')
        .trim();
      if (full !== '') names.set(person.PersonID, full);
    }
  }

  const tenures: MinisterTenure[] = [];
  const unmatchedMinistries = new Map<string, number>();
  let withoutName = 0;

  for (const row of rows) {
    const personName = names.get(row.PersonID) ?? null;
    if (personName === null) {
      withoutName += 1;
      continue;
    }
    const ministryId = matchMinistryName(row.GovMinistryName, seed.ministries);
    if (ministryId === null) {
      const label = row.GovMinistryName ?? '(ללא שם משרד)';
      unmatchedMinistries.set(label, (unmatchedMinistries.get(label) ?? 0) + 1);
      continue;
    }
    const role = (row.DutyDesc ?? '').trim();
    if (role === '') continue;
    tenures.push({
      id: `tenure-${row.PersonToPositionID}`,
      personName,
      role,
      ministryId,
      startDate: isoDay(row.StartDate),
      endDate: isoDay(row.FinishDate),
      sourceUrl: HUMAN_SOURCE,
      sourceTitle: 'הרכב הממשלה ה-37 — אתר הכנסת (נתוני שירות ה-OData של הכנסת)',
    });
  }

  tenures.sort(
    (a, b) =>
      (a.startDate ?? '').localeCompare(b.startDate ?? '') ||
      a.ministryId.localeCompare(b.ministryId) ||
      a.personName.localeCompare(b.personName),
  );
  writeJson(path.join(PROCESSED_DIR, 'minister-tenures.json'), tenures);

  const ended = tenures.filter((t) => t.endDate !== null).length;
  writeJson(path.join(PROCESSED_DIR, 'minister-tenure-notes.json'), {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: {
      name: 'שירות ה-OData של הכנסת (ParliamentInfo.svc)',
      appointmentsUrl: positionsUrl,
      humanReadableUrl: HUMAN_SOURCE,
      note: 'מקור רשמי ראשוני. עמוד הרכב הממשלה ב-gov.il דוחה לקוחות אוטומטיים מזוהים, אך הכנסת מפרסמת את אותן עובדות בשירות פתוח ומתועד, ולכן אין צורך להתחזות לדפדפן ואין צורך להסיק תאריכים.',
    },
    totals: {
      appointmentsRead: rows.length,
      people: personIds.length,
      tenuresWritten: tenures.length,
      tenuresEndedMidTerm: ended,
      appointmentsWithoutAMatchedSection: [...unmatchedMinistries.values()].reduce(
        (sum, n) => sum + n,
        0,
      ),
      appointmentsWithoutAName: withoutName,
    },
    unmatchedMinistries: [...unmatchedMinistries.entries()]
      .map(([ministryName, appointments]) => ({ ministryName, appointments }))
      .sort(
        (a, b) => b.appointments - a.appointments || a.ministryName.localeCompare(b.ministryName),
      ),
    limitations: [
      'שיוך משרד לסעיף תקציב נעשה רק לפי רשימת הכינויים המוצהרת. מינוי במשרד שאין לו סעיף תקציב עצמאי — למשל ירושלים ומורשת, או שר בלי תיק — נספר כאן ואינו נדחס לסעיף שכן.',
      'התאריכים הם תאריכי המינוי והסיום כפי שהכנסת מפרסמת אותם. כהונה שטרם הסתיימה מופיעה בלי תאריך סיום, ולא עם תאריך משוער.',
      'מינוי בפועל וממלא מקום מופיעים בתיאור התפקיד כלשונו (DutyDesc) ואינם מאוחדים עם כהונה מלאה.',
    ],
  });

  console.log(
    `collect-minister-tenures: ${rows.length} מינויים נקראו · ${tenures.length} כהונות נכתבו · ` +
      `${ended} הסתיימו במהלך הכהונה · ${unmatchedMinistries.size} משרדים ללא סעיף תקציב מותאם`,
  );
  logger.flush(
    'נקרא משירות ה-OData של הכנסת בבקשה מזוהה. תאריכים לא הוסקו ולא הושלמו; משרד ללא סעיף תקציב מדווח ואינו משויך בכוח.',
  );
}

void main();
