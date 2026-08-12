/**
 * The pure topic-matching logic, kept separate from the classify-topics entry
 * point so it can be unit-tested without running the pipeline.
 *
 * Deterministic by construction: same text + same dictionary → same topics and
 * the same explanation of why.
 */

export interface KeywordTopic {
  id: string;
  keywords: readonly string[];
}

export interface MatchOutcome {
  topicIds: string[];
  rules: string[];
}

/** Removes Hebrew niqqud/te'amim and collapses whitespace, so matching is stable. */
export function normalizeHebrew(text: string): string {
  return text.replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ').trim();
}

export function matchTopics(
  title: string,
  summary: string,
  topics: readonly KeywordTopic[],
): MatchOutcome {
  const haystack = normalizeHebrew(`${title} ${summary}`);
  const topicIds: string[] = [];
  const rules: string[] = [];
  for (const topic of topics) {
    const hits = topic.keywords.filter((keyword) => haystack.includes(normalizeHebrew(keyword)));
    if (hits.length > 0) {
      topicIds.push(topic.id);
      rules.push(`keyword_match(${topic.id}): ${hits.join(', ')}`);
    }
  }
  return { topicIds, rules };
}
