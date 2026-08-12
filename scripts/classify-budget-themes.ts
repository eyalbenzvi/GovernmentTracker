/**
 * classify-budget-themes — builds data/processed/budget-themes.json.
 *
 * Applies the build-time LLM classification seed
 * (data/raw/seeds/budget-themes.seed.json) to the collected budget lines. The
 * model itself never runs here or in the browser: its entire contribution is the
 * seed file, which was written during the build session, carries a reasoning and
 * a confidence level per assignment, and can be corrected by editing the file.
 *
 * This script only verifies and joins:
 *   - every level-2/3 budget line collected must have exactly one assignment
 *     (otherwise the run fails loudly rather than shipping an unlabelled line);
 *   - every assignment must point at an existing theme and at a line that was
 *     actually collected — stale assignments fail the build;
 *   - the seed's stored title must match the collected title, so a silent
 *     renumbering at the source cannot silently misattach a theme.
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson, writeText } from './lib/paths.js';
import { toCsv } from './lib/csv.js';
import type { BudgetItem } from './lib/schema.js';

interface ThemeSeed {
  id: string;
  labelHe: string;
  description: string;
  color: string;
}
interface AssignmentSeed {
  ministryId: string;
  budgetCode: string;
  title: string;
  themeId: string;
  confidence: 'high' | 'medium';
  reasoning: string;
}
interface ThemesSeedFile {
  method: string;
  methodNote: string;
  confidenceNote: string;
  themes: ThemeSeed[];
  assignments: AssignmentSeed[];
}

function main(): void {
  const seed = readJson<ThemesSeedFile>(path.join(RAW_DIR, 'seeds', 'budget-themes.seed.json'));
  const budgetItems = readJson<BudgetItem[]>(path.join(PROCESSED_DIR, 'budget-items.json'));

  const themeIds = new Set(seed.themes.map((t) => t.id));
  const problems: string[] = [];

  // Index assignments and check their internal integrity.
  const byKey = new Map<string, AssignmentSeed>();
  for (const assignment of seed.assignments) {
    const key = `${assignment.ministryId}:${assignment.budgetCode}`;
    if (byKey.has(key)) problems.push(`שיוך כפול עבור ${key}`);
    if (!themeIds.has(assignment.themeId)) {
      problems.push(`שיוך ${key} מפנה לתמה שאינה קיימת: ${assignment.themeId}`);
    }
    byKey.set(key, assignment);
  }

  // The thematic layer covers only the ministries that appear in the seed —
  // full completeness is required inside that scope, and nothing is required
  // (or emitted) outside it. Uncovered ministries show an explicit
  // "not yet classified" state in the UI instead of a silent gap.
  const coveredMinistryIds = new Set(seed.assignments.map((a) => a.ministryId));

  // Every collected level-2/3 line of a covered ministry must be assigned.
  const collected = new Map<string, string>();
  for (const item of budgetItems) {
    if (
      coveredMinistryIds.has(item.ministryId) &&
      (item.hierarchyLevel === 2 || item.hierarchyLevel === 3)
    ) {
      collected.set(`${item.ministryId}:${item.budgetCode}`, item.title);
    }
  }
  for (const [key, title] of collected) {
    const assignment = byKey.get(key);
    if (assignment === undefined) {
      problems.push(`שורת תקציב ללא שיוך תמטי: ${key} (${title})`);
      continue;
    }
    if (assignment.title !== title) {
      problems.push(
        `אי-התאמת כותרת עבור ${key}: בקובץ הסיווג "${assignment.title}", במקור "${title}". ייתכן שהסעיף מוספר מחדש — נדרש אימות אנושי.`,
      );
    }
  }
  // Stale assignments (a line the source no longer returns) also fail the build.
  for (const key of byKey.keys()) {
    if (!collected.has(key)) problems.push(`שיוך לשורה שלא נאספה: ${key}`);
  }

  if (problems.length > 0) {
    console.error(`classify-budget-themes: ${problems.length} בעיות:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }

  // Per-theme usage counts, derived from actual assignments in use.
  const counts = new Map<string, number>();
  for (const key of collected.keys()) {
    const themeId = byKey.get(key)?.themeId;
    if (themeId !== undefined) counts.set(themeId, (counts.get(themeId) ?? 0) + 1);
  }

  const output = {
    method: seed.method,
    coveredMinistryIds: [...coveredMinistryIds].sort(),
    methodNote: seed.methodNote,
    confidenceNote: seed.confidenceNote,
    themes: seed.themes.map((theme) => ({
      ...theme,
      assignedLineCount: counts.get(theme.id) ?? 0,
    })),
    assignments: seed.assignments
      .filter((a) => collected.has(`${a.ministryId}:${a.budgetCode}`))
      .sort(
        (a, b) =>
          a.ministryId.localeCompare(b.ministryId) || a.budgetCode.localeCompare(b.budgetCode),
      ),
  };

  writeJson(path.join(PROCESSED_DIR, 'budget-themes.json'), output);
  writeText(
    path.join(PROCESSED_DIR, 'csv', 'budget-themes.csv'),
    toCsv(
      ['משרד', 'קוד תקציבי', 'כותרת הסעיף', 'תמה', 'רמת ודאות', 'נימוק'],
      output.assignments.map((a) => [
        a.ministryId,
        a.budgetCode,
        a.title,
        seed.themes.find((t) => t.id === a.themeId)?.labelHe ?? a.themeId,
        a.confidence === 'high' ? 'גבוהה' : 'בינונית',
        a.reasoning,
      ]),
    ),
  );

  const medium = output.assignments.filter((a) => a.confidence === 'medium').length;
  console.log(
    `classify-budget-themes: ${output.assignments.length} שיוכים · ${seed.themes.length} תמות · ${medium} שיוכים ברמת ודאות בינונית`,
  );
}

main();
