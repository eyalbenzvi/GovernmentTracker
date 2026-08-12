/**
 * Minimal RFC-4180 CSV writer for the downloadable data files.
 *
 * A UTF-8 BOM is prepended because the primary consumer of these files is
 * Excel on Windows, which otherwise renders Hebrew as mojibake.
 */
export const UTF8_BOM = '﻿';

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
