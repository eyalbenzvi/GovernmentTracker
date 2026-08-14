/**
 * infer-diary-participants — works out who a subject names, and what field that
 * person belongs to, using nothing but the diaries themselves.
 *
 * Input:  data/processed/diaries/*.json     (already classified)
 *         data/processed/diaries-index.json (publication metadata)
 * Output: the same shards, with inferred categories written onto rows that had
 *         no topic, and data/processed/diary-name-inferences.json — every
 *         inference with the evidence behind it.
 *
 * Why this exists. A large share of published diary rows are a person's name and
 * nothing else — "יוסי דגן", or "פגישה עם תומר גלאם". The row says who, not
 * what. Two honest things can be done with it, and this script does both:
 *
 *   1. If the same name appears elsewhere in the diaries next to a subject that
 *      *was* classified, the field of those rows is evidence about this one.
 *      "תומר גלאם" appears in 43 other rows, 33 of them about local government,
 *      so a bare "תומר גלאם" row is attributed to local government — with the
 *      count of supporting rows recorded, and marked as an inference, never as
 *      something the office wrote.
 *   2. Where there is no such evidence but the corpus does show the name carried
 *      a personal title elsewhere, the row is labelled as a meeting with a named
 *      person and no stated subject. That is a fact about the publication, not a
 *      guess about its content.
 *
 * The evidence comes only from the published diaries. No outside knowledge of
 * who anyone is enters here — that would be unverifiable by a reader, and this
 * site's whole claim is that every figure can be checked against a source.
 *
 * Every inference is weaker than a keyword the office's own words triggered, so
 * every inferred row carries confidence `low` and an explicit rule id, and the
 * screen labels it as inferred.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';
import { matchesAsWord, normalizeSubject } from './classify-diary-categories.js';

// ---- thresholds, published with the output ---------------------------------
/**
 * A name must appear beside a classified subject at least this many times.
 * Raised from 3 after the first run: "בנימין נתניהו" was given a field on the
 * strength of four appearances and then applied to 498 rows, most of them OCR
 * page headers rather than meetings. Evidence this thin cannot carry that much.
 */
const MIN_SUPPORTING_ROWS = 5;
/** And that many rows must be at least this share of its classified appearances. */
const MIN_DOMINANCE = 0.7;
/**
 * An inference may not be extrapolated further than this multiple of the rows
 * that evidence it. A name seen five times in context does not get to relabel
 * five hundred rows.
 */
const MAX_EXTRAPOLATION = 8;
/** Name candidates are this many Hebrew words — enough to be a name, short
 *  enough not to be a sentence. */
const MIN_NAME_WORDS = 2;
const MAX_NAME_WORDS = 4;
const NAME_SHAPE = /^[א-ת"'\- ]{4,40}$/;

/** Titles that, appearing beside a name in some other row, evidence a person. */
const PERSONAL_TITLES = [
  'מר',
  "גב'",
  'ד"ר',
  "פרופ'",
  'הרב',
  'הרבנית',
  'עו"ד',
  'רו"ח',
  'ח"כ',
  'השר',
  'השרה',
  'מנכ"ל',
  'מנכ"לית',
  'ראש העיר',
  'ראש המועצה',
  'שגריר',
  'רה"מ',
  'יו"ר',
];

/** Categories that carry no topic, so they are never evidence of a field. */
const NON_TOPIC_CATEGORIES = new Set([
  'unclassified',
  'meeting_without_subject',
  'named_person_meeting',
  'unspecified',
  'no_subject_recorded',
]);

interface ShardEntry {
  id: string;
  subject: string;
  categoryId?: string;
  matchedKeyword?: string | null;
  matchedConfidence?: 'high' | 'medium' | 'low' | null;
  inferredFrom?: string | null;
  [key: string]: unknown;
}

interface DiariesIndex {
  shards: Array<{ shardKey: string; file: string }>;
  datasets: Array<{ personLabel: string | null }>;
}

interface CategoriesSeed {
  categories: Array<{ id: string; keywords: Array<string | { keyword: string }> }>;
}

/**
 * Whether a tally of the fields a name appeared beside is strong enough to
 * attribute the name to one of them. Pure, so the thresholds can be tested
 * rather than trusted.
 */
export function decideNameField(tally: ReadonlyMap<string, number>): {
  categoryId: string;
  supportingRows: number;
  classifiedAppearances: number;
  dominance: number;
} | null {
  const classifiedAppearances = [...tally.values()].reduce((sum, n) => sum + n, 0);
  if (classifiedAppearances === 0) return null;
  // Sorted by support, then by id, so a tie can never depend on insertion order.
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (best === undefined) return null;
  if (best[1] < MIN_SUPPORTING_ROWS) return null;
  if (best[1] / classifiedAppearances < MIN_DOMINANCE) return null;
  return {
    categoryId: best[0],
    supportingRows: best[1],
    classifiedAppearances,
    dominance: Math.round((best[1] / classifiedAppearances) * 1000) / 10,
  };
}

/**
 * Whether an inference would be stretched further than its evidence can carry.
 * "בנימין נתניהו" was attributed on four appearances and then applied to 498
 * rows, most of them OCR page headers; this is the guard that refuses that.
 */
export function isOverExtrapolated(supportingRows: number, wouldTouch: number): boolean {
  return wouldTouch > supportingRows * MAX_EXTRAPOLATION;
}

interface NameEvidence {
  name: string;
  categoryId: string;
  supportingRows: number;
  classifiedAppearances: number;
  dominance: number;
  rowsAffected: number;
}

function main(): void {
  const index = readJson<DiariesIndex>(path.join(PROCESSED_DIR, 'diaries-index.json'));
  // Any word the taxonomy already knows means the candidate is a phrase, not a
  // person: "ראיון טלפוני", "פגישת מטה", "לשכה ירושלים" and "דיון סטאטוס" all
  // reached the first run's output as if they were people's names.
  const seed = readJson<CategoriesSeed>(path.join(RAW_DIR, 'seeds', 'diary-categories.seed.json'));
  const vocabularyWords = new Set<string>();
  for (const category of seed.categories) {
    for (const entry of category.keywords) {
      const text = normalizeSubject(typeof entry === 'string' ? entry : entry.keyword);
      for (const word of text.split(' ')) if (word.length > 1) vocabularyWords.add(word);
    }
  }
  const shardPaths = index.shards.map((s) => path.join(PROCESSED_DIR, s.file));
  const shards = shardPaths.map((p) => readJson<ShardEntry[]>(p));

  // Flatten once; every step below reads this and only the last step writes.
  const rows: Array<{ shard: number; at: number; subject: string; categoryId: string }> = [];
  shards.forEach((entries, shard) => {
    entries.forEach((entry, at) => {
      rows.push({
        shard,
        at,
        subject: normalizeSubject(entry.subject),
        categoryId: entry.categoryId ?? '',
      });
    });
  });

  // ---- 1. candidate names -------------------------------------------------
  // Two sources, both from the corpus: a row whose entire subject has the shape
  // of a name, and the office holders the publications themselves name.
  const candidates = new Set<string>();
  for (const row of rows) {
    if (!NON_TOPIC_CATEGORIES.has(row.categoryId)) continue;
    const words = row.subject.split(' ').filter(Boolean);
    if (words.length < MIN_NAME_WORDS || words.length > MAX_NAME_WORDS) continue;
    if (!NAME_SHAPE.test(row.subject)) continue;
    if (words.some((w) => vocabularyWords.has(w))) continue;
    candidates.add(row.subject);
  }
  for (const dataset of index.datasets) {
    const label = normalizeSubject(dataset.personLabel ?? '');
    const words = label.split(' ').filter(Boolean);
    if (
      words.length >= MIN_NAME_WORDS &&
      words.length <= MAX_NAME_WORDS &&
      NAME_SHAPE.test(label)
    ) {
      candidates.add(label);
    }
  }

  // ---- 2. inverted index over words, so a name can be found in other rows --
  const postings = new Map<string, number[]>();
  rows.forEach((row, i) => {
    for (const word of new Set(row.subject.split(' ').filter((w) => w.length > 1))) {
      const list = postings.get(word);
      if (list === undefined) postings.set(word, [i]);
      else list.push(i);
    }
  });

  const rowsContaining = (name: string): number[] => {
    const words = name.split(' ').filter((w) => w.length > 1);
    if (words.length === 0) return [];
    let candidateRows: number[] | null = null;
    for (const word of words) {
      const list = postings.get(word) ?? [];
      if (candidateRows === null) {
        candidateRows = [...list];
      } else {
        const set = new Set(list);
        candidateRows = candidateRows.filter((i) => set.has(i));
      }
      if (candidateRows.length === 0) return [];
    }
    // The word index is an approximation — confirm the name appears as a whole
    // phrase, not as its words scattered through a sentence.
    return (candidateRows ?? []).filter((i) => matchesAsWord(rows[i]?.subject ?? '', name));
  };

  // ---- 3. resolve each name to a field, or to personhood only -------------
  const resolved = new Map<string, NameEvidence>();
  const peopleWithoutField = new Set<string>();
  for (const name of [...candidates].sort()) {
    const containing = rowsContaining(name);
    const tally = new Map<string, number>();
    let titled = false;
    for (const i of containing) {
      const row = rows[i];
      if (row === undefined) continue;
      if (row.subject !== name && PERSONAL_TITLES.some((t) => matchesAsWord(row.subject, t))) {
        titled = true;
      }
      if (NON_TOPIC_CATEGORIES.has(row.categoryId) || row.categoryId === '') continue;
      tally.set(row.categoryId, (tally.get(row.categoryId) ?? 0) + 1);
    }
    const decision = decideNameField(tally);
    if (decision !== null) {
      resolved.set(name, { name, ...decision, rowsAffected: 0 });
    } else if (titled || name.split(' ').length >= MIN_NAME_WORDS) {
      peopleWithoutField.add(name);
    }
  }

  // ---- 4. count what each inference would touch, and refuse the reckless ---
  // Applying first and checking afterwards would leave rows already relabelled,
  // so the reach of every inference is measured before any row is written.
  const resolvedByLength = [...resolved.keys()].sort((a, b) => b.length - a.length);
  const reach = new Map<string, number>();
  const targetRows: Array<{ row: (typeof rows)[number]; name: string }> = [];
  for (const row of rows) {
    if (!NON_TOPIC_CATEGORIES.has(row.categoryId)) continue;
    if (row.categoryId === 'no_subject_recorded' || row.categoryId === 'unspecified') continue;
    const hit = resolvedByLength.find((name) => matchesAsWord(row.subject, name));
    if (hit === undefined) continue;
    reach.set(hit, (reach.get(hit) ?? 0) + 1);
    targetRows.push({ row, name: hit });
  }
  const overExtrapolated: Array<{ name: string; supportingRows: number; wouldTouch: number }> = [];
  for (const [name, wouldTouch] of reach) {
    const evidence = resolved.get(name);
    if (evidence === undefined) continue;
    if (isOverExtrapolated(evidence.supportingRows, wouldTouch)) {
      overExtrapolated.push({ name, supportingRows: evidence.supportingRows, wouldTouch });
      resolved.delete(name);
    }
  }

  // ---- 5. apply, longest name first so the most specific match wins -------
  const resolvedNames = [...resolved.keys()].sort((a, b) => b.length - a.length);
  let inferredField = 0;
  let namedOnly = 0;
  for (const row of rows) {
    if (!NON_TOPIC_CATEGORIES.has(row.categoryId)) continue;
    // A row the office left blank stays blank: there is no name in it to read.
    if (row.categoryId === 'no_subject_recorded' || row.categoryId === 'unspecified') continue;
    const entry = shards[row.shard]?.[row.at];
    if (entry === undefined) continue;

    const hit = resolvedNames.find((name) => matchesAsWord(row.subject, name));
    if (hit !== undefined) {
      const evidence = resolved.get(hit);
      if (evidence === undefined) continue;
      entry.categoryId = evidence.categoryId;
      entry.matchedKeyword = hit;
      entry.matchedConfidence = 'low';
      entry.inferredFrom = 'name_cooccurrence';
      evidence.rowsAffected += 1;
      inferredField += 1;
      continue;
    }
    if (row.categoryId === 'unclassified' && peopleWithoutField.has(row.subject)) {
      entry.categoryId = 'named_person_meeting';
      entry.matchedKeyword = row.subject;
      entry.matchedConfidence = 'low';
      entry.inferredFrom = 'name_without_field';
      namedOnly += 1;
    }
  }

  shardPaths.forEach((p, i) => writeJson(p, shards[i]));

  // The published category counts were written by the classifier, before any of
  // the rows above moved. Recompute them here rather than leave the site showing
  // a total that no longer matches its own shards.
  const categoriesPath = path.join(PROCESSED_DIR, 'diary-categories.json');
  const categoriesFile = readJson<{
    categories: Array<{ id: string; entryCount: number }>;
    totals: { classifiedEntries: number; byMatchConfidence: Record<string, number> };
  }>(categoriesPath);
  const recount = new Map<string, number>();
  const confidenceCount: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const shard of shards) {
    for (const entry of shard) {
      const id = entry.categoryId ?? '';
      recount.set(id, (recount.get(id) ?? 0) + 1);
      const confidence = entry.matchedConfidence ?? null;
      if (confidence !== null) confidenceCount[confidence] = (confidenceCount[confidence] ?? 0) + 1;
    }
  }
  for (const category of categoriesFile.categories) {
    category.entryCount = recount.get(category.id) ?? 0;
  }
  categoriesFile.categories.sort((a, b) => b.entryCount - a.entryCount);
  categoriesFile.totals.byMatchConfidence = confidenceCount as Record<string, number>;
  writeJson(categoriesPath, categoriesFile);

  const inferences = [...resolved.values()]
    .filter((e) => e.rowsAffected > 0)
    .sort((a, b) => b.rowsAffected - a.rowsAffected || a.name.localeCompare(b.name));
  writeJson(path.join(PROCESSED_DIR, 'diary-name-inferences.json'), {
    generatedAt: new Date().toISOString().slice(0, 10),
    method:
      'שיוך שם לתחום נעשה מתוך היומנים עצמם: אם אותו שם מופיע בשורות אחרות שנושאן כן סווג, הקטגוריה של אותן שורות היא עדות לגבי השורה שאין בה נושא. לא נעשה שימוש בשום ידע חיצוני על זהות אנשים — ידע כזה אינו ניתן לאימות על ידי הקורא.',
    rule: `שם מיוחס לתחום רק אם הוא מופיע לצד נושא מסווג לפחות ${MIN_SUPPORTING_ROWS} פעמים, ולפחות ${Math.round(MIN_DOMINANCE * 100)}% מהופעותיו המסווגות הן באותו תחום. שם שאינו עומד בכך, ושהקורפוס מראה שהוא של אדם (תואר אישי לצדו בשורה אחרת), מסומן כ"פגישה עם אדם ששמו נקוב, בלי נושא".`,
    caveats: [
      'זו הסקה, לא ציטוט: הלשכה לא כתבה את התחום. כל שורה כזו מסומנת בממשק כמסקנה ורמת הביטחון שלה נמוכה.',
      'שם זהה יכול להיות של שני אנשים שונים. ההסקה נשענת על רוב ההופעות ולא על זיהוי ודאי.',
      'פגישה עם אדם מתחום מסוים אינה קובעת שנושא הפגישה היה אותו תחום.',
    ],
    thresholds: { MIN_SUPPORTING_ROWS, MIN_DOMINANCE, MIN_NAME_WORDS, MAX_NAME_WORDS },
    totals: {
      candidateNames: candidates.size,
      namesResolvedToField: inferences.length,
      rowsGivenAFieldByInference: inferredField,
      rowsMarkedAsNamedPersonOnly: namedOnly,
      inferencesRefusedAsOverExtrapolated: overExtrapolated.length,
    },
    inferences,
    refusedAsOverExtrapolated: overExtrapolated.sort((a, b) => b.wouldTouch - a.wouldTouch),
  });

  console.log(
    `infer-diary-participants: ${candidates.size} שמות נבדקו · ${inferences.length} שויכו לתחום מתוך היומנים · ` +
      `${inferredField} שורות קיבלו תחום בהסקה · ${namedOnly} שורות סומנו כפגישה עם אדם ששמו נקוב · ` +
      `${overExtrapolated.length} הסקות נדחו כהכללה מרחיקת לכת`,
  );
}

if (process.argv[1]?.includes('infer-diary-participants')) main();
