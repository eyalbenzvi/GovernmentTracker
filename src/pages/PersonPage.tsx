/**
 * One office-holder: what they held, when, and what the diaries show for that
 * period only.
 *
 * The site publishes measures about named people, so this page is built around the
 * tenure rather than around the office: a figure is shown against the period the
 * person actually served, and where the collected diary file covers several people
 * or a period outside the tenure, the page says so instead of quietly attributing it.
 */
import { Link, useParams } from 'react-router-dom';
import type { Dataset } from '../types/domain';
import { Badge, Callout, Card, QualityNote, SectionHeading } from '../components/ui';
import { ChartWithTable } from '../components/charts';
import { formatDate, formatDateRange, formatNumber, formatPercent } from '../lib/format';
import { personId, personProfiles } from '../lib/tenure';
import { DIARY_FINDING_BIAS_HE } from '../lib/insights';
import { groupDiaryCounts } from '../lib/taxonomy';

export function PersonPage({ data }: { data: Dataset }): JSX.Element {
  const { personId: routeId } = useParams();
  const profiles = personProfiles(data.ministerTenures);
  const profile = profiles.find((p) => p.id === routeId);

  if (profile === undefined) {
    return (
      <div className="space-y-6">
        <h1>לא נמצא בעל תפקיד</h1>
        <Callout tone="caution" title="הכהונה אינה במאגר">
          <p>
            האתר אוסף כהונות שרים וסגני שרים מהשירות הפתוח של הכנסת. מנכ"לים ובעלי תפקידים אחרים
            מופיעים ביומנים אך אין להם רשומת כהונה, ולכן אין להם עמוד.
          </p>
        </Callout>
        <p>
          <Link className="link" to="/diaries">
            למסך היומנים
          </Link>
        </p>
      </div>
    );
  }

  const diaryProfiles = data.diaryInsights.profiles.filter(
    (p) => p.personLabel !== null && personId(p.personLabel) === profile.id,
  );
  const findings = data.diaryInsights.findings.filter(
    (f) => f.personLabel !== null && personId(f.personLabel) === profile.id,
  );
  const crossMatches = data.diaryInsights.crossMatches.filter(
    (c) => c.personLabel !== null && personId(c.personLabel) === profile.id,
  );

  const totalEntries = diaryProfiles.reduce((acc, p) => acc + p.entryCount, 0);
  const categoryCounts: Record<string, number> = {};
  for (const diary of diaryProfiles) {
    for (const [categoryId, count] of Object.entries(diary.categoryCounts)) {
      categoryCounts[categoryId] = (categoryCounts[categoryId] ?? 0) + count;
    }
  }
  const groups = groupDiaryCounts(categoryCounts, data.diaryCategories.categories);

  const monthly = new Map<string, number>();
  for (const diary of diaryProfiles) {
    for (const bucket of diary.monthly) {
      monthly.set(bucket.period, (monthly.get(bucket.period) ?? 0) + bucket.count);
    }
  }
  const monthlyPoints = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, count]) => ({ label: period, values: { count } }));

  const sharedFile = diaryProfiles.some((p) => p.coversMultiplePeople);

  return (
    <div className="space-y-8">
      <section>
        <p className="eyebrow">בעל תפקיד</p>
        <h1 className="mt-1">{profile.personName}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {profile.roles.map((role) => (
            <Badge key={role} tone="primary">
              {role}
            </Badge>
          ))}
          {profile.hasEnded && <Badge tone="muted">הכהונה הסתיימה</Badge>}
        </div>
      </section>

      <section aria-labelledby="tenure-heading">
        <SectionHeading
          id="tenure-heading"
          title="כהונות שנאספו"
          description="מהשירות הפתוח של הכנסת. כל מדד בעמוד הזה מחושב על התקופות האלה בלבד."
        />
        <ul className="space-y-2">
          {profile.tenures.map((tenure) => {
            const ministry = data.ministries.find((m) => m.id === tenure.ministryId);
            return (
              <li key={tenure.id}>
                <Card className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{tenure.role}</p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {ministry !== undefined ? (
                        <Link className="link" to={`/ministry/${ministry.id}`}>
                          {ministry.displayName}
                        </Link>
                      ) : (
                        tenure.ministryId
                      )}
                    </p>
                  </div>
                  <p className="num text-sm text-ink-2">
                    {formatDateRange(tenure.startDate, tenure.endDate)}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {diaryProfiles.length === 0 ? (
        <section>
          <Callout tone="caution" title="לא נמצא יומן שפורסם ושויך לאדם הזה">
            <p>
              היעדר יומן כאן אינו בהכרח היעדר פרסום: הוא יכול לנבוע מכך שהפרסום שויך ללשכה ולא לאדם,
              או מקובץ שהאתר לא הצליח לקרוא. הפירוט לפי סעיף נמצא במסך "מי שקוף יותר".
            </p>
          </Callout>
        </section>
      ) : (
        <>
          <section aria-labelledby="mix-heading">
            <SectionHeading
              id="mix-heading"
              title="במה עסק הזמן שדווח"
              description={`${formatNumber(totalEntries)} שורות יומן, מקובצות לשמונה קבוצות קריאה.`}
            />
            <Card>
              <ul className="space-y-2">
                {groups.map((group) => (
                  <li key={group.group.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink-2">{group.group.labelHe}</span>
                      <span className="num font-medium text-ink">
                        {formatPercent(group.sharePercent)}{' '}
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
                  </li>
                ))}
              </ul>
              <QualityNote>
                <p>
                  האתר סופר שורות יומן, לא זמן: פגישה בת עשר דקות ופגישה בת יומיים נספרות אותו דבר.
                  הקבוצות הן שיוך מוצהר של 30 קטגוריות שפורסמו, והן אינן שיפוט על מהות הפגישה.
                </p>
                {sharedFile && (
                  <p>
                    לפחות אחד הקבצים שנאספו מאגד כמה בעלי תפקידים. שורות ממנו אינן מיוחסות בוודאות
                    לאדם הזה.
                  </p>
                )}
              </QualityNote>
            </Card>
          </section>

          {monthlyPoints.length > 1 && (
            <section aria-labelledby="timeline-heading">
              <SectionHeading
                id="timeline-heading"
                title="שורות יומן לפי חודש"
                description="נפח הפרסום לאורך הזמן. ירידה יכולה לשקף פחות פגישות, או פחות פרסום."
              />
              <ChartWithTable
                title="שורות יומן לפי חודש"
                points={monthlyPoints}
                series={[{ key: 'count', label: 'שורות', color: '#1b5e8a' }]}
                kind="bar"
                formatValue={(v) => formatNumber(v)}
                fullValue={(v) => `${formatNumber(v)} שורות`}
                firstColumnLabel="חודש"
                emptyReason="אין שורות עם תאריך שניתן למקם בזמן."
              />
            </section>
          )}
        </>
      )}

      {findings.length > 0 && (
        <section aria-labelledby="findings-heading">
          <SectionHeading
            id="findings-heading"
            title="ממצאי יומן שנוגעים לאדם הזה"
            description="כל ממצא הוא תבנית בשורות שפורסמו, לא קביעה על התנהלות."
          />
          <ul className="space-y-2">
            {findings.map((finding) => (
              <li key={`${finding.ruleId}-${finding.personKey}`}>
                <Card>
                  <p className="text-sm text-ink">{finding.evidenceHe}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    כלל: {finding.ruleId} · {finding.roleLabelHe}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Callout tone="caution" title="הטיה שצריך להכיר">
              <p>{DIARY_FINDING_BIAS_HE}</p>
            </Callout>
          </div>
        </section>
      )}

      {crossMatches.length > 0 && (
        <section aria-labelledby="cross-heading">
          <SectionHeading
            id="cross-heading"
            title="הצלבות לספקים ולמקבלי תמיכות"
            description="שורת יומן שנקוב בה שם שמופיע גם בהתקשרויות או בתמיכות של הסעיף."
          />
          <ul className="space-y-2">
            {crossMatches.slice(0, 12).map((match) => (
              <li key={match.entryId}>
                <Card>
                  <p className="text-sm text-ink">{match.subject}</p>
                  <p className="mt-1 text-xs text-ink-2">
                    <span className="num">{formatDate(match.date)}</span> · {match.matchedName} ·{' '}
                    {match.amountLabelHe}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
          <QualityNote>
            <p>
              פגישה עם ספק או עם מקבל תמיכה היא חלק שגרתי ולגיטימי מעבודת משרד. ההצלבה מבוססת על
              התאמת שם, ושם נפוץ עלול להתאים לישות אחרת.
            </p>
          </QualityNote>
        </section>
      )}
    </div>
  );
}
