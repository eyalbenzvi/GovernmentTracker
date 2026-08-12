/**
 * Unit tests for the pure parsing/attribution helpers of the diaries
 * collector. The collector itself only runs in GitHub Actions (network), but
 * everything that decides how a row is interpreted or attributed is pure and
 * tested here — importing the module must not fire any network call (the
 * script's entry point is guarded).
 */
import { describe, expect, it } from 'vitest';
import {
  isRelevantDiaryDataset,
  mapDiaryFields,
  matchMinistryByTitle,
  parseDiaryDate,
  parseDiaryTime,
  parseDiaryTitle,
} from '../scripts/collect-diaries';

const SEED = [
  {
    id: 'health',
    officialName: 'משרד הבריאות',
    displayName: 'משרד הבריאות',
    aliases: ['משרד הבריאות'],
  },
  {
    id: 'sec-7',
    officialName: 'המשרד לביטחון לאומי',
    displayName: 'המשרד לביטחון לאומי',
    aliases: ['המשרד לביטחון לאומי', 'המשרד לביטחון פנים'],
  },
  {
    id: 'sec-15',
    officialName: 'משרד הביטחון',
    displayName: 'משרד הביטחון',
    aliases: ['משרד הביטחון'],
  },
  {
    id: 'environment',
    officialName: 'המשרד להגנת הסביבה',
    displayName: 'המשרד להגנת הסביבה',
    aliases: ['המשרד להגנת הסביבה', 'משרד להגנת הסביבה'],
  },
];

describe('parseDiaryTitle', () => {
  it('extracts role, person and period from the standard pattern', () => {
    const parsed = parseDiaryTitle(
      'יומן מנכ"ל משרד הבריאות, משה בר סימן טוב, לשנת 2026 (רבעון ראשון)',
    );
    expect(parsed.personRole).toBe('director_general');
    expect(parsed.personLabel).toBe('משה בר סימן טוב');
    expect(parsed.periodLabel).toContain('2026');
  });

  it('classifies ministers and deputy ministers', () => {
    expect(parseDiaryTitle('יומן שר הבריאות, חיים כץ, לשנת 2026 (רבעון ראשון)').personRole).toBe(
      'minister',
    );
    expect(parseDiaryTitle('יומן שרת ההתיישבות, אורית סטרוק, לשנת 2026').personRole).toBe(
      'minister',
    );
    expect(parseDiaryTitle('יומן סגנית שר האוצר לשנת 2023').personRole).toBe('deputy_minister');
  });

  it('keeps senior officials that are neither ministers nor DGs as other_senior', () => {
    expect(parseDiaryTitle('יומן מזכיר הממשלה מר יוסי פוקס, לשנת 2025').personRole).toBe(
      'other_senior',
    );
    expect(parseDiaryTitle('יומן החשב הכללי, יהלי רוטברג, לשנת 2025').personRole).toBe(
      'other_senior',
    );
  });

  it('never invents a person when the title has none', () => {
    expect(parseDiaryTitle('יומן שר התיירות 2019').personLabel).toBeNull();
  });
});

describe('matchMinistryByTitle', () => {
  it('attributes by explicit ministry name in the title', () => {
    expect(matchMinistryByTitle('יומן מנכ"ל משרד הבריאות, משה בר סימן טוב, לשנת 2026', SEED)).toBe(
      'health',
    );
  });

  it('prefers the longest alias so national security does not collapse into defense', () => {
    expect(matchMinistryByTitle('יומן השר לביטחון לאומי לשנת 2023', SEED)).toBe('sec-7');
    expect(matchMinistryByTitle('יומן שר הביטחון לשנת 2023', SEED)).toBe('sec-15');
  });

  it('matches a role phrase without the word משרד', () => {
    expect(matchMinistryByTitle('יומן השרה להגנת הסביבה, עידית סילמן, לשנת 2025', SEED)).toBe(
      'environment',
    );
  });

  it('returns null instead of guessing from a person name', () => {
    expect(matchMinistryByTitle('יומן השר יריב לוין 1.1.23-18.6.23', SEED)).toBeNull();
  });
});

describe('isRelevantDiaryDataset', () => {
  it('accepts 37th-government-window diary datasets', () => {
    expect(isRelevantDiaryDataset('יומן שר הבריאות, חיים כץ, לשנת 2026 (רבעון ראשון)')).toBe(true);
    expect(isRelevantDiaryDataset('יומן השר יריב לוין 1.1.23-18.6.23')).toBe(true);
    expect(isRelevantDiaryDataset('יומני שרי ממשלת ישראל שנת 2023')).toBe(true);
  });

  it('rejects municipal diaries and out-of-window years', () => {
    expect(isRelevantDiaryDataset('עיריית כפר סבא - יומן קובי פדוה לשנת 2025')).toBe(false);
    expect(isRelevantDiaryDataset('יומן שר התקשורת 2019')).toBe(false);
    expect(isRelevantDiaryDataset('יומן השרה לשוויון חברתי לשנת 2022 (רבעון שני)')).toBe(false);
  });
});

describe('mapDiaryFields', () => {
  it('maps Hebrew headers', () => {
    const { mapping, unknown } = mapDiaryFields(['_id', 'נושא', 'תאריך_התחלה', 'מיקום']);
    expect(mapping.get('נושא')).toBe('subject');
    expect(mapping.get('תאריך_התחלה')).toBe('startDate');
    expect(mapping.get('מיקום')).toBe('location');
    expect(unknown).toEqual([]);
  });

  it('maps the transliterated headers produced by the odata pipeline', () => {
    const { mapping } = mapDiaryFields([
      '_id',
      'nvsh',
      'tryk htkhlh',
      'sh`t htkhlh',
      'tryk syvm',
      'sh`t syvm',
      'myqvm',
    ]);
    expect(mapping.get('nvsh')).toBe('subject');
    expect(mapping.get('tryk htkhlh')).toBe('startDate');
    expect(mapping.get('sh`t htkhlh')).toBe('startTime');
    expect(mapping.get('tryk syvm')).toBe('endDate');
    expect(mapping.get('sh`t syvm')).toBe('endTime');
    expect(mapping.get('myqvm')).toBe('location');
  });

  it('reports unmapped columns instead of silently dropping them', () => {
    const { unknown } = mapDiaryFields(['נושא', 'עמודה מסתורית']);
    expect(unknown).toEqual(['עמודה מסתורית']);
  });

  it('flags a glued single-column header as unknown so the resource is disclosed', () => {
    const { mapping, unknown } = mapDiaryFields(['nvsh,tryk htkhlh,sh`t htkhlh,tryk syvm']);
    expect(mapping.size).toBe(0);
    expect(unknown.length).toBe(1);
  });
});

describe('parseDiaryDate / parseDiaryTime', () => {
  it('parses ISO, day-first and Excel-serial dates', () => {
    expect(parseDiaryDate('2023-01-01')).toBe('2023-01-01');
    expect(parseDiaryDate('2023-01-01T09:30:00')).toBe('2023-01-01');
    expect(parseDiaryDate('15/02/2024')).toBe('2024-02-15');
    expect(parseDiaryDate('5.3.24')).toBe('2024-03-05');
    expect(parseDiaryDate(45292)).toBe('2024-01-01');
  });

  it('returns null on garbage instead of guessing', () => {
    expect(parseDiaryDate('רבעון ראשון')).toBeNull();
    expect(parseDiaryDate('')).toBeNull();
    expect(parseDiaryDate(123)).toBeNull();
    expect(parseDiaryDate(null)).toBeNull();
  });

  it('parses times from strings and Excel day fractions', () => {
    expect(parseDiaryTime('13:30')).toBe('13:30');
    expect(parseDiaryTime('2023-01-01T09:05:00')).toBe('09:05');
    expect(parseDiaryTime(0.5)).toBe('12:00');
    expect(parseDiaryTime('99:99')).toBeNull();
    expect(parseDiaryTime('')).toBeNull();
  });
});
