import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityEvidence, Dataset } from '../types/domain';
import { Badge, Callout, Card, DataUnavailable, SourceLink } from '../components/ui';
import { CsvDownloadButton, FilterGrid, SearchField, SelectField } from '../components/controls';
import {
  activitySourceTypeLabel,
  coverageLevelLabel,
  formatDate,
  formatNumber,
} from '../lib/format';
import { dataBackedTopics, filterActivities, uniqueSorted } from '../lib/selectors';

const ALL = 'all';

export function ActivityPage({ data }: { data: Dataset }): JSX.Element {
  const [ministryId, setMinistryId] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [topicId, setTopicId] = useState(ALL);
  const [sourceType, setSourceType] = useState(ALL);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(50);

  const topics = dataBackedTopics(data);
  const sourceTypes = uniqueSorted(data.activities.map((a) => a.sourceType));

  const filtered = useMemo(
    () => filterActivities(data.activities, { ministryId, year, topicId, sourceType, query }),
    [data.activities, ministryId, year, topicId, sourceType, query],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl">פעילות פומבית</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          כל פריטי הפעילות במאגר. פריט פעילות הוא פרסום פומבי — הודעת משרד, עמוד ממשלתי, מסמך
          מדיניות או פרוטוקול ועדה — ולא תיעוד של עבודת עובדי המשרד.
        </p>
      </header>

      <Callout tone="warning" title="מה אפשר ומה אי אפשר להסיק מכאן">
        <p>
          פריט פעילות מלמד שדבר מסוים פורסם בתאריך מסוים. הוא אינו מלמד על היקף העבודה, על סדרי
          עדיפויות פנימיים או על תוצאה.
        </p>
        <p>פרטי אנשים מוצגים רק כפי שהופיעו בפרסום הפומבי, ורק כאשר הם נחוצים להבנת המקור.</p>
      </Callout>

      {data.activities.length === 0 ? (
        <DataUnavailable
          title="לא נאספו פריטי פעילות בגרסת נתונים זו"
          reason="API הפרסומים של gov.il דוחה בקשות אוטומטיות מזוהות ב-HTTP 403 (הגנת bot). לא נעשה ניסיון להתחזות לדפדפן כדי לעקוף את הסירוב, ולא נוצרו פריטים משוחזרים או מנוסחים ללא מקור. יומן ניסיונות האיסוף המלא מופיע ב-data/raw/collection-log, והפירוט במסך המתודולוגיה."
        />
      ) : (
        <>
          <Card>
            <FilterGrid>
              <SelectField
                label="משרד"
                value={ministryId}
                onChange={setMinistryId}
                options={[
                  { value: ALL, label: 'כל המשרדים' },
                  ...data.ministries.map((m) => ({ value: m.id, label: m.displayName })),
                ]}
              />
              <SelectField
                label="שנה"
                value={year}
                onChange={setYear}
                options={[
                  { value: ALL, label: 'כל השנים' },
                  ...data.methodology.analysisYears.map((y) => ({
                    value: String(y),
                    label: String(y),
                  })),
                ]}
              />
              <SelectField
                label="נושא"
                value={topicId}
                onChange={setTopicId}
                options={[
                  { value: ALL, label: 'כל הנושאים' },
                  ...topics.map((t) => ({
                    value: t.id,
                    label: `${t.labelHe} (${t.activityItemCount})`,
                  })),
                ]}
              />
              <SelectField
                label="סוג מקור"
                value={sourceType}
                onChange={setSourceType}
                options={[
                  { value: ALL, label: 'כל סוגי המקור' },
                  ...sourceTypes.map((t) => ({ value: t, label: activitySourceTypeLabel(t) })),
                ]}
              />
            </FilterGrid>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SearchField
                label="חיפוש טקסט חופשי"
                value={query}
                onChange={setQuery}
                placeholder="כותרת, תקציר, נושא, ארגון"
              />
              <div className="flex items-end">
                <CsvDownloadButton
                  filename="activity-filtered"
                  headers={[
                    'id',
                    'משרד',
                    'תאריך',
                    'כותרת',
                    'תקציר',
                    'סוג מקור',
                    'נושאים',
                    'רמת כיסוי',
                    'URL',
                  ]}
                  rows={(a: ActivityEvidence) => [
                    a.id,
                    a.ministryId,
                    a.date,
                    a.title,
                    a.summary,
                    activitySourceTypeLabel(a.sourceType),
                    a.topics,
                    coverageLevelLabel(a.coverageLevel),
                    a.sourceUrl,
                  ]}
                  items={filtered}
                />
              </div>
            </div>
          </Card>

          <p className="num text-sm text-slate-600" role="status" aria-live="polite">
            {formatNumber(filtered.length)} פריטים מתוך {formatNumber(data.activities.length)}
          </p>

          {filtered.length === 0 ? (
            <DataUnavailable
              title="אין פריטים התואמים את הסינון"
              reason="נסו להרחיב את הסינון או לנקות את תיבת החיפוש."
            />
          ) : (
            <ol className="space-y-3">
              {filtered.slice(0, visible).map((activity) => {
                const ministry = data.ministries.find((m) => m.id === activity.ministryId);
                return (
                  <li key={activity.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="num text-xs text-slate-500">{formatDate(activity.date)}</p>
                          <h2 className="mt-1 text-sm font-semibold text-slate-800">
                            {activity.title}
                          </h2>
                          <p className="mt-1 max-w-3xl text-sm text-slate-600">
                            {activity.summary}
                          </p>
                        </div>
                        <SourceLink url={activity.sourceUrl} title={activity.sourceTitle} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {ministry !== undefined && (
                          <Link className="link text-xs" to={`/ministry/${ministry.id}`}>
                            {ministry.displayName}
                          </Link>
                        )}
                        <Badge tone="muted">{activitySourceTypeLabel(activity.sourceType)}</Badge>
                        <Badge tone="muted">
                          כיסוי {coverageLevelLabel(activity.coverageLevel)}
                        </Badge>
                        {activity.topics.map((id) => (
                          <Badge key={id} tone="primary">
                            {data.topics.find((t) => t.id === id)?.labelHe ?? id}
                          </Badge>
                        ))}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
          {filtered.length > visible && (
            <div className="text-center">
              <button type="button" className="btn" onClick={() => setVisible((v) => v + 50)}>
                הצג עוד 50 מתוך {formatNumber(filtered.length - visible)} הנותרים
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
