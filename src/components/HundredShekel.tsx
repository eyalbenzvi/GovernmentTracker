/**
 * The reader's own hundred shekels.
 *
 * The arithmetic already existed in the codebase (`hundredShekelBreakdown`) and was
 * buried at the bottom of the analysis screen, behind nine warning boxes. It is the
 * most approachable thing the site can show someone who does not read budget
 * hierarchies, so it belongs on the front page — and it accepts an amount, because
 * "out of every ₪100" lands differently when the number is the reader's own.
 */
import { useState } from 'react';
import type { SummarySlice } from '../types/summary';
import { formatCurrencyFull, formatNumber, formatPercent } from '../lib/format';
import { DataUnavailable, QualityNote } from './ui';

const PRESETS = [100, 1_000, 10_000] as const;

export function HundredShekel({
  slices,
  year,
  emptyReason,
}: {
  slices: readonly SummarySlice[];
  year: number | null;
  emptyReason: string;
}): JSX.Element {
  const [amount, setAmount] = useState<number>(100);

  if (slices.length === 0) {
    return <DataUnavailable reason={emptyReason} />;
  }

  const total = slices.reduce((acc, s) => acc + s.value, 0);

  return (
    <div className="card card-pad">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3>
            על מה מוצא כל שקל
            {year !== null && (
              <>
                {' '}
                בשנת <span className="num">{year}</span>
              </>
            )}
          </h3>
          <p className="mt-1 text-sm text-ink-2">
            הזינו סכום, וראו כיצד הוא מתחלק לפי הסיווג הכלכלי של התקציב המעודכן.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="field-label mb-0" htmlFor="hundred-amount">
            סכום בש״ח
          </label>
          <input
            id="hundred-amount"
            type="number"
            min={1}
            step={100}
            className="field num w-28"
            value={amount}
            onChange={(event) => {
              const next = Number(event.target.value);
              setAmount(Number.isFinite(next) && next > 0 ? next : 1);
            }}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`btn btn-sm ${amount === preset ? 'btn-primary' : ''}`}
            onClick={() => setAmount(preset)}
          >
            <span className="num">{formatNumber(preset)}</span> ש״ח
          </button>
        ))}
      </div>

      {/* One stacked bar: the composition is the point, not the individual widths. */}
      <div
        className="mt-4 flex h-6 w-full overflow-hidden rounded"
        role="img"
        aria-label={`הרכב ההוצאה: ${slices.map((s) => `${s.label} ${s.value}%`).join(', ')}`}
      >
        {slices.map((slice) => (
          <span
            key={slice.label}
            style={{ width: `${slice.value}%`, backgroundColor: slice.color }}
            title={`${slice.label}: ${formatPercent(slice.value)}`}
          />
        ))}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              <span className="truncate text-ink-2">{slice.label}</span>
            </span>
            <span className="num shrink-0 font-medium text-ink">
              {formatCurrencyFull(Math.round((slice.value / 100) * amount * 100) / 100)}
            </span>
          </li>
        ))}
      </ul>

      <QualityNote>
        <p>
          הפירוק מחושב על שורות הסיווג הכלכלי בעלות סכום חיובי בלבד: שורות של הכנסות מיועדות
          וחשבונות מעבר בסכום אפס או שלילי אינן נכללות, ולכן הסכום הוא הרכב ההוצאה ולא תזרים המדינה.
        </p>
        <p>
          זה אינו חשבון המס האישי שלכם. התקציב אינו ממומן רק ממס הכנסה, וההוצאה אינה מתחלקת בין
          תושבים באופן שווה. הסכום שהזנתם משמש כאן כדי להמחיש יחסים, לא כדי לחשב את תשלומיכם.
        </p>
        <p className="num">
          סכום נתחי הקטגוריות: {formatPercent(total)} — הפרש מ-100% נובע מעיגול.
        </p>
      </QualityNote>
    </div>
  );
}
