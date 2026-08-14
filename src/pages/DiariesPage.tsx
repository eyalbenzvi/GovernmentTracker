import { useEffect, useMemo, useState } from 'react';
import { useUrlParam } from '../lib/useUrlState';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  Dataset,
  DiaryEntry,
  DiaryExtractionMethod,
  DiaryPersonRole,
  DiaryProfile,
} from '../types/domain';
import { Badge, Callout, Card, DataUnavailable, QualityNote, SourceLink } from '../components/ui';
import { supplierId } from './SupplierPage';
import {
  DIARY_GROUP_RULE_HE,
  NO_MONEY_VS_TIME_HE,
  SUBJECT_MATTER_RULE_HE,
  groupDiaryCounts,
} from '../lib/taxonomy';
import { subjectMatterShareOf } from '../lib/scorecards';
import { CsvDownloadButton, FilterGrid, SearchField, SelectField } from '../components/controls';
import { loadDiaryShard } from '../data/datasets';
import { formatCurrencyShort, formatDate, formatNumber, MISSING_SHORT } from '../lib/format';

const ALL = 'all';

const ROLE_LABELS: Record<DiaryPersonRole, string> = {
  minister: 'שר/ה',
  deputy_minister: 'סגן/ית שר',
  director_general: 'מנכ"ל/ית',
  other_senior: 'בכיר/ה אחר/ת',
};

const EXTRACTION_LABELS: Record<DiaryExtractionMethod, string> = {
  datastore: 'נתון מובנה מהמאגר',
  spreadsheet: 'חולץ מגיליון',
  pdf_text: 'חולץ מטקסט PDF',
  pdf_ocr: 'פוענח ב-OCR מסריקה',
};

function percent(part: number, whole: number): string {
  if (whole === 0) return '0%';
  return `${(Math.round((part / whole) * 1000) / 10).toFixed(1)}%`;
}

export function DiariesPage({ data }: { data: Dataset }): JSX.Element {
  const index = data.diariesIndex;
  const insights = data.diaryInsights;
  const categories = data.diaryCategories;
  const nameInferences = data.diaryNameInferences;

  const sectionsWithDiaries = useMemo(
    () =>
      index.shards
        .map((shard) => ({
          shardKey: shard.shardKey,
          entryCount: shard.entryCount,
          label:
            shard.ministryId === null
              ? 'פרסומים ללא שיוך משרד'
              : (data.ministries.find((m) => m.id === shard.ministryId)?.displayName ??
                shard.ministryId),
        }))
        .sort((a, b) => b.entryCount - a.entryCount),
    [index.shards, data.ministries],
  );

  /**
   * The default section is the largest one that belongs to an actual ministry, not
   * the largest shard overall: the unattributed file is both the biggest download on
   * the site and the least useful place to land, since by definition its rows could
   * not be tied to a ministry.
   */
  const defaultShardKey =
    index.shards
      .filter((shard) => shard.ministryId !== null)
      .sort((a, b) => b.entryCount - a.entryCount)[0]?.shardKey ??
    sectionsWithDiaries[0]?.shardKey ??
    null;
  const [shardKey, setShardKey] = useState<string | null>(defaultShardKey);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [personKey, setPersonKey] = useUrlParam('person', ALL);
  const [categoryId, setCategoryId] = useUrlParam('category', ALL);
  const [query, setQuery] = useUrlParam('q', '');
  const [visible, setVisible] = useState(50);
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly'>('quarterly');
  const [ruleFilter, setRuleFilter] = useState(ALL);

  // Only the section a reader actually opens is fetched.
  useEffect(() => {
    if (shardKey === null) return;
    let active = true;
    setEntries(null);
    void loadDiaryShard(shardKey).then((rows) => {
      if (active) setEntries(rows);
    });
    return () => {
      active = false;
    };
  }, [shardKey]);

  const datasetById = useMemo(
    () => new Map(index.datasets.map((d) => [d.datasetId, d])),
    [index.datasets],
  );
  const categoryById = useMemo(
    () => new Map(categories.categories.map((c) => [c.id, c])),
    [categories.categories],
  );

  const shardMinistryId = index.shards.find((s) => s.shardKey === shardKey)?.ministryId ?? null;

  const shardProfiles = useMemo(
    () =>
      insights.profiles
        .filter((p) =>
          shardMinistryId === null ? p.ministryId === null : p.ministryId === shardMinistryId,
        )
        .sort((a, b) => b.entryCount - a.entryCount),
    [insights.profiles, shardMinistryId],
  );

  const activeProfile: DiaryProfile | null =
    personKey === ALL ? null : (shardProfiles.find((p) => p.key === personKey) ?? null);

  /**
   * The time mix for whatever is in view — one person when one is selected, the
   * whole section otherwise — rolled up to the eight reading groups.
   */
  const shardGroups = useMemo(() => {
    const sources = activeProfile === null ? shardProfiles : [activeProfile];
    const counts: Record<string, number> = {};
    for (const profile of sources) {
      for (const [categoryId, count] of Object.entries(profile.categoryCounts)) {
        counts[categoryId] = (counts[categoryId] ?? 0) + count;
      }
    }
    return groupDiaryCounts(counts, categories.categories);
  }, [activeProfile, shardProfiles, categories.categories]);

  const subjectShare = useMemo(
    () => subjectMatterShareOf(activeProfile === null ? shardProfiles : [activeProfile]),
    [activeProfile, shardProfiles],
  );

  const filtered = useMemo(() => {
    if (entries === null) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const meta = datasetById.get(entry.datasetId);
      if (personKey !== ALL) {
        const key = [
          meta?.ministryId ?? 'unattributed',
          meta?.roleLabelHe ?? '',
          meta?.personLabel ?? '—',
        ].join('|');
        if (key !== personKey) return false;
      }
      if (categoryId !== ALL && (entry.categoryId ?? 'unspecified') !== categoryId) return false;
      if (q !== '') {
        const haystack =
          `${entry.subject} ${entry.location ?? ''} ${entry.participants ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, personKey, categoryId, query, datasetById]);

  // Category mix over time for the selected person, or the whole section.
  const series = useMemo(() => {
    const source =
      activeProfile !== null
        ? activeProfile[granularity]
        : shardProfiles.flatMap((p) => p[granularity]);
    const buckets = new Map<string, Record<string, number>>();
    for (const bucket of source) {
      const target = buckets.get(bucket.period) ?? {};
      for (const [cat, count] of Object.entries(bucket.byCategory)) {
        target[cat] = (target[cat] ?? 0) + count;
      }
      buckets.set(bucket.period, target);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, byCategory]) => ({ period, ...byCategory }));
  }, [activeProfile, shardProfiles, granularity]);

  const chartCategories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of series) {
      for (const [key, value] of Object.entries(row)) {
        if (key === 'period') continue;
        totals.set(key, (totals.get(key) ?? 0) + (typeof value === 'number' ? value : 0));
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);
  }, [series]);

  const shardFindings = useMemo(
    () =>
      insights.findings.filter((f) =>
        shardMinistryId === null ? f.ministryId === null : f.ministryId === shardMinistryId,
      ),
    [insights.findings, shardMinistryId],
  );
  const visibleFindings =
    ruleFilter === ALL ? shardFindings : shardFindings.filter((f) => f.ruleId === ruleFilter);

  const shardCrossMatches = useMemo(
    () => insights.crossMatches.filter((m) => m.ministryId === shardMinistryId),
    [insights.crossMatches, shardMinistryId],
  );

  const opacityRanking = useMemo(
    () =>
      insights.profiles
        .filter((p) => p.entryCount >= (insights.thresholds.OPACITY_MIN_ENTRIES ?? 20))
        .sort((a, b) => (b.opacityPercent ?? 0) - (a.opacityPercent ?? 0))
        .slice(0, 12),
    [insights.profiles, insights.thresholds],
  );

  const scansOnly = index.datasets.filter(
    (d) => d.machineReadableEntries === 0 && d.unparsedResources.length > 0,
  );

  const ministryName = (id: string | null): string =>
    id === null ? 'ללא שיוך משרד' : (data.ministries.find((m) => m.id === id)?.displayName ?? id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl">יומני שרים, סגני שרים ומנכ"לים</h1>
        <p className="mt-2 max-w-3xl text-ink-2">
          לפי נוהל היומנים, בעלי תפקידים בכירים מפרסמים אחת לרבעון את יומן הפגישות שלהם. כאן מוצגות
          הרשומות שפורסמו, כלשונן — עם סיווג נושאים, פילוח לפי זמן, וממצאים מחושבים לפי נוסחאות
          מפורסמות.
        </p>
      </header>

      <Callout tone="warning" title="מה זה כן, ומה זה לא">
        <p>
          רשומת יומן היא שורה שפורסמה על ידי לשכת בעל התפקיד, לאחר בדיקה וההשחרות שהנוהל מתיר. היעדר
          יומן אינו היעדר פעילות, ופרסום יומן אינו תמונה מלאה של הפגישות.
        </p>
        <p>{index.source.note}</p>
        <p>
          כל מדד מחושב רק מול מה שאותו בעל תפקיד פרסם. שני בעלי תפקיד אינם בני-השוואה אם אחד פרסם
          יומן מלא והשני פרסם רבעון אחד.
        </p>
      </Callout>

      {index.totals.entries === 0 ? (
        <DataUnavailable title="טרם נאספו רשומות יומן בגרסת נתונים זו" reason={index.source.note} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Card>
              <p className="text-xs text-ink-3">רשומות יומן</p>
              <p className="num mt-1 text-xl font-semibold">{formatNumber(index.totals.entries)}</p>
              <p className="mt-1 text-xs text-ink-3">
                לאחר ניכוי {formatNumber(index.totals.duplicateRowsRemoved)} כפילויות
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ink-3">בעלי תפקיד</p>
              <p className="num mt-1 text-xl font-semibold">
                {formatNumber(insights.totals.people)}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                ב-{formatNumber(insights.totals.ministries)} משרדים
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ink-3">נושא גנרי או מושחר</p>
              <p className="num mt-1 text-xl font-semibold">
                {insights.totals.unspecifiedPercent === null
                  ? 'אין נתון'
                  : `${insights.totals.unspecifiedPercent}%`}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                בנוסף,{' '}
                {insights.totals.noSubjectPercent === null
                  ? 'אין נתון'
                  : `${insights.totals.noSubjectPercent}%`}{' '}
                פורסמו ללא טקסט נושא כלל
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ink-3">סווגו לנושא</p>
              <p className="num mt-1 text-xl font-semibold">
                {insights.totals.classifiedPercent === null
                  ? 'אין נתון'
                  : `${insights.totals.classifiedPercent}%`}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                בנוסף,{' '}
                {insights.totals.noTopicPercent === null
                  ? 'אין נתון'
                  : `${insights.totals.noTopicPercent}%`}{' '}
                מסרו שהתקיים מפגש או עם מי, בלי נושא;{' '}
                {insights.totals.unclassifiedPercent === null
                  ? 'אין נתון'
                  : `${insights.totals.unclassifiedPercent}%`}{' '}
                נושאן אמיתי אך מחוץ למילון של האתר
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ink-3">פרסומים שלא פוענחו</p>
              <p className="num mt-1 text-xl font-semibold">
                {formatNumber(index.totals.unparsedResources)}
              </p>
              <p className="mt-1 text-xs text-ink-3">מדווחים בגלוי, ראו למטה</p>
            </Card>
          </div>

          <Card>
            <h2 className="text-lg font-semibold">איך הגיעו הרשומות</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              לכל רשומה מצוינת שיטת החילוץ. רשומה שפוענחה מסריקה ב-OCR היא קריאה אוטומטית של תמונה —
              היא מסומנת ככזו ועשויה להכיל שגיאות תעתיק.
            </p>
            <ul className="mt-3 flex flex-wrap gap-3 text-sm">
              {(
                Object.entries(index.totals.byExtractionMethod) as Array<
                  [DiaryExtractionMethod, number]
                >
              ).map(([method, count]) => (
                <li key={method} className="rounded-md border border-rule px-3 py-2">
                  <span className="text-ink-2">{EXTRACTION_LABELS[method]}: </span>
                  <span className="num font-semibold">{formatNumber(count)}</span>
                  <span className="num text-xs text-ink-3">
                    {' '}
                    ({percent(count, index.totals.entries)})
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">שקיפות היומן — מי כותב במה עסק</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              שיעור הרשומות שנושאן גנרי ("פגישה", "שיחה") או מושחר, בקרב בעלי תפקיד עם{' '}
              {formatNumber(insights.thresholds.OPACITY_MIN_ENTRIES ?? 20)} רשומות ומעלה. שיעור גבוה
              אינו עבירה — הוא אומר שהפרסום מקיים את הנוהל בצורתו ולא בתכליתו.
            </p>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              שתי העמודות הימניות אינן חלק ממדד השקיפות, במכוון. "ללא טקסט נושא" יכול לנבוע מתא ריק
              במקור אך גם מעמודה שהאתר לא זיהה בקובץ. "לא סווג" הוא נושא אמיתי שמילון הקטגוריות של
              האתר אינו מכסה — מגבלה שלנו, לא של הלשכה. ספירתן כאטימות הייתה הופכת פער בכיסוי שלנו
              לטענה על בעל תפקיד.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="text-right text-xs text-ink-3">
                    <th className="py-1 pl-3">בעל תפקיד</th>
                    <th className="py-1 pl-3">משרד</th>
                    <th className="py-1 pl-3">רשומות</th>
                    <th className="py-1 pl-3">נושא גנרי/מושחר</th>
                    <th className="py-1 pl-3">ללא טקסט נושא</th>
                    <th className="py-1 pl-3">לא סווג</th>
                    <th className="py-1">מקור</th>
                  </tr>
                </thead>
                <tbody>
                  {opacityRanking.map((profile) => (
                    <tr key={profile.key} className="border-t border-rule">
                      <td className="py-2 pl-3">
                        {profile.personLabel ?? profile.roleLabelHe}
                        <span className="block text-xs text-ink-3">{profile.roleLabelHe}</span>
                      </td>
                      <td className="py-2 pl-3 text-xs text-ink-2">
                        {ministryName(profile.ministryId)}
                      </td>
                      <td className="num py-2 pl-3">{formatNumber(profile.entryCount)}</td>
                      <td className="num py-2 pl-3 font-semibold">
                        {profile.opacityPercent === null
                          ? 'אין נתון'
                          : `${profile.opacityPercent}%`}
                      </td>
                      <td className="num py-2 pl-3 text-ink-2">
                        {profile.noSubjectPercent === null
                          ? 'אין נתון'
                          : `${profile.noSubjectPercent}%`}
                      </td>
                      <td className="num py-2 pl-3 text-ink-2">
                        {profile.unclassifiedPercent === null
                          ? 'אין נתון'
                          : `${profile.unclassifiedPercent}%`}
                      </td>
                      <td className="py-2">
                        <SourceLink url={profile.sourceUrl} title="לפרסום" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">בחירת סעיף ובעל תפקיד</h2>
                <p className="mt-1 text-sm text-ink-2">
                  הרשומות נטענות לפי סעיף, כדי שהאתר יישאר מהיר גם עם מאות אלפי שורות.
                </p>
              </div>
              <p className="num text-sm text-ink-2">
                {formatNumber(sectionsWithDiaries.length)} סעיפים עם יומנים
              </p>
            </div>
            <div className="mt-3">
              <FilterGrid>
                <SelectField
                  label="סעיף"
                  value={shardKey ?? ''}
                  onChange={(value) => {
                    setShardKey(value);
                    setPersonKey(ALL);
                    setVisible(50);
                  }}
                  options={sectionsWithDiaries.map((s) => ({
                    value: s.shardKey,
                    label: `${s.label} (${formatNumber(s.entryCount)})`,
                  }))}
                />
                <SelectField
                  label="בעל תפקיד"
                  value={personKey}
                  onChange={(value) => {
                    setPersonKey(value);
                    setVisible(50);
                  }}
                  options={[
                    { value: ALL, label: 'כל בעלי התפקיד בסעיף' },
                    ...shardProfiles.map((p) => ({
                      value: p.key,
                      label: `${p.personLabel ?? p.roleLabelHe} — ${p.roleLabelHe} (${formatNumber(p.entryCount)})`,
                    })),
                  ]}
                />
                <SelectField
                  label="קטגוריית נושא"
                  value={categoryId}
                  onChange={(value) => {
                    setCategoryId(value);
                    setVisible(50);
                  }}
                  options={[
                    { value: ALL, label: 'כל הקטגוריות' },
                    ...categories.categories
                      .filter((c) => c.entryCount > 0)
                      .map((c) => ({
                        value: c.id,
                        label: `${c.labelHe} (${formatNumber(c.entryCount)})`,
                      })),
                  ]}
                />
                <SearchField
                  label="חיפוש בנושא, מיקום ומשתתפים"
                  value={query}
                  onChange={(value) => {
                    setQuery(value);
                    setVisible(50);
                  }}
                  placeholder="נושא, מיקום, שם"
                />
              </FilterGrid>
            </div>
          </Card>

          {activeProfile !== null && (
            <Card>
              <h2 className="text-lg font-semibold">
                {activeProfile.personLabel ?? activeProfile.roleLabelHe} — תמונת יומן
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-ink-3">רשומות</dt>
                  <dd className="num font-semibold">{formatNumber(activeProfile.entryCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">טווח תאריכים</dt>
                  <dd className="num">
                    {formatDate(activeProfile.firstDate)} – {formatDate(activeProfile.lastDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">נושא גנרי או מושחר</dt>
                  <dd className="num font-semibold">
                    {activeProfile.opacityPercent === null
                      ? 'אין נתון'
                      : `${activeProfile.opacityPercent}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">ללא טקסט נושא</dt>
                  <dd className="num">
                    {activeProfile.noSubjectPercent === null
                      ? 'אין נתון'
                      : `${activeProfile.noSubjectPercent}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">רשומות עם שעה</dt>
                  <dd className="num">{formatNumber(activeProfile.timedEntryCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">שישי-שבת</dt>
                  <dd className="num">{formatNumber(activeProfile.weekendCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">שעות לילה</dt>
                  <dd className="num">{formatNumber(activeProfile.lateNightCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">ימי מרתון</dt>
                  <dd className="num">{formatNumber(activeProfile.marathonDays.length)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">היום העמוס</dt>
                  <dd className="num">
                    {activeProfile.busiestDay === null
                      ? 'אין נתון'
                      : `${formatDate(activeProfile.busiestDay.date)} · ${formatNumber(activeProfile.busiestDay.count)}`}
                  </dd>
                </div>
              </dl>
              {activeProfile.repeatedSubjects.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-ink-2">נושאים חוזרים ביומן</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {activeProfile.repeatedSubjects.map((item) => (
                      <li
                        key={item.subject}
                        className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-2"
                      >
                        {item.subject}{' '}
                        <span className="num font-semibold">×{formatNumber(item.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          <Card>
            <h2 className="text-lg font-semibold">במה עסק הזמן — שמונה קבוצות קריאה</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              אוצר המילים המפורסם מכיל 30 קטגוריות, יותר משגרף אחד יכול לשאת. הקבוצות מסכמות אותן;
              הקטגוריות עצמן מוצגות מיד מתחת.
            </p>
            {shardGroups.length === 0 ? (
              <DataUnavailable reason="לא סווגו רשומות בסעיף שנבחר, ולכן אין תמהיל להצגה." />
            ) : (
              <ul className="mt-3 space-y-2">
                {shardGroups.map((group) => (
                  <li key={group.group.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink-2" title={group.group.descriptionHe}>
                        {group.group.labelHe}
                      </span>
                      <span className="num font-medium text-ink">
                        {group.sharePercent === null ? MISSING_SHORT : `${group.sharePercent}%`}{' '}
                        <span className="text-ink-3">({formatNumber(group.count)})</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded bg-surface-sunken">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${group.sharePercent ?? 0}%`,
                          backgroundColor: group.group.color,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      {group.categories
                        .slice(0, 4)
                        .map((c) => `${c.labelHe} (${formatNumber(c.count)})`)
                        .join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {subjectShare.sharePercent !== null && (
              <p className="mt-3 border-t border-rule pt-3 text-sm font-medium text-ink">
                <span className="eyebrow me-2">שורה תחתונה</span>
                {`${subjectShare.sharePercent}% מהשורות שסווגו בסעיף הזה הן עיסוק בתוכן; היתר ניהול המשרד, נסיעות ואישי, שורות בלי נושא, ושורות שאוצר המילים שלנו לא כיסה.`}
              </p>
            )}
            <QualityNote>
              <p>{DIARY_GROUP_RULE_HE}</p>
              <p>{SUBJECT_MATTER_RULE_HE}</p>
              <p>{NO_MONEY_VS_TIME_HE}</p>
            </QualityNote>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">במה עסקו — לפי קטגוריה ולפי זמן</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={granularity === 'quarterly' ? 'btn-primary' : 'btn'}
                  onClick={() => setGranularity('quarterly')}
                >
                  רבעונים
                </button>
                <button
                  type="button"
                  className={granularity === 'monthly' ? 'btn-primary' : 'btn'}
                  onClick={() => setGranularity('monthly')}
                >
                  חודשים
                </button>
              </div>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">{categories.methodNote}</p>
            {series.length === 0 ? (
              <DataUnavailable
                title="אין רשומות מתוארכות להצגה בגרף"
                reason="הפרסומים בסעיף זה אינם כוללים תאריכים שניתן לפרסר, ולכן לא נבנתה סדרת זמן."
              />
            ) : (
              <div className="mt-3 h-80" dir="ltr">
                <ResponsiveContainer>
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    {chartCategories.map((id) => (
                      <Bar
                        key={id}
                        dataKey={id}
                        stackId="a"
                        name={categoryById.get(id)?.labelHe ?? id}
                        fill={categoryById.get(id)?.color ?? '#94a3b8'}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">ממצאים מחושבים</h2>
                <p className="mt-1 max-w-3xl text-sm text-ink-2">
                  כל ממצא הוא תוצאה של נוסחה מפורסמת עם סף קבוע. ממצא אינו טענה שנעשה דבר פסול.
                </p>
              </div>
              <SelectField
                label="כלל"
                value={ruleFilter}
                onChange={setRuleFilter}
                options={[
                  { value: ALL, label: `כל הכללים (${formatNumber(shardFindings.length)})` },
                  ...insights.rules
                    .filter((rule) => shardFindings.some((f) => f.ruleId === rule.id))
                    .map((rule) => ({
                      value: rule.id,
                      label: `${rule.labelHe} (${formatNumber(shardFindings.filter((f) => f.ruleId === rule.id).length)})`,
                    })),
                ]}
              />
            </div>
            {visibleFindings.length === 0 ? (
              <DataUnavailable
                title="אין ממצאים בסעיף זה"
                reason="אף אחד מהכללים לא חצה את הסף עבור בעלי התפקיד בסעיף זה."
              />
            ) : (
              <ul className="mt-3 space-y-3">
                {visibleFindings.slice(0, 40).map((finding, i) => {
                  const rule = insights.rules.find((r) => r.id === finding.ruleId);
                  return (
                    <li
                      key={`${finding.ruleId}-${finding.personKey}-${i}`}
                      className="rounded-md border border-rule p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <Badge tone="primary">{rule?.labelHe ?? finding.ruleId}</Badge>
                          <p className="mt-1 text-sm font-semibold text-ink">
                            {finding.personLabel ?? finding.roleLabelHe}
                            <span className="font-normal text-ink-3"> · {finding.roleLabelHe}</span>
                          </p>
                          <p className="mt-1 text-sm text-ink-2">{finding.evidenceHe}</p>
                        </div>
                        <SourceLink url={finding.sourceUrl} title="לפרסום המקורי" />
                      </div>
                      {rule !== undefined && (
                        <p className="mt-2 text-xs text-ink-3">
                          נוסחה: {rule.formulaHe} · למה זה מעניין: {rule.whyInterestingHe}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">מי היה בפגישה — שיוך שנגזר מהיומנים</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              חלק ניכר מהרשומות הן שם של אדם ולא נושא. כשאותו שם מופיע בשורות אחרות שנושאן כן סווג,
              התחום של אותן שורות הוא עדות לגבי השורה שאין בה נושא. זו{' '}
              <strong>הסקה, לא ציטוט</strong>: הלשכה לא כתבה את התחום, ולכן כל שורה כזו נושאת רמת
              ביטחון נמוכה ומסומנת כמסקנה.
            </p>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              {nameInferences.rule} השיוך נשען על היומנים בלבד — לא על ידע חיצוני על זהות אנשים,
              שהקורא אינו יכול לאמת.
            </p>
            <ul className="mt-3 flex flex-wrap gap-3 text-sm">
              <li className="rounded-md border border-rule px-3 py-2">
                <span className="text-ink-2">שמות שנבדקו: </span>
                <span className="num font-semibold">
                  {formatNumber(nameInferences.totals.candidateNames)}
                </span>
              </li>
              <li className="rounded-md border border-rule px-3 py-2">
                <span className="text-ink-2">שויכו לתחום: </span>
                <span className="num font-semibold">
                  {formatNumber(nameInferences.totals.namesResolvedToField)}
                </span>
              </li>
              <li className="rounded-md border border-rule px-3 py-2">
                <span className="text-ink-2">שורות שקיבלו תחום בהסקה: </span>
                <span className="num font-semibold">
                  {formatNumber(nameInferences.totals.rowsGivenAFieldByInference)}
                </span>
              </li>
              <li className="rounded-md border border-rule px-3 py-2">
                <span className="text-ink-2">הסקות שנדחו כהכללה מרחיקת לכת: </span>
                <span className="num font-semibold">
                  {formatNumber(nameInferences.totals.inferencesRefusedAsOverExtrapolated)}
                </span>
              </li>
            </ul>
            {nameInferences.inferences.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-right text-xs text-ink-3">
                      <th className="py-1 pl-3">השם ביומן</th>
                      <th className="py-1 pl-3">התחום שנגזר</th>
                      <th className="py-1 pl-3">שורות תומכות</th>
                      <th className="py-1">שורות שהושפעו</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nameInferences.inferences.slice(0, 25).map((inference) => (
                      <tr key={inference.name} className="border-t border-rule">
                        <td className="py-2 pl-3">{inference.name}</td>
                        <td className="py-2 pl-3 text-ink-2">
                          {categories.categories.find((c) => c.id === inference.categoryId)
                            ?.labelHe ?? inference.categoryId}
                        </td>
                        <td className="num py-2 pl-3">
                          {inference.supportingRows}/{inference.classifiedAppearances} (
                          {inference.dominance}%)
                        </td>
                        <td className="num py-2">{formatNumber(inference.rowsAffected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ul className="mt-3 list-disc space-y-1 pr-5 text-xs text-ink-3">
              {nameInferences.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">הצלבה: פגישות עם ספקים ומקבלי תמיכות</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              רשומות יומן שנושאן מכיל שם של ספק מדוחות ההתקשרויות או של מקבל תמיכות באותו משרד.
              התאמת שם היא טקסטואלית: שם דומה אינו הוכחה לזהות, ופגישה עם ספק אינה טענה לפגם — זו
              הצלבה שמוצגת עם שני הקישורים כדי שהקורא יבדוק בעצמו.
            </p>
            {shardCrossMatches.length === 0 ? (
              <DataUnavailable
                title="לא נמצאו הצלבות בסעיף זה"
                reason="אף שם ספק או מקבל תמיכה מהמשרד לא הופיע בנושאי הפגישות שפורסמו."
              />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-right text-xs text-ink-3">
                      <th className="py-1 pl-3">תאריך</th>
                      <th className="py-1 pl-3">נושא כפי שפורסם</th>
                      <th className="py-1 pl-3">השם שהותאם</th>
                      <th className="py-1 pl-3">סכום במאגר</th>
                      <th className="py-1">קישורים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shardCrossMatches.slice(0, 30).map((match) => (
                      <tr
                        key={`${match.entryId}-${match.matchedName}`}
                        className="border-t border-rule align-top"
                      >
                        <td className="num py-2 pl-3 text-xs">{formatDate(match.date)}</td>
                        <td className="py-2 pl-3">{match.subject}</td>
                        <td className="py-2 pl-3">
                          <Link className="link" to={`/supplier/${supplierId(match.matchedName)}`}>
                            {match.matchedName}
                          </Link>
                          <span className="block text-xs text-ink-3">
                            {match.ruleId === 'supplier_meeting' ? 'ספק' : 'מקבל תמיכות'}
                          </span>
                        </td>
                        <td className="num py-2 pl-3">
                          {formatCurrencyShort(match.amount)}
                          <span className="block text-xs text-ink-3">{match.amountLabelHe}</span>
                        </td>
                        <td className="py-2 text-xs">
                          <SourceLink url={match.diarySourceUrl} title="ליומן" />
                          <SourceLink url={match.entityUrl} title="לישות במפתח התקציב" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shardCrossMatches.length > 30 && (
                  <p className="mt-2 text-xs text-ink-3">
                    מוצגות 30 מתוך {formatNumber(shardCrossMatches.length)} הצלבות בסעיף.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">הרשומות עצמן</h2>
              <div className="flex items-end gap-3">
                <p className="num text-sm text-ink-2" role="status" aria-live="polite">
                  {entries === null
                    ? 'טוען רשומות…'
                    : `${formatNumber(filtered.length)} רשומות מתוך ${formatNumber(entries.length)} בסעיף`}
                </p>
                <CsvDownloadButton
                  filename="diaries-filtered"
                  headers={['id', 'תאריך', 'שעה', 'נושא', 'קטגוריה', 'מיקום', 'שיטת חילוץ', 'מקור']}
                  rows={(entry: DiaryEntry) => [
                    entry.id,
                    entry.date,
                    entry.startTime,
                    entry.subject,
                    categoryById.get(entry.categoryId ?? '')?.labelHe ?? '',
                    entry.location,
                    EXTRACTION_LABELS[entry.extractionMethod],
                    datasetById.get(entry.datasetId)?.url ?? '',
                  ]}
                  items={filtered}
                />
              </div>
            </div>

            {entries !== null && filtered.length === 0 ? (
              <DataUnavailable
                title="אין רשומות התואמות את הסינון"
                reason="נסו להרחיב את הסינון או לנקות את תיבת החיפוש."
              />
            ) : (
              <ol className="mt-3 space-y-2">
                {filtered.slice(0, visible).map((entry) => {
                  const meta = datasetById.get(entry.datasetId);
                  const category = categoryById.get(entry.categoryId ?? '');
                  return (
                    <li key={entry.id} className="rounded-md border border-rule p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="num text-xs text-ink-3">
                            {formatDate(entry.date)}
                            {entry.startTime !== null && ` · ${entry.startTime}`}
                            {entry.endTime !== null && `–${entry.endTime}`}
                          </p>
                          <h3 className="mt-1 text-sm font-semibold text-ink">{entry.subject}</h3>
                          {entry.participants !== null && (
                            <p className="mt-1 max-w-3xl text-xs text-ink-2">
                              משתתפים כפי שפורסמו: {entry.participants}
                            </p>
                          )}
                        </div>
                        {meta !== undefined && <SourceLink url={meta.url} title={meta.title} />}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {meta?.ministryId !== undefined && meta.ministryId !== null && (
                          <Link className="link text-xs" to={`/ministry/${meta.ministryId}`}>
                            {ministryName(meta.ministryId)}
                          </Link>
                        )}
                        {meta !== undefined && (
                          <Badge tone="muted">{ROLE_LABELS[meta.personRole]}</Badge>
                        )}
                        {meta?.personLabel !== undefined && meta.personLabel !== null && (
                          <Badge tone="primary">{meta.personLabel}</Badge>
                        )}
                        {category !== undefined && (
                          <span
                            className="rounded-md px-2 py-0.5 text-xs text-white"
                            style={{ backgroundColor: category.color }}
                          >
                            {category.labelHe}
                          </span>
                        )}
                        {entry.location !== null && <Badge tone="muted">{entry.location}</Badge>}
                        {entry.extractionMethod === 'pdf_ocr' && (
                          <Badge tone="primary">{EXTRACTION_LABELS.pdf_ocr}</Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {filtered.length > visible && (
              <div className="mt-3 text-center">
                <button type="button" className="btn" onClick={() => setVisible((v) => v + 50)}>
                  הצג עוד 50 מתוך {formatNumber(filtered.length - visible)} הנותרים
                </button>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">מה פורסם אך לא נכנס לרשומות</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              {formatNumber(index.totals.unparsedResources)} קבצים לא הניבו רשומות: סריקות שה-OCR לא
              הצליח לפרסר לשורות, פורמטים שאינם נתמכים, וקבצים שהמאגר סירב להוריד. הם קיימים ופתוחים
              לעיון אנושי בקישור, ולא שוחזרו בניחוש. {formatNumber(scansOnly.length)} פרסומים לא
              הניבו אף רשומה.
            </p>
            {scansOnly.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-right text-xs text-ink-3">
                      <th className="py-1 pl-3">פרסום</th>
                      <th className="py-1 pl-3">סיבה</th>
                      <th className="py-1">מקור</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scansOnly.slice(0, 25).map((d) => (
                      <tr key={d.datasetId} className="border-t border-rule align-top">
                        <td className="py-2 pl-3">{d.title}</td>
                        <td className="py-2 pl-3 text-xs text-ink-2">
                          {d.unparsedResources[0]?.note ?? 'לא פוענח'}
                        </td>
                        <td className="py-2">
                          <SourceLink url={d.url} title="לעמוד הפרסום" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {scansOnly.length > 25 && (
                  <p className="mt-2 text-xs text-ink-3">
                    מוצגים 25 מתוך {formatNumber(scansOnly.length)}; הרשימה המלאה בקובץ
                    diaries-index.json.
                  </p>
                )}
              </div>
            )}
          </Card>

          {index.unmatchedTitles.length > 0 && (
            <Callout tone="info" title="פרסומים שלא שויכו למשרד">
              <p>
                {formatNumber(index.unmatchedTitles.length)} פרסומי יומן לא שויכו לסעיף תקציב לפי
                כותרתם (למשל כשהכותרת נוקבת בשם בעל התפקיד בלבד). הם נכללים תחת "פרסומים ללא שיוך
                משרד" ולא נופו — שיוך לפי שם אדם היה ניחוש.
              </p>
            </Callout>
          )}

          <Callout tone="info" title="מגבלות הסיווג">
            <ul className="list-inside list-disc space-y-1">
              {categories.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
              {insights.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </Callout>
        </>
      )}
    </div>
  );
}
