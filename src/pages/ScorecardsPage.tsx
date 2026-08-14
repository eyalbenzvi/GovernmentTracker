/**
 * The league table, and the 2×2 that keeps it honest.
 *
 * Two indices per section — transparency of what was published, concentration of
 * what was contracted — each with its formula printed next to it. Above them sits the
 * matrix that separates "they published nothing" from "they published and we could
 * not read it", because the site was previously capable of making the second look
 * like the first.
 *
 * Renders from the summary alone, so it opens without the 12MB corpus.
 */
import { Link } from 'react-router-dom';
import type { SiteSummary, MinistrySummary } from '../types/summary';
import { Badge, Callout, Card, QualityNote, ScoreBar, SectionHeading } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { DotPlot } from '../components/charts';
import { CsvDownloadButton, SelectField } from '../components/controls';
import { comparisonSentence } from '../lib/insights';
import { PROCUREMENT_FORMULA_HE, TRANSPARENCY_FORMULA_HE } from '../lib/scorecards';
import { PUBLICATION_STATE_LABELS, PUBLICATION_STATE_RULE_HE } from '../lib/scorecards';
import { formatCurrencyShort, formatNumber, formatPercent, MISSING_SHORT } from '../lib/format';
import { useUrlParam } from '../lib/useUrlState';

const ALL = 'all';

type Measure = 'transparency' | 'procurement' | 'execution' | 'budget';

const MEASURES: Array<{
  value: Measure;
  label: string;
  description: string;
  pick: (row: MinistrySummary) => number | null;
  format: (value: number | null) => string;
}> = [
  {
    value: 'transparency',
    label: 'ציון שקיפות היומנים',
    description: 'עד כמה הפרסום שימושי: נושא, שעה, ייחוס לאדם, רצף.',
    pick: (row) => row.transparencyScore,
    format: (v) => (v === null ? MISSING_SHORT : formatNumber(v)),
  },
  {
    value: 'procurement',
    label: 'מדד ריכוזיות רכש',
    description: 'ריכוזיות ספקים, נתח חמשת הגדולים ונתח הפטור ממכרז.',
    pick: (row) => row.procurementScore,
    format: (v) => (v === null ? MISSING_SHORT : formatNumber(v)),
  },
  {
    value: 'execution',
    label: 'שיעור ביצוע',
    description: 'ביצוע או אומדן חלקי התקציב המעודכן, בשנה האחרונה שיש לה נתון.',
    pick: (row) => row.executionRatePercent,
    format: formatPercent,
  },
  {
    value: 'budget',
    label: 'נתח מהתקציב',
    description: 'חלקו של הסעיף מסך התקציב המעודכן שנאסף.',
    pick: (row) => row.shareOfTotalPercent,
    format: formatPercent,
  },
];

function PublicationMatrix({ rows }: { rows: readonly MinistrySummary[] }): JSX.Element {
  const buckets = {
    published_and_read: rows.filter((r) => r.publicationState === 'published_and_read'),
    published_not_read: rows.filter((r) => r.publicationState === 'published_not_read'),
    nothing_published: rows.filter((r) => r.publicationState === 'nothing_published'),
    no_diary_expected: rows.filter((r) => r.publicationState === 'no_diary_expected'),
  };

  const CELLS = [
    {
      id: 'published_and_read' as const,
      tone: 'border-state-final/40 bg-state-final-soft',
      note: 'הנתונים על הסעיפים האלה בטבלה למטה.',
    },
    {
      id: 'published_not_read' as const,
      tone: 'border-state-partial/50 bg-state-partial-soft',
      note: 'פער שלנו: קובץ סרוק, פורמט שאינו נתמך או הורדה שנחסמה. אינו משפיע על הציון.',
    },
    {
      id: 'nothing_published' as const,
      tone: 'border-rule-strong bg-surface-2',
      note: 'לא נמצא פרסום יומן במאגר שנסרק. אין ציון שקיפות.',
    },
    {
      id: 'no_diary_expected' as const,
      tone: 'border-rule bg-surface-2',
      note: 'סעיפי תקציב שאינם משרדי ממשלה — מוסדות שלטון, רשויות וסעיפים טכניים.',
    },
  ];

  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CELLS.map((cell) => {
          const list = buckets[cell.id];
          return (
            <li key={cell.id} className={`rounded-lg border p-4 ${cell.tone}`}>
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{PUBLICATION_STATE_LABELS[cell.id]}</span>
                <span className="num text-xl font-semibold text-ink">{list.length}</span>
              </p>
              <p className="mt-1 text-xs text-ink-2">{cell.note}</p>
              {list.length > 0 && list.length <= 8 && (
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {list.map((row) => (
                    <li key={row.id}>
                      <Link className="link" to={`/ministry/${row.id}`}>
                        {row.displayName}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <QualityNote label="למה ההפרדה הזו קיימת">
        <p>{PUBLICATION_STATE_RULE_HE}</p>
      </QualityNote>
    </div>
  );
}

export function ScorecardsPage({ summary }: { summary: SiteSummary }): JSX.Element {
  const [measureId, setMeasureId] = useUrlParam('measure', 'transparency');
  const [kind, setKind] = useUrlParam('kind', 'ministry');

  const measure =
    MEASURES.find((m) => m.value === measureId) ?? (MEASURES[0] as (typeof MEASURES)[0]);
  const rows = summary.ministries.filter((r) => kind === ALL || r.sectionKind === kind);

  const dotRows = rows.map((row) => ({
    id: row.id,
    label: row.displayName,
    value: measure.pick(row),
    href: `#/ministry/${row.id}`,
  }));

  const columns: Column<MinistrySummary>[] = [
    {
      key: 'name',
      header: 'סעיף',
      render: (row) => (
        <Link className="link" to={`/ministry/${row.id}`}>
          {row.displayName}
        </Link>
      ),
      sortValue: (row) => row.displayName,
    },
    {
      key: 'budget',
      header: 'תקציב מעודכן',
      render: (row) => formatCurrencyShort(row.updatedBudget),
      sortValue: (row) => row.updatedBudget,
      align: 'end',
    },
    {
      key: 'share',
      header: 'נתח',
      render: (row) => formatPercent(row.shareOfTotalPercent),
      sortValue: (row) => row.shareOfTotalPercent,
      align: 'end',
    },
    {
      key: 'execution',
      header: 'שיעור ביצוע',
      render: (row) => (
        <span>
          {formatPercent(row.executionRatePercent)}
          {row.executionIsEstimate && <span className="text-ink-3"> (אומדן)</span>}
        </span>
      ),
      sortValue: (row) => row.executionRatePercent,
      align: 'end',
    },
    {
      key: 'transparency',
      header: 'שקיפות יומנים',
      render: (row) =>
        row.transparencyScore === null ? (
          <span className="text-ink-3">{MISSING_SHORT}</span>
        ) : (
          <ScoreBar score={row.transparencyScore} label="ציון שקיפות" />
        ),
      sortValue: (row) => row.transparencyScore,
    },
    {
      key: 'procurement',
      header: 'ריכוזיות רכש',
      render: (row) =>
        row.procurementScore === null ? (
          <span className="text-ink-3">{MISSING_SHORT}</span>
        ) : (
          <ScoreBar score={row.procurementScore} label="מדד ריכוזיות" tone="warm" />
        ),
      sortValue: (row) => row.procurementScore,
    },
    {
      key: 'exempt',
      header: 'פטור ממכרז',
      render: (row) => formatPercent(row.exemptVolumeSharePercent),
      sortValue: (row) => row.exemptVolumeSharePercent,
      align: 'end',
    },
    {
      key: 'state',
      header: 'מצב פרסום היומנים',
      render: (row) => (
        <Badge
          tone={
            row.publicationState === 'published_and_read'
              ? 'primary'
              : row.publicationState === 'published_not_read'
                ? 'warm'
                : 'muted'
          }
        >
          {PUBLICATION_STATE_LABELS[row.publicationState]}
        </Badge>
      ),
      sortValue: (row) => PUBLICATION_STATE_LABELS[row.publicationState],
    },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h1>מי שקוף יותר, ומי מרכז יותר</h1>
        <p className="mt-2 max-w-3xl text-ink-2">
          שני מדדים מחושבים לכל סעיף, עם הנוסחה גלויה: כמה שימושי מה שפורסם, וכמה מרוכזות
          ההתקשרויות. מדד אינו ממצא של אי-תקינות — הוא נקודת פתיחה לשאלה.
        </p>
      </section>

      <section aria-labelledby="matrix-heading">
        <SectionHeading
          id="matrix-heading"
          title="מה פורסם, ומה הצלחנו לקרוא"
          description="ההפרדה הזו קודמת לכל ציון: בלעדיה, כישלון של צינור האיסוף שלנו נראה כמו אטימות של משרד."
        />
        <PublicationMatrix rows={summary.ministries} />
      </section>

      <section aria-labelledby="compare-heading">
        <SectionHeading
          id="compare-heading"
          title="השוואה בין הסעיפים"
          description="מדד אחד, כל הסעיפים, על אותו ציר. הבחירה נשמרת בכתובת וניתן לשתף אותה."
        />
        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="מדד להשוואה"
              value={measure.value}
              options={MEASURES.map((m) => ({ value: m.value, label: m.label }))}
              onChange={setMeasureId}
              hint={measure.description}
            />
            <SelectField
              label="אילו סעיפים"
              value={kind}
              options={[
                { value: 'ministry', label: `משרדי ממשלה (${summary.counts.ministrySections})` },
                { value: 'other', label: `סעיפים שאינם משרדים (${summary.counts.otherSections})` },
                { value: ALL, label: `כל הסעיפים (${summary.counts.ministries})` },
              ]}
              onChange={setKind}
              hint="סעיף שאינו משרד — מוסד שלטון, רשות או סעיף טכני."
            />
          </div>
        </Card>
        <DotPlot
          title={measure.label}
          description={measure.description}
          rows={dotRows}
          formatValue={measure.format}
          valueLabelHe={measure.label}
          referenceLabelHe="חציון הסעיפים שיש להם נתון"
          takeaway={comparisonSentence(dotRows, measure.label, measure.format)}
          emptyReason="אין לאף סעיף בבחירה הנוכחית נתון עבור המדד הזה."
        />
      </section>

      <section aria-labelledby="table-heading">
        <SectionHeading
          id="table-heading"
          title="טבלת הליגה"
          description="כל המדדים יחד. ניתן למיין לפי כל עמודה."
          action={
            <CsvDownloadButton
              filename="scorecards.csv"
              headers={[
                'סעיף',
                'תקציב מעודכן',
                'נתח',
                'שיעור ביצוע',
                'ציון שקיפות',
                'מדד ריכוזיות',
                'פטור ממכרז',
                'מצב פרסום',
              ]}
              rows={(row: MinistrySummary) => [
                row.displayName,
                row.updatedBudget,
                row.shareOfTotalPercent,
                row.executionRatePercent,
                row.transparencyScore,
                row.procurementScore,
                row.exemptVolumeSharePercent,
                PUBLICATION_STATE_LABELS[row.publicationState],
              ]}
              items={rows}
            />
          }
        />
        <DataTable
          items={rows}
          columns={columns}
          caption="מדדים מחושבים לכל סעיף תקציב"
          rowKey={(row) => row.id}
          emptyMessage="אין סעיפים בבחירה הנוכחית."
        />
        <div className="mt-4 space-y-3">
          <Callout tone="caution" title="הנוסחאות, במלואן">
            <p>{TRANSPARENCY_FORMULA_HE}</p>
            <p>{PROCUREMENT_FORMULA_HE}</p>
          </Callout>
        </div>
      </section>
    </div>
  );
}
