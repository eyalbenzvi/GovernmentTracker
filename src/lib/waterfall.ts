/**
 * The budget lifecycle of one section in one year, as a bridge.
 *
 * Three parallel lines — original, updated, execution — hide the thing worth
 * seeing: what happened between them. This module turns those three levels into
 * ordered steps, and attaches the Finance Committee requests that account for the
 * middle step, so a reader can go from "the budget grew by ₪1.2bn" to the specific
 * transfers that grew it.
 *
 * Two honesty rules are built in rather than left to the caller:
 *   - The transfer step is labelled as *the difference* between the two published
 *     levels. It is not a sum of the committee requests: the site holds a sample of
 *     requests, not the full ledger, so their total will not reconcile. The
 *     unexplained remainder is reported as its own figure instead of hidden.
 *   - A step whose inputs are missing is returned with value null and a reason,
 *     never as zero.
 */
import type { BudgetChangeRequest, BudgetItem } from '../types/domain';
import { sumWithoutDoubleCounting } from './calc';

export type WaterfallStepKind = 'base' | 'increase' | 'decrease' | 'total' | 'residual';

export interface WaterfallStep {
  id: string;
  labelHe: string;
  kind: WaterfallStepKind;
  /** Signed value for increase/decrease steps, absolute level for base/total. */
  value: number | null;
  /** Where the bar starts, for a floating bar chart. Null when value is null. */
  start: number | null;
  end: number | null;
  noteHe: string;
}

export interface BudgetWaterfall {
  fiscalYear: number;
  ministryId: string;
  steps: WaterfallStep[];
  /** Requests the site holds for this section and year, newest first. */
  requests: BudgetChangeRequest[];
  /** Σ netExpenseDiff of the held requests, or null when none are held. */
  requestsNetTotal: number | null;
  /** מעודכן − מקורי − Σ הפניות שבידינו. Null when either side is unknown. */
  unexplainedTransfer: number | null;
  executionIsEstimate: boolean;
  hasAnyValue: boolean;
}

export const WATERFALL_RULE_HE =
  'המדרגות נגזרות משלוש רמות שפורסמו: תקציב מקורי, תקציב מעודכן, וביצוע או אומדן ביצוע. מדרגת ההעברות היא ההפרש בין המקורי למעודכן ולא סכום הפניות — האתר מחזיק מדגם פניות של ועדת הכספים ולא את כל תנועות התקציב, ולכן ההפרש שאינו מוסבר בפניות שבידינו מוצג בנפרד. סכימה נעשית על רמת היררכיה אחת בלבד, כדי למנוע כפל ספירה.';

function floatSteps(steps: WaterfallStep[]): WaterfallStep[] {
  let cursor = 0;
  for (const step of steps) {
    if (step.value === null) {
      step.start = null;
      step.end = null;
      continue;
    }
    if (step.kind === 'base' || step.kind === 'total') {
      step.start = 0;
      step.end = step.value;
      cursor = step.value;
      continue;
    }
    if (step.kind === 'residual') {
      step.start = 0;
      step.end = step.value;
      continue;
    }
    step.start = cursor;
    step.end = cursor + step.value;
    cursor = step.end;
  }
  return steps;
}

export function buildWaterfall(
  items: readonly BudgetItem[],
  requests: readonly BudgetChangeRequest[],
  ministryId: string,
  fiscalYear: number,
): BudgetWaterfall {
  const scoped = items.filter((i) => i.ministryId === ministryId && i.fiscalYear === fiscalYear);
  const original = sumWithoutDoubleCounting(scoped, (i) => i.originalBudget).total;
  const updated = sumWithoutDoubleCounting(scoped, (i) => i.updatedBudget).total;
  const actual = sumWithoutDoubleCounting(scoped, (i) => i.actualExecution).total;
  const estimate = sumWithoutDoubleCounting(scoped, (i) => i.estimatedExecution).total;
  const executionIsEstimate = actual === null && estimate !== null;
  const execution = actual ?? estimate;

  const transfer = original !== null && updated !== null ? updated - original : null;
  const unused = updated !== null && execution !== null ? updated - execution : null;

  const yearRequests = requests
    .filter((r) => r.year === fiscalYear)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const requestValues = yearRequests
    .map((r) => r.netExpenseDiff)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const requestsNetTotal =
    requestValues.length > 0 ? requestValues.reduce((a, b) => a + b, 0) : null;

  const steps: WaterfallStep[] = [
    {
      id: 'original',
      labelHe: 'תקציב מקורי',
      kind: 'base',
      value: original,
      start: null,
      end: null,
      noteHe:
        original === null
          ? 'אין נתון תקציב מקורי לסעיף ולשנה שנבחרו.'
          : 'התקציב כפי שאושר בחוק התקציב, לפני תנועות במהלך השנה.',
    },
    {
      id: 'transfer',
      labelHe: transfer !== null && transfer < 0 ? 'קיצוצים והעברות החוצה' : 'תוספות והעברות',
      kind: transfer !== null && transfer < 0 ? 'decrease' : 'increase',
      value: transfer,
      start: null,
      end: null,
      noteHe:
        transfer === null
          ? 'לא ניתן לחשב את התנועה בלי שני הנתונים — מקורי ומעודכן.'
          : 'ההפרש בין המקורי למעודכן. הפניות שבידינו מוצגות מתחת לגרף, והשארית שאינה מוסברת בהן מדווחת בנפרד.',
    },
    {
      id: 'updated',
      labelHe: 'תקציב מעודכן',
      kind: 'total',
      value: updated,
      start: null,
      end: null,
      noteHe:
        updated === null
          ? 'אין נתון תקציב מעודכן לסעיף ולשנה שנבחרו.'
          : 'התקציב לאחר תנועות במהלך השנה, כפי שפורסם.',
    },
    {
      id: 'unused',
      labelHe: 'יתרה שלא נוצלה',
      kind: 'decrease',
      value: unused === null ? null : -Math.abs(unused) * Math.sign(unused || 1),
      start: null,
      end: null,
      noteHe:
        unused === null
          ? 'אין נתון ביצוע, ולכן לא ניתן לחשב יתרה.'
          : unused < 0
            ? 'הביצוע גבוה מהתקציב המעודכן. זה נתון מהמקור, ואינו שגיאת חישוב.'
            : 'ההפרש בין התקציב המעודכן לביצוע. אינו בהכרח כסף שהוחזר — הוא יכול לשקף התחייבות שטרם שולמה.',
    },
    {
      id: 'execution',
      labelHe: executionIsEstimate ? 'אומדן ביצוע' : 'ביצוע',
      kind: 'total',
      value: execution,
      start: null,
      end: null,
      noteHe:
        execution === null
          ? 'אין נתון ביצוע או אומדן לסעיף ולשנה שנבחרו.'
          : executionIsEstimate
            ? 'אומדן לשנה שוטפת, ולא ביצוע סופי.'
            : 'ביצוע לפי המקור שנאסף.',
    },
  ];

  // The "unused" step must bridge updated → execution exactly; recompute from the
  // two levels rather than trusting the sign juggling above.
  const unusedStep = steps.find((s) => s.id === 'unused');
  if (unusedStep !== undefined) {
    unusedStep.value = updated !== null && execution !== null ? execution - updated : null;
    unusedStep.kind = (unusedStep.value ?? 0) > 0 ? 'increase' : 'decrease';
    unusedStep.labelHe =
      unusedStep.value !== null && unusedStep.value > 0 ? 'ביצוע מעל התקציב' : 'יתרה שלא נוצלה';
  }

  floatSteps(steps);

  return {
    fiscalYear,
    ministryId,
    steps,
    requests: yearRequests,
    requestsNetTotal,
    unexplainedTransfer:
      transfer === null || requestsNetTotal === null ? null : transfer - requestsNetTotal,
    executionIsEstimate,
    hasAnyValue: steps.some((s) => s.value !== null),
  };
}
