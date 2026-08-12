import { describe, expect, it } from 'vitest';
import {
  MISSING_SHORT,
  dataStatusLabel,
  formatCurrencyFull,
  formatCurrencyShort,
  formatDate,
  formatNumber,
  formatPercent,
} from '../src/lib/format';

describe('formatCurrencyShort', () => {
  it('abbreviates billions and millions', () => {
    expect(formatCurrencyShort(1_250_000_000)).toContain('מיליארד');
    expect(formatCurrencyShort(1_250_000_000)).toContain('1.25');
    expect(formatCurrencyShort(4_800_000)).toContain('מיליון');
  });

  it('keeps small amounts unabbreviated', () => {
    expect(formatCurrencyShort(950)).not.toContain('מיליון');
  });

  it('renders a dash for a missing figure — never 0', () => {
    expect(formatCurrencyShort(null)).toBe(MISSING_SHORT);
    expect(formatCurrencyShort(Number.NaN)).toBe(MISSING_SHORT);
  });

  it('distinguishes a real zero from a missing value', () => {
    expect(formatCurrencyShort(0)).not.toBe(MISSING_SHORT);
  });
});

describe('formatCurrencyFull', () => {
  it('shows the whole amount with a currency suffix', () => {
    const output = formatCurrencyFull(1_250_000_000);
    expect(output).toContain('ש"ח');
    expect(output.replace(/[^\d]/g, '')).toBe('1250000000');
  });

  it('renders a dash for a missing figure', () => {
    expect(formatCurrencyFull(null)).toBe(MISSING_SHORT);
  });
});

describe('formatPercent', () => {
  it('shows one decimal place', () => {
    expect(formatPercent(93.46)).toContain('93.5');
    expect(formatPercent(93.46)).toContain('%');
  });

  it('renders a dash when the rate is not computable', () => {
    expect(formatPercent(null)).toBe(MISSING_SHORT);
  });
});

describe('formatDate', () => {
  it('uses the Israeli day.month.year order', () => {
    expect(formatDate('2022-12-29')).toBe('29.12.2022');
    expect(formatDate('2026-08-12')).toBe('12.08.2026');
  });

  it('renders a dash for a missing or invalid date', () => {
    expect(formatDate(null)).toBe(MISSING_SHORT);
    expect(formatDate('')).toBe(MISSING_SHORT);
    expect(formatDate('not-a-date')).toBe(MISSING_SHORT);
  });
});

describe('formatNumber', () => {
  it('groups thousands and dashes missing values', () => {
    expect(formatNumber(50).length).toBeGreaterThan(0);
    expect(formatNumber(null)).toBe(MISSING_SHORT);
  });
});

describe('dataStatusLabel', () => {
  it('translates every status the schema allows', () => {
    expect(dataStatusLabel('final')).toBe('ביצוע סופי');
    expect(dataStatusLabel('estimate')).toBe('אומדן');
    expect(dataStatusLabel('partial')).toBe('נתון חלקי');
    expect(dataStatusLabel('unavailable')).toBe('אין נתון');
  });
});
