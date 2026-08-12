import { useMemo, useState } from 'react';
import type { Dataset, SourceCatalogItem } from '../types/domain';
import {
  Badge,
  Callout,
  Card,
  DataUnavailable,
  SectionHeading,
  SourceLink,
} from '../components/ui';
import { CsvDownloadButton, FilterGrid, SearchField, SelectField } from '../components/controls';
import { DataTable, type Column } from '../components/DataTable';
import { formatDate, formatNumber, retrievalStatusLabel } from '../lib/format';
import { filterSources, uniqueSorted } from '../lib/selectors';

const ALL = 'all';

export function SourcesPage({ data }: { data: Dataset }): JSX.Element {
  const [ministryId, setMinistryId] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [sourceType, setSourceType] = useState(ALL);
  const [publisher, setPublisher] = useState(ALL);
  const [query, setQuery] = useState('');

  const publishers = uniqueSorted(data.sources.map((s) => s.publisher));
  const types = uniqueSorted(data.sources.map((s) => s.sourceType));
  const typeLabels = new Map(data.sources.map((s) => [s.sourceType, s.sourceTypeLabelHe]));

  const filtered = useMemo(
    () => filterSources(data.sources, { ministryId, year, sourceType, publisher, query }),
    [data.sources, ministryId, year, sourceType, publisher, query],
  );

  const retrievedCount = data.sources.filter((s) => s.retrievalStatus === 'retrieved').length;

  const columns: Column<SourceCatalogItem>[] = [
    {
      key: 'title',
      header: 'כותרת המקור',
      render: (source) => (
        <div className="max-w-md">
          <span className="font-medium">{source.title}</span>
          <span className="block text-xs text-slate-500">{source.periodCovered}</span>
        </div>
      ),
      sortValue: (source) => source.title,
    },
    {
      key: 'publisher',
      header: 'מפרסם',
      render: (source) => source.publisher,
      sortValue: (source) => source.publisher,
    },
    {
      key: 'type',
      header: 'סוג',
      render: (source) => source.sourceTypeLabelHe,
      sortValue: (source) => source.sourceTypeLabelHe,
    },
    {
      key: 'ministries',
      header: 'משרדים',
      render: (source) =>
        source.ministryIds.length === 0 ? (
          <span className="text-slate-500">רוחבי</span>
        ) : (
          source.ministryIds
            .map((id) => data.ministries.find((m) => m.id === id)?.displayName ?? id)
            .join(', ')
        ),
      sortValue: (source) => source.ministryIds.join(','),
    },
    {
      key: 'years',
      header: 'שנות תקציב',
      render: (source) => (
        <span className="num">
          {source.fiscalYears.length > 0 ? source.fiscalYears.join(', ') : '—'}
        </span>
      ),
      sortValue: (source) => source.fiscalYears[0] ?? null,
      align: 'end',
    },
    {
      key: 'reliability',
      header: 'אמינות',
      render: (source) => (
        <Badge tone={source.reliabilityLevel === 'primary_official' ? 'primary' : 'muted'}>
          {source.reliabilityLevel === 'primary_official' ? 'רשמי ראשוני' : 'שכבת עזר'}
        </Badge>
      ),
      sortValue: (source) => source.reliabilityLevel,
    },
    {
      key: 'retrieval',
      header: 'סטטוס אחזור',
      render: (source) => (
        <span className="text-xs" title={source.retrievalNote}>
          {retrievalStatusLabel(source.retrievalStatus)}
        </span>
      ),
      sortValue: (source) => source.retrievalStatus,
    },
    {
      key: 'collected',
      header: 'נאסף בתאריך',
      render: (source) => <span className="num">{formatDate(source.collectedAt)}</span>,
      sortValue: (source) => source.collectedAt,
      align: 'end',
    },
    {
      key: 'link',
      header: 'קישור',
      render: (source) => <SourceLink url={source.url} title={source.title} />,
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl">קטלוג המקורות</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          כל מקור שהאתר מסתמך עליו או מפנה אליו, עם מפרסם, סוג, תקופה, שיטת גילוי, סטטוס אחזור
          וקישור ישיר. אין באתר תוכן ממקור חיצוני ללא URL.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm font-medium text-slate-600">מקורות בקטלוג</p>
          <p className="num mt-1 text-2xl font-semibold">{formatNumber(data.sources.length)}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-600">מקורות רשמיים ראשוניים</p>
          <p className="num mt-1 text-2xl font-semibold">
            {formatNumber(
              data.sources.filter((s) => s.reliabilityLevel === 'primary_official').length,
            )}
          </p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-600">גוף המסמך אוחזר</p>
          <p className="num mt-1 text-2xl font-semibold">{formatNumber(retrievedCount)}</p>
          <p className="mt-1 text-xs text-slate-500">
            מתוך {formatNumber(data.sources.length)} — היתר נשמרו כהפניה בלבד
          </p>
        </Card>
      </div>

      {retrievedCount === 0 && (
        <Callout tone="warning" title="גוף המסמכים לא אוחזר בגרסה זו">
          <p>
            כל {formatNumber(data.sources.length)} המקורות בקטלוג הם מקורות אמיתיים שאותרו ותועדו,
            אך מתחמי האירוח שלהם חסומים על ידי רשימת ההיתר של סביבת הבנייה. לכן נשמרו הכותרת וה-URL,
            ולא חולצו מהם נתונים.
          </p>
          <p>הקישורים תקפים ומפנים ישירות למקור הרשמי. אפשר וכדאי לאמת כל פרט מולם.</p>
        </Callout>
      )}

      <Card>
        <FilterGrid>
          <SelectField
            label="משרד"
            value={ministryId}
            onChange={setMinistryId}
            options={[
              { value: ALL, label: 'כל המקורות' },
              { value: 'cross-cutting', label: 'מקורות רוחביים (לא ממופים למשרד)' },
              ...data.ministries.map((m) => ({ value: m.id, label: m.displayName })),
            ]}
          />
          <SelectField
            label="שנת תקציב"
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
            label="סוג מקור"
            value={sourceType}
            onChange={setSourceType}
            options={[
              { value: ALL, label: 'כל הסוגים' },
              ...types.map((t) => ({ value: t, label: typeLabels.get(t) ?? t })),
            ]}
          />
          <SelectField
            label="מפרסם"
            value={publisher}
            onChange={setPublisher}
            options={[
              { value: ALL, label: 'כל המפרסמים' },
              ...publishers.map((p) => ({ value: p, label: p })),
            ]}
          />
        </FilterGrid>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SearchField
            label="חיפוש חופשי"
            value={query}
            onChange={setQuery}
            placeholder="כותרת, מפרסם או כתובת"
          />
          <div className="flex items-end">
            <CsvDownloadButton
              filename="source-catalog-filtered"
              headers={[
                'id',
                'כותרת',
                'מפרסם',
                'סוג',
                'משרדים',
                'שנות תקציב',
                'תקופה',
                'אמינות',
                'שיטת חילוץ',
                'שאילתת גילוי',
                'כלל מיפוי',
                'סטטוס אחזור',
                'checksum',
                'נאסף בתאריך',
                'URL',
              ]}
              rows={(s: SourceCatalogItem) => [
                s.id,
                s.title,
                s.publisher,
                s.sourceTypeLabelHe,
                s.ministryIds,
                s.fiscalYears,
                s.periodCovered,
                s.reliabilityLevel,
                s.extractionMethod,
                s.discoveryQueryId,
                s.mappingRule,
                retrievalStatusLabel(s.retrievalStatus),
                s.checksumSha256,
                s.collectedAt,
                s.url,
              ]}
              items={filtered}
            />
          </div>
        </div>
      </Card>

      <section aria-labelledby="catalog-table">
        <SectionHeading id="catalog-table" title="הקטלוג המלא" />
        <p className="num mb-2 text-sm text-slate-600" role="status" aria-live="polite">
          {formatNumber(filtered.length)} מקורות מתוך {formatNumber(data.sources.length)}
        </p>
        {data.sources.length === 0 ? (
          <DataUnavailable reason="קטלוג המקורות ריק." />
        ) : (
          <DataTable
            items={filtered}
            columns={columns}
            caption="קטלוג המקורות הרשמיים"
            rowKey={(source) => source.id}
            emptyMessage="אין מקורות התואמים את הסינון הנוכחי."
          />
        )}
      </section>
    </div>
  );
}
