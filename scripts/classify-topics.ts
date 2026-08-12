/**
 * classify-topics — assigns topics to collected activity items, deterministically.
 *
 * No language model is involved, at build time or at run time. Classification is
 * a two-stage, fully auditable process:
 *
 *   1. Keyword dictionary matching (data/raw/seeds/topics.seed.json). The text
 *      searched is the item's own title + summary, after whitespace collapsing
 *      and niqqud removal. Matching is plain substring containment.
 *   2. Declared manual overrides (data/raw/seeds/topic-overrides.json), applied
 *      after stage 1 and recorded as such.
 *
 * Every assignment writes the rule that produced it into the item's
 * extractionNotes, so the site can show *why* a topic was attached.
 *
 * Outputs: data/processed/topics.json, and activity-evidence.json rewritten with
 * topics populated (idempotent — re-running on unchanged input is a no-op).
 */
import path from 'node:path';
import { PROCESSED_DIR, RAW_DIR, readJson, writeJson } from './lib/paths.js';
import type { ActivityEvidence, Topic } from './lib/schema.js';
import { matchTopics } from './lib/topic-matching.js';

interface TopicSeed {
  id: string;
  labelHe: string;
  description: string;
  keywords: string[];
  color: string;
}
interface TopicsSeedFile {
  matchingNote: string;
  topics: TopicSeed[];
}
interface OverrideRule {
  activityIdPattern: string;
  topicIds: string[];
  reason: string;
  enabled: boolean;
}
interface OverridesFile {
  rules: OverrideRule[];
}

function main(): void {
  const seed = readJson<TopicsSeedFile>(path.join(RAW_DIR, 'seeds', 'topics.seed.json'));
  const overrides = readJson<OverridesFile>(path.join(RAW_DIR, 'seeds', 'topic-overrides.json'));
  const activityPath = path.join(PROCESSED_DIR, 'activity-evidence.json');
  const activities = readJson<ActivityEvidence[]>(activityPath);

  const activeOverrides = overrides.rules.filter((r) => r.enabled);
  const counts = new Map<string, number>(seed.topics.map((t) => [t.id, 0]));

  const classified = activities.map((activity) => {
    const { topicIds, rules } = matchTopics(activity.title, activity.summary, seed.topics);
    const applied = new Set(topicIds);

    for (const rule of activeOverrides) {
      if (new RegExp(rule.activityIdPattern).test(activity.id)) {
        for (const topicId of rule.topicIds) applied.add(topicId);
        rules.push(`manual_override: ${rule.reason}`);
      }
    }

    const finalTopics = [...applied].sort();
    for (const topicId of finalTopics) {
      counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
    }

    const ruleNote =
      finalTopics.length > 0
        ? `סיווג נושאים: ${rules.join(' | ')}`
        : 'סיווג נושאים: לא נמצאה התאמה לאף מילת מפתח; הפריט נותר ללא נושא ומסומן לסיווג ידני.';

    // Keep extractionNotes idempotent: strip any previous classification note.
    const baseNotes = activity.extractionNotes.split(' || סיווג נושאים:')[0] ?? '';

    return {
      ...activity,
      topics: finalTopics,
      extractionNotes: `${baseNotes} || ${ruleNote}`,
    };
  });

  const topics: Topic[] = seed.topics.map((topic) => ({
    id: topic.id,
    labelHe: topic.labelHe,
    description: topic.description,
    keywords: topic.keywords,
    classificationRule: `התאמת תת-מחרוזת על מילות המפתח: ${topic.keywords.join(', ')}. ${seed.matchingNote}`,
    color: topic.color,
    activityItemCount: counts.get(topic.id) ?? 0,
  }));

  writeJson(activityPath, classified);
  writeJson(path.join(PROCESSED_DIR, 'topics.json'), topics);

  const withActivity = topics.filter((t) => t.activityItemCount > 0).length;
  console.log(
    `classify-topics: ${classified.length} פריטים סווגו · ${withActivity}/${topics.length} נושאים קיבלו לפחות פריט אחד`,
  );
  if (classified.length === 0) {
    console.log(
      'לא נאספו פריטי פעילות, ולכן כל הנושאים נשארים עם מונה 0. הטקסונומיה מוצגת באתר כמוגדרת-אך-לא-מאוכלסת, ולא כנתון.',
    );
  }
}

main();
