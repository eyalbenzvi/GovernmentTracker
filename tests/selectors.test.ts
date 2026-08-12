import { describe, expect, it } from 'vitest';
import {
  dataBackedTopics,
  filterActivities,
  filterSources,
  matchesQuery,
  normalizeSearchText,
} from '../src/lib/selectors';
import type { ActivityEvidence, Dataset, SourceCatalogItem, Topic } from '../src/types/domain';

function topic(id: string, count: number): Topic {
  return {
    id,
    labelHe: id,
    description: 'תיאור',
    keywords: ['מילה'],
    classificationRule: 'כלל',
    color: '#123456',
    activityItemCount: count,
  };
}

function activity(overrides: Partial<ActivityEvidence>): ActivityEvidence {
  return {
    id: 'a1',
    ministryId: 'transport',
    date: '2025-03-01',
    title: 'קו אוטובוס חדש',
    summary: 'הרחבת תחבורה ציבורית',
    sourceType: 'ministry_news',
    sourceUrl: 'https://www.gov.il/he/pages/x',
    sourceTitle: 'מקור',
    collectedAt: '2026-08-12',
    people: [],
    organizations: [],
    topics: ['public-transport'],
    coverageLevel: 'direct',
    extractionNotes: '',
    isPublicPublicationOnly: true,
    ...overrides,
  };
}

function source(overrides: Partial<SourceCatalogItem>): SourceCatalogItem {
  return {
    id: 's1',
    title: 'הצעת תקציב משרד התחבורה',
    publisher: 'הכנסת',
    url: 'https://m.knesset.gov.il/a.pdf',
    sourceType: 'budget_book',
    sourceTypeLabelHe: 'ספר התקציב',
    ministryIds: ['transport'],
    fiscalYears: [2025],
    periodCovered: 'שנת תקציב 2025',
    collectedAt: '2026-08-12',
    licenseOrUsageNote: 'פומבי',
    reliabilityLevel: 'primary_official',
    extractionMethod: 'גילוי',
    discoveryQueryId: 'q01',
    mappingRule: 'כלל',
    retrievalStatus: 'not_retrieved_egress_blocked',
    retrievalNote: 'חסום',
    checksumSha256: null,
    ...overrides,
  };
}

describe('normalizeSearchText', () => {
  it('collapses whitespace and strips niqqud', () => {
    expect(normalizeSearchText('  תַּקְצִיב   המדינה ')).toBe('תקציב המדינה');
  });
});

describe('matchesQuery', () => {
  it('matches an empty query against everything', () => {
    expect(matchesQuery(['כל דבר'], '')).toBe(true);
  });

  it('requires every term to be present', () => {
    expect(matchesQuery(['תקציב משרד התחבורה'], 'תקציב תחבורה')).toBe(true);
    expect(matchesQuery(['תקציב משרד התחבורה'], 'תקציב חינוך')).toBe(false);
  });

  it('ignores null and undefined parts', () => {
    expect(matchesQuery(['תקציב', null, undefined], 'תקציב')).toBe(true);
  });
});

describe('dataBackedTopics', () => {
  it('excludes topics with zero activity items', () => {
    const dataset = {
      topics: [topic('a', 3), topic('b', 0), topic('c', 7)],
    } as unknown as Dataset;
    expect(dataBackedTopics(dataset).map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('returns nothing when the taxonomy is defined but unpopulated', () => {
    const dataset = { topics: [topic('a', 0), topic('b', 0)] } as unknown as Dataset;
    expect(dataBackedTopics(dataset)).toHaveLength(0);
  });
});

describe('filterActivities', () => {
  const items = [
    activity({ id: 'a1', date: '2025-03-01', ministryId: 'transport' }),
    activity({
      id: 'a2',
      date: '2024-05-01',
      ministryId: 'education',
      title: 'תוכנית לימודים',
      summary: 'בתי ספר',
      topics: ['education'],
    }),
    activity({ id: 'a3', date: null, ministryId: 'transport', title: 'ללא תאריך' }),
  ];
  const base = { ministryId: 'all', year: 'all', topicId: 'all', sourceType: 'all', query: '' };

  it('filters by ministry', () => {
    expect(filterActivities(items, { ...base, ministryId: 'education' }).map((a) => a.id)).toEqual([
      'a2',
    ]);
  });

  it('excludes undated items when a year is selected', () => {
    expect(filterActivities(items, { ...base, year: '2025' }).map((a) => a.id)).toEqual(['a1']);
  });

  it('filters by topic', () => {
    expect(filterActivities(items, { ...base, topicId: 'education' }).map((a) => a.id)).toEqual([
      'a2',
    ]);
  });

  it('filters by free text across title and summary', () => {
    expect(filterActivities(items, { ...base, query: 'בתי ספר' }).map((a) => a.id)).toEqual(['a2']);
  });
});

describe('filterSources', () => {
  const items = [
    source({ id: 's1', ministryIds: ['transport'], fiscalYears: [2025] }),
    source({
      id: 's2',
      ministryIds: [],
      fiscalYears: [2024],
      title: 'דוח ביצוע',
      publisher: 'משרד האוצר',
    }),
  ];
  const base = { ministryId: 'all', year: 'all', sourceType: 'all', publisher: 'all', query: '' };

  it('isolates cross-cutting sources', () => {
    expect(filterSources(items, { ...base, ministryId: 'cross-cutting' }).map((s) => s.id)).toEqual(
      ['s2'],
    );
  });

  it('filters by ministry, year and publisher', () => {
    expect(filterSources(items, { ...base, ministryId: 'transport' }).map((s) => s.id)).toEqual([
      's1',
    ]);
    expect(filterSources(items, { ...base, year: '2024' }).map((s) => s.id)).toEqual(['s2']);
    expect(filterSources(items, { ...base, publisher: 'משרד האוצר' }).map((s) => s.id)).toEqual([
      's2',
    ]);
  });
});
