/**
 * audit-diary-vocabulary — checks a keyword vocabulary against the real rows
 * before it is trusted.
 *
 * Usage: npx tsx scripts/audit-diary-vocabulary.ts [--limit N] [--keyword X]
 *
 * A keyword list authored from samples can be wrong in two directions, and only
 * the collected data can tell you which:
 *   - it fires on nothing, and is dead weight;
 *   - it fires on the wrong thing, and quietly mislabels rows at scale.
 *
 * For every keyword in the seed this prints how many rows it would claim and a
 * few of the subjects it claims, so a human can see what a keyword actually
 * does. Nothing is written; this is a reading tool, run before and after a merge.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson } from './lib/paths.js';
import {
  keywordConfidenceOf,
  keywordTextOf,
  matchesAsWord,
  normalizeSubject,
} from './classify-diary-categories.js';
import type { SeedKeyword } from './classify-diary-categories.js';

interface CategorySeed {
  id: string;
  labelHe: string;
  priority: number;
  keywords: SeedKeyword[];
}
interface SeedFile {
  categories: CategorySeed[];
}
interface ShardEntry {
  subject: string;
}

function main(): void {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const sampleSize = limitArg >= 0 ? Number(args[limitArg + 1] ?? '3') : 3;
  const keywordArg = args.indexOf('--keyword');
  const onlyKeyword = keywordArg >= 0 ? (args[keywordArg + 1] ?? null) : null;

  const seed = readJson<SeedFile>(path.join(RAW_DIR, 'seeds', 'diary-categories.seed.json'));
  const index = readJson<{ shards: Array<{ file: string }> }>(
    path.join(PROCESSED_DIR, 'diaries-index.json'),
  );

  const subjects: string[] = [];
  for (const shard of index.shards) {
    for (const row of readJson<ShardEntry[]>(path.join(PROCESSED_DIR, shard.file))) {
      subjects.push(normalizeSubject(row.subject).toLowerCase());
    }
  }

  // Longest-match-wins means a keyword's real effect is only what no longer
  // keyword already claimed, so the audit reports both numbers.
  const allKeywords: Array<{ categoryId: string; keyword: string; confidence: string }> = [];
  for (const category of seed.categories) {
    for (const entry of category.keywords) {
      allKeywords.push({
        categoryId: category.id,
        keyword: normalizeSubject(keywordTextOf(entry)).toLowerCase(),
        confidence: keywordConfidenceOf(entry),
      });
    }
  }
  allKeywords.sort((a, b) => b.keyword.length - a.keyword.length);

  const rows: Array<{
    keyword: string;
    categoryId: string;
    confidence: string;
    hits: number;
    examples: string[];
  }> = [];
  for (const k of allKeywords) {
    if (onlyKeyword !== null && k.keyword !== normalizeSubject(onlyKeyword).toLowerCase()) continue;
    const examples: string[] = [];
    let hits = 0;
    for (const subject of subjects) {
      if (!matchesAsWord(subject, k.keyword)) continue;
      hits += 1;
      if (examples.length < sampleSize && !examples.includes(subject)) examples.push(subject);
    }
    rows.push({ ...k, hits, examples });
  }

  const dead = rows.filter((r) => r.hits === 0);
  console.log(`\n=== ${rows.length} מילות מפתח נבדקו מול ${subjects.length} רשומות ===\n`);
  console.log(`מילות מפתח שאינן תופסות שום רשומה: ${dead.length}`);
  if (dead.length > 0) {
    console.log('  ' + dead.map((d) => `${d.keyword} (${d.categoryId})`).join(' · '));
  }
  console.log('\n--- לפי תפוקה ---');
  for (const r of [...rows].sort((a, b) => b.hits - a.hits)) {
    if (r.hits === 0) continue;
    console.log(
      `${String(r.hits).padStart(6)}  ${r.keyword}  →  ${r.categoryId} [${r.confidence}]`,
    );
    for (const e of r.examples) console.log(`         · ${e.slice(0, 90)}`);
  }
}

main();
