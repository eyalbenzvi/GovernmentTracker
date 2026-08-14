/**
 * Tests for the diary extraction layer: the dependency-free XLSX/CSV reader and
 * the row recognisers that turn spreadsheets, PDF text and OCR output into diary
 * rows. These are the parts that decide what the site claims a diary said, so
 * the cases below focus on the ways they could invent or lose content.
 */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  columnIndexOf,
  parseCsvGrid,
  parseSharedStrings,
  readXlsxGrid,
} from '../scripts/lib/xlsx-lite';
import { extractFromGrid, extractFromText, mapGridHeader } from '../scripts/lib/diary-extract';
import {
  classifySubject,
  isGenericSubject,
  matchesAsWord,
  normalizeSubject,
} from '../scripts/classify-diary-categories';
import { mergeProposals } from '../scripts/merge-diary-expert-vocabulary';
import {
  coversMultiplePeople,
  isGovernmentEntityName,
  isWeekend,
  normalizeEntityName,
  personKeyOf,
  quarterOf,
} from '../scripts/analyze-diaries';

// ---------------------------------------------------------------------------
// A real (minimal) xlsx, built in-memory: store-only ZIP entries so the reader
// is exercised end to end without shipping a binary fixture.
// ---------------------------------------------------------------------------
function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function buildZip(files: Array<{ name: string; content: string; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.content, 'utf8');
    const stored = file.deflate === true ? deflateRawSync(raw) : raw;
    const method = file.deflate === true ? 8 : 0;

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    locals.push(local, stored);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centrals.push(central);

    offset += local.length + stored.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

const SHARED_STRINGS = `<?xml version="1.0"?><sst count="6" uniqueCount="6">
  <si><t>נושא</t></si>
  <si><t>תאריך התחלה</t></si>
  <si><t>שעת התחלה</t></si>
  <si><t>ישיבת ממשלה</t></si>
  <si><t>פגישה עם נציגי חברת בזק בע"מ</t></si>
  <si><t>מיקום</t></si>
</sst>`;

const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>5</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>45292</v></c><c r="C2" t="inlineStr"><is><t>09:30</t></is></c><c r="D2" t="str"><v>קריה</v></c></row>
  <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="str"><v>15/02/2024</v></c><c r="C3" t="inlineStr"><is><t>14:00</t></is></c></row>
</sheetData></worksheet>`;

function sampleWorkbook(deflate: boolean): Buffer {
  return buildZip([
    { name: 'xl/sharedStrings.xml', content: SHARED_STRINGS, deflate },
    { name: 'xl/worksheets/sheet1.xml', content: SHEET, deflate },
  ]);
}

describe('xlsx-lite', () => {
  it('resolves column references', () => {
    expect(columnIndexOf('A1')).toBe(0);
    expect(columnIndexOf('D7')).toBe(3);
    expect(columnIndexOf('AA1')).toBe(26);
    expect(columnIndexOf('BC12')).toBe(54);
  });

  it('reads shared strings including multi-run items', () => {
    const parsed = parseSharedStrings('<sst><si><r><t>אב</t></r><r><t>גד</t></r></si></sst>');
    expect(parsed).toEqual(['אבגד']);
  });

  it('reads a stored (uncompressed) workbook into a grid', () => {
    const grid = readXlsxGrid(sampleWorkbook(false));
    expect(grid[0]).toEqual(['נושא', 'תאריך התחלה', 'שעת התחלה', 'מיקום']);
    // Numbers stay numbers, so an Excel date serial survives to the date parser.
    expect(grid[1]).toEqual(['ישיבת ממשלה', 45292, '09:30', 'קריה']);
  });

  it('reads a deflated workbook identically', () => {
    expect(readXlsxGrid(sampleWorkbook(true))).toEqual(readXlsxGrid(sampleWorkbook(false)));
  });

  it('refuses a file that is not a zip instead of returning empty data', () => {
    expect(() => readXlsxGrid(Buffer.from('%PDF-1.7 not a spreadsheet'))).toThrow(/zip/i);
  });

  it('parses quoted CSV fields with embedded commas and quotes', () => {
    const grid = parseCsvGrid('נושא,תאריך\r\n"פגישה, עם ""נציג""",2024-01-01\r\n');
    expect(grid[0]).toEqual(['נושא', 'תאריך']);
    expect(grid[1]).toEqual(['פגישה, עם "נציג"', '2024-01-01']);
  });
});

describe('spreadsheet extraction', () => {
  it('finds the header row and maps its columns', () => {
    const grid = readXlsxGrid(sampleWorkbook(false));
    const { headerRowIndex, columns } = mapGridHeader(grid);
    expect(headerRowIndex).toBe(0);
    expect([...columns.values()]).toContain('subject');
    expect([...columns.values()]).toContain('startDate');
    expect([...columns.values()]).toContain('startTime');
  });

  it('extracts rows with raw dates left for the collector to parse', () => {
    const result = extractFromGrid(readXlsxGrid(sampleWorkbook(false)));
    expect(result.headerFound).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.subject).toBe('ישיבת ממשלה');
    expect(result.rows[0]?.startDate).toBe('45292');
    expect(result.rows[1]?.subject).toContain('בזק');
  });

  it('refuses a headerless grid rather than mapping columns by position', () => {
    const result = extractFromGrid([
      ['ישיבה', '2024-01-01'],
      ['פגישה', '2024-01-02'],
    ]);
    expect(result.headerFound).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.note).toContain('לא זוהתה שורת כותרות');
  });

  it('needs a subject column, not just a date column', () => {
    const { headerRowIndex } = mapGridHeader([['תאריך', 'שעה']]);
    expect(headerRowIndex).toBe(-1);
  });
});

describe('text and OCR extraction', () => {
  it('reads one-row-per-line layouts', () => {
    const result = extractFromText(
      ['01/03/2024 09:00-10:30 ישיבת הנהלה', '01/03/2024 11:00 ראיון ברדיו'].join('\n'),
      'pdf_text',
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      subject: 'ישיבת הנהלה',
      startDate: '01/03/2024',
      startTime: '09:00',
      endTime: '10:30',
    });
  });

  it('carries a date heading down to the lines beneath it', () => {
    const result = extractFromText(
      [
        '12.05.2025',
        '08:30 פורום מטכ"ל',
        '10:00 סיור בנמל חיפה',
        '13.05.2025',
        '09:00 ועדת הכספים',
      ].join('\n'),
      'pdf_text',
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.startDate).toBe('12.05.2025');
    expect(result.rows[2]?.startDate).toBe('13.05.2025');
    expect(result.rows[2]?.subject).toBe('ועדת הכספים');
  });

  it('counts non-row lines as unparsed instead of inventing rows', () => {
    const result = extractFromText(
      ['יומן השר לשנת 2025', 'עמוד 1 מתוך 4', '01/01/2025 10:00 פגישה'].join('\n'),
      'pdf_text',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.unparsedLineCount).toBe(2);
  });

  it('labels OCR output as a machine reading', () => {
    const result = extractFromText('01/01/2025 10:00 פגישה', 'pdf_ocr');
    expect(result.note).toContain('OCR');
  });
});

describe('subject classification', () => {
  const CATEGORIES = [
    {
      id: 'government_cabinet',
      labelHe: '',
      description: '',
      color: '#000000',
      priority: 1,
      reasoning: '',
      keywords: ['ישיבת ממשלה'],
    },
    {
      id: 'internal_management',
      labelHe: '',
      description: '',
      color: '#000000',
      priority: 4,
      reasoning: '',
      keywords: ['ישיבת הנהלה', 'פורום הנהלה'],
    },
    {
      id: 'private_sector',
      labelHe: '',
      description: '',
      color: '#000000',
      priority: 6,
      reasoning: '',
      keywords: ['בע"מ', 'חברת'],
    },
    {
      id: 'unspecified',
      labelHe: '',
      description: '',
      color: '#000000',
      priority: 99,
      reasoning: '',
      keywords: [],
    },
  ];
  const GENERIC = ['פגישה', 'שיחה', 'ישיבה', 'חסוי'];

  it('lets the longest keyword win so a specific forum is not swallowed by a generic word', () => {
    const match = classifySubject('ישיבת ממשלה מיוחדת', CATEGORIES, GENERIC);
    expect(match.categoryId).toBe('government_cabinet');
    expect(match.matchedKeyword).toBe('ישיבת ממשלה');
  });

  it('classifies a private-sector meeting and records the keyword', () => {
    const match = classifySubject('פגישה עם נציגי חברת בזק בע"מ', CATEGORIES, GENERIC);
    expect(match.categoryId).toBe('private_sector');
    expect(match.matchedKeyword).not.toBeNull();
  });

  it('treats a bare generic subject as unspecified, which is the transparency measure', () => {
    for (const subject of ['פגישה', 'שיחה', 'חסוי', '  ישיבה  ']) {
      expect(isGenericSubject(subject, GENERIC)).toBe(true);
      expect(classifySubject(subject, CATEGORIES, GENERIC).categoryId).toBe('unspecified');
    }
    expect(classifySubject('פגישה עם ראש העיר', CATEGORIES, GENERIC).rule).toBe('no_match');
  });

  it('keeps "no subject text at all" apart from "text that says nothing"', () => {
    // The distinction matters: an absent subject can come from a column this
    // site failed to identify, so it must never inflate an opacity measure that
    // is presented as a choice made by the office.
    const sentinels = ['ללא נושא רשום'];
    const absent = classifySubject('ללא נושא רשום', CATEGORIES, GENERIC, sentinels);
    expect(absent.categoryId).toBe('no_subject_recorded');
    expect(absent.rule).toBe('no_subject_recorded');
    // An empty string is also absence of text, not a generic phrase.
    expect(classifySubject('', CATEGORIES, GENERIC, sentinels).categoryId).toBe(
      'no_subject_recorded',
    );
    // A generic phrase stays in the opacity bucket.
    expect(classifySubject('פגישה', CATEGORIES, GENERIC, sentinels).categoryId).toBe('unspecified');
  });

  it('matches a keyword only as a whole word, since Hebrew words contain each other', () => {
    // Every pair below misclassified real collected rows before the boundary
    // rule existed: over 11,000 travel entries were filed as party politics
    // because "נסיעה" contains "סיעה".
    expect(matchesAsWord('נסיעה לירושלים', 'סיעה')).toBe(false);
    expect(matchesAsWord('מעקב הוצאות והכנסות', 'כנס')).toBe(false);
    expect(matchesAsWord('התכנסות מחלקתית', 'כנס')).toBe(false);
    expect(matchesAsWord('דיון בנושא חברתי', 'חברת')).toBe(false);
    // A real occurrence still matches, including through Hebrew's one-letter
    // prefixes, which belong to the sentence rather than to the word.
    expect(matchesAsWord('כינוס סיעה', 'סיעה')).toBe(true);
    expect(matchesAsWord('הצבעה בכנסת', 'כנסת')).toBe(true);
    expect(matchesAsWord('דיון ולסיעה הודע', 'סיעה')).toBe(true);
    expect(matchesAsWord('חברת בזק', 'חברת')).toBe(true);
    // A keyword that deliberately ends in an attaching prefix must still reach
    // the word after it.
    expect(matchesAsWord('ביקור במרכז הרפואי', 'ביקור ב')).toBe(true);
  });

  it("separates our own coverage gap from the office holder's opacity", () => {
    // A subject with real, informative text that no keyword covers is a limit
    // of this site's vocabulary. Counting it as opacity published a finding
    // against people by name for words we simply had not listed.
    const gap = classifySubject('דיון בנושא רפורמת הכשרות', CATEGORIES, GENERIC);
    expect(gap.rule).toBe('no_match');
    expect(gap.categoryId).toBe('unclassified');
    expect(gap.matchedKeyword).toBeNull();
    // Generic text remains the transparency measure, and absent text stays its
    // own third thing.
    expect(classifySubject('פגישה', CATEGORIES, GENERIC).categoryId).toBe('unspecified');
    expect(classifySubject('', CATEGORIES, GENERIC, ['ללא נושא רשום']).categoryId).toBe(
      'no_subject_recorded',
    );
  });

  it("flags a publication that holds several people's diaries, and only on strong signals", () => {
    // Titles taken verbatim from the collected publications.
    expect(
      coversMultiplePeople('יומן שר הרווחה, יעקב מרגי ויומן מנכ"ל משרד הרווחה, ינון אהרוני'),
    ).toBe(true);
    expect(coversMultiplePeople('יומני שרי ממשלת ישראל שנת 2023')).toBe(true);
    expect(coversMultiplePeople('יומן שרי הפנים, אריה דרעי ומיכאל מלכיאלי לשנת 2023')).toBe(true);
    expect(
      coversMultiplePeople('יומני השר לביטחון לאומי, איתמר בן גביר ומנכ"ל המשרד, רפאל אנגל'),
    ).toBe(true);
    // The plural "יומני" alone is not a signal: offices use it for one person's
    // several quarters, and treating it as multi-person would erase real
    // profiles.
    expect(coversMultiplePeople('יומני שר החוץ, אלי כהן, לשנת 2023 (רבעון ראשון)')).toBe(false);
    expect(coversMultiplePeople('יומן מנכ"ל משרד הביטחון, אייל זמיר, לשנת 2025')).toBe(false);
    expect(coversMultiplePeople('יומן שר המשפטים, יריב לוין, לשנת 2024 (רבעון שני)')).toBe(false);
  });

  it('normalises quote variants so the same subject classifies identically', () => {
    expect(normalizeSubject('חברת בזק בע״מ')).toBe(normalizeSubject('חברת בזק בע"מ'));
  });
});

describe('insight helpers', () => {
  it('builds a stable person key', () => {
    expect(
      personKeyOf({ ministryId: 'health', roleLabelHe: 'שר הבריאות', personLabel: 'חיים כץ' }),
    ).toBe('health|שר הבריאות|חיים כץ');
    expect(personKeyOf({ ministryId: null, roleLabelHe: 'שר', personLabel: null })).toBe(
      'unattributed|שר|—',
    );
  });

  it('identifies the Israeli weekend', () => {
    expect(isWeekend('2026-08-14')).toBe(true); // Friday
    expect(isWeekend('2026-08-15')).toBe(true); // Saturday
    expect(isWeekend('2026-08-16')).toBe(false); // Sunday is a work day
  });

  it('maps dates to quarters', () => {
    expect(quarterOf('2024-01-31')).toBe('2024-Q1');
    expect(quarterOf('2024-04-01')).toBe('2024-Q2');
    expect(quarterOf('2024-12-31')).toBe('2024-Q4');
  });

  it('normalises entity names and excludes government bodies from cross-referencing', () => {
    expect(normalizeEntityName('בזק בע"מ')).toBe('בזק');
    expect(normalizeEntityName('קבוצת שלמה (החזקות) בע״מ')).toBe('קבוצת שלמה');
    expect(isGovernmentEntityName('משרד הבריאות')).toBe(true);
    expect(isGovernmentEntityName('רשות המים')).toBe(true);
    expect(isGovernmentEntityName('שירותי בריאות כללית')).toBe(false);
  });
});

describe('expert panel merge', () => {
  // The five experts classify the same subjects independently, so the merge is
  // where disagreements are decided. It must be reproducible: same proposals,
  // same result, regardless of the order the files happened to be read in.
  const priorityOf = (id: string): number =>
    ({ diplomacy: 11, politics_party: 12, ceremonies: 13 })[id] ?? 99;

  it('takes the assignment with the highest stated confidence', () => {
    const merged = mergeProposals(
      [
        {
          expert: 'media',
          keyword: 'שגריר',
          categoryId: 'ceremonies',
          confidence: 'low',
          reasoning: '',
        },
        {
          expert: 'foreign',
          keyword: 'שגריר',
          categoryId: 'diplomacy',
          confidence: 'high',
          reasoning: '',
        },
      ],
      priorityOf,
    );
    expect(merged.categoryId).toBe('diplomacy');
    expect(merged.confidence).toBe('high');
    expect(merged.conflict?.rejected).toEqual([
      { expert: 'media', categoryId: 'ceremonies', confidence: 'low' },
    ]);
  });

  it('falls to the majority of experts when confidence ties', () => {
    const merged = mergeProposals(
      [
        {
          expert: 'foreign',
          keyword: 'ועידה',
          categoryId: 'diplomacy',
          confidence: 'medium',
          reasoning: '',
        },
        {
          expert: 'media',
          keyword: 'ועידה',
          categoryId: 'ceremonies',
          confidence: 'medium',
          reasoning: '',
        },
        {
          expert: 'politics',
          keyword: 'ועידה',
          categoryId: 'ceremonies',
          confidence: 'medium',
          reasoning: '',
        },
      ],
      priorityOf,
    );
    expect(merged.categoryId).toBe('ceremonies');
    expect(merged.experts).toEqual(['media', 'politics']);
    expect(merged.conflict?.resolvedBy).toBe('majority');
  });

  it('breaks a dead tie on declared priority, never on input order', () => {
    const proposals = [
      {
        expert: 'politics',
        keyword: 'כינוס',
        categoryId: 'politics_party',
        confidence: 'high' as const,
        reasoning: '',
      },
      {
        expert: 'foreign',
        keyword: 'כינוס',
        categoryId: 'diplomacy',
        confidence: 'high' as const,
        reasoning: '',
      },
    ];
    const forward = mergeProposals(proposals, priorityOf);
    const reversed = mergeProposals([...proposals].reverse(), priorityOf);
    expect(forward.categoryId).toBe('diplomacy');
    expect(reversed.categoryId).toBe(forward.categoryId);
    expect(forward.conflict?.resolvedBy).toBe('priority');
  });

  it('records a unanimous assignment without inventing a conflict', () => {
    const merged = mergeProposals(
      [
        {
          expert: 'foreign',
          keyword: 'או"ם',
          categoryId: 'diplomacy',
          confidence: 'high',
          reasoning: 'א',
        },
        {
          expert: 'law',
          keyword: 'או"ם',
          categoryId: 'diplomacy',
          confidence: 'high',
          reasoning: 'ב',
        },
      ],
      priorityOf,
    );
    expect(merged.conflict).toBeUndefined();
    expect(merged.experts).toEqual(['foreign', 'law']);
    expect(merged.reasoning).toContain('[foreign]');
    expect(merged.reasoning).toContain('[law]');
  });
});
