import { describe, expect, it } from 'vitest';
import { ANOMALY_RULES, scanRegulations, type RegulationRow } from '../scripts/lib/anomaly-rules';
import { normalizeMethod } from '../scripts/collect-findings';

function row(overrides: Partial<RegulationRow>): RegulationRow {
  return {
    code: '0040500101',
    title: 'תקנה לדוגמה',
    year: 2024,
    econLevel2: 'קניות בארץ',
    allocated: 10_000_000,
    revised: 10_000_000,
    executed: 9_000_000,
    ...overrides,
  };
}

describe('scanRegulations', () => {
  it('flags execution from a zero revised budget above the threshold', () => {
    const findings = scanRegulations([row({ revised: 0, executed: 2_000_000 })], 'transport', 2025);
    expect(findings.map((f) => f.ruleId)).toContain('executed_without_budget');
  });

  it('ignores sub-threshold execution from a zero budget', () => {
    const findings = scanRegulations([row({ revised: 0, executed: 900_000 })], 'transport', 2025);
    expect(findings).toHaveLength(0);
  });

  it('flags overspend only when both the ratio and the absolute gap are exceeded', () => {
    // Ratio exceeded but gap below 5M — not flagged.
    expect(
      scanRegulations([row({ revised: 3_000_000, executed: 4_000_000 })], 'transport', 2025),
    ).toHaveLength(0);
    // Both exceeded — flagged.
    expect(
      scanRegulations([row({ revised: 20_000_000, executed: 40_000_000 })], 'transport', 2025).map(
        (f) => f.ruleId,
      ),
    ).toContain('overspend');
  });

  it('flags a sizeable budget with zero execution, but never a null execution', () => {
    expect(
      scanRegulations([row({ revised: 20_000_000, executed: 0 })], 'transport', 2025).map(
        (f) => f.ruleId,
      ),
    ).toContain('unexecuted_budget');
    // null = no data collected; absence of data is never treated as zero spending.
    expect(
      scanRegulations([row({ revised: 20_000_000, executed: null })], 'transport', 2025),
    ).toHaveLength(0);
  });

  it('does not apply closed-year rules to an open fiscal year', () => {
    const findings = scanRegulations(
      [row({ year: 2026, revised: 20_000_000, executed: 0 })],
      'transport',
      2025,
    );
    expect(findings).toHaveLength(0);
  });

  it('compares year over year on the allocated figure, not the revised one', () => {
    // Allocated against allocated: two numbers from the same stage of the year.
    const enacted = scanRegulations(
      [
        row({ year: 2023, allocated: 5_000_000, revised: 5_000_000 }),
        row({ year: 2024, allocated: 40_000_000, revised: 40_000_000 }),
      ],
      'transport',
      2025,
    );
    expect(enacted.map((f) => f.ruleId)).toContain('enacted_jump');
  });

  it('does not call ordinary budget movement a jump between years', () => {
    // The defect this replaced: a closed year's revised budget is what remained
    // after transfers, an open year's is its opening allocation, and comparing
    // them published "₪1M → ₪63.5M" on a line whose allocation barely moved.
    const findings = scanRegulations(
      [
        row({ year: 2025, allocated: 37_740_000, revised: 1_000_000 }),
        row({ year: 2026, allocated: 37_990_000, revised: 37_990_000 }),
      ],
      'transport',
      2025,
    );
    expect(findings.map((f) => f.ruleId)).not.toContain('enacted_jump');
  });

  it('reports a large mid-year addition as its own, lawful pattern', () => {
    const findings = scanRegulations(
      [row({ year: 2024, allocated: 10_000_000, revised: 90_000_000, executed: 80_000_000 })],
      'transport',
      2025,
    );
    expect(findings.map((f) => f.ruleId)).toContain('in_year_reinforcement');
  });

  it('flags direct execution from a reserve regulation', () => {
    const findings = scanRegulations(
      [row({ econLevel2: 'רזרבה', revised: 10_000_000, executed: 2_000_000 })],
      'transport',
      2025,
    );
    expect(findings.map((f) => f.ruleId)).toContain('reserve_executed');
  });

  it('produces evidence text and a source link for every finding', () => {
    const findings = scanRegulations([row({ revised: 0, executed: 2_000_000 })], 'transport', 2025);
    for (const f of findings) {
      expect(f.evidenceHe.length).toBeGreaterThan(5);
      expect(f.sourceUrl).toMatch(/^https:\/\/next\.obudget\.org\/i\/budget\//);
      expect(ANOMALY_RULES.some((r) => r.id === f.ruleId)).toBe(true);
    }
  });
});

describe('normalizeMethod', () => {
  it('buckets unreported values honestly', () => {
    expect(normalizeMethod(null)).toBe('לא דווח / אחר');
    expect(normalizeMethod('ILS')).toBe('לא דווח / אחר');
    expect(normalizeMethod('אחר')).toBe('לא דווח / אחר');
  });

  it('groups every exemption variant under one label', () => {
    expect(normalizeMethod('פטור ממכרז')).toBe('פטור ממכרז');
    expect(normalizeMethod('פטור בוועדת חריגים')).toBe('פטור ממכרז');
  });

  it('keeps real tender types distinct', () => {
    expect(normalizeMethod('תקנה 1ב - מכרז פומבי רגיל')).toBe('תקנה 1ב - מכרז פומבי רגיל');
  });
});

describe('matchOffice (publication → ministry attribution)', () => {
  const aliases = ['משרד התחבורה', 'משרד התחבורה והבטיחות בדרכים', 'רשות הספנות והנמלים'];

  it('matches the full official office name', async () => {
    const { matchOffice } = await import('../scripts/collect-activities');
    expect(matchOffice('משרד התחבורה והבטיחות בדרכים', aliases)).toBe(true);
  });

  it('matches a subordinate authority listed as an alias', async () => {
    const { matchOffice } = await import('../scripts/collect-activities');
    expect(matchOffice('רשות הספנות והנמלים', aliases)).toBe(true);
  });

  it('does not match an unrelated office — attribution is never guessed', async () => {
    const { matchOffice } = await import('../scripts/collect-activities');
    expect(matchOffice('רשות מקרקעי ישראל', aliases)).toBe(false);
    expect(matchOffice('משרד הבריאות', aliases)).toBe(false);
  });
});
