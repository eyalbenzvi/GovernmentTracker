/**
 * classify-diary-categories — assigns every diary entry to one subject
 * category, deterministically.
 *
 * Input:  data/processed/diaries-index.json + data/processed/diaries/*.json
 *         data/raw/seeds/diary-categories.seed.json  (taxonomy + keyword lists,
 *                                                     authored with a language
 *                                                     model at build time and
 *                                                     stored in full)
 * Output: data/processed/diary-categories.json, and a categoryId written onto
 *         every row of every shard
 *
 * No language model runs here and none runs in the published site. The seed
 * holds the vocabulary; this script only matches it, longest keyword wins, and
 * records the exact keyword that fired on the row itself, so any reader can
 * audit or dispute a single assignment.
 *
 * Three categories are not subject categories, and the difference between them
 * is the difference between a fact about the office and a fact about this site:
 *
 *   unspecified          the office published text that says nothing ("פגישה").
 *                        This, and only this, is the transparency measure.
 *   no_subject_recorded  no subject text at all — an empty cell in the source,
 *                        or a column this site failed to identify.
 *   unclassified         real, informative text that our keyword vocabulary
 *                        does not cover. Our gap, reported as coverage.
 *
 * Collapsing any of them into the others would let this site's own limits be
 * published as an office-holder's opacity. None of them is ever guessed away.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';

interface CategorySeed {
  id: string;
  labelHe: string;
  description: string;
  color: string;
  priority: number;
  reasoning: string;
  keywords: string[];
}

interface CategoriesSeedFile {
  method: string;
  purpose: string;
  classifierRule: string;
  limitations: string[];
  genericSubjects: string[];
  /** Subjects the collector writes when the source recorded no subject text. */
  noSubjectSentinels: string[];
  categories: CategorySeed[];
}

export function normalizeSubject(subject: string): string {
  return subject
    .replace(/["'״׳]/g, '"')
    .replace(/[‏‎]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A subject is generic when, stripped of punctuation, it *is* a generic term. */
export function isGenericSubject(subject: string, genericSubjects: readonly string[]): boolean {
  const bare = normalizeSubject(subject)
    .replace(/["'.,:;!?()\-–—*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (bare === '') return true;
  return genericSubjects.some((g) => {
    const normalizedGeneric = g
      .replace(/["'.,:;!?()\-–—*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return normalizedGeneric !== '' && bare === normalizedGeneric;
  });
}

export interface CategoryMatch {
  categoryId: string;
  matchedKeyword: string | null;
  rule: 'no_subject_recorded' | 'generic_subject' | 'keyword_match' | 'no_match';
}

const HEBREW_LETTER = /[א-ת]/;

/**
 * The one-letter particles Hebrew attaches to the front of a word: and, the,
 * in, to, as, from, that. They are part of the sentence, not of the word, so a
 * keyword must still match through them — "בכנסת" is "כנסת".
 */
const PROCLITICS = new Set(['ו', 'ה', 'ב', 'ל', 'כ', 'מ', 'ש']);
const MAX_PROCLITIC_RUN = 3; // e.g. "וכשה"

function isHebrewLetter(ch: string | undefined): boolean {
  return ch !== undefined && HEBREW_LETTER.test(ch);
}

/**
 * Whether a keyword occurrence stands as its own word.
 *
 * JavaScript's `\b` is defined over [A-Za-z0-9_], so next to Hebrew letters it
 * matches at every position and is worthless. A plain substring test is worse
 * than worthless here, because Hebrew words routinely contain each other:
 * "נסיעה" (a trip) contains "סיעה" (a party faction), "הכנסות" (revenues) and
 * "התכנסות" (a gathering) both contain "כנס" (a conference), "חברתי" (social)
 * contains "חברת" (company of). All three were misclassifying real entries.
 *
 * Left side: the occurrence must start a word, allowing only a run of
 * proclitics before it. Right side: a Hebrew letter directly after means the
 * text is a longer word, so the match is rejected — inflected forms belong in
 * the seed's vocabulary, explicitly, rather than being guessed by morphology
 * this site does not implement. A keyword that deliberately ends in a
 * proclitic ("ביקור ב") is exempt from the right-side rule: its whole purpose
 * is to attach to the word that follows.
 */
export function matchesAsWord(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  const endsWithAttachingPrefix = /\s[ובלכמ]$/.test(needle);
  for (let from = 0; from <= haystack.length - needle.length;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    if (boundsAWord(haystack, at, needle.length, endsWithAttachingPrefix)) return true;
    from = at + 1;
  }
  return false;
}

function boundsAWord(
  haystack: string,
  at: number,
  length: number,
  endsWithAttachingPrefix: boolean,
): boolean {
  if (!endsWithAttachingPrefix && isHebrewLetter(haystack[at + length])) return false;
  let run = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = haystack[i];
    if (!isHebrewLetter(ch)) break;
    if (run >= MAX_PROCLITIC_RUN || ch === undefined || !PROCLITICS.has(ch)) return false;
    run += 1;
  }
  return true;
}

/**
 * Longest-keyword-wins matching. Length is the tie-break that keeps
 * "ישיבת ממשלה" from being swallowed by "ישיבה", and declared priority
 * resolves exact-length ties so the result never depends on object order.
 */
export function classifySubject(
  subject: string,
  categories: readonly CategorySeed[],
  genericSubjects: readonly string[],
  noSubjectSentinels: readonly string[] = [],
): CategoryMatch {
  // "The office wrote nothing" and "the office wrote something uninformative"
  // are different facts, and only the second is a choice by the office: an
  // absent subject can also come from a column this site failed to identify.
  // Conflating them would let our own extraction gaps inflate a transparency
  // measure, so the sentinel is checked first and kept in its own category.
  if (isGenericSubject(subject, noSubjectSentinels)) {
    return { categoryId: 'no_subject_recorded', matchedKeyword: null, rule: 'no_subject_recorded' };
  }
  if (isGenericSubject(subject, genericSubjects)) {
    return { categoryId: 'unspecified', matchedKeyword: null, rule: 'generic_subject' };
  }
  const haystack = normalizeSubject(subject).toLowerCase();
  let best: { category: CategorySeed; keyword: string } | null = null;
  for (const category of categories) {
    for (const keyword of category.keywords) {
      const needle = normalizeSubject(keyword).toLowerCase();
      if (needle === '' || !matchesAsWord(haystack, needle)) continue;
      if (
        best === null ||
        needle.length > best.keyword.length ||
        (needle.length === best.keyword.length && category.priority < best.category.priority)
      ) {
        best = { category, keyword: needle };
      }
    }
  }
  if (best === null) {
    // Not "the office was opaque" — "our vocabulary did not cover this text".
    // These two were one category until an audit showed the consequence: rows
    // with perfectly informative subjects were counted into a person's opacity
    // score, and fed a published finding against them by name.
    return { categoryId: 'unclassified', matchedKeyword: null, rule: 'no_match' };
  }
  return { categoryId: best.category.id, matchedKeyword: best.keyword, rule: 'keyword_match' };
}

interface DiariesIndex {
  shards: Array<{ shardKey: string; file: string; entryCount: number }>;
  totals: { entries: number };
}

interface ShardEntry {
  id: string;
  subject: string;
  [key: string]: unknown;
}

function main(): void {
  const seed = readJson<CategoriesSeedFile>(
    path.join(RAW_DIR, 'seeds', 'diary-categories.seed.json'),
  );
  const index = readJson<DiariesIndex>(path.join(PROCESSED_DIR, 'diaries-index.json'));

  const counts = new Map<string, number>();
  let classified = 0;

  // Entries live in per-section shards; each is classified and rewritten in
  // place, so the category travels with the row the reader is looking at and no
  // second index of ~190k assignments has to be shipped.
  for (const shard of index.shards) {
    const shardPath = path.join(PROCESSED_DIR, shard.file);
    const entries = readJson<ShardEntry[]>(shardPath);
    const updated = entries.map((entry) => {
      const match = classifySubject(
        entry.subject,
        seed.categories,
        seed.genericSubjects,
        seed.noSubjectSentinels,
      );
      counts.set(match.categoryId, (counts.get(match.categoryId) ?? 0) + 1);
      classified += 1;
      return { ...entry, categoryId: match.categoryId, matchedKeyword: match.matchedKeyword };
    });
    writeJson(shardPath, updated);
  }

  const output = {
    generatedAt: new Date().toISOString().slice(0, 10),
    method: seed.method,
    methodNote: seed.purpose,
    classifierRule: seed.classifierRule,
    limitations: seed.limitations,
    categories: seed.categories
      .map((c) => ({
        id: c.id,
        labelHe: c.labelHe,
        description: c.description,
        color: c.color,
        reasoning: c.reasoning,
        keywordCount: c.keywords.length,
        entryCount: counts.get(c.id) ?? 0,
      }))
      .sort((a, b) => b.entryCount - a.entryCount),
    totals: { classifiedEntries: classified },
  };

  writeJson(path.join(PROCESSED_DIR, 'diary-categories.json'), output);
  console.log(
    `classify-diary-categories: ${classified} רשומות סווגו ל-${output.categories.filter((c) => c.entryCount > 0).length} קטגוריות בשימוש`,
  );
  for (const category of output.categories.filter((c) => c.entryCount > 0)) {
    const share = classified === 0 ? 0 : (category.entryCount / classified) * 100;
    console.log(`  ${category.labelHe}: ${category.entryCount} (${share.toFixed(1)}%)`);
  }
}

import { pathToFileURL } from 'node:url';
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
