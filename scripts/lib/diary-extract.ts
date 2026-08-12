/**
 * Extraction of diary rows from the formats offices actually publish.
 *
 * Three shapes are handled, each with its own fidelity label so a reader always
 * knows how a row reached the screen:
 *   - a spreadsheet grid (XLSX/CSV) → 'spreadsheet', exact values;
 *   - text extracted from a PDF that carries a text layer → 'pdf_text', exact
 *     characters but reconstructed row boundaries;
 *   - text produced by OCR over a scanned PDF → 'pdf_ocr', characters
 *     themselves are a machine's reading of an image and can be wrong.
 *
 * The rules below are conservative on purpose. A line that does not yield a
 * date is counted as unparsed and reported, never invented; a grid with no
 * recognisable header is refused rather than mapped by position, because
 * guessing which column held the subject would silently fabricate content.
 */
import type { CellValue } from './xlsx-lite.js';

export type ExtractionMethod = 'datastore' | 'spreadsheet' | 'pdf_text' | 'pdf_ocr';

export interface ExtractedRow {
  subject: string | null;
  startDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  participants: string | null;
}

export interface ExtractionResult {
  rows: ExtractedRow[];
  unparsedLineCount: number;
  headerFound: boolean;
  headerText: string | null;
  note: string | null;
}

const HEADER_TARGETS: ReadonlyArray<[RegExp, keyof ExtractedRow]> = [
  [/^נושא|נושא הפגישה|נושא הפעילות|תיאור|פעילות$/, 'subject'],
  [/תאריך\s*(?:התחלה|הפגישה|יום)?$|^תאריך/, 'startDate'],
  [/שעת\s*התחלה|^שעה|משעה/, 'startTime'],
  [/שעת\s*סיום|עד שעה|^סיום/, 'endTime'],
  [/מיקום|מקום|כתובת|אולם/, 'location'],
  [/משתתפים|נוכחים|מוזמנים|עם מי/, 'participants'],
];

function cellText(value: CellValue): string {
  if (value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Finds the header row and maps its columns. Requires two distinct recognised
 * columns, so a stray cell containing the word "תאריך" cannot be mistaken for
 * a table header.
 */
export function mapGridHeader(grid: readonly CellValue[][]): {
  headerRowIndex: number;
  columns: Map<number, keyof ExtractedRow>;
  headerText: string | null;
} {
  const limit = Math.min(grid.length, 20);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = grid[rowIndex];
    if (row === undefined) continue;
    const columns = new Map<number, keyof ExtractedRow>();
    row.forEach((cell, columnIndex) => {
      const text = cellText(cell).replace(/["'״׳:]/g, '');
      if (text === '') return;
      for (const [pattern, target] of HEADER_TARGETS) {
        if (pattern.test(text) && ![...columns.values()].includes(target)) {
          columns.set(columnIndex, target);
          return;
        }
      }
    });
    if (columns.size >= 2 && [...columns.values()].includes('subject')) {
      return {
        headerRowIndex: rowIndex,
        columns,
        headerText: row
          .map(cellText)
          .filter((t) => t !== '')
          .join(' | ')
          .slice(0, 200),
      };
    }
  }
  return { headerRowIndex: -1, columns: new Map(), headerText: null };
}

/** Extracts rows from a spreadsheet grid using its own header row. */
export function extractFromGrid(grid: readonly CellValue[][]): ExtractionResult {
  const { headerRowIndex, columns, headerText } = mapGridHeader(grid);
  if (headerRowIndex === -1) {
    const sample = grid
      .slice(0, 3)
      .map((row) =>
        row
          .map(cellText)
          .filter((t) => t !== '')
          .join(' | '),
      )
      .filter((line) => line !== '')
      .join(' ⏎ ')
      .slice(0, 200);
    return {
      rows: [],
      unparsedLineCount: grid.length,
      headerFound: false,
      headerText: null,
      note: `לא זוהתה שורת כותרות עם עמודת נושא${sample === '' ? '' : ` (תחילת הגיליון: ${sample})`}`,
    };
  }

  const rows: ExtractedRow[] = [];
  let unparsed = 0;
  let consecutiveEmpty = 0;
  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    if (row === undefined) continue;
    const values = new Map<keyof ExtractedRow, CellValue>();
    for (const [columnIndex, target] of columns) values.set(target, row[columnIndex] ?? null);
    const nonEmpty = [...values.values()].filter((v) => cellText(v) !== '').length;
    if (nonEmpty === 0) {
      consecutiveEmpty += 1;
      // A long empty stretch marks the end of the table; short gaps are normal.
      if (consecutiveEmpty >= 30) break;
      continue;
    }
    consecutiveEmpty = 0;
    const subject = cellText(values.get('subject') ?? null);
    const rawDate = values.get('startDate') ?? null;
    if (subject === '' && cellText(rawDate) === '') {
      unparsed += 1;
      continue;
    }
    rows.push({
      subject: subject === '' ? null : subject,
      // Dates/times stay raw here: the collector owns parsing, because Excel
      // serials, ISO strings and day-first text all arrive in this one column.
      startDate: rawDate === null ? null : String(rawDate),
      startTime: cellText(values.get('startTime') ?? null) || null,
      endTime: cellText(values.get('endTime') ?? null) || null,
      location: cellText(values.get('location') ?? null) || null,
      participants: cellText(values.get('participants') ?? null) || null,
    });
  }
  return { rows, unparsedLineCount: unparsed, headerFound: true, headerText, note: null };
}

const DATE_PATTERN = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
const TIME_PATTERN = /(\d{1,2}:\d{2})/;
const TIME_RANGE_PATTERN = /(\d{1,2}:\d{2})\s*(?:-|–|—|עד)\s*(\d{1,2}:\d{2})/;

/**
 * Parses diary lines out of flat text (pdftotext -layout output, or OCR).
 *
 * Printed diaries come in two layouts, and both appear in practice: one row
 * per line with the date repeated, or a date heading followed by time+subject
 * lines. A date heading is therefore remembered and applied to the lines under
 * it. Lines with neither a date nor a time are not diary rows (page headers,
 * column titles, footers) and are counted as unparsed.
 */
export function extractFromText(text: string, method: 'pdf_text' | 'pdf_ocr'): ExtractionResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');

  const rows: ExtractedRow[] = [];
  let unparsed = 0;
  let currentDate: string | null = null;

  for (const line of lines) {
    const dateMatch = DATE_PATTERN.exec(line);
    const rangeMatch = TIME_RANGE_PATTERN.exec(line);
    const timeMatch = rangeMatch === null ? TIME_PATTERN.exec(line) : null;

    // A line that is *only* a date is a heading for the rows beneath it.
    const withoutDate = dateMatch === null ? line : line.replace(dateMatch[1] ?? '', ' ').trim();
    const looksLikeHeading =
      dateMatch !== null && rangeMatch === null && timeMatch === null && withoutDate.length <= 12;
    if (looksLikeHeading) {
      currentDate = dateMatch?.[1] ?? null;
      continue;
    }

    const date = dateMatch?.[1] ?? currentDate;
    if (date === null || (rangeMatch === null && timeMatch === null && dateMatch === null)) {
      unparsed += 1;
      continue;
    }

    let subject = line;
    if (dateMatch?.[1] !== undefined) subject = subject.replace(dateMatch[1], ' ');
    if (rangeMatch !== null) subject = subject.replace(rangeMatch[0], ' ');
    else if (timeMatch?.[1] !== undefined) subject = subject.replace(timeMatch[1], ' ');
    subject = subject
      .replace(/^[\s|:•\-–—*]+|[\s|:•\-–—*]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (subject.length < 2) {
      unparsed += 1;
      continue;
    }
    rows.push({
      subject,
      startDate: date,
      startTime: rangeMatch?.[1] ?? timeMatch?.[1] ?? null,
      endTime: rangeMatch?.[2] ?? null,
      location: null,
      participants: null,
    });
  }

  return {
    rows,
    unparsedLineCount: unparsed,
    headerFound: rows.length > 0,
    headerText: null,
    note:
      method === 'pdf_ocr'
        ? 'הטקסט הופק בזיהוי תווים אוטומטי (OCR) מסריקה — ייתכנו שגיאות תעתיק'
        : 'הטקסט הופק משכבת הטקסט של ה-PDF; גבולות השורות שוחזרו',
  };
}
