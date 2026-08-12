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
 * A subject that matches nothing — or that consists only of a generic word
 * such as "פגישה" — lands in `unspecified`. That is not a failure of the
 * classifier: the share of unspecified entries is itself one of the most
 * telling transparency measures on the screen, so it must never be papered
 * over with a guess.
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
  rule: 'generic_subject' | 'keyword_match' | 'no_match';
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
): CategoryMatch {
  if (isGenericSubject(subject, genericSubjects)) {
    return { categoryId: 'unspecified', matchedKeyword: null, rule: 'generic_subject' };
  }
  const haystack = normalizeSubject(subject).toLowerCase();
  let best: { category: CategorySeed; keyword: string } | null = null;
  for (const category of categories) {
    for (const keyword of category.keywords) {
      const needle = normalizeSubject(keyword).toLowerCase();
      if (needle === '' || !haystack.includes(needle)) continue;
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
    return { categoryId: 'unspecified', matchedKeyword: null, rule: 'no_match' };
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
      const match = classifySubject(entry.subject, seed.categories, seed.genericSubjects);
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
