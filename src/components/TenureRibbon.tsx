/**
 * Who held the office over the period a figure covers.
 *
 * Placed above any time series about a ministry, so a reader never reads a
 * quarter — or a fiscal year — against whoever holds the post today. When more
 * than one person covered the window, the ribbon says so in words as well as in
 * segments, because the split is the point.
 */
import { Link } from 'react-router-dom';
import type { MinisterTenure } from '../types/domain';
import { formatDate } from '../lib/format';
import { attributeWindow, personId } from '../lib/tenure';

export function TenureRibbon({
  tenures,
  windowStart,
  windowEnd,
  title = 'מי כיהן בתקופה המוצגת',
}: {
  tenures: readonly MinisterTenure[];
  windowStart: string;
  windowEnd: string;
  title?: string;
}): JSX.Element | null {
  const attribution = attributeWindow(tenures, windowStart, windowEnd);
  if (attribution.segments.length === 0) return null;

  return (
    <div className="rounded-lg border border-rule bg-surface-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-ink-2">{title}</p>
        <p className="num text-xs text-ink-3">
          {formatDate(windowStart)} – {formatDate(windowEnd)}
        </p>
      </div>

      <div
        className="mt-2 flex h-3 w-full overflow-hidden rounded bg-surface-sunken"
        role="img"
        aria-label={`רצועת כהונות: ${attribution.segments
          .map((s) => `${s.tenure.personName} ${s.sharePercent}%`)
          .join(', ')}`}
      >
        {attribution.segments.map((segment, index) => (
          <span
            key={`${segment.tenure.id}-${segment.fromDate}`}
            className={index % 2 === 0 ? 'bg-brand' : 'bg-brand/60'}
            style={{ width: `${Math.max(1, segment.sharePercent)}%` }}
          />
        ))}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {attribution.segments.map((segment) => (
          <li key={`${segment.tenure.id}-${segment.fromDate}-label`}>
            <Link className="link" to={`/person/${personId(segment.tenure.personName)}`}>
              {segment.tenure.personName}
            </Link>{' '}
            <span className="text-ink-3">
              ({segment.tenure.role}, <span className="num">{segment.sharePercent}%</span> מהתקופה)
            </span>
          </li>
        ))}
      </ul>

      {attribution.isSplit && (
        <p className="mt-2 text-xs text-ink-3">
          בתקופה זו כיהן יותר מאדם אחד. מדד שמסוכם על כל התקופה אינו מתאר אדם אחד, ואין לייחס אותו
          למי שמכהן כרגע.
        </p>
      )}
      {attribution.uncoveredDays > 0 && (
        <p className="num mt-1 text-xs text-ink-3">
          {attribution.uncoveredDays} ימים בתקופה אינם מכוסים בכהונה שנאספה.
        </p>
      )}
    </div>
  );
}
