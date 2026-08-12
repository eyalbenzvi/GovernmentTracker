import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, SearchCode } from 'lucide-react';
import type { Dataset } from '../types/domain';
import {
  Badge,
  Callout,
  Card,
  DataUnavailable,
  SectionHeading,
  SourceLink,
} from '../components/ui';
import { CsvDownloadButton, SelectField } from '../components/controls';
import {
  formatCurrencyFull,
  formatCurrencyShort,
  formatDate,
  formatNumber,
  formatPercent,
  MISSING_SHORT,
} from '../lib/format';

const ALL = 'all';

const ENTITY_KIND_LABELS: Record<string, string> = {
  company: 'חברה',
  association: 'עמותה',
  municipality: 'רשות מקומית',
  provident_fund: 'קופת גמל',
  cooperative: 'אגודה שיתופית',
  'ottoman-association': 'אגודה עות׳מאנית',
};

function kindLabel(kind: string | null): string {
  if (kind === null) return 'ישות';
  return ENTITY_KIND_LABELS[kind] ?? kind;
}

export function FindingsPage({ data }: { data: Dataset }): JSX.Element {
  const [ministryId, setMinistryId] = useState<string>('transport');
  const [ruleFilter, setRuleFilter] = useState<string>(ALL);
  const [anomalyMinistry, setAnomalyMinistry] = useState<string>(ALL);

  const ministryOptions = data.ministries.map((m) => ({ value: m.id, label: m.displayName }));
  const ministryName = data.ministries.find((m) => m.id === ministryId)?.displayName ?? ministryId;

  const suppliers = data.findings.suppliers[ministryId] ?? [];
  const totals = data.findings.contractTotals[ministryId];
  const methods = data.findings.procurementMethods[ministryId] ?? [];
  const contracts = data.findings.notableContracts[ministryId] ?? [];
  const recipients = data.findings.supportRecipients[ministryId] ?? [];
  const changes = data.findings.budgetChanges[ministryId] ?? [];

  const exemptShare = methods.find((m) => m.method === 'פטור ממכרז')?.sharePercent ?? null;
  const excluded = data.findings.excludedContracts[ministryId];
  const contractsSuspect = excluded?.dataSuspect === true;

  const anomalies = useMemo(
    () =>
      data.anomalies.findings.filter(
        (f) =>
          (ruleFilter === ALL || f.ruleId === ruleFilter) &&
          (anomalyMinistry === ALL || f.ministryId === anomalyMinistry),
      ),
    [data.anomalies.findings, ruleFilter, anomalyMinistry],
  );
  const ruleById = new Map(data.anomalies.rules.map((r) => [r.id, r]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl sm:text-3xl">ממצאים: ספקים, תמיכות והעברות</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          שכבת העומק של המאגר: עם מי המשרדים מתקשרים, מי מקבל תמיכות, אילו העברות תקציב אושרו באמצע
          השנה — ואילו תקנות עונות על כללי חריגה מוצהרים. הכול מקושר חזרה למקור.
        </p>
      </header>

      <Callout tone="caution" title="איך לקרוא את המסך הזה">
        <p>{data.findings.method}</p>
        <p>
          <strong>{data.findings.volumeNote}</strong>
        </p>
        <p>
          ממצא או שורה בטבלה אינם טענה לאי-סדרים. אלה נתונים פומביים שמוצגים כדי שאפשר יהיה לשאול
          שאלות טובות — והקישור למקור נמצא בכל שורה בדיוק בשביל זה.
        </p>
      </Callout>

      <section aria-labelledby="ministry-pick">
        <SectionHeading
          id="ministry-pick"
          title="בחירת משרד"
          description="חל על הספקים, ההתקשרויות, התמיכות וההעברות שבהמשך."
        />
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="משרד"
              value={ministryId}
              options={ministryOptions}
              onChange={setMinistryId}
            />
            <div className="flex flex-wrap items-end gap-2 pb-1">
              {totals !== undefined && (
                <>
                  <Badge tone="primary">
                    <span className="num">
                      {formatNumber(totals.contractCount)} התקשרויות מאז 2023
                    </span>
                  </Badge>
                  <Badge tone="muted">
                    <span className="num">
                      היקף רב-שנתי {formatCurrencyShort(totals.totalVolume)}
                    </span>
                  </Badge>
                  {totals.top5SharePercent !== null && (
                    <Badge tone="muted">
                      <span className="num">
                        5 הספקים הגדולים = {formatPercent(totals.top5SharePercent)} מההיקף
                      </span>
                    </Badge>
                  )}
                  {exemptShare !== null && (
                    <Badge>
                      <span className="num">פטור ממכרז: {formatPercent(exemptShare)} מההיקף</span>
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </section>

      {contractsSuspect && excluded !== undefined && (
        <Callout tone="warning" title="נתוני ההתקשרויות של משרד זה אינם מוצגים — חשד לשגיאות במקור">
          <p>
            {formatNumber(excluded.excludedCount)} רשומות התקשרות בהיקף מדווח של{' '}
            <span className="num">{formatCurrencyShort(excluded.excludedVolume)}</span> חרגו מתקרת
            השפיות — יותר מכלל ההיקף שנותר. במצב כזה איננו מציגים דירוג ספקים או שיטות רכש, מפני
            שאין דרך להבחין בין רשומה תקינה לשגויה.
          </p>
          <p className="text-xs">{excluded.rule}</p>
          {excluded.examples.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-1 text-xs">
              {excluded.examples.slice(0, 4).map((example, index) => (
                <li key={index}>
                  {(example.name ?? 'ספק ללא שם') + ' — היקף מדווח '}
                  <span className="num">{formatCurrencyShort(example.volume)}</span>
                  {example.purpose !== null && ` — "${example.purpose.slice(0, 60)}"`}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs">
            הרשומות המלאות זמינות במקור (מפתח התקציב) ובקובץ findings.json; דיווח שגיאות — ב-Issue.
          </p>
        </Callout>
      )}

      {/* ---- suppliers ---- */}
      {!contractsSuspect && (
        <section aria-labelledby="suppliers-heading">
          <SectionHeading
            id="suppliers-heading"
            title={`הספקים המרכזיים — ${ministryName}`}
            description="לפי היקף ההתקשרויות המצטבר בהסכמים שפעילים מ-2023 ואילך, מדוחות ההתקשרויות של החשב הכללי."
            action={
              <CsvDownloadButton
                filename={`suppliers-${ministryId}`}
                headers={['ספק', 'סוג ישות', 'התקשרויות', 'היקף רב-שנתי', 'שולם עד כה', 'קישור']}
                rows={(s) => [
                  s.name,
                  kindLabel(s.entityKind),
                  s.contractCount,
                  s.totalVolume,
                  s.totalExecuted,
                  s.entityUrl,
                ]}
                items={suppliers}
              />
            }
          />
          {suppliers.length === 0 ? (
            <DataUnavailable reason="לא נמצאו התקשרויות למשרד זה במקור." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">הספקים המרכזיים של המשרד</caption>
                <thead>
                  <tr>
                    <th scope="col">ספק</th>
                    <th scope="col">סוג</th>
                    <th scope="col">התקשרויות</th>
                    <th scope="col">היקף רב-שנתי</th>
                    <th scope="col">שולם עד כה</th>
                    <th scope="col">מקור</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={`${s.name}-${s.entityId ?? ''}`}>
                      <td className="font-medium">{s.name}</td>
                      <td>
                        <Badge tone="muted">{kindLabel(s.entityKind)}</Badge>
                      </td>
                      <td className="num text-left">{formatNumber(s.contractCount)}</td>
                      <td className="num text-left" title={formatCurrencyFull(s.totalVolume)}>
                        {formatCurrencyShort(s.totalVolume)}
                      </td>
                      <td className="num text-left" title={formatCurrencyFull(s.totalExecuted)}>
                        {formatCurrencyShort(s.totalExecuted)}
                      </td>
                      <td>
                        {s.entityUrl !== null ? (
                          <SourceLink url={s.entityUrl} title={s.name} label="דף הישות" />
                        ) : (
                          MISSING_SHORT
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ---- procurement methods ---- */}
      {!contractsSuspect && (
        <section aria-labelledby="methods-heading">
          <SectionHeading
            id="methods-heading"
            title="איך נקנה: שיטות הרכש"
            description="חלוקת היקף ההתקשרויות לפי שיטת הרכש המדווחת. שיעור גבוה של פטור ממכרז אינו בהכרח חריגה — חלק מהפטורים קבועים בתקנות — אבל הוא נתון שראוי להיות גלוי."
          />
          {methods.length === 0 ? (
            <DataUnavailable reason="אין נתוני שיטות רכש למשרד זה." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">שיטות רכש לפי היקף</caption>
                <thead>
                  <tr>
                    <th scope="col">שיטה</th>
                    <th scope="col">התקשרויות</th>
                    <th scope="col">היקף רב-שנתי</th>
                    <th scope="col">נתח</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((m) => (
                    <tr key={m.method}>
                      <td className={m.method === 'פטור ממכרז' ? 'font-semibold' : undefined}>
                        {m.method}
                      </td>
                      <td className="num text-left">{formatNumber(m.contractCount)}</td>
                      <td className="num text-left" title={formatCurrencyFull(m.totalVolume)}>
                        {formatCurrencyShort(m.totalVolume)}
                      </td>
                      <td className="num text-left">{formatPercent(m.sharePercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ---- notable contracts ---- */}
      {!contractsSuspect && (
        <section aria-labelledby="contracts-heading">
          <SectionHeading
            id="contracts-heading"
            title="ההתקשרויות הגדולות"
            description="לפי היקף ההסכם הרב-שנתי. מטרת ההתקשרות מוצגת כלשונה בדוח הרשמי."
          />
          {contracts.length === 0 ? (
            <DataUnavailable reason="לא נמצאו התקשרויות למשרד זה." />
          ) : (
            <ol className="space-y-2">
              {contracts.map((c, index) => (
                <li key={`${c.supplier}-${index}`} className="card card-pad">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{c.supplier ?? 'ספק לא מזוהה'}</p>
                      <p className="mt-0.5 max-w-2xl text-sm text-slate-600">
                        {c.purpose ?? MISSING_SHORT}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        <span className="num">{formatDate(c.orderDate)}</span> · {c.method} ·{' '}
                        {c.budgetTitle ?? ''}{' '}
                        {c.budgetCode !== null && <span className="num">({c.budgetCode})</span>}
                      </p>
                    </div>
                    <div className="shrink-0 text-left">
                      <p className="num font-semibold" title={formatCurrencyFull(c.volume)}>
                        {formatCurrencyShort(c.volume)}
                      </p>
                      <p
                        className="num text-xs text-slate-500"
                        title={formatCurrencyFull(c.executed)}
                      >
                        שולם: {formatCurrencyShort(c.executed)}
                      </p>
                      {c.entityUrl !== null && (
                        <SourceLink url={c.entityUrl} title={c.supplier ?? ''} label="דף הישות" />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* ---- support recipients ---- */}
      <section aria-labelledby="recipients-heading">
        <SectionHeading
          id="recipients-heading"
          title={`מקבלי התמיכות המרכזיים — ${ministryName}`}
          description="סכומי תמיכות ששולמו מאז 2023 לפי מסד התמיכות הממשלתי, בקיבוץ לפי מקבל."
          action={
            <CsvDownloadButton
              filename={`support-recipients-${ministryId}`}
              headers={['מקבל', 'סוג ישות', 'בקשות', 'אושר', 'שולם', 'דוגמת תמיכה', 'קישור']}
              rows={(r) => [
                r.name,
                kindLabel(r.entityKind),
                r.requestCount,
                r.totalApproved,
                r.totalPaid,
                r.exampleTitle,
                r.entityUrl,
              ]}
              items={recipients}
            />
          }
        />
        {recipients.length === 0 ? (
          <DataUnavailable reason="לא נמצאו תמיכות למשרד זה בתקופה." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">מקבלי תמיכות מרכזיים</caption>
              <thead>
                <tr>
                  <th scope="col">מקבל</th>
                  <th scope="col">סוג</th>
                  <th scope="col">שולם</th>
                  <th scope="col">אושר</th>
                  <th scope="col">דוגמה לתמיכה</th>
                  <th scope="col">מקור</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={`${r.name}-${r.entityId ?? ''}`}>
                    <td className="max-w-xs font-medium">{r.name}</td>
                    <td>
                      <Badge tone="muted">{kindLabel(r.entityKind)}</Badge>
                    </td>
                    <td className="num text-left" title={formatCurrencyFull(r.totalPaid)}>
                      {formatCurrencyShort(r.totalPaid)}
                    </td>
                    <td className="num text-left" title={formatCurrencyFull(r.totalApproved)}>
                      {formatCurrencyShort(r.totalApproved)}
                    </td>
                    <td className="max-w-xs text-xs text-slate-600">
                      {r.exampleTitle ?? MISSING_SHORT}
                    </td>
                    <td>
                      {r.entityUrl !== null ? (
                        <SourceLink url={r.entityUrl} title={r.name} label="דף הישות" />
                      ) : (
                        MISSING_SHORT
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- mid-year transfers ---- */}
      <section aria-labelledby="changes-heading">
        <SectionHeading
          id="changes-heading"
          title="העברות תקציב באמצע השנה"
          description="הפניות הגדולות לוועדת הכספים עבור סעיף המשרד, עם ההסבר הרשמי שצורף לבקשה."
        />
        {changes.length === 0 ? (
          <DataUnavailable reason="לא נמצאו העברות תקציב לסעיף זה." />
        ) : (
          <ol className="space-y-3">
            {changes.map((change) => (
              <ChangeCard
                key={change.transactionId ?? `${change.year}-${change.reqTitle}`}
                change={change}
              />
            ))}
          </ol>
        )}
      </section>

      {/* ---- anomaly scan ---- */}
      <section aria-labelledby="anomalies-heading">
        <SectionHeading
          id="anomalies-heading"
          title="סריקת חריגים בתקנות"
          description={`${formatNumber(Object.values(data.anomalies.scannedCounts).reduce((a, b) => a + b, 0))} תקנות נסרקו בכללים דטרמיניסטיים עם ספים מפורסמים. ממצא = שורה שמקיימת נוסחה, לא קביעה שנפל פגם.`}
          action={
            <CsvDownloadButton
              filename="anomalies-filtered"
              headers={['כלל', 'משרד', 'שנה', 'קוד', 'תקנה', 'מעודכן', 'ביצוע', 'ראיה', 'מקור']}
              rows={(f) => [
                ruleById.get(f.ruleId)?.labelHe ?? f.ruleId,
                f.ministryId,
                f.year,
                f.code,
                f.title,
                f.revised,
                f.executed,
                f.evidenceHe,
                f.sourceUrl,
              ]}
              items={anomalies}
            />
          }
        />

        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="כלל"
              value={ruleFilter}
              onChange={setRuleFilter}
              options={[
                { value: ALL, label: `כל הכללים (${data.anomalies.findings.length} ממצאים)` },
                ...data.anomalies.rules.map((r) => ({
                  value: r.id,
                  label: `${r.labelHe} (${data.anomalies.findings.filter((f) => f.ruleId === r.id).length})`,
                })),
              ]}
            />
            <SelectField
              label="משרד"
              value={anomalyMinistry}
              onChange={setAnomalyMinistry}
              options={[{ value: ALL, label: 'כל המשרדים' }, ...ministryOptions]}
            />
          </div>
          {ruleFilter !== ALL && (
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium">{ruleById.get(ruleFilter)?.labelHe}</p>
              <p className="num mt-1 text-slate-700">{ruleById.get(ruleFilter)?.formulaHe}</p>
              <p className="mt-1 text-slate-600">{ruleById.get(ruleFilter)?.whyInterestingHe}</p>
            </div>
          )}
        </Card>

        <p className="num mb-2 text-sm text-slate-600" role="status" aria-live="polite">
          {formatNumber(anomalies.length)} ממצאים מתוך{' '}
          {formatNumber(data.anomalies.findings.length)}
        </p>

        {anomalies.length === 0 ? (
          <DataUnavailable reason="אין ממצאים התואמים את הסינון." />
        ) : (
          <ol className="space-y-2">
            {anomalies.slice(0, 60).map((f) => {
              const ministry = data.ministries.find((m) => m.id === f.ministryId);
              return (
                <li key={`${f.ruleId}-${f.code}-${f.year}`} className="card card-pad">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <SearchCode
                        className="mt-1 h-4 w-4 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {f.title} <span className="num text-xs text-slate-500">({f.code})</span>
                        </p>
                        <p className="mt-0.5 text-sm text-slate-700">{f.evidenceHe}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {ministry?.displayName ?? f.ministryId} ·{' '}
                          <span className="num">{f.year}</span> ·{' '}
                          <Badge tone="muted">{ruleById.get(f.ruleId)?.labelHe ?? f.ruleId}</Badge>
                        </p>
                      </div>
                    </div>
                    <SourceLink url={f.sourceUrl} title={f.title} />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {anomalies.length > 60 && (
          <p className="mt-2 text-xs text-slate-500">
            מוצגים 60 הראשונים לפי גודל הסכום; הרשימה המלאה בהורדת ה-CSV.
          </p>
        )}
      </section>

      <Callout tone="caution" title="גבולות">
        <p>
          כל הנתונים במסך זה מגיעים משכבת עזר (מפתח התקציב) ומכסים את התקציב הרגיל של חמשת המשרדים
          שנאספו בלבד. שיעור פטור גבוה, ריכוזיות ספקים או ממצא בסריקה אינם קביעה שנפל פגם — הם נקודת
          פתיחה לבדיקה, עם קישור למקור. פירוט מלא ב
          <Link className="link" to="/methodology">
            מסך המתודולוגיה
          </Link>
          .
        </p>
      </Callout>
    </div>
  );
}

function ChangeCard({
  change,
}: {
  change: Dataset['findings']['budgetChanges'][string][number];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const diff = change.netExpenseDiff;
  return (
    <li className="card card-pad list-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{change.reqTitle ?? 'פנייה תקציבית'}</p>
          <p className="mt-1 text-xs text-slate-500">
            <span className="num">{formatDate(change.date)}</span> · {change.changeTypeName ?? ''}{' '}
            {change.transactionId !== null && (
              <span className="num text-slate-400">({change.transactionId})</span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-left">
          <p
            className={`num font-semibold ${diff !== null && diff < 0 ? 'text-red-700' : 'text-emerald-700'}`}
            title={formatCurrencyFull(diff)}
          >
            {diff !== null && diff > 0 ? '+' : ''}
            {formatCurrencyShort(diff)}
          </p>
          <SourceLink url={change.sourceUrl} title={change.reqTitle ?? ''} />
        </div>
      </div>
      {change.explanation !== '' && (
        <div className="mt-2">
          <button
            type="button"
            className="btn"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
            ההסבר הרשמי שצורף לפנייה
          </button>
          {open && (
            <blockquote className="mt-2 rounded border-r-4 border-slate-300 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
              {change.explanation}
              {change.explanation.length >= 600 && '…'}
            </blockquote>
          )}
        </div>
      )}
    </li>
  );
}
