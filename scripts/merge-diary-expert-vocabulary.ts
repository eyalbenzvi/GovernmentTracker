/**
 * merge-diary-expert-vocabulary — folds five expert vocabularies into the
 * classification seed, deterministically.
 *
 * Input:  data/raw/seeds/diary-experts/expert-*.json   (one file per expert,
 *                                                       stored in full)
 *         data/raw/seeds/diary-categories.seed.json    (existing taxonomy)
 * Output: data/raw/seeds/diary-categories.seed.json    (rewritten in place)
 *         data/raw/seeds/diary-experts/merge-report.json
 *
 * Five domain experts — Hebrew language, Israeli politics, media, Israeli law,
 * foreign relations — each read the same real subject lines and proposed
 * keyword→category assignments with a stated confidence and a reason. A model
 * produced those files at build time; nothing here or in the published site
 * runs a model, and every proposal is kept verbatim so a reader can dispute a
 * single keyword.
 *
 * The merge rule, applied per keyword and published with the data:
 *   1. Highest stated confidence wins (high > medium > low).
 *   2. Among the proposals at that confidence, the category named by the most
 *      experts wins.
 *   3. Still tied — the category with the lower declared priority wins, so the
 *      result never depends on file order or object iteration.
 * Every disagreement is recorded in the merge report with how it was resolved,
 * including the losing side.
 *
 * A keyword an expert marked `low` is kept, not dropped: it carries its
 * confidence onto every row it classifies, so a reader can see exactly how
 * firm any single assignment is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAW_DIR, readJson, writeJson } from './lib/paths.js';

type Confidence = 'high' | 'medium' | 'low';

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

interface ExpertKeyword {
  keyword: string;
  categoryId: string;
  confidence: Confidence;
  reasoning: string;
}

interface ProposedCategory {
  id: string;
  labelHe: string;
  description: string;
  color: string;
  reasoning: string;
}

interface ExpertFile {
  expert: string;
  summary: string;
  keywords: ExpertKeyword[];
  proposedCategories?: ProposedCategory[];
  unclassifiableNote?: string;
}

/** Seed keywords are either a bare string (hand-curated) or a full record. */
type SeedKeyword =
  string | { keyword: string; confidence: Confidence; experts: string[]; reasoning: string };

interface CategorySeed {
  id: string;
  labelHe: string;
  description: string;
  color: string;
  priority: number;
  reasoning: string;
  keywords: SeedKeyword[];
}

interface CategoriesSeedFile {
  method: string;
  purpose: string;
  classifierRule: string;
  limitations: string[];
  genericSubjects: string[];
  noSubjectSentinels: string[];
  categories: CategorySeed[];
  expertPanel?: unknown;
}

/**
 * Corrections applied to the panel's proposals, declared here rather than
 * edited into the expert files — those stay exactly as delivered, so a reader
 * can see both what an expert proposed and what this project did with it.
 *
 * Every entry was checked against all 223,032 collected rows before being
 * written, with scripts/audit-diary-vocabulary.ts.
 */
const PANEL_OVERRIDES: Array<{
  keyword: string;
  action: 'drop' | 'remap';
  toCategoryId?: string;
  reasonHe: string;
}> = [
  {
    keyword: 'מס',
    action: 'drop',
    reasonHe:
      'תופס 632 שורות, ובהן "מפגש מס\' 1" — הגרש אינו אות עברית ולכן קיצור המילה "מספר" נספר כמילת המס. מומחה העברית עצמו סימן את המילה כאסורה בדוח שלו והציע אותה בכל זאת; הצורות הרב-מיליות (מס רכוש, מס הכנסה) נשמרו.',
  },
  {
    keyword: 'שבת',
    action: 'drop',
    reasonHe:
      'תופס 557 שורות, ובהן "השבת מענקי הסיוע" ו"השבת רכוש" — אות השימוש ה מאפשרת התאמה לשורש הָשָׁבָה. הצורות "כניסת שבת" ו"ליל שבת" נשמרו.',
  },
  {
    keyword: 'בית',
    action: 'drop',
    reasonHe:
      'הוצע כ"בית" במשמעות אישית, אך תופס 585 שורות ובהן "בית שאן", "בית אל" ו"משחק בית"ר" — כלומר שמות מקומות וקבוצות, לא ענייני בית. מומחה העברית סימן את המילה כמסוכנת.',
  },
  {
    keyword: 'פרטיות',
    action: 'drop',
    reasonHe:
      'נועד לסמן נושא שהושחר, אך תופס גם "הרשות להגנת הפרטיות" ו"קרקעות פרטיות" — כלומר היה מסמן דיון מקצועי בפרטיות כאילו הלשכה הסתירה את הנושא. סמני ההשחרה המפורשים (מושחר, מסתיר, צד ג\') נשמרו.',
  },
  // The meeting-format words tell a reader that a meeting happened, or by what
  // medium — never what it was about. They are not the office writing nothing
  // (that is `unspecified`), and not a gap in our vocabulary (we recognise the
  // word perfectly); they are their own fact, and they get their own category.
  ...[
    'פגישה',
    'פגישת',
    'פגישות',
    'ישיבה',
    'ישיבות',
    'מפגש',
    'מפגשים',
    'דיון',
    'דיונים',
    'דיוני',
    'שיחה',
    'שיחת',
    'שיחות',
    'התייעצות',
    'התייעצויות',
    'התיעצות',
    'עדכון',
    'עדכונים',
    'עדכוני',
    'סטטוס',
    'סטאטוס',
    'מקצועי',
    'מקצועית',
    'מקצועיות',
    'זום',
    'בזום',
    'גוגל מיט',
    'וובינר',
    'היוועדות חזותית',
    'שיחת זום',
    'טלפוני',
    'טלפונית',
    'שיחה טלפונית',
    'ויעוד',
    'היכרות',
    'הכרות',
    'הכירות',
    'פ.היכרות',
    // The "work meeting" abbreviations, in every spelling the diaries use.
    // 8,399 rows: the row says a work meeting happened, nothing more.
    'פ.ע',
    'פ"ע',
    'פ.ע.',
    'פע',
    'פ.א',
    'פ"א',
    // Role titles: they name the counterpart, which is who and not what. 10,185
    // rows. Filing them as internal management would present "פ.ע מנכ״ל" as if
    // the diary disclosed a management subject.
    'מנכ"ל',
    'מנכ"לית',
    'מנכל',
    'מנכ"לים',
    'משנה למנכ"ל',
    'סמנכ"ל',
    'סמנכ"לית',
    'רמ"ט',
    'יועצים',
    // Contentless status words. 4,782 rows.
    'שוטף',
    'הכנה',
    'לשכה',
    'פנימי',
    'פנימית',
  ].map((keyword) => ({
    keyword,
    action: 'remap' as const,
    toCategoryId: 'meeting_without_subject',
    reasonHe:
      'מילה שמתארת את עצם המפגש או את אמצעי הקיום שלו, ולא את נושאו. הועברה מקטגוריית האטימות לקטגוריה נפרדת, כדי לא לערבב "הלשכה לא כתבה דבר" עם "הלשכה כתבה שהייתה פגישה".',
  })),
];

/** Same normalisation the classifier applies, so a keyword cannot merge into
 *  two entries that differ only by quote style or spacing. */
function normalizeKeyword(value: string): string {
  return value
    .replace(/["'״׳]/g, '"')
    .replace(/[‏‎]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordTextOf(entry: SeedKeyword): string {
  return typeof entry === 'string' ? entry : entry.keyword;
}

interface Resolution {
  keyword: string;
  categoryId: string;
  confidence: Confidence;
  experts: string[];
  reasoning: string;
  conflict?: {
    rejected: Array<{ expert: string; categoryId: string; confidence: Confidence }>;
    resolvedBy: 'confidence' | 'majority' | 'priority';
  };
}

export function mergeProposals(
  proposals: Array<ExpertKeyword & { expert: string }>,
  priorityOf: (categoryId: string) => number,
): Resolution {
  const keyword = normalizeKeyword(proposals[0]?.keyword ?? '');
  const topRank = Math.max(...proposals.map((p) => CONFIDENCE_RANK[p.confidence]));
  const top = proposals.filter((p) => CONFIDENCE_RANK[p.confidence] === topRank);

  const byCategory = new Map<string, Array<ExpertKeyword & { expert: string }>>();
  for (const p of top) {
    byCategory.set(p.categoryId, [...(byCategory.get(p.categoryId) ?? []), p]);
  }

  const ranked = [...byCategory.entries()].sort(
    (a, b) => b[1].length - a[1].length || priorityOf(a[0]) - priorityOf(b[0]),
  );
  const winner = ranked[0];
  if (winner === undefined) throw new Error(`no proposal for keyword ${keyword}`);
  const [categoryId, winningProposals] = winner;

  const confidence = (winningProposals[0]?.confidence ?? 'low') as Confidence;
  const rejected = proposals
    .filter((p) => p.categoryId !== categoryId)
    .map((p) => ({ expert: p.expert, categoryId: p.categoryId, confidence: p.confidence }))
    .sort((a, b) => a.expert.localeCompare(b.expert));

  let resolvedBy: 'confidence' | 'majority' | 'priority' = 'confidence';
  if (rejected.length > 0) {
    const contested = new Set(top.map((p) => p.categoryId));
    if (contested.size > 1) {
      const secondPlace = ranked[1];
      resolvedBy =
        secondPlace !== undefined && secondPlace[1].length === winningProposals.length
          ? 'priority'
          : 'majority';
    }
  }

  return {
    keyword,
    categoryId,
    confidence,
    experts: [...new Set(winningProposals.map((p) => p.expert))].sort(),
    reasoning: winningProposals.map((p) => `[${p.expert}] ${p.reasoning}`).join(' | '),
    ...(rejected.length > 0 ? { conflict: { rejected, resolvedBy } } : {}),
  };
}

function main(): void {
  const seedPath = path.join(RAW_DIR, 'seeds', 'diary-categories.seed.json');
  const expertsDir = path.join(RAW_DIR, 'seeds', 'diary-experts');
  const seed = readJson<CategoriesSeedFile>(seedPath);

  const expertFiles = fs
    .readdirSync(expertsDir)
    .filter((f) => f.startsWith('expert-') && f.endsWith('.json'))
    .sort();
  if (expertFiles.length === 0) throw new Error('no expert files found');

  const experts = expertFiles.map((f) => readJson<ExpertFile>(path.join(expertsDir, f)));

  // ---- new categories -----------------------------------------------------
  // A category proposed by more than one expert is kept once, described by the
  // first expert alphabetically, with every proposer recorded.
  const existingIds = new Set(seed.categories.map((c) => c.id));
  const proposedById = new Map<string, Array<{ expert: string; category: ProposedCategory }>>();
  for (const e of experts) {
    for (const c of e.proposedCategories ?? []) {
      if (existingIds.has(c.id)) continue;
      proposedById.set(c.id, [
        ...(proposedById.get(c.id) ?? []),
        { expert: e.expert, category: c },
      ]);
    }
  }
  const sentinelPriority = 90; // content categories must sort before the sentinels
  let nextPriority =
    Math.max(
      0,
      ...seed.categories.filter((c) => c.priority < sentinelPriority).map((c) => c.priority),
    ) + 1;
  const addedCategories: string[] = [];
  for (const [id, proposals] of [...proposedById.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const sorted = [...proposals].sort((a, b) => a.expert.localeCompare(b.expert));
    const first = sorted[0];
    if (first === undefined) continue;
    if (nextPriority >= sentinelPriority) throw new Error('too many content categories');
    seed.categories.push({
      id,
      labelHe: first.category.labelHe,
      description: first.category.description,
      color: first.category.color,
      priority: nextPriority,
      reasoning: sorted.map((p) => `[${p.expert}] ${p.category.reasoning}`).join(' | '),
      keywords: [],
    });
    nextPriority += 1;
    addedCategories.push(id);
  }

  const priorityOf = (categoryId: string): number =>
    seed.categories.find((c) => c.id === categoryId)?.priority ?? 999;
  const knownCategoryIds = new Set(seed.categories.map((c) => c.id));

  // ---- keyword proposals --------------------------------------------------
  const overrideByKeyword = new Map(
    PANEL_OVERRIDES.map((o) => [normalizeKeyword(o.keyword), o] as const),
  );
  const appliedOverrides: Array<{ keyword: string; action: string; reasonHe: string }> = [];

  const byKeyword = new Map<string, Array<ExpertKeyword & { expert: string }>>();
  const rejectedUnknownCategory: Array<{ expert: string; keyword: string; categoryId: string }> =
    [];
  for (const e of experts) {
    for (const k of e.keywords) {
      const keyword = normalizeKeyword(k.keyword);
      if (keyword === '') continue;
      const override = overrideByKeyword.get(keyword);
      if (override !== undefined) {
        appliedOverrides.push({
          keyword,
          action:
            override.action === 'drop' ? 'drop' : `remap → ${override.toCategoryId ?? '(none)'}`,
          reasonHe: override.reasonHe,
        });
        if (override.action === 'drop') continue;
        k.categoryId = override.toCategoryId ?? k.categoryId;
      }
      if (!knownCategoryIds.has(k.categoryId)) {
        rejectedUnknownCategory.push({ expert: e.expert, keyword, categoryId: k.categoryId });
        continue;
      }
      byKeyword.set(keyword, [
        ...(byKeyword.get(keyword) ?? []),
        { ...k, keyword, expert: e.expert },
      ]);
    }
  }

  // A keyword already curated by hand is left alone: the panel extends the
  // vocabulary, it does not overrule decisions already reviewed.
  const curated = new Set<string>();
  for (const category of seed.categories) {
    for (const entry of category.keywords) curated.add(normalizeKeyword(keywordTextOf(entry)));
  }

  const resolutions: Resolution[] = [];
  const skippedAlreadyCurated: string[] = [];
  for (const [keyword, proposals] of [...byKeyword.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (curated.has(keyword)) {
      skippedAlreadyCurated.push(keyword);
      continue;
    }
    resolutions.push(mergeProposals(proposals, priorityOf));
  }

  for (const resolution of resolutions) {
    const category = seed.categories.find((c) => c.id === resolution.categoryId);
    if (category === undefined) continue;
    category.keywords.push({
      keyword: resolution.keyword,
      confidence: resolution.confidence,
      experts: resolution.experts,
      reasoning: resolution.reasoning,
    });
  }

  seed.expertPanel = {
    method:
      'חמישה מומחי תחום — עברית, פוליטיקה ישראלית, תקשורת, משפט ישראלי ויחסי חוץ — קראו את שורות הנושא האמיתיות והציעו התאמות של מילת מפתח לקטגוריה, כל אחת עם רמת ביטחון מוצהרת ונימוק. ההצעות הופקו בסיוע מודל שפה בזמן בנייה ונשמרות במלואן ב-data/raw/seeds/diary-experts. האתר המפורסם אינו מריץ מודל שפה, וההתאמה עצמה דטרמיניסטית.',
    mergeRule:
      'לכל מילת מפתח: (1) רמת הביטחון הגבוהה ביותר גוברת; (2) בין ההצעות באותה רמה — הקטגוריה שהוצעה על ידי הכי הרבה מומחים; (3) בתיקו — הקטגוריה בעלת ה-priority הנמוך יותר, כדי שהתוצאה לא תלויה בסדר הקבצים. מילת מפתח שכבר נוסחה ידנית קודם לכן אינה נדרסת. כל מחלוקת נשמרת בדוח האיחוד עם הצד שנדחה ועם דרך ההכרעה.',
    overrideRule:
      'תיקונים להצעות הפאנל מוצהרים בסקריפט האיחוד ולא נערכים לתוך קבצי המומחים — הקבצים נשמרים כפי שנמסרו, כדי שניתן יהיה לראות גם מה מומחה הציע וגם מה נעשה עם ההצעה. כל תיקון נבדק מול כל הרשומות שנאספו לפני שנכתב, ומופיע בדוח האיחוד עם הנימוק.',
    experts: experts.map((e) => ({
      expert: e.expert,
      summary: e.summary,
      keywordsProposed: e.keywords.length,
      unclassifiableNote: e.unclassifiableNote ?? '',
    })),
  };

  writeJson(seedPath, seed);

  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    expertFiles,
    totals: {
      proposalsRead: experts.reduce((sum, e) => sum + e.keywords.length, 0),
      distinctKeywords: byKeyword.size,
      keywordsAdded: resolutions.length,
      skippedAlreadyCurated: skippedAlreadyCurated.length,
      rejectedUnknownCategory: rejectedUnknownCategory.length,
      conflicts: resolutions.filter((r) => r.conflict !== undefined).length,
      overridesApplied: appliedOverrides.length,
      categoriesAdded: addedCategories,
      byConfidence: {
        high: resolutions.filter((r) => r.confidence === 'high').length,
        medium: resolutions.filter((r) => r.confidence === 'medium').length,
        low: resolutions.filter((r) => r.confidence === 'low').length,
      },
    },
    conflicts: resolutions.filter((r) => r.conflict !== undefined),
    appliedOverrides,
    rejectedUnknownCategory,
    skippedAlreadyCurated,
  };
  writeJson(path.join(expertsDir, 'merge-report.json'), report);

  console.log(
    `merge-diary-expert-vocabulary: ${report.totals.proposalsRead} הצעות מ-${experts.length} מומחים → ${report.totals.keywordsAdded} מילות מפתח חדשות ` +
      `(גבוה ${report.totals.byConfidence.high} · בינוני ${report.totals.byConfidence.medium} · נמוך ${report.totals.byConfidence.low}), ` +
      `${report.totals.conflicts} מחלוקות הוכרעו, ${report.totals.categoriesAdded.length} קטגוריות חדשות`,
  );
  if (rejectedUnknownCategory.length > 0) {
    console.log(
      `  ${rejectedUnknownCategory.length} הצעות נדחו: קטגוריה שאינה קיימת ולא הוצעה כחדשה`,
    );
  }
}

if (process.argv[1]?.includes('merge-diary-expert-vocabulary')) main();
