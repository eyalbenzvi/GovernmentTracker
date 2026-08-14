/**
 * Context for a single figure: share, rank and change.
 *
 * A number on its own — "תקציב מעודכן: 47 מיליארד ש"ח" — carries no measure of
 * size. These helpers produce the three comparisons the site is able to make from
 * the collected rows, and each returns null when the inputs do not support it, so
 * a missing comparison is never rendered as a zero.
 *
 * Deliberately absent: any inflation adjustment. Every change figure here is
 * nominal, and `CHANGE_IS_NOMINAL_HE` states that wherever one is displayed. Real
 * terms require a price index, which is not among the collected sources.
 */

export const CHANGE_IS_NOMINAL_HE =
  'השינוי מוצג במונחים נומינליים — כלומר בשקלים שוטפים, בלי ניכוי אינפלציה. אין באתר מדד מחירים, ולכן גידול נומינלי אינו בהכרח גידול בכוח הקנייה של התקציב.';

/** נתח = ערך ÷ סך הכל × 100, מחושב רק כשהסך חיובי. */
export function shareOf(value: number | null, total: number | null): number | null {
  if (value === null || total === null) return null;
  if (!Number.isFinite(value) || !Number.isFinite(total)) return null;
  if (total <= 0) return null;
  return Math.round((value / total) * 1000) / 10;
}

/** שינוי באחוזים בין שתי תקופות, נומינלי. */
export function changePercent(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from === 0) return null;
  return Math.round(((to - from) / Math.abs(from)) * 1000) / 10;
}

export interface RankResult {
  /** 1 = largest. */
  rank: number;
  outOf: number;
}

/**
 * Rank of one key among a set of values, largest first. Entries without a value
 * are excluded from both the position and the denominator — being unranked is not
 * the same as being last.
 */
export function rankOf(
  key: string,
  values: ReadonlyMap<string, number | null> | ReadonlyArray<readonly [string, number | null]>,
): RankResult | null {
  const entries = Array.isArray(values) ? values : [...values.entries()];
  const usable = entries.filter(
    (entry): entry is [string, number] => entry[1] !== null && Number.isFinite(entry[1]),
  );
  if (usable.length === 0) return null;
  const own = usable.find(([k]) => k === key);
  if (own === undefined) return null;
  const sorted = [...usable].sort((a, b) => b[1] - a[1]);
  const index = sorted.findIndex(([k]) => k === key);
  return { rank: index + 1, outOf: sorted.length };
}

export interface FigureContext {
  sharePercent: number | null;
  shareOfLabelHe: string | null;
  changePercent: number | null;
  changeFromLabelHe: string | null;
  rank: RankResult | null;
  rankAmongLabelHe: string | null;
}

export const EMPTY_CONTEXT: FigureContext = {
  sharePercent: null,
  shareOfLabelHe: null,
  changePercent: null,
  changeFromLabelHe: null,
  rank: null,
  rankAmongLabelHe: null,
};
