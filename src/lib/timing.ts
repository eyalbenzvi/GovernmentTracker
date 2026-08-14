/**
 * When did a meeting happen, relative to the contract?
 *
 * The site already records that a diary row names a supplier or a support
 * recipient. That alone is not interesting: meeting suppliers is a normal part of
 * running a ministry. What can be measured is timing — whether the meeting sits in
 * the window before the order date — and a timing figure is only readable next to a
 * baseline, so this module always returns one.
 *
 * The baseline here is deliberately weak and labelled as such: it compares matched
 * suppliers against the section's other notable contracts, which is a comparison
 * of *held* rows, not a random sample. It exists to stop a single coincidence
 * reading as a pattern, not to support a causal claim.
 */
import type { DiaryCrossMatch, NotableContract } from '../types/domain';

export const TIMING_WINDOW_DAYS = 90;

export const TIMING_RULE_HE =
  'לכל הצלבה בין שורת יומן לספק או למקבל תמיכה, נמדד המרווח בימים בין מועד הפגישה למועד ההזמנה של ההתקשרות הקרובה ביותר בזמן של אותו ספק באותו סעיף. "בחלון" = הפגישה התקיימה עד 90 יום לפני מועד ההזמנה. פגישה עם ספק היא לגיטימית ושכיחה, וקרבה בזמן אינה קשר סיבתי: מרווח קטן יכול לנבוע מכך שההתקשרות עצמה היא הסיבה לפגישה.';

export const TIMING_BASELINE_NOTE_HE =
  'בסיס ההשוואה הוא ההתקשרויות הבולטות שהאתר מחזיק באותו סעיף שלא נמצאה להן הצלבה ליומן. זה אינו מדגם מקרי, ולכן אינו מבחן סטטיסטי — הוא רק מונע קריאת מקרה בודד כתופעה.';

export interface MeetingTiming {
  crossMatch: DiaryCrossMatch;
  contract: NotableContract;
  /** Positive when the meeting preceded the order date. */
  daysBeforeOrder: number;
  withinWindow: boolean;
}

export interface TimingAnalysis {
  ministryId: string;
  /** Cross-matches that could be placed in time against a held contract. */
  timed: MeetingTiming[];
  /** Cross-matches with no date, or with no held contract for that supplier. */
  unplaceable: number;
  withinWindowCount: number;
  /** Median gap in days among timed matches, or null. */
  medianDaysBefore: number | null;
  /** Held notable contracts of this section with no diary match at all. */
  contractsWithoutMatch: number;
  contractsHeld: number;
}

function normalizeName(name: string | null): string {
  if (name === null) return '';
  return name
    .replace(/[״"'׳]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bבע"?מ\b|\bבעמ\b/g, '')
    .trim()
    .toLowerCase();
}

function daysBetween(earlier: string, later: string): number | null {
  const a = Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${later.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round((((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2) * 10) / 10;
}

/**
 * Pairs each cross-match with the closest-in-time held contract of the same
 * supplier in the same section, and reports how many fall in the window.
 */
export function analyseTiming(
  crossMatches: readonly DiaryCrossMatch[],
  notableContracts: readonly NotableContract[],
  ministryId: string,
): TimingAnalysis {
  const scopedMatches = crossMatches.filter((m) => m.ministryId === ministryId);
  const held = notableContracts.filter((c) => c.orderDate !== null);
  const matchedContracts = new Set<NotableContract>();

  const timed: MeetingTiming[] = [];
  let unplaceable = 0;

  for (const crossMatch of scopedMatches) {
    if (crossMatch.date === null) {
      unplaceable += 1;
      continue;
    }
    const target = normalizeName(crossMatch.matchedName);
    const candidates = held.filter((c) => {
      const supplier = normalizeName(c.supplier);
      return supplier !== '' && target !== '' && (supplier === target || supplier.includes(target));
    });
    if (candidates.length === 0) {
      unplaceable += 1;
      continue;
    }
    let best: MeetingTiming | null = null;
    for (const contract of candidates) {
      const gap = daysBetween(crossMatch.date, contract.orderDate as string);
      if (gap === null) continue;
      const candidate: MeetingTiming = {
        crossMatch,
        contract,
        daysBeforeOrder: gap,
        withinWindow: gap >= 0 && gap <= TIMING_WINDOW_DAYS,
      };
      if (best === null || Math.abs(candidate.daysBeforeOrder) < Math.abs(best.daysBeforeOrder)) {
        best = candidate;
      }
    }
    if (best === null) {
      unplaceable += 1;
      continue;
    }
    timed.push(best);
    matchedContracts.add(best.contract);
  }

  timed.sort((a, b) => a.daysBeforeOrder - b.daysBeforeOrder);

  return {
    ministryId,
    timed,
    unplaceable,
    withinWindowCount: timed.filter((t) => t.withinWindow).length,
    medianDaysBefore: median(
      timed.filter((t) => t.daysBeforeOrder >= 0).map((t) => t.daysBeforeOrder),
    ),
    contractsWithoutMatch: held.length - matchedContracts.size,
    contractsHeld: held.length,
  };
}
