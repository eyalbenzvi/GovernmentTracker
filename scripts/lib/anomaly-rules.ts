/**
 * Deterministic anomaly rules over individual budget regulations (תקנות).
 *
 * Each rule is a pure predicate with a fixed, published threshold. A "finding"
 * is not an accusation — it is a line whose numbers satisfy a stated formula,
 * shown so a reader can follow the link and judge for themselves. No model is
 * involved in detection; thresholds are deliberately conservative so the list
 * stays short enough to read.
 */

export interface RegulationRow {
  code: string;
  title: string;
  year: number;
  econLevel2: string | null;
  allocated: number | null;
  revised: number | null;
  executed: number | null;
}

export interface AnomalyRule {
  id: string;
  labelHe: string;
  formulaHe: string;
  /** Why this pattern is worth a human look — not why it is wrong. */
  whyInterestingHe: string;
  appliesToClosedYearsOnly: boolean;
}

export interface AnomalyFinding {
  ruleId: string;
  ministryId: string;
  code: string;
  title: string;
  year: number;
  allocated: number | null;
  revised: number | null;
  executed: number | null;
  /** The concrete numbers that satisfied the formula, pre-formatted for display. */
  evidenceHe: string;
  sourceUrl: string;
}

const MILLION = 1_000_000;

export const ANOMALY_RULES: readonly AnomalyRule[] = [
  {
    id: 'executed_without_budget',
    labelHe: 'ביצוע ללא תקציב מעודכן',
    formulaHe: 'תקציב מעודכן = 0 וגם ביצוע > 1 מיליון ש"ח',
    whyInterestingHe:
      'כסף יצא מתקנה שבתקציב המעודכן שלה לא נותר סכום. לרוב מדובר בתיקון חשבונאי או בהעברה מאוחרת, אך זה דפוס ששווה בדיקה.',
    appliesToClosedYearsOnly: true,
  },
  {
    id: 'overspend',
    labelHe: 'ביצוע גבוה מהתקציב המעודכן',
    formulaHe: 'ביצוע > תקציב מעודכן × 1.25 וגם (ביצוע − מעודכן) > 5 מיליון ש"ח',
    whyInterestingHe:
      'ההוצאה בפועל עלתה על התקציב שאושר לאותה תקנה ביותר מרבע. ייתכן שההפרש כוסה מהרשאה להתחייב או מהעברה שטרם נרשמה.',
    appliesToClosedYearsOnly: true,
  },
  {
    id: 'unexecuted_budget',
    labelHe: 'תקציב שלא בוצע כלל',
    formulaHe: 'תקציב מעודכן > 10 מיליון ש"ח וגם ביצוע = 0',
    whyInterestingHe:
      'תקנה שתוקצבה בסכום ניכר ולא הוצא ממנה שקל עד סוף השנה. יכול להעיד על עיכוב בתוכנית, על תקצוב יתר או על רישום ההוצאה בתקנה אחרת.',
    appliesToClosedYearsOnly: true,
  },
  {
    id: 'enacted_jump',
    labelHe: 'קפיצה חדה בתקציב שאושר',
    formulaHe: '|מקורי השנה − מקורי אשתקד| > פי 3 מאשתקד וגם ההפרש > 20 מיליון ש"ח',
    whyInterestingHe:
      'התקציב שאושר לתקנה בתחילת השנה השתנה בין שנתיים עוקבות בסדר גודל. ההשוואה היא מקורי מול מקורי — שני מספרים מאותו שלב בשנה — ולכן היא משקפת החלטת תקצוב ולא תנועות במהלך השנה.',
    appliesToClosedYearsOnly: false,
  },
  {
    id: 'in_year_reinforcement',
    labelHe: 'תוספת גדולה במהלך השנה',
    formulaHe: 'מעודכן − מקורי > פי 3 מהמקורי וגם ההפרש > 20 מיליון ש"ח, באותה שנה',
    whyInterestingHe:
      'התקנה קיבלה במהלך השנה תוספת גדולה מהתקציב שאושר לה בתחילתה. זהו נוהג תקציבי חוקי ושכיח — העברות מאושרות בוועדת הכספים — והשאלה המעניינת היא הסדר גודל והחזרתיות, לא עצם קיומו. ההשוואה היא בתוך אותה שנה, ולכן היא אינה מושפעת מארגון מחדש של סעיפים בין שנים.',
    appliesToClosedYearsOnly: false,
  },
  {
    id: 'reserve_executed',
    labelHe: 'רזרבה שבוצעה ישירות',
    formulaHe: 'סיווג משני = "רזרבה" וגם ביצוע > 1 מיליון ש"ח',
    whyInterestingHe:
      'רזרבה אמורה להתחלק לתקנות אחרות לפני שמוציאים ממנה, ולכן ביצוע ישיר מתוכה הוא דפוס חריג הראוי לעיון.',
    appliesToClosedYearsOnly: true,
  },
] as const;

function money(value: number): string {
  return `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(value)} ש"ח`;
}

/**
 * Applies every rule to every row. `closedYearMax` is the last fiscal year whose
 * execution figures are treated as actual (not an in-year snapshot).
 */
export function scanRegulations(
  rows: readonly RegulationRow[],
  ministryId: string,
  closedYearMax: number,
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const link = (row: RegulationRow): string =>
    `https://next.obudget.org/i/budget/${row.code}/${row.year}`;

  const byCodeYear = new Map<string, RegulationRow>();
  for (const row of rows) byCodeYear.set(`${row.code}:${row.year}`, row);

  for (const row of rows) {
    const closed = row.year <= closedYearMax;

    if (closed && row.revised === 0 && row.executed !== null && row.executed > MILLION) {
      findings.push({
        ruleId: 'executed_without_budget',
        ministryId,
        ...pick(row),
        evidenceHe: `בוצעו ${money(row.executed)} מתקנה שתקציבה המעודכן אפס`,
        sourceUrl: link(row),
      });
    }

    if (
      closed &&
      row.revised !== null &&
      row.revised > 0 &&
      row.executed !== null &&
      row.executed > row.revised * 1.25 &&
      row.executed - row.revised > 5 * MILLION
    ) {
      findings.push({
        ruleId: 'overspend',
        ministryId,
        ...pick(row),
        evidenceHe: `בוצעו ${money(row.executed)} מול תקציב מעודכן של ${money(row.revised)} — פער של ${money(row.executed - row.revised)}`,
        sourceUrl: link(row),
      });
    }

    if (closed && row.revised !== null && row.revised > 10 * MILLION && row.executed === 0) {
      findings.push({
        ruleId: 'unexecuted_budget',
        ministryId,
        ...pick(row),
        evidenceHe: `תקציב מעודכן של ${money(row.revised)} — וביצוע אפס`,
        sourceUrl: link(row),
      });
    }

    // Year over year is compared on the *allocated* figure, never the revised
    // one. A closed year's revised budget is what remained after transfers in
    // and out, while an open year's is its opening allocation, so comparing them
    // manufactured jumps out of ordinary budget movement: the Knesset's routine
    // maintenance line was published as ₪1M → ₪63.5M when its allocation barely
    // moved. Allocated against allocated is two numbers from the same stage of
    // the year.
    const prior = byCodeYear.get(`${row.code}:${row.year - 1}`);
    if (
      prior !== undefined &&
      prior.allocated !== null &&
      prior.allocated > 0 &&
      row.allocated !== null &&
      Math.abs(row.allocated - prior.allocated) > prior.allocated * 3 &&
      Math.abs(row.allocated - prior.allocated) > 20 * MILLION
    ) {
      findings.push({
        ruleId: 'enacted_jump',
        ministryId,
        ...pick(row),
        evidenceHe: `התקציב שאושר לתקנה: מ-${money(prior.allocated)} ב-${prior.year} ל-${money(row.allocated)} ב-${row.year}`,
        sourceUrl: link(row),
      });
    }

    // Within-year reinforcement, which is a different fact and a lawful one.
    if (
      row.allocated !== null &&
      row.allocated > 0 &&
      row.revised !== null &&
      row.revised - row.allocated > row.allocated * 3 &&
      row.revised - row.allocated > 20 * MILLION
    ) {
      findings.push({
        ruleId: 'in_year_reinforcement',
        ministryId,
        ...pick(row),
        evidenceHe: `מ-${money(row.allocated)} שאושרו לתקנה ל-${money(row.revised)} מעודכן באותה שנה`,
        sourceUrl: link(row),
      });
    }

    if (closed && row.econLevel2 === 'רזרבה' && row.executed !== null && row.executed > MILLION) {
      findings.push({
        ruleId: 'reserve_executed',
        ministryId,
        ...pick(row),
        evidenceHe: `בוצעו ${money(row.executed)} ישירות מתקנת רזרבה`,
        sourceUrl: link(row),
      });
    }
  }

  return findings.sort(
    (a, b) => Math.abs(b.executed ?? b.revised ?? 0) - Math.abs(a.executed ?? a.revised ?? 0),
  );
}

function pick(
  row: RegulationRow,
): Omit<AnomalyFinding, 'ruleId' | 'ministryId' | 'evidenceHe' | 'sourceUrl'> {
  return {
    code: row.code,
    title: row.title,
    year: row.year,
    allocated: row.allocated,
    revised: row.revised,
    executed: row.executed,
  };
}
