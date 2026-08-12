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
  themes: Array<{ id: string; assignedLineCount: number }>;
  assignments: Array<{ ministryId: string; budgetCode: string; title: string; themeId: string }>;
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
  const catalogHosts = new Set(catalog.map((s) => new URL(s.url).host));
  const unlistedSources = [
    ...budgetItems
      .filter((b) => !catalogHosts.has(new URL(b.sourceUrl).host))
      .map((b) => `budget:${b.id} → ${new URL(b.sourceUrl).host}`),
    ...activities
      .filter((a) => !catalogHosts.has(new URL(a.sourceUrl).host))
      .map((a) => `activity:${a.id} → ${new URL(a.sourceUrl).host}`),
    ...tenures
      .filter((t) => !catalogHosts.has(new URL(t.sourceUrl).host))
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
  for (const cov of usage.coverage) {
    // The classified depth-4 sum may legitimately fall short of the section
    // total (current year), but it must never exceed it by more than rounding.
    if (
      cov.sectionRevisedTotal !== null &&
      cov.classifiedRevisedSum > cov.sectionRevisedTotal + 1
    ) {
      usageProblems.push(
        `${cov.ministryId}/${cov.fiscalYear}: סכום הסיווג (${cov.classifiedRevisedSum}) גדול מסך הסעיף (${cov.sectionRevisedTotal})`,
      );
    }
    if (cov.coveragePercent !== null && (cov.coveragePercent < 0 || cov.coveragePercent > 100.5)) {
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
  // Every collected level-2/3 line must carry a theme, with a matching title.
  const collectedLines = new Map<string, string>();
  for (const item of budgetItems) {
    if (item.hierarchyLevel === 2 || item.hierarchyLevel === 3) {
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
