/**
 * Israeli-locale formatting helpers.
 *
 * Rounding policy, applied everywhere: abbreviated money is shown to at most two
 * decimal places, percentages to one. The full, unrounded figure is always
 * available in the accompanying title/tooltip, so the display never implies more
 * precision than the source provides.
 */

const HE = 'he-IL';

export const MISSING_LABEL = 'אין נתון זמין במקור שנאסף';
export const MISSING_SHORT = '—';

const numberFormat = new Intl.NumberFormat(HE, { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat(HE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percentFormat = new Intl.NumberFormat(HE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING_SHORT;
  return numberFormat.format(value);
}

/** Full shekel amount, e.g. 1,250,000,000 ש"ח */
export function formatCurrencyFull(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING_SHORT;
  return `${numberFormat.format(value)} ש"ח`;
}

/**
 * Abbreviated shekel amount for dense views, e.g. 1.25 מיליארד ש"ח.
 * Always pair with formatCurrencyFull in a title attribute.
 */
export function formatCurrencyShort(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING_SHORT;
  const abs = Math.abs(value);
  const sign = value < 0 ? '־' : '';
  if (abs >= 1_000_000_000)
    return `${sign}${decimalFormat.format(abs / 1_000_000_000)} מיליארד ש"ח`;
  if (abs >= 1_000_000) return `${sign}${decimalFormat.format(abs / 1_000_000)} מיליון ש"ח`;
  if (abs >= 1_000) return `${sign}${numberFormat.format(abs)} ש"ח`;
  return `${sign}${numberFormat.format(abs)} ש"ח`;
}

/**
 * Hebrew counting, so a generated sentence never reads "1 סעיפים".
 * `one` is the singular form including its own word for one ("סעיף אחד").
 */
export function formatCountHe(count: number, one: string, many: string): string {
  if (!Number.isFinite(count)) return MISSING_SHORT;
  if (count === 1) return one;
  return `${numberFormat.format(count)} ${many}`;
}

/**
 * A chart axis tick: as short as possible while still readable. The currency word
 * is dropped because the axis carries a single unit and the tooltip and table both
 * spell the full figure out — a tick of "75.00 מיליארד ש\"ח" wraps and clips.
 */
export function formatCurrencyAxis(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING_SHORT;
  const abs = Math.abs(value);
  const sign = value < 0 ? '־' : '';
  const compact = new Intl.NumberFormat(HE, { maximumFractionDigits: 1 });
  if (abs >= 1_000_000_000) return `${sign}${compact.format(abs / 1_000_000_000)} מיליארד`;
  if (abs >= 1_000_000) return `${sign}${compact.format(abs / 1_000_000)} מיליון`;
  if (abs >= 1_000) return `${sign}${compact.format(abs / 1_000)} אלף`;
  return `${sign}${numberFormat.format(abs)}`;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING_SHORT;
  return `${percentFormat.format(value)}%`;
}

/** Israeli date format: 29.12.2022 */
export function formatDate(value: string | null): string {
  if (value === null || value === '') return MISSING_SHORT;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return MISSING_SHORT;
  const date = new Date(ms);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

export function formatDateRange(start: string | null, end: string | null): string {
  const from = formatDate(start);
  const to = end === null ? 'מכהן/בתוקף' : formatDate(end);
  if (from === MISSING_SHORT && end === null) return MISSING_LABEL;
  return `${from} – ${to}`;
}

const DATA_STATUS_LABELS: Record<string, string> = {
  final: 'ביצוע סופי',
  partial: 'נתון חלקי',
  estimate: 'אומדן',
  unavailable: 'אין נתון',
};

export function dataStatusLabel(status: string): string {
  return DATA_STATUS_LABELS[status] ?? status;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  calendar: 'יומן פומבי',
  ministry_news: 'הודעת משרד',
  government_page: 'עמוד ממשלתי',
  committee_protocol: 'פרוטוקול ועדה',
  policy_document: 'מסמך מדיניות',
  other_official: 'מקור רשמי אחר',
};

export function activitySourceTypeLabel(type: string): string {
  return SOURCE_TYPE_LABELS[type] ?? type;
}

const COVERAGE_LEVEL_LABELS: Record<string, string> = {
  direct: 'ישיר',
  indirect: 'עקיף',
  partial: 'חלקי',
};

export function coverageLevelLabel(level: string): string {
  return COVERAGE_LEVEL_LABELS[level] ?? level;
}

const RETRIEVAL_LABELS: Record<string, string> = {
  retrieved: 'גוף המסמך אוחזר',
  not_retrieved_egress_blocked: 'לא אוחזר — מתחם חסום בסביבת הבנייה',
  not_retrieved_error: 'לא אוחזר — שגיאה',
};

export function retrievalStatusLabel(status: string): string {
  return RETRIEVAL_LABELS[status] ?? status;
}
