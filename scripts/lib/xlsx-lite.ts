/**
 * Minimal, dependency-free XLSX reader for build-time extraction.
 *
 * An .xlsx file is a ZIP of XML parts. Everything needed to read a diary sheet
 * is here: locate the entries in the ZIP central directory, inflate them, and
 * pull cell values out of the sheet XML (resolving shared strings).
 *
 * Why not a library: the published site ships no parser at all, this runs once
 * at build time, and the popular SheetJS builds on npm carry a prototype-
 * pollution advisory. ~150 auditable lines beat an unaudited dependency for a
 * job this narrow.
 *
 * Deliberately not supported: legacy binary .xls (a different format
 * altogether), formulas (the cached value is read instead), and styles — so a
 * date cell arrives as its Excel serial number, which the diary date parser
 * already understands.
 */
import { inflateRawSync, inflateSync } from 'node:zlib';

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}
function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

/** Locates the End Of Central Directory record, scanning back from the tail. */
function findEocd(buffer: Buffer): number | null {
  const minOffset = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (readUInt32(buffer, i) === 0x06054b50) return i;
  }
  return null;
}

export function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer);
  if (eocd === null) throw new Error('not a zip archive: no end-of-central-directory record');
  const entryCount = readUInt16(buffer, eocd + 10);
  let offset = readUInt32(buffer, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) break;
    const compressionMethod = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const uncompressedSize = readUInt32(buffer, offset + 24);
    const nameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const local = entry.localHeaderOffset;
  if (readUInt32(buffer, local) !== 0x04034b50) throw new Error(`bad local header: ${entry.name}`);
  const nameLength = readUInt16(buffer, local + 26);
  const extraLength = readUInt16(buffer, local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(raw);
  if (entry.compressionMethod === 8) return inflateRawSync(raw);
  // Some producers write zlib-wrapped data under method 8; try that as a fallback.
  return inflateSync(raw);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** Concatenates the <t> runs of one shared-string item. */
function textOfSharedItem(xml: string): string {
  const parts = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '');
  return decodeXmlEntities(parts.join(''));
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOfSharedItem(m[1] ?? ''));
}

/** "BC12" → 0-based column index 54. */
export function columnIndexOf(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase())?.[1] ?? 'A';
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

export type CellValue = string | number | null;

/**
 * Reads the first worksheet as a rectangular grid of raw cell values.
 * Empty cells are null; numbers stay numbers (Excel date serials included).
 */
export function readXlsxGrid(buffer: Buffer, maxRows = 20_000): CellValue[][] {
  const entries = listZipEntries(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const sharedEntry = byName.get('xl/sharedStrings.xml');
  const shared =
    sharedEntry === undefined
      ? []
      : parseSharedStrings(readEntry(buffer, sharedEntry).toString('utf8'));

  // Prefer sheet1; otherwise the first worksheet part present in the archive.
  const sheetEntry =
    byName.get('xl/worksheets/sheet1.xml') ??
    entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (sheetEntry === undefined) throw new Error('no worksheet part in workbook');
  const sheetXml = readEntry(buffer, sheetEntry).toString('utf8');

  const grid: CellValue[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (grid.length >= maxRows) break;
    const rowXml = rowMatch[1] ?? '';
    const row: CellValue[] = [];
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const index = reference === undefined ? row.length : columnIndexOf(reference);
      while (row.length < index) row.push(null);

      let value: CellValue = null;
      if (type === 'inlineStr') {
        value = textOfSharedItem(body);
      } else if (type === 's') {
        const sharedIndex = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? 'NaN');
        value = Number.isInteger(sharedIndex) ? (shared[sharedIndex] ?? null) : null;
      } else if (type === 'str') {
        value = decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw !== undefined && raw !== '') {
          const asNumber = Number(raw);
          value = Number.isFinite(asNumber) ? asNumber : decodeXmlEntities(raw);
        }
      }
      row[index] = typeof value === 'string' && value.trim() === '' ? null : value;
    }
    grid.push(row);
  }
  return grid;
}

/** CSV with quoted fields, for the plain-text diary exports. */
export function parseCsvGrid(text: string, maxRows = 20_000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (inQuotes) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length >= maxRows) return rows;
    } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
