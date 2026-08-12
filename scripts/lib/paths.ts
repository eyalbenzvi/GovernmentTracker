import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const RAW_DIR = path.join(DATA_DIR, 'raw');
export const SEARCH_DISCOVERY_DIR = path.join(RAW_DIR, 'search-discovery');
export const COLLECTION_LOG_DIR = path.join(RAW_DIR, 'collection-log');
export const PROCESSED_DIR = path.join(DATA_DIR, 'processed');
export const CSV_DIR = path.join(PROCESSED_DIR, 'csv');
export const CACHE_DIR = path.join(DATA_DIR, '.cache');

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/**
 * Writes JSON deterministically (stable key order as provided, 2-space indent,
 * trailing newline) so that re-running a collector on unchanged inputs produces
 * a byte-identical file and therefore no spurious git diff.
 */
export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(file: string, value: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

export function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => path.join(dir, f));
}
