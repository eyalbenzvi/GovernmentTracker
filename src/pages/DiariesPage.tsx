import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Dataset, DiaryEntry, DiaryPersonRole } from '../types/domain';
import { Badge, Callout, Card, DataUnavailable, SourceLink } from '../components/ui';
import { CsvDownloadButton, FilterGrid, SearchField, SelectField } from '../components/controls';
import { formatDate, formatNumber } from '../lib/format';

const ALL = 'all';

const ROLE_LABELS: Record<DiaryPersonRole, string> = {
  minister: 'שר/ה',
  deputy_minister: 'סגן/ית שר',
  director_general: 'מנכ"ל/ית',
  other_senior: 'בכיר/ה אחר/ת',
};

function entryYear(entry: DiaryEntry): string | null {
  return entry.date === null ? null : entry.date.slice(0, 4);
}

export function DiariesPage({ data }: { data: Dataset }): JSX.Element {
  const [ministryId, setMinistryId] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(50);

  const coverage = data.diariesCoverage;
  const entries = data.diaries;

  const ministriesWithDiaries = useMemo(() => {
    const ids = new Set(entries.map((e) => e.ministryId).filter((id): id is string => id !== null));
    return data.ministries
      .filter((m) => ids.has(m.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));
  }, [entries, data.ministries]);

  const years = useMemo(
    () =>
      [...new Set(entries.map(entryYear).filter((y): y is string => y !== null))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    return entries.filter((e) => {
      if (ministryId !== ALL && e.ministryId !== ministryId) return false;
      if (role !== ALL && e.personRole !== role) return false;
      if (year !== ALL && entryYear(e) !== year) return false;
      if (q !== '') {
        const haystack =
          `${e.subject} ${e.location ?? ''} ${e.participants ?? ''} ${e.personLabel ?? ''} ${e.roleLabelHe}`.toLowerCase();
        if (!haystack.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [entries, ministryId, role, year, query]);

  const scansOnly = coverage.datasets.filter(
    (d) => d.machineReadableEntries === 0 && d.unparsedResources.length > 0,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl">יומני שרים, סגני שרים ומנכ"לים</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          לפי נוהל היומנים, שרים, סגני שרים ומנכ"לים מפרסמים אחת לרבעון את יומן הפגישות שלהם. המסך
          מציג את הרשומות מתוך הקבצים שפורסמו, כלשונן, עם קישור למקור לכל רשומה.
        </p>
      </header>

      <Callout tone="warning" title="מה זה כן, ומה זה לא">
        <p>
          רשומת יומן היא שורה שפורסמה על ידי לשכת בעל התפקיד לאחר בדיקה וההשחרות הקבועות בנוהל.
          היעדר יומן אינו היעדר פעילות, ופרסום יומן אינו תמונה מלאה של פגישות בעל התפקיד.
        </p>
        <p>
          המקור: {coverage.source.name} (
          {coverage.source.trustTier === 'civic_helper' && 'שכבת עזר אזרחית'}
          ). {coverage.source.note}
        </p>
      </Callout>

      {entries.length === 0 ? (
        <DataUnavailable
          title="טרם נאספו רשומות יומן בגרסת נתונים זו"
          reason={coverage.source.note}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <p className="text-xs text-slate-500">רשומות יומן</p>
              <p className="num mt-1 text-xl font-semibold">{formatNumber(entries.length)}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">קבצים שפוענחו</p>
              <p className="num mt-1 text-xl font-semibold">
                {formatNumber(coverage.totals.datasetsWithEntries)}
                <span className="text-sm font-normal text-slate-500">
                  {' '}
                  מתוך {formatNumber(coverage.totals.datasets)}
                </span>
              </p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">משרדים עם יומן</p>
              <p className="num mt-1 text-xl font-semibold">
                {formatNumber(ministriesWithDiaries.length)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">פרסומים שלא ניתן לפענח</p>
              <p className="num mt-1 text-xl font-semibold">
                {formatNumber(coverage.totals.unparsedResources)}
              </p>
            </Card>
          </div>

          <Card>
            <FilterGrid>
              <SelectField
                label="משרד"
                value={ministryId}
                onChange={setMinistryId}
                options={[
                  { value: ALL, label: 'כל המשרדים' },
                  ...ministriesWithDiaries.map((m) => ({ value: m.id, label: m.displayName })),
                ]}
              />
              <SelectField
                label="תפקיד"
                value={role}
                onChange={setRole}
                options={[
                  { value: ALL, label: 'כל התפקידים' },
                  ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
                ]}
              />
              <SelectField
                label="שנה"
                value={year}
                onChange={setYear}
                options={[
                  { value: ALL, label: 'כל השנים' },
                  ...years.map((y) => ({ value: y, label: y })),
                ]}
              />
              <SearchField
                label="חיפוש בנושא, במיקום ובמשתתפים"
                value={query}
                onChange={setQuery}
                placeholder="נושא הפגישה, מיקום, שם"
              />
            </FilterGrid>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="num text-sm text-slate-600" role="status" aria-live="polite">
                {formatNumber(filtered.length)} רשומות מתוך {formatNumber(entries.length)}
              </p>
              <CsvDownloadButton
                filename="diaries-filtered"
                headers={[
                  'id',
                  'משרד',
                  'תפקיד',
                  'בעל התפקיד',
                  'תאריך',
                  'שעה',
                  'נושא',
                  'מיקום',
                  'URL',
                ]}
                rows={(e: DiaryEntry) => [
                  e.id,
                  e.ministryId,
                  e.roleLabelHe,
                  e.personLabel,
                  e.date,
                  e.startTime,
                  e.subject,
                  e.location,
                  e.sourceUrl,
                ]}
                items={filtered}
              />
            </div>
          </Card>

          {filtered.length === 0 ? (
            <DataUnavailable
              title="אין רשומות התואמות את הסינון"
              reason="נסו להרחיב את הסינון או לנקות את תיבת החיפוש."
            />
          ) : (
            <ol className="space-y-2">
              {filtered.slice(0, visible).map((entry) => {
                const ministry = data.ministries.find((m) => m.id === entry.ministryId);
                return (
                  <li key={entry.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="num text-xs text-slate-500">
                            {formatDate(entry.date)}
                            {entry.startTime !== null && ` · ${entry.startTime}`}
                            {entry.endTime !== null && `–${entry.endTime}`}
                          </p>
                          <h2 className="mt-1 text-sm font-semibold text-slate-800">
                            {entry.subject}
                          </h2>
                          {entry.participants !== null && (
                            <p className="mt-1 max-w-3xl text-xs text-slate-600">
                              משתתפים כפי שפורסמו: {entry.participants}
                            </p>
                          )}
                        </div>
                        <SourceLink url={entry.sourceUrl} title={entry.sourceTitle} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {ministry !== undefined && (
                          <Link className="link text-xs" to={`/ministry/${ministry.id}`}>
                            {ministry.displayName}
                          </Link>
                        )}
                        <Badge tone="muted">{ROLE_LABELS[entry.personRole]}</Badge>
                        {entry.personLabel !== null && (
                          <Badge tone="primary">{entry.personLabel}</Badge>
                        )}
                        {entry.location !== null && <Badge tone="muted">{entry.location}</Badge>}
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

          <Card>
            <h2 className="text-lg font-semibold">מה פורסם אך לא ניתן לפענוח אוטומטי</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              חלק מהיומנים פורסמו כסריקות PDF או כקבצים שלא נטענו למסד הנתונים של המאגר. הם קיימים
              ופתוחים לעיון אנושי בקישור, אך אינם מופיעים ברשימת הרשומות — ולא שוחזרו בניחוש.{' '}
              {formatNumber(scansOnly.length)} פרסומים כאלה בגרסה זו.
            </p>
            {scansOnly.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-right text-xs text-slate-500">
                      <th className="py-1 pl-3">פרסום</th>
                      <th className="py-1 pl-3">קבצים</th>
                      <th className="py-1">מקור</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scansOnly.slice(0, 40).map((d) => (
                      <tr key={d.datasetId} className="border-t border-slate-100 align-top">
                        <td className="py-2 pl-3">{d.title}</td>
                        <td className="py-2 pl-3 text-xs text-slate-600">
                          {d.unparsedResources
                            .map((r) => r.format)
                            .filter((f, i, arr) => arr.indexOf(f) === i)
                            .join(', ')}
                        </td>
                        <td className="py-2">
                          <SourceLink url={d.url} title="לעמוד הפרסום" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {scansOnly.length > 40 && (
                  <p className="mt-2 text-xs text-slate-500">
                    מוצגים 40 מתוך {formatNumber(scansOnly.length)}; הרשימה המלאה בקובץ
                    diaries-coverage.json.
                  </p>
                )}
              </div>
            )}
          </Card>

          {coverage.unmatchedTitles.length > 0 && (
            <Callout tone="info" title="פרסומים שלא שויכו למשרד">
              <p>
                {formatNumber(coverage.unmatchedTitles.length)} פרסומי יומן לא שויכו לסעיף תקציב
                מוכר לפי כותרתם (למשל כאשר הכותרת נוקבת בשם בעל התפקיד בלבד). הם נכללים בסך הרשומות
                תחת "ללא שיוך" ולא נופו — שיוך לפי שם אדם בלבד היה ניחוש.
              </p>
            </Callout>
          )}
        </>
      )}
    </div>
  );
}
