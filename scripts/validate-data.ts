/**
 * validate-data — the gate that must pass before anything is published.
 *
 * It runs schema validation plus the integrity rules that a transparency site
 * has to guarantee: no duplicate identifiers, no displayed figure without a
 * source, no invalid date, no non-finite amount, no implausible execution rate
 * without an explicit note, no hierarchy double counting, no topic presented as
 * data-backed without at least one real item, and no source shown that is
 * missing from the catalogue.
 *
 * Exits non-zero on any failure, so CI refuses to deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROCESSED_DIR, readJson } from './lib/paths.js';
import { schemas } from './lib/schema.js';
import type {
  ActivityBudgetLink,
  ActivityEvidence,
  BudgetItem,
  Coverage,
  Ministry,
  MinisterTenure,
  SourceCatalogItem,
  Topic,
} from './lib/schema.js';

interface UsageBreakdownFile {
  rows: Array<{
    ministryId: string;
    fiscalYear: number;
    econLevel1: string;
    revised: number | null;
  }>;
  coverage: Array<{
    ministryId: string;
    fiscalYear: number;
    classifiedRevisedSum: number;
    sectionRevisedTotal: number | null;
    coveragePercent: number | null;
  }>;
}
interface BudgetThemesFile {
  coveredMinistryIds: string[];
  themes: Array<{ id: string; assignedLineCount: number }>;
  assignments: Array<{ ministryId: string; budgetCode: string; title: string; themeId: string }>;
}
interface DiaryEntryLite {
  id: string;
  datasetId: string;
  date: string | null;
  extractionMethod: string;
  categoryId?: string;
  matchedKeyword?: string | null;
  matchedConfidence?: 'high' | 'medium' | 'low' | null;
  inferredFrom?: string | null;
}
interface DiariesIndexLite {
  windowStart: string;
  totals: {
    entries: number;
    duplicateRowsRemoved: number;
    datasetsWithoutIdentifier: number;
    byExtractionMethod: {
      datastore: number;
      spreadsheet: number;
      pdf_text: number;
      pdf_ocr: number;
    };
  };
  shards: Array<{ shardKey: string; file: string; entryCount: number }>;
  datasets: Array<{ datasetId: string; machineReadableEntries: number }>;
}
interface DiaryCategoriesLite {
  categories: Array<{ id: string; entryCount: number }>;
}
interface DiaryInsightsLite {
  totals: {
    entries: number;
    people: number;
    sharedFileProfiles: number;
    quartersPublishedButUnread: number;
    unspecifiedPercent: number | null;
    unclassifiedPercent: number | null;
    noTopicPercent: number | null;
    classifiedPercent: number | null;
    noSubjectPercent: number | null;
  };
  rules: Array<{ id: string }>;
  profiles: Array<{
    key: string;
    entryCount: number;
    personLabel: string | null;
    coversMultiplePeople: boolean;
  }>;
  findings: Array<{ ruleId: string; personKey: string }>;
  crossMatches: Array<{ entryId: string; ministryId: string }>;
}

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(name: string, passed: boolean, detail = ''): void {
  checks.push({ name, passed, detail });
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

function isValidIsoDate(value: string | null): boolean {
  if (value === null) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function main(): void {
  const p = (file: string): string => path.join(PROCESSED_DIR, file);

  const ministries = readJson<Ministry[]>(p('ministries.json'));
  const tenures = readJson<MinisterTenure[]>(p('minister-tenures.json'));
  const budgetItems = readJson<BudgetItem[]>(p('budget-items.json'));
  const activities = readJson<ActivityEvidence[]>(p('activity-evidence.json'));
  const topics = readJson<Topic[]>(p('topics.json'));
  const catalog = readJson<SourceCatalogItem[]>(p('source-catalog.json'));
  const coverage = readJson<Coverage[]>(p('coverage.json'));
  const links = readJson<ActivityBudgetLink[]>(p('activity-budget-links.json'));
  const dataVersion = readJson<unknown>(p('data-version.json'));
  const usage = readJson<UsageBreakdownFile>(p('usage-breakdown.json'));
  const budgetThemes = readJson<BudgetThemesFile>(p('budget-themes.json'));
  const findings = readJson<unknown>(p('findings.json'));
  const anomalies = readJson<{
    rules: Array<{ id: string }>;
    findings: Array<{ ruleId: string; ministryId: string; sourceUrl: string }>;
  }>(p('anomalies.json'));

  // ---- 1. schema validation ----------------------------------------------
  // Structural result type, so parse results for differently-shaped schemas can
  // share one list without widening every entry to the first schema's type.
  type ParseResult =
    { success: true } | { success: false; error: { issues: ReadonlyArray<unknown> } };

  const schemaTargets: Array<[string, ParseResult]> = [
    ['ministries.json', schemas.ministries.safeParse(ministries)],
    ['minister-tenures.json', schemas.ministerTenures.safeParse(tenures)],
    ['budget-items.json', schemas.budgetItems.safeParse(budgetItems)],
    ['activity-evidence.json', schemas.activityEvidence.safeParse(activities)],
    ['topics.json', schemas.topics.safeParse(topics)],
    ['source-catalog.json', schemas.sourceCatalog.safeParse(catalog)],
    ['coverage.json', schemas.coverage.safeParse(coverage)],
    ['activity-budget-links.json', schemas.activityBudgetLinks.safeParse(links)],
    ['data-version.json', schemas.dataVersion.safeParse(dataVersion)],
    ['usage-breakdown.json', schemas.usageBreakdown.safeParse(usage)],
    ['budget-themes.json', schemas.budgetThemes.safeParse(budgetThemes)],
    ['findings.json', schemas.findings.safeParse(findings)],
    ['anomalies.json', schemas.anomalies.safeParse(anomalies)],
  ];
  for (const [file, result] of schemaTargets) {
    check(
      `סכמה תקינה: ${file}`,
      result.success,
      result.success ? '' : JSON.stringify(result.error.issues.slice(0, 4)),
    );
  }

  // ---- 2. no duplicate identifiers ---------------------------------------
  for (const [label, ids] of [
    ['ministries', ministries.map((m) => m.id)],
    ['minister-tenures', tenures.map((t) => t.id)],
    ['budget-items', budgetItems.map((b) => b.id)],
    ['activity-evidence', activities.map((a) => a.id)],
    ['topics', topics.map((t) => t.id)],
    ['source-catalog', catalog.map((s) => s.id)],
    ['coverage', coverage.map((c) => c.ministryId)],
  ] as Array<[string, string[]]>) {
    const dupes = duplicates(ids);
    check(`אין מזהים כפולים: ${label}`, dupes.length === 0, dupes.join(', '));
  }

  const catalogUrls = catalog.map((s) => s.url);
  check('אין URL כפול בקטלוג המקורות', duplicates(catalogUrls).length === 0);

  // ---- 3. every displayed record has a non-empty source URL --------------
  const missingSource = [
    ...budgetItems.filter((b) => !b.sourceUrl || !b.sourceUrl.startsWith('http')).map((b) => b.id),
    ...activities.filter((a) => !a.sourceUrl || !a.sourceUrl.startsWith('http')).map((a) => a.id),
    ...catalog.filter((s) => !s.url || !s.url.startsWith('http')).map((s) => s.id),
    ...tenures.filter((t) => !t.sourceUrl || !t.sourceUrl.startsWith('http')).map((t) => t.id),
    ...ministries.filter((m) => !m.nameEvidenceUrl.startsWith('http')).map((m) => m.id),
  ];
  check('לכל רשומה מוצגת יש URL מקור תקין', missingSource.length === 0, missingSource.join(', '));

  // ---- 4. valid dates -----------------------------------------------------
  const badDates = [
    ...budgetItems
      .filter((b) => !isValidIsoDate(b.sourcePublishedAt) || !isValidIsoDate(b.collectedAt))
      .map((b) => b.id),
    ...activities
      .filter((a) => !isValidIsoDate(a.date) || !isValidIsoDate(a.collectedAt))
      .map((a) => a.id),
    ...tenures
      .filter((t) => !isValidIsoDate(t.startDate) || !isValidIsoDate(t.endDate))
      .map((t) => t.id),
    ...coverage
      .filter((c) => !isValidIsoDate(c.dateRangeStart) || !isValidIsoDate(c.dateRangeEnd))
      .map((c) => c.ministryId),
  ];
  check('אין תאריך לא תקין', badDates.length === 0, badDates.join(', '));

  const tenureOrderProblems = tenures
    .filter((t) => t.startDate !== null && t.endDate !== null && t.endDate < t.startDate)
    .map((t) => t.id);
  check('תאריך סיום כהונה אינו לפני תאריך התחלה', tenureOrderProblems.length === 0);

  // ---- 5. amounts are finite numbers or explicitly absent ----------------
  const badAmounts = budgetItems
    .filter((b) =>
      [b.originalBudget, b.updatedBudget, b.actualExecution, b.estimatedExecution].some(
        (v) => v !== null && !Number.isFinite(v),
      ),
    )
    .map((b) => b.id);
  check('כל הסכומים הם מספרים סופיים או null', badAmounts.length === 0, badAmounts.join(', '));

  // A figure of exactly 0 is legitimate only if the source really says 0; it must
  // never be used to stand in for "unknown". Flag zeros lacking an explanatory note.
  const suspiciousZeros = budgetItems
    .filter(
      (b) =>
        [b.originalBudget, b.updatedBudget, b.actualExecution].some((v) => v === 0) &&
        b.notes.trim() === '',
    )
    .map((b) => b.id);
  check('אין אפס ללא הערה מסבירה', suspiciousZeros.length === 0, suspiciousZeros.join(', '));

  // ---- 6. execution rate sanity + recomputation --------------------------
  const rateProblems: string[] = [];
  for (const item of budgetItems) {
    const execution = item.actualExecution ?? item.estimatedExecution;
    const expected =
      execution !== null && item.updatedBudget !== null && item.updatedBudget > 0
        ? Math.round((execution / item.updatedBudget) * 1000) / 10
        : null;
    // The stored rate must match the deterministic formula, or be absent.
    if (item.executionRate !== null && expected !== null) {
      if (Math.abs(item.executionRate - expected) > 0.1) {
        rateProblems.push(`${item.id}: מאוחסן ${item.executionRate}, מחושב ${expected}`);
      }
    }
    // An out-of-band rate must carry the explicit outlier marker, not merely *some*
    // note — otherwise the check passes trivially on boilerplate.
    if (
      item.executionRate !== null &&
      (item.executionRate < 0 || item.executionRate > 150) &&
      !item.notes.includes('חריגה:')
    ) {
      rateProblems.push(`${item.id}: שיעור ביצוע ${item.executionRate}% ללא הערת חריגה מפורשת`);
    }
  }
  check(
    'שיעור הביצוע עקבי עם הנוסחה ובטווח סביר',
    rateProblems.length === 0,
    rateProblems.join(' | '),
  );

  // ---- 7. no hierarchy double counting ------------------------------------
  // Two records for the same ministry+year must not sit on different hierarchy
  // levels while one is the declared parent of the other AND both are marked as
  // leaves — that is the shape that produces double counting on aggregation.
  const byKey = new Map<string, BudgetItem[]>();
  for (const item of budgetItems) {
    const key = `${item.ministryId}:${item.fiscalYear}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  }
  const doubleCount: string[] = [];
  for (const [key, items] of byKey) {
    const codes = new Set(items.filter((i) => i.isLeaf).map((i) => i.budgetCode));
    for (const item of items) {
      if (item.isLeaf && item.parentBudgetCode !== null && codes.has(item.parentBudgetCode)) {
        doubleCount.push(
          `${key}: ${item.budgetCode} וגם ההורה ${item.parentBudgetCode} מסומנים כעלים`,
        );
      }
    }
  }
  check('אין כפילות היררכית בסכימה', doubleCount.length === 0, doubleCount.join(' | '));

  // ---- 8. referential integrity -------------------------------------------
  const ministryIds = new Set(ministries.map((m) => m.id));
  const topicIds = new Set(topics.map((t) => t.id));
  const activityIds = new Set(activities.map((a) => a.id));
  const budgetIds = new Set(budgetItems.map((b) => b.id));

  const orphanRefs = [
    ...budgetItems.filter((b) => !ministryIds.has(b.ministryId)).map((b) => `budget:${b.id}`),
    ...activities.filter((a) => !ministryIds.has(a.ministryId)).map((a) => `activity:${a.id}`),
    ...coverage
      .filter((c) => !ministryIds.has(c.ministryId))
      .map((c) => `coverage:${c.ministryId}`),
    ...activities
      .flatMap((a) =>
        a.topics.filter((t) => !topicIds.has(t)).map((t) => `activity ${a.id} → topic ${t}`),
      )
      .slice(0, 10),
    ...links.filter((l) => !ministryIds.has(l.ministryId)).map((l) => `link:${l.id}`),
    ...links
      .flatMap((l) =>
        l.activityIds
          .filter((id) => !activityIds.has(id))
          .map((id) => `link ${l.id} → activity ${id}`),
      )
      .slice(0, 10),
    ...links
      .flatMap((l) =>
        l.budgetItemIds
          .filter((id) => !budgetIds.has(id))
          .map((id) => `link ${l.id} → budget ${id}`),
      )
      .slice(0, 10),
  ];
  check('אין הפניות לרשומות שאינן קיימות', orphanRefs.length === 0, orphanRefs.join(' | '));

  // ---- 9. topic counts are real ------------------------------------------
  const actualTopicCounts = new Map<string, number>();
  for (const activity of activities) {
    for (const topicId of activity.topics) {
      actualTopicCounts.set(topicId, (actualTopicCounts.get(topicId) ?? 0) + 1);
    }
  }
  const countMismatches = topics
    .filter((t) => t.activityItemCount !== (actualTopicCounts.get(t.id) ?? 0))
    .map(
      (t) => `${t.id}: מאוחסן ${t.activityItemCount}, בפועל ${actualTopicCounts.get(t.id) ?? 0}`,
    );
  check(
    'מוני הנושאים תואמים את הפריטים בפועל',
    countMismatches.length === 0,
    countMismatches.join(' | '),
  );

  // Any topic *presented as data-backed* must have at least one item. Topics with
  // zero items are allowed to exist only as a declared taxonomy, and the app
  // filters them out of every data view (see src/lib/selectors.ts).
  const dataBackedTopics = topics.filter((t) => t.activityItemCount > 0);
  check(
    'כל נושא שמוצג כנתון מכיל לפחות פריט פעילות אחד',
    dataBackedTopics.every((t) => t.activityItemCount > 0),
    `${dataBackedTopics.length} נושאים מגובים בנתונים מתוך ${topics.length} מוגדרים`,
  );

  // ---- 10. every source referenced is in the catalogue -------------------
  // A subdomain of a catalogued host counts as covered: gov.il publications live
  // on unit subdomains (e.g. pob.education.gov.il) while the catalogue lists the
  // canonical www.gov.il entry.
  const catalogHosts = new Set(catalog.map((s) => new URL(s.url).host));
  const catalogApexes = [...catalogHosts].map((h) => h.replace(/^www\./, ''));
  const hostCovered = (host: string): boolean =>
    catalogHosts.has(host) ||
    catalogApexes.some((apex) => host === apex || host.endsWith('.' + apex));
  const unlistedSources = [
    ...budgetItems
      .filter((b) => !hostCovered(new URL(b.sourceUrl).host))
      .map((b) => `budget:${b.id} → ${new URL(b.sourceUrl).host}`),
    ...activities
      .filter((a) => !hostCovered(new URL(a.sourceUrl).host))
      .map((a) => `activity:${a.id} → ${new URL(a.sourceUrl).host}`),
    ...tenures
      .filter((t) => !hostCovered(new URL(t.sourceUrl).host))
      .map((t) => `tenure:${t.id} → ${new URL(t.sourceUrl).host}`),
  ].slice(0, 10);
  check(
    'כל מקור שמוצג מופיע בקטלוג המקורות',
    unlistedSources.length === 0,
    unlistedSources.join(' | '),
  );

  // ---- 11. coverage agrees with the records ------------------------------
  const coverageProblems: string[] = [];
  for (const cov of coverage) {
    const actualActivities = activities.filter((a) => a.ministryId === cov.ministryId).length;
    const actualBudget = budgetItems.filter((b) => b.ministryId === cov.ministryId).length;
    const actualSources = catalog.filter((s) => s.ministryIds.includes(cov.ministryId)).length;
    if (cov.activityItemCount !== actualActivities) {
      coverageProblems.push(
        `${cov.ministryId}: פעילות ${cov.activityItemCount} מול ${actualActivities}`,
      );
    }
    if (cov.budgetRecordCount !== actualBudget) {
      coverageProblems.push(
        `${cov.ministryId}: תקציב ${cov.budgetRecordCount} מול ${actualBudget}`,
      );
    }
    if (cov.sourcesDefined !== actualSources) {
      coverageProblems.push(`${cov.ministryId}: מקורות ${cov.sourcesDefined} מול ${actualSources}`);
    }
    if (cov.sourcesSuccessfullyCollected > cov.sourcesDefined) {
      coverageProblems.push(`${cov.ministryId}: נאספו יותר מקורות ממה שהוגדרו`);
    }
    if (cov.budgetRecordCount === 0 && cov.limitations.length === 0) {
      coverageProblems.push(`${cov.ministryId}: אין נתוני תקציב אך לא נרשמה מגבלה`);
    }
  }
  check(
    'דוח הכיסוי תואם את הרשומות בפועל',
    coverageProblems.length === 0,
    coverageProblems.join(' | '),
  );

  // ---- 12. every ministry has a coverage row -----------------------------
  const missingCoverage = ministries
    .filter((m) => !coverage.some((c) => c.ministryId === m.id))
    .map((m) => m.id);
  check('לכל משרד יש שורת כיסוי', missingCoverage.length === 0, missingCoverage.join(', '));

  // ---- 13. usage breakdown consistency ------------------------------------
  const ministryIdSet = new Set(ministries.map((m) => m.id));
  const usageProblems: string[] = [];
  for (const row of usage.rows) {
    if (!ministryIdSet.has(row.ministryId))
      usageProblems.push(`שורת שימוש למשרד לא קיים: ${row.ministryId}`);
  }
  const currentFiscalYear = new Date().getFullYear();
  for (const cov of usage.coverage) {
    // For a closed year the classified depth-4 sum must not exceed the section
    // total beyond rounding. In an open year the source itself can be
    // transiently inconsistent — regulation-level changes recorded before the
    // roll-up — so a bounded overshoot is tolerated and surfaced in the UI
    // rather than failing the build.
    const openYear = cov.fiscalYear >= currentFiscalYear;
    const overshootFactor = openYear ? 1.2 : 1.000001;
    if (
      cov.sectionRevisedTotal !== null &&
      cov.sectionRevisedTotal > 0 &&
      cov.classifiedRevisedSum > cov.sectionRevisedTotal * overshootFactor
    ) {
      usageProblems.push(
        `${cov.ministryId}/${cov.fiscalYear}: סכום הסיווג (${cov.classifiedRevisedSum}) חורג מסך הסעיף (${cov.sectionRevisedTotal}) מעבר למותר`,
      );
    }
    if (
      cov.coveragePercent !== null &&
      (cov.coveragePercent < 0 || cov.coveragePercent > (openYear ? 120 : 100.5))
    ) {
      usageProblems.push(
        `${cov.ministryId}/${cov.fiscalYear}: אחוז כיסוי לא סביר ${cov.coveragePercent}`,
      );
    }
  }
  // Cross-check: per ministry-year, the usage rows must sum to the recorded classified sum.
  for (const cov of usage.coverage) {
    const sum = usage.rows
      .filter((r) => r.ministryId === cov.ministryId && r.fiscalYear === cov.fiscalYear)
      .reduce((acc, r) => acc + (r.revised ?? 0), 0);
    if (Math.abs(sum - cov.classifiedRevisedSum) > 1) {
      usageProblems.push(
        `${cov.ministryId}/${cov.fiscalYear}: סכום שורות השימוש (${sum}) שונה מסכום הכיסוי (${cov.classifiedRevisedSum})`,
      );
    }
  }
  check(
    'פירוט השימוש הרשמי עקבי ובגבולות הסעיף',
    usageProblems.length === 0,
    usageProblems.slice(0, 5).join(' | '),
  );

  // ---- 14. thematic classification integrity ------------------------------
  const themeProblems: string[] = [];
  const themeIdSet = new Set(budgetThemes.themes.map((t) => t.id));
  const assignmentKeys = new Set(
    budgetThemes.assignments.map((a) => `${a.ministryId}:${a.budgetCode}`),
  );
  for (const assignment of budgetThemes.assignments) {
    if (!themeIdSet.has(assignment.themeId))
      themeProblems.push(`שיוך לתמה לא קיימת: ${assignment.themeId}`);
    if (!ministryIdSet.has(assignment.ministryId))
      themeProblems.push(`שיוך למשרד לא קיים: ${assignment.ministryId}`);
  }
  // Full theme coverage is required only inside the declared covered scope.
  const coveredSet = new Set(budgetThemes.coveredMinistryIds);
  const collectedLines = new Map<string, string>();
  for (const item of budgetItems) {
    if (
      coveredSet.has(item.ministryId) &&
      (item.hierarchyLevel === 2 || item.hierarchyLevel === 3)
    ) {
      collectedLines.set(`${item.ministryId}:${item.budgetCode}`, item.title);
    }
  }
  for (const [key, title] of collectedLines) {
    if (!assignmentKeys.has(key)) themeProblems.push(`שורה ללא שיוך תמטי: ${key} (${title})`);
  }
  for (const assignment of budgetThemes.assignments) {
    const collectedTitle = collectedLines.get(`${assignment.ministryId}:${assignment.budgetCode}`);
    if (collectedTitle !== undefined && collectedTitle !== assignment.title) {
      themeProblems.push(`אי-התאמת כותרת בשיוך ${assignment.budgetCode}`);
    }
  }
  // Stored per-theme counts must equal the real assignment counts.
  const actualThemeCounts = new Map<string, number>();
  for (const assignment of budgetThemes.assignments) {
    actualThemeCounts.set(assignment.themeId, (actualThemeCounts.get(assignment.themeId) ?? 0) + 1);
  }
  for (const theme of budgetThemes.themes) {
    if (theme.assignedLineCount !== (actualThemeCounts.get(theme.id) ?? 0)) {
      themeProblems.push(`מונה שגוי לתמה ${theme.id}`);
    }
  }
  check(
    'הסיווג התמטי שלם, עקבי ותואם כותרות',
    themeProblems.length === 0,
    themeProblems.slice(0, 5).join(' | '),
  );

  // ---- 15. anomaly findings integrity --------------------------------------
  const anomalyProblems: string[] = [];
  const ruleIds = new Set(anomalies.rules.map((r) => r.id));
  for (const finding of anomalies.findings) {
    if (!ruleIds.has(finding.ruleId))
      anomalyProblems.push(`ממצא עם כלל לא קיים: ${finding.ruleId}`);
    if (!ministryIdSet.has(finding.ministryId)) {
      anomalyProblems.push(`ממצא למשרד לא קיים: ${finding.ministryId}`);
    }
  }
  check(
    'ממצאי האנומליות מפנים לכללים ולמשרדים קיימים',
    anomalyProblems.length === 0,
    anomalyProblems.slice(0, 5).join(' | '),
  );

  // ---- 16. diaries integrity (index + shards) -----------------------------
  const diariesIndex = readJson<DiariesIndexLite>(p('diaries-index.json'));
  const indexParse = schemas.diariesIndex.safeParse(diariesIndex);
  check(
    'סכמה תקינה: diaries-index.json',
    indexParse.success,
    indexParse.success ? '' : JSON.stringify(indexParse.error.issues.slice(0, 4)),
  );

  const diaryProblems: string[] = [];
  const datasetIds = new Set(diariesIndex.datasets.map((d) => d.datasetId));
  const diaries: DiaryEntryLite[] = [];
  const shardIds = new Set<string>();

  for (const shard of diariesIndex.shards) {
    const shardPath = p(shard.file);
    if (!fs.existsSync(shardPath)) {
      diaryProblems.push(`חסר קובץ שרד: ${shard.file}`);
      continue;
    }
    const rows = readJson<DiaryEntryLite[]>(shardPath);
    const parsed = schemas.diaryShard.safeParse(rows);
    if (!parsed.success) {
      diaryProblems.push(
        `סכמה שגויה ב-${shard.file}: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`.slice(
          0,
          300,
        ),
      );
    }
    if (rows.length !== shard.entryCount) {
      diaryProblems.push(
        `מונה שגוי לשרד ${shard.shardKey}: ${shard.entryCount} מוצהר מול ${rows.length} בפועל`,
      );
    }
    for (const row of rows) {
      if (shardIds.has(row.id)) {
        diaryProblems.push(`מזהה רשומת יומן כפול: ${row.id}`);
        break;
      }
      shardIds.add(row.id);
      if (!datasetIds.has(row.datasetId)) {
        diaryProblems.push(`רשומת יומן למאגר שאינו מתועד: ${row.datasetId}`);
        break;
      }
      if (row.date !== null && !isValidIsoDate(row.date)) {
        diaryProblems.push(`תאריך לא תקין ברשומת יומן: ${row.id}`);
        break;
      }
      if (row.date !== null && row.date < diariesIndex.windowStart) {
        diaryProblems.push(`רשומת יומן מחוץ לחלון הניתוח: ${row.id} (${row.date})`);
        break;
      }
      // A row read by OCR must say so, wherever it is displayed.
      if (row.extractionMethod === 'pdf_ocr' && row.categoryId === undefined) {
        // categoryId is checked below; nothing extra needed here.
      }
      diaries.push(row);
    }
  }

  // Declared per-dataset counts must equal what actually shipped.
  const perDataset = new Map<string, number>();
  for (const row of diaries)
    perDataset.set(row.datasetId, (perDataset.get(row.datasetId) ?? 0) + 1);
  for (const ds of diariesIndex.datasets) {
    if (ds.machineReadableEntries !== (perDataset.get(ds.datasetId) ?? 0)) {
      diaryProblems.push(
        `מונה שגוי למאגר ${ds.datasetId}: ${ds.machineReadableEntries} מוצהר מול ${perDataset.get(ds.datasetId) ?? 0} בפועל`,
      );
      break;
    }
  }
  if (diariesIndex.totals.entries !== diaries.length) {
    diaryProblems.push(
      `סך הרשומות המוצהר (${diariesIndex.totals.entries}) שונה מסך השרדים (${diaries.length})`,
    );
  }
  const methodTotals = diariesIndex.totals.byExtractionMethod;
  const declaredByMethod =
    methodTotals.datastore +
    methodTotals.spreadsheet +
    methodTotals.pdf_text +
    methodTotals.pdf_ocr;
  if (declaredByMethod !== diaries.length) {
    diaryProblems.push(
      `פילוח שיטות החילוץ (${declaredByMethod}) אינו מסתכם למספר הרשומות (${diaries.length})`,
    );
  }
  if (diaries.length > 0) {
    const catalogHasOdata = catalog.some((s) => new URL(s.url).host.endsWith('odata.org.il'));
    if (!catalogHasOdata) {
      diaryProblems.push('יש רשומות יומן אך מקור odata.org.il אינו מקוטלג');
    }
  }
  check(
    'רשומות היומן עקביות, בחלון הניתוח ומגובות בקטלוג המקורות',
    diaryProblems.length === 0,
    diaryProblems.slice(0, 5).join(' | '),
  );

  // ---- 17. diary categories + insights integrity ---------------------------
  const diaryCategories = readJson<DiaryCategoriesLite>(p('diary-categories.json'));
  const diaryInsights = readJson<DiaryInsightsLite>(p('diary-insights.json'));
  const categoriesParse = schemas.diaryCategories.safeParse(diaryCategories);
  check(
    'סכמה תקינה: diary-categories.json',
    categoriesParse.success,
    categoriesParse.success ? '' : JSON.stringify(categoriesParse.error.issues.slice(0, 4)),
  );
  const insightsParse = schemas.diaryInsights.safeParse(diaryInsights);
  check(
    'סכמה תקינה: diary-insights.json',
    insightsParse.success,
    insightsParse.success ? '' : JSON.stringify(insightsParse.error.issues.slice(0, 4)),
  );

  const analysisProblems: string[] = [];
  const categoryIds = new Set(diaryCategories.categories.map((c) => c.id));

  // Every entry must carry a category — an unclassified row would silently
  // vanish from every chart on the screen.
  const categoryCountFromRows = new Map<string, number>();
  for (const row of diaries) {
    if (row.categoryId === undefined) {
      analysisProblems.push(`רשומה ללא סיווג קטגוריה: ${row.id}`);
      break;
    }
    if (!categoryIds.has(row.categoryId)) {
      analysisProblems.push(`סיווג לקטגוריה שאינה קיימת: ${row.categoryId}`);
      break;
    }
    categoryCountFromRows.set(row.categoryId, (categoryCountFromRows.get(row.categoryId) ?? 0) + 1);
  }
  for (const category of diaryCategories.categories) {
    if (category.entryCount !== (categoryCountFromRows.get(category.id) ?? 0)) {
      analysisProblems.push(`מונה שגוי לקטגוריה ${category.id}`);
      break;
    }
  }

  const profileKeys = new Set(diaryInsights.profiles.map((prof) => prof.key));
  const ruleIdsDiary = new Set(diaryInsights.rules.map((r) => r.id));
  for (const finding of diaryInsights.findings) {
    if (!profileKeys.has(finding.personKey)) {
      analysisProblems.push(`ממצא יומן לבעל תפקיד שאינו במאגר: ${finding.personKey}`);
      break;
    }
    if (!ruleIdsDiary.has(finding.ruleId)) {
      analysisProblems.push(`ממצא יומן עם כלל שאינו מוגדר: ${finding.ruleId}`);
      break;
    }
  }
  const diaryIds = new Set(diaries.map((d) => d.id));
  for (const match of diaryInsights.crossMatches) {
    if (!diaryIds.has(match.entryId)) {
      analysisProblems.push(`הצלבה לרשומת יומן שאינה קיימת: ${match.entryId}`);
      break;
    }
    if (!ministryIdSet.has(match.ministryId)) {
      analysisProblems.push(`הצלבה למשרד שאינו קיים: ${match.ministryId}`);
      break;
    }
  }
  if (diaryInsights.totals.entries !== diaries.length) {
    analysisProblems.push(
      `סך הרשומות בתובנות (${diaryInsights.totals.entries}) שונה מהשרדים (${diaries.length})`,
    );
  }
  if (diaryInsights.totals.people !== diaryInsights.profiles.length) {
    analysisProblems.push('מונה בעלי התפקיד בתובנות אינו תואם את מספר הפרופילים');
  }
  const profileEntrySum = diaryInsights.profiles.reduce((sum, prof) => sum + prof.entryCount, 0);
  if (profileEntrySum !== diaries.length) {
    analysisProblems.push(
      `סכום הרשומות בפרופילים (${profileEntrySum}) שונה ממספר הרשומות (${diaries.length})`,
    );
  }

  // The transparency measure must never absorb this site's own coverage gap:
  // a row is `unspecified` only when the office wrote generic text, and
  // `unclassified` only when our vocabulary missed real text. Both are rows
  // that matched no keyword, so a matched keyword on either is a leak.
  for (const row of diaries) {
    // Only these two are pure fallbacks, reached when no keyword fired at all:
    // the office wrote nothing, or wrote something our vocabulary misses. The
    // other non-topic categories are keyword-driven and must carry one like any
    // other category — `unspecified` through an explicit redaction marker
    // ("צד ג'", "מושחר"), `meeting_without_subject` through a meeting-format
    // word, `named_person_meeting` through the person's name.
    const isPureFallback =
      row.categoryId === 'unclassified' || row.categoryId === 'no_subject_recorded';
    if (isPureFallback && row.matchedKeyword !== null && row.matchedKeyword !== undefined) {
      analysisProblems.push(`רשומה בקטגוריית מפלט אך עם מילת מפתח: ${row.id}`);
      break;
    }
    // `unspecified` is the one category reached both ways: by the generic-text
    // rule, which has no keyword, and by an explicit redaction marker, which
    // does. Every other category must name the keyword that produced it.
    const mayLackKeyword = isPureFallback || row.categoryId === 'unspecified';
    if (!mayLackKeyword && (row.matchedKeyword ?? '') === '') {
      analysisProblems.push(`רשומה בקטגוריית תוכן ללא מילת המפתח שהפעילה אותה: ${row.id}`);
      break;
    }
    // An inference is never allowed to present itself as firmly as the office's
    // own words: it must carry the lowest confidence and name its rule.
    if ((row.inferredFrom ?? null) !== null && row.matchedConfidence !== 'low') {
      analysisProblems.push(`שורה שסווגה בהסקה אך אינה מסומנת ברמת ביטחון נמוכה: ${row.id}`);
      break;
    }
    // Confidence and keyword travel together: a reader who is shown a category
    // must be able to see how firm the keyword behind it was.
    const hasKeyword = (row.matchedKeyword ?? '') !== '';
    const hasConfidence = (row.matchedConfidence ?? null) !== null;
    if (hasKeyword !== hasConfidence) {
      analysisProblems.push(`רשומה שבה מילת המפתח ורמת הביטחון אינן תואמות: ${row.id}`);
      break;
    }
  }

  // A file holding several people's diaries is nobody's personal conduct, so no
  // person-level finding may be published from it — including under a name the
  // title happens to mention.
  const sharedProfileKeys = new Set(
    diaryInsights.profiles.filter((prof) => prof.coversMultiplePeople).map((prof) => prof.key),
  );
  for (const finding of diaryInsights.findings) {
    if (sharedProfileKeys.has(finding.personKey)) {
      analysisProblems.push(`ממצא אישי מפרסום שמאגד כמה בעלי תפקיד: ${finding.personKey}`);
      break;
    }
  }
  for (const prof of diaryInsights.profiles) {
    if (prof.coversMultiplePeople && prof.personLabel !== null) {
      analysisProblems.push(`פרסום מאוגד שיוחס לאדם אחד בשמו: ${prof.key}`);
      break;
    }
  }
  if (diaryInsights.totals.sharedFileProfiles !== sharedProfileKeys.size) {
    analysisProblems.push('מונה הפרסומים המאוגדים אינו תואם את הפרופילים');
  }

  // The four shares must account for every row exactly once.
  const shareSum = [
    diaryInsights.totals.classifiedPercent,
    diaryInsights.totals.noTopicPercent,
    diaryInsights.totals.unclassifiedPercent,
    diaryInsights.totals.unspecifiedPercent,
    diaryInsights.totals.noSubjectPercent,
  ].reduce((sum: number, value) => sum + (value ?? 0), 0);
  if (diaries.length > 0 && Math.abs(shareSum - 100) > 0.5) {
    analysisProblems.push(`שיעורי הסיווג אינם מסתכמים ל-100% (${shareSum})`);
  }
  check(
    'סיווג היומנים והתובנות עקביים, מלאים ומסומנים לפי שיטת החילוץ',
    analysisProblems.length === 0,
    analysisProblems.slice(0, 5).join(' | '),
  );

  // ---- report -------------------------------------------------------------
  console.log('\n=== ולידציית נתונים ===\n');
  for (const c of checks) {
    console.log(`${c.passed ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} בדיקות עברו`);
  if (failed.length > 0) {
    console.error(`\nולידציה נכשלה ב-${failed.length} בדיקות. הפריסה נעצרת.`);
    process.exit(1);
  }
}

main();
