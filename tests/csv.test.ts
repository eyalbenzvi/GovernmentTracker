import { describe, expect, it } from 'vitest';
import { UTF8_BOM, buildCsv, csvEscape } from '../src/lib/csv';

describe('csvEscape', () => {
  it('quotes values containing a comma, quote or newline', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('joins arrays with a semicolon so commas stay unambiguous', () => {
    expect(csvEscape(['a', 'b'])).toBe('a; b');
  });

  it('renders null and undefined as empty, not as the string "null"', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('keeps Hebrew text intact', () => {
    expect(csvEscape('תקציב מעודכן')).toBe('תקציב מעודכן');
  });
});

describe('buildCsv', () => {
  it('starts with a UTF-8 BOM so Excel reads Hebrew correctly', () => {
    expect(buildCsv(['a'], [[1]]).startsWith(UTF8_BOM)).toBe(true);
  });

  it('writes a header row and CRLF-separated data rows', () => {
    const csv = buildCsv(['שנה', 'סכום'], [[2025, 100]]);
    const lines = csv.replace(UTF8_BOM, '').trim().split('\r\n');
    expect(lines[0]).toBe('שנה,סכום');
    expect(lines[1]).toBe('2025,100');
  });

  it('produces a header-only file for an empty result set', () => {
    const csv = buildCsv(['a', 'b'], []);
    expect(csv.replace(UTF8_BOM, '').trim()).toBe('a,b');
  });
});
