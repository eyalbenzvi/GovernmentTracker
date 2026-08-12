import { describe, expect, it } from 'vitest';
import { matchTopics, normalizeHebrew } from '../scripts/lib/topic-matching';

const TOPICS = [
  { id: 'public-transport', keywords: ['תחבורה ציבורית', 'אוטובוס'] },
  { id: 'education', keywords: ['בית ספר', 'תלמידים'] },
  { id: 'procurement', keywords: ['מכרז'] },
];

describe('normalizeHebrew', () => {
  it('removes niqqud so vocalised text still matches', () => {
    expect(normalizeHebrew('תַּקְצִיב')).toBe('תקציב');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeHebrew('א   ב\n\tג')).toBe('א ב ג');
  });
});

describe('matchTopics', () => {
  it('assigns a topic when a keyword appears', () => {
    const result = matchTopics('הרחבת תחבורה ציבורית', 'קווי אוטובוס נוספים', TOPICS);
    expect(result.topicIds).toEqual(['public-transport']);
  });

  it('records which keywords fired, so an assignment can be audited', () => {
    const result = matchTopics('מכרז חדש', 'פרסום מכרז', TOPICS);
    expect(result.rules.join(' ')).toContain('keyword_match(procurement)');
    expect(result.rules.join(' ')).toContain('מכרז');
  });

  it('can assign several topics to one item', () => {
    const result = matchTopics('מכרז להסעות תלמידים', 'אוטובוס לבית ספר', TOPICS);
    expect(result.topicIds).toEqual(['public-transport', 'education', 'procurement']);
  });

  it('assigns nothing when no keyword matches', () => {
    const result = matchTopics('נושא אחר לגמרי', 'ללא התאמה למילון', TOPICS);
    expect(result.topicIds).toEqual([]);
    expect(result.rules).toEqual([]);
  });

  it('is deterministic across repeated runs', () => {
    const a = matchTopics('אוטובוס', 'תלמידים', TOPICS);
    const b = matchTopics('אוטובוס', 'תלמידים', TOPICS);
    expect(a).toEqual(b);
  });
});
