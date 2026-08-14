/**
 * The editorial layer: a sentence per figure, and a ranking across findings.
 *
 * Two problems this solves. A chart titled "תקציב וביצוע לפי שנה" tells a reader
 * who does not work in government nothing about whether what they are looking at
 * is ordinary or unusual; and a list of hundreds of findings presented at equal
 * weight is indistinguishable from noise.
 *
 * Every sentence here is assembled from figures that were collected, by a fixed
 * template — nothing is written by a model at runtime, and no sentence asserts a
 * cause. Each insight also carries `notSayingHe`: the reading the figure does *not*
 * support. That field is required, because the most likely way this site misleads
 * is a true number read as a claim it cannot carry.
 */
import type { AnomalyFinding, DiaryFinding } from '../types/domain';
import { formatCurrencyShort, formatNumber, formatPercent } from './format';
import type { YearAggregate } from './budgetSeries';
import { changePercent, shareOf } from './context';

export type InsightKind = 'budget' | 'execution' | 'procurement' | 'diary' | 'coverage';

export interface Insight {
  id: string;
  kind: InsightKind;
  /** The number itself, formatted for display. */
  headline: string;
  /** One sentence in plain Hebrew: what the number says. */
  sentenceHe: string;
  /** One sentence: what it does not say. Required by design. */
  notSayingHe: string;
  /** Where in the site the reader can check it. */
  href: string;
  /** The published source behind the figure, when there is a single one. */
  sourceUrl: string | null;
  /** 0–100. Comparable only within a kind; see rankInsights. */
  strength: number;
}

/* ------------------------------------------------------------------------- *
 * Takeaway sentences for charts
 * ------------------------------------------------------------------------- */

/**
 * The sentence printed under the multi-year budget chart. Describes the direction
 * and size of the movement between the first and last year that carry a figure,
 * and the execution gap in the latest year that has one.
 */
export function budgetTrendSentence(
  aggregates: readonly YearAggregate[],
  scopeLabelHe: string,
): string | null {
  const withUpdated = aggregates.filter((a) => a.updatedBudget !== null);
  if (withUpdated.length === 0) return null;

  const first = withUpdated[0] as YearAggregate;
  const last = withUpdated[withUpdated.length - 1] as YearAggregate;
  const parts: string[] = [];

  if (withUpdated.length > 1) {
    const delta = changePercent(first.updatedBudget, last.updatedBudget);
    if (delta !== null) {
      const direction = delta > 0 ? 'גדל' : delta < 0 ? 'קטן' : 'לא השתנה';
      parts.push(
        `התקציב המעודכן של ${scopeLabelHe} ${direction} ב-${formatPercent(Math.abs(delta))} בין ${first.fiscalYear} ל-${last.fiscalYear} (נומינלי)`,
      );
    }
  } else {
    parts.push(
      `התקציב המעודכן של ${scopeLabelHe} ב-${last.fiscalYear} עמד על ${formatCurrencyShort(last.updatedBudget)}`,
    );
  }

  const withExecution = [...aggregates].reverse().find((a) => a.execution !== null);
  if (withExecution !== undefined && withExecution.updatedBudget !== null) {
    const rate = shareOf(withExecution.execution, withExecution.updatedBudget);
    if (rate !== null) {
      const basis = withExecution.executionIsEstimate ? 'אומדן הביצוע' : 'הביצוע';
      parts.push(
        `${basis} ב-${withExecution.fiscalYear} הגיע ל-${formatPercent(rate)} מהתקציב המעודכן`,
      );
    }
  }

  if (parts.length === 0) return null;
  return `${parts.join('; ')}.`;
}

/** The sentence printed under a treemap or theme breakdown. */
export function compositionSentence(
  slices: readonly { label: string; value: number | null }[],
  totalLabelHe: string,
): string | null {
  const usable = slices.filter(
    (s): s is { label: string; value: number } => s.value !== null && s.value > 0,
  );
  if (usable.length === 0) return null;
  const total = usable.reduce((acc, s) => acc + s.value, 0);
  const sorted = [...usable].sort((a, b) => b.value - a.value);
  const top = sorted[0] as { label: string; value: number };
  const topShare = shareOf(top.value, total);
  if (topShare === null) return null;
  const topThree = sorted.slice(0, 3);
  const threeShare = shareOf(
    topThree.reduce((acc, s) => acc + s.value, 0),
    total,
  );
  if (sorted.length <= 3 || threeShare === null) {
    return `הרכיב הגדול ב${totalLabelHe} הוא "${top.label}", ${formatPercent(topShare)} מהסך.`;
  }
  return `הרכיב הגדול ב${totalLabelHe} הוא "${top.label}", ${formatPercent(topShare)} מהסך; שלושת הגדולים מהווים יחד ${formatPercent(threeShare)} מתוך ${formatNumber(sorted.length)} רכיבים.`;
}

/** The sentence printed under a cross-section comparison (dot plot). */
export function comparisonSentence(
  values: readonly { label: string; value: number | null }[],
  measureLabelHe: string,
  formatValue: (value: number | null) => string,
): string | null {
  const usable = values.filter(
    (v): v is { label: string; value: number } => v.value !== null && Number.isFinite(v.value),
  );
  if (usable.length < 2) return null;
  const sorted = [...usable].sort((a, b) => b.value - a.value);
  const top = sorted[0] as { label: string; value: number };
  const bottom = sorted[sorted.length - 1] as { label: string; value: number };
  const midIndex = Math.floor(sorted.length / 2);
  const median = sorted[midIndex] as { label: string; value: number };
  return `${measureLabelHe}: הגבוה הוא ${top.label} (${formatValue(top.value)}), החציון ${formatValue(median.value)}, והנמוך ${bottom.label} (${formatValue(bottom.value)}), מבין ${formatNumber(sorted.length)} סעיפים שיש להם נתון.`;
}

/* ------------------------------------------------------------------------- *
 * Ranking findings
 * ------------------------------------------------------------------------- */

export const STRENGTH_RULE_HE =
  'הדירוג נקבע משלושה גורמים מוצהרים: גודל האפקט ביחס לסעיף (עד 60 נקודות), איכות הנתון — האם הוא סופי, חלקי או אומדן (עד 20 נקודות), ונדירות התופעה בהתפלגות של אותו כלל (עד 20 נקודות). הדירוג קובע מה מוצג בראש הרשימה ומה נשאר בטבלה. הוא אינו מדד חשיבות ציבורית ואינו טענה על תקינות.';

/**
 * Effect size for a budget anomaly, as a share of the line's own revised budget,
 * capped so a tiny line with a huge ratio cannot dominate the ranking.
 */
function anomalyEffect(finding: AnomalyFinding): number {
  const base = Math.abs(finding.revised ?? finding.allocated ?? 0);
  const executed = finding.executed ?? 0;
  const allocated = finding.allocated ?? 0;
  const revised = finding.revised ?? 0;
  const gap = Math.max(
    Math.abs(executed - revised),
    Math.abs(revised - allocated),
    base === 0 ? Math.abs(executed) : 0,
  );
  if (gap === 0) return 0;
  // Absolute magnitude matters as well as ratio: ₪500M on a ₪1bn line outranks
  // ₪50k on a ₪10k line, which a pure ratio would invert.
  const magnitude = Math.min(1, Math.log10(1 + gap) / 10);
  const ratio = base > 0 ? Math.min(1, gap / base) : 1;
  return Math.round((0.6 * magnitude + 0.4 * ratio) * 100) / 100;
}

export function rankAnomalies(findings: readonly AnomalyFinding[]): AnomalyFinding[] {
  const perRule = new Map<string, number>();
  for (const finding of findings) {
    perRule.set(finding.ruleId, (perRule.get(finding.ruleId) ?? 0) + 1);
  }
  const total = findings.length;
  return [...findings]
    .map((finding) => {
      const effect = anomalyEffect(finding);
      const rarity = total > 0 ? 1 - (perRule.get(finding.ruleId) ?? 0) / total : 0;
      const quality = finding.executed !== null && finding.revised !== null ? 1 : 0.5;
      return {
        finding,
        strength: Math.round((effect * 60 + quality * 20 + rarity * 20) * 10) / 10,
      };
    })
    .sort((a, b) => b.strength - a.strength)
    .map((entry) => entry.finding);
}

export function anomalyStrength(
  finding: AnomalyFinding,
  allFindings: readonly AnomalyFinding[],
): number {
  const sameRule = allFindings.filter((f) => f.ruleId === finding.ruleId).length;
  const rarity = allFindings.length > 0 ? 1 - sameRule / allFindings.length : 0;
  const quality = finding.executed !== null && finding.revised !== null ? 1 : 0.5;
  return Math.round((anomalyEffect(finding) * 60 + quality * 20 + rarity * 20) * 10) / 10;
}

/**
 * Diary findings scale with how fully an office published, so the ranking damps
 * that: a finding is ranked by its value relative to the median value of the same
 * rule, not by the raw count.
 */
export function rankDiaryFindings(findings: readonly DiaryFinding[]): DiaryFinding[] {
  const medianByRule = new Map<string, number>();
  const byRule = new Map<string, number[]>();
  for (const finding of findings) {
    if (finding.value === null) continue;
    const list = byRule.get(finding.ruleId) ?? [];
    list.push(finding.value);
    byRule.set(finding.ruleId, list);
  }
  for (const [ruleId, values] of byRule) {
    const sorted = [...values].sort((a, b) => a - b);
    medianByRule.set(ruleId, sorted[Math.floor(sorted.length / 2)] as number);
  }

  return [...findings]
    .map((finding) => {
      const median = medianByRule.get(finding.ruleId) ?? null;
      const relative =
        finding.value !== null && median !== null && median > 0 ? finding.value / median : 1;
      return { finding, strength: relative };
    })
    .sort((a, b) => b.strength - a.strength)
    .map((entry) => entry.finding);
}

export const DIARY_FINDING_BIAS_HE =
  'ממצאי יומן מצטברים אצל מי שפרסם יותר: לשכה שפרסמה יומן מלא ומפורט תייצר יותר ממצאים מלשכה שפרסמה מעט. הדירוג משווה כל ממצא לחציון של אותו כלל כדי לרסן את ההטיה הזו, אבל אינו מבטל אותה. אין לקרוא את מספר הממצאים של אדם כמדד להתנהלותו.';
