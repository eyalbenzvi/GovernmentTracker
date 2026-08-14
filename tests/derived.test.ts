/**
 * Tests for the derivation layer added with the site rework.
 *
 * The emphasis is on the rules that protect a reader rather than on arithmetic for
 * its own sake: a missing input must produce null and not zero, our own collection
 * gaps must not lower anyone's score, and a generated sentence must never claim more
 * than the figures support.
 */
import { describe, expect, it } from 'vitest';
import type { AnomalyFinding, DiaryProfile, MinisterTenure } from '../src/types/domain';
import { changePercent, rankOf, shareOf } from '../src/lib/context';
import { attributeWindow, personId, personProfiles } from '../src/lib/tenure';
import { buildWaterfall } from '../src/lib/waterfall';
import { analyseTiming, TIMING_WINDOW_DAYS } from '../src/lib/timing';
import { supplierHhi, transparencyScore } from '../src/lib/scorecards';
import { DIARY_CATEGORY_GROUP, DIARY_GROUPS, groupDiaryCounts } from '../src/lib/taxonomy';
import { budgetTrendSentence, compositionSentence, rankAnomalies } from '../src/lib/insights';
import { formatCountHe } from '../src/lib/format';
import categories from '../data/processed/diary-categories.json';

describe('context helpers', () => {
  it('refuses a share when the total is not positive', () => {
    expect(shareOf(5, 0)).toBeNull();
    expect(shareOf(5, -10)).toBeNull();
    expect(shareOf(null, 100)).toBeNull();
    expect(shareOf(25, 200)).toBe(12.5);
  });

  it('refuses a change against a zero base rather than reporting infinity', () => {
    expect(changePercent(0, 100)).toBeNull();
    expect(changePercent(100, 150)).toBe(50);
    // A negative base compares by magnitude, so a shrinking deficit is not "+".
    expect(changePercent(-100, -50)).toBe(50);
  });

  it('excludes entries without a value from both the position and the denominator', () => {
    const values: Array<readonly [string, number | null]> = [
      ['a', 10],
      ['b', null],
      ['c', 30],
    ];
    expect(rankOf('c', values)).toEqual({ rank: 1, outOf: 2 });
    expect(rankOf('a', values)).toEqual({ rank: 2, outOf: 2 });
    expect(rankOf('b', values)).toBeNull();
  });
});

describe('hebrew counting', () => {
  it('never produces "1 סעיפים"', () => {
    expect(formatCountHe(1, 'סעיף אחד', 'סעיפים')).toBe('סעיף אחד');
    expect(formatCountHe(3, 'סעיף אחד', 'סעיפים')).toBe('3 סעיפים');
  });
});

function tenure(partial: Partial<MinisterTenure>): MinisterTenure {
  return {
    id: 'x',
    personName: 'פלוני',
    role: 'שר',
    ministryId: 'sec-1',
    startDate: '2023-01-01',
    endDate: null,
    sourceUrl: 'https://example.gov.il/a',
    sourceTitle: 'מקור',
    ...partial,
  };
}

describe('tenure attribution', () => {
  it('splits a window between holders and flags the split', () => {
    const result = attributeWindow(
      [
        tenure({ id: 'a', personName: 'א', startDate: '2023-01-01', endDate: '2023-06-30' }),
        tenure({ id: 'b', personName: 'ב', startDate: '2023-07-01', endDate: '2023-12-31' }),
      ],
      '2023-01-01',
      '2023-12-31',
    );
    expect(result.segments).toHaveLength(2);
    expect(result.isSplit).toBe(true);
    expect(result.uncoveredDays).toBe(0);
    const total = result.segments.reduce((acc, s) => acc + s.days, 0);
    expect(total).toBe(365);
  });

  it('reports days no collected tenure covers instead of absorbing them', () => {
    const result = attributeWindow(
      [tenure({ startDate: '2023-07-01', endDate: '2023-12-31' })],
      '2023-01-01',
      '2023-12-31',
    );
    expect(result.uncoveredDays).toBe(181);
    expect(result.isSplit).toBe(false);
  });

  it('skips a tenure with no start date, since it cannot be placed in time', () => {
    const result = attributeWindow([tenure({ startDate: null })], '2023-01-01', '2023-12-31');
    expect(result.segments).toHaveLength(0);
  });

  it('gives one profile per person and a URL-safe id', () => {
    const profiles = personProfiles([
      tenure({ id: 'a', personName: 'משה כהן', ministryId: 'sec-1', endDate: '2024-01-01' }),
      tenure({ id: 'b', personName: 'משה כהן', ministryId: 'sec-2' }),
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.ministryIds).toEqual(['sec-1', 'sec-2']);
    // One tenure is still open, so the person has not finished serving.
    expect(profiles[0]?.hasEnded).toBe(false);
    expect(profiles[0]?.id).toBe(personId('משה כהן'));
    expect(personId('משה כהן')).not.toContain(' ');
  });
});

describe('budget waterfall', () => {
  const items = [
    {
      id: '1',
      ministryId: 'sec-1',
      fiscalYear: 2024,
      budgetCode: '0001',
      parentBudgetCode: null,
      title: 'תקנה',
      hierarchyPath: ['סעיף'],
      hierarchyLevel: 1,
      isLeaf: true,
      originalBudget: 1_000,
      updatedBudget: 1_500,
      actualExecution: 1_200,
      estimatedExecution: null,
      executionRate: null,
      currency: 'ILS' as const,
      unit: 'ILS' as const,
      dataStatus: 'final' as const,
      sourceUrl: 'https://example.gov.il/b',
      sourceTitle: 'מקור',
      sourcePublishedAt: null,
      collectedAt: '2026-01-01',
      rawReference: '',
      notes: '',
    },
  ];

  it('bridges original to execution through the published levels', () => {
    const waterfall = buildWaterfall(items, [], 'sec-1', 2024);
    const byId = new Map(waterfall.steps.map((s) => [s.id, s]));
    expect(byId.get('original')?.value).toBe(1_000);
    expect(byId.get('transfer')?.value).toBe(500);
    expect(byId.get('updated')?.value).toBe(1_500);
    // Execution below the updated budget leaves an unused balance, as a negative step.
    expect(byId.get('unused')?.value).toBe(-300);
    expect(byId.get('execution')?.value).toBe(1_200);
  });

  it('reports the part of the movement its held requests do not explain', () => {
    const waterfall = buildWaterfall(
      items,
      [
        {
          year: 2024,
          date: '2024-05-01',
          reqTitle: 'פנייה',
          changeTypeName: 'אישור ועדה',
          netExpenseDiff: 200,
          transactionId: 'x',
          explanation: '',
          sourceUrl: 'https://example.gov.il/c',
        },
      ],
      'sec-1',
      2024,
    );
    expect(waterfall.requestsNetTotal).toBe(200);
    expect(waterfall.unexplainedTransfer).toBe(300);
  });

  it('returns nulls, not zeros, when the year has no rows', () => {
    const waterfall = buildWaterfall(items, [], 'sec-1', 2099);
    expect(waterfall.hasAnyValue).toBe(false);
    expect(waterfall.steps.every((s) => s.value === null)).toBe(true);
  });
});

function profile(partial: Partial<DiaryProfile>): DiaryProfile {
  return {
    key: 'k',
    ministryId: 'sec-1',
    personLabel: 'פלוני',
    personRole: 'minister',
    roleLabelHe: 'שר',
    entryCount: 100,
    datedEntryCount: 100,
    timedEntryCount: 100,
    usableClockTimeCount: 80,
    firstDate: '2023-01-01',
    lastDate: '2023-12-31',
    datasetIds: ['d1'],
    sourceUrl: 'https://example.gov.il/d',
    sourceTitle: 'יומן',
    unspecifiedCount: 0,
    opacityPercent: 0,
    noSubjectCount: 0,
    noSubjectPercent: 0,
    unclassifiedCount: 0,
    unclassifiedPercent: 0,
    coversMultiplePeople: false,
    categoryCounts: {},
    monthly: [],
    quarterly: [],
    weekendCount: 0,
    fridayMeetingCount: 0,
    saturdayMeetingCount: 0,
    weekendNonMeetingCount: 0,
    lateNightCount: 0,
    longMeetingCount: 0,
    marathonDays: [],
    doubleBookedCount: 0,
    busiestDay: null,
    repeatedSubjects: [],
    ...partial,
  };
}

describe('transparency score', () => {
  it('does not lower the score for publications this site could not read', () => {
    const profiles = [profile({})];
    const withGap = transparencyScore('sec-1', profiles, 12);
    const withoutGap = transparencyScore('sec-1', profiles, 0);
    expect(withGap.score).toBe(withoutGap.score);
    // The gap is reported instead, on its own axis.
    expect(withGap.readabilityGap).toBe(12);
  });

  it('counts rows the site failed to classify as having a topic', () => {
    // An unclassified row carries real subject text; the gap is in our vocabulary.
    const scored = transparencyScore(
      'sec-1',
      [profile({ entryCount: 100, unclassifiedCount: 40, noSubjectCount: 0, unspecifiedCount: 0 })],
      0,
    );
    const topic = scored.components.find((c) => c.id === 'hasTopic');
    expect(topic?.score).toBe(100);
  });

  it('has no score at all for a ministry that published nothing', () => {
    expect(transparencyScore('sec-9', [], 0).score).toBeNull();
  });
});

describe('procurement concentration', () => {
  it('is at its maximum for a single supplier holding everything', () => {
    expect(supplierHhi([100], 100)).toBe(10_000);
  });

  it('falls as volume spreads across suppliers', () => {
    const concentrated = supplierHhi([80, 20], 100) as number;
    const spread = supplierHhi([25, 25, 25, 25], 100) as number;
    expect(concentrated).toBeGreaterThan(spread);
  });

  it('refuses to compute without a positive total', () => {
    expect(supplierHhi([10], 0)).toBeNull();
    expect(supplierHhi([], 100)).toBeNull();
  });
});

describe('diary reading groups', () => {
  it('assigns every published category to exactly one group', () => {
    const published = (categories as { categories: Array<{ id: string }> }).categories;
    const unmapped = published.filter((c) => DIARY_CATEGORY_GROUP[c.id] === undefined);
    expect(unmapped.map((c) => c.id)).toEqual([]);
  });

  it('maps only to groups that exist', () => {
    const groupIds = new Set(DIARY_GROUPS.map((g) => g.id));
    for (const groupId of Object.values(DIARY_CATEGORY_GROUP)) {
      expect(groupIds.has(groupId)).toBe(true);
    }
  });

  it('rolls counts up and shares sum to about 100', () => {
    const grouped = groupDiaryCounts(
      { government_cabinet: 60, media_pr: 40 },
      (categories as { categories: Array<{ id: string; labelHe: string }> }).categories as never,
    );
    const total = grouped.reduce((acc, g) => acc + (g.sharePercent ?? 0), 0);
    expect(Math.round(total)).toBe(100);
    expect(grouped[0]?.count).toBe(60);
  });
});

describe('meeting timing', () => {
  const contract = {
    supplier: 'חברה בע"מ',
    entityUrl: null,
    purpose: null,
    volume: 1_000,
    executed: null,
    orderDate: '2024-06-01',
    method: 'פטור ממכרז',
    budgetCode: null,
    budgetTitle: null,
    isActive: null,
  };

  const crossMatch = {
    ruleId: 'supplier_meeting' as const,
    entryId: 'e1',
    ministryId: 'sec-1',
    personLabel: 'פלוני',
    roleLabelHe: 'שר',
    date: '2024-05-01',
    subject: 'פגישה',
    matchedName: 'חברה בע"מ',
    entityUrl: 'https://example.gov.il/e',
    amount: 1_000,
    amountLabelHe: 'נפח',
    diarySourceUrl: 'https://example.gov.il/f',
  };

  it('measures the gap to the order date and flags the window', () => {
    const analysis = analyseTiming([crossMatch], [contract], 'sec-1');
    expect(analysis.timed).toHaveLength(1);
    expect(analysis.timed[0]?.daysBeforeOrder).toBe(31);
    expect(analysis.withinWindowCount).toBe(1);
    expect(TIMING_WINDOW_DAYS).toBe(90);
  });

  it('always reports a baseline of held contracts with no match', () => {
    const analysis = analyseTiming(
      [crossMatch],
      [contract, { ...contract, supplier: 'ספק אחר', orderDate: '2024-02-01' }],
      'sec-1',
    );
    expect(analysis.contractsHeld).toBe(2);
    expect(analysis.contractsWithoutMatch).toBe(1);
  });

  it('counts a meeting it cannot place in time as unplaceable, not as zero days', () => {
    const analysis = analyseTiming([{ ...crossMatch, date: null }], [contract], 'sec-1');
    expect(analysis.timed).toHaveLength(0);
    expect(analysis.unplaceable).toBe(1);
    expect(analysis.medianDaysBefore).toBeNull();
  });
});

describe('generated sentences', () => {
  const aggregate = (fiscalYear: number, updated: number | null, execution: number | null) => ({
    fiscalYear,
    originalBudget: updated,
    updatedBudget: updated,
    execution,
    executionIsEstimate: false,
    executionStatus: 'final' as const,
    recordCount: 1,
  });

  it('states the direction and marks the figure as nominal', () => {
    const sentence = budgetTrendSentence(
      [aggregate(2023, 1_000, null), aggregate(2024, 1_200, 1_100)],
      'משרד לדוגמה',
    );
    expect(sentence).toContain('גדל');
    expect(sentence).toContain('נומינלי');
  });

  it('says nothing when there is nothing to say', () => {
    expect(budgetTrendSentence([aggregate(2023, null, null)], 'משרד')).toBeNull();
    expect(compositionSentence([], 'תקציב')).toBeNull();
  });

  it('names the largest component and its share', () => {
    const sentence = compositionSentence(
      [
        { label: 'שכר', value: 60 },
        { label: 'קניות', value: 40 },
      ],
      'תקציב הסעיף',
    );
    expect(sentence).toContain('שכר');
    expect(sentence).toContain('60.0%');
  });
});

describe('anomaly ranking', () => {
  const finding = (partial: Partial<AnomalyFinding>): AnomalyFinding => ({
    ruleId: 'overspend',
    ministryId: 'sec-1',
    code: '0001',
    title: 'תקנה',
    year: 2024,
    allocated: 100,
    revised: 100,
    executed: 100,
    evidenceHe: 'ראיה',
    sourceUrl: 'https://example.gov.il/g',
    ...partial,
  });

  it('puts a large absolute gap above a large ratio on a tiny line', () => {
    const big = finding({ code: 'big', revised: 1_000_000_000, executed: 1_500_000_000 });
    const tiny = finding({ code: 'tiny', revised: 10, executed: 100 });
    const ranked = rankAnomalies([tiny, big]);
    expect(ranked[0]?.code).toBe('big');
  });

  it('keeps every finding, ranking only changes the order', () => {
    const findings = [finding({ code: 'a' }), finding({ code: 'b', ruleId: 'unexecuted_budget' })];
    expect(rankAnomalies(findings)).toHaveLength(2);
  });
});

/*
 * The shipped summary file, checked against the promises the screens make about it.
 * The zod schema in scripts/lib/schema.ts gates the write; these gate the build.
 */
import summary from '../data/processed/site-summary.json';
import type { SiteSummary } from '../src/types/summary';

const site = summary as unknown as SiteSummary;

describe('site-summary.json', () => {
  it('stays small enough to be the first thing a reader waits for', () => {
    // The corpus is ~12MB; the point of this file is that it is not.
    expect(JSON.stringify(site).length).toBeLessThan(400_000);
  });

  it('gives every insight a source, a link and a "what this does not say"', () => {
    expect(site.insights.length).toBeGreaterThan(0);
    for (const insight of site.insights) {
      expect(insight.notSayingHe.length).toBeGreaterThan(40);
      expect(insight.href.startsWith('#/')).toBe(true);
      expect(insight.sentenceHe.length).toBeGreaterThan(20);
    }
  });

  it('is ordered by strength, so the home screen leads with the strongest', () => {
    const strengths = site.insights.map((i) => i.strength);
    expect([...strengths].sort((a, b) => b - a)).toEqual(strengths);
  });

  it('covers every collected section exactly once', () => {
    const ids = site.ministries.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(site.counts.ministries);
  });

  it('separates what an office published from what this site could read', () => {
    const states = new Set(site.ministries.map((m) => m.publicationState));
    // "published but unreadable by us" must be expressible, not folded into "nothing".
    expect(
      [...states].every((s) =>
        [
          'published_and_read',
          'published_not_read',
          'nothing_published',
          'no_diary_expected',
        ].includes(s),
      ),
    ).toBe(true);
  });

  it('never reports a share or a score outside its range', () => {
    for (const row of site.ministries) {
      if (row.shareOfTotalPercent !== null) {
        expect(row.shareOfTotalPercent).toBeGreaterThanOrEqual(0);
        expect(row.shareOfTotalPercent).toBeLessThanOrEqual(100);
      }
      for (const score of [row.transparencyScore, row.procurementScore]) {
        if (score !== null) {
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('publishes how selective each anomaly rule is', () => {
    expect(site.hygiene.length).toBeGreaterThan(0);
    for (const rule of site.hygiene) {
      expect(rule.scannedCount).toBeGreaterThan(0);
      expect(rule.whyInterestingHe.length).toBeGreaterThan(0);
    }
  });
});
