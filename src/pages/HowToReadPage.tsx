/**
 * One screen for the caveats that used to be stacked on every other screen.
 *
 * The site had seven to nine warning boxes per page, several of them repeated
 * verbatim across screens, and on the home page the first one appeared before the
 * first number. That teaches a reader to skip yellow boxes — including the ones that
 * change the conclusion. The rules now live here, in full, and each figure carries a
 * folded note that links back to the relevant section.
 *
 * Every rule stated here is imported from the module that implements it, so the text
 * cannot drift from the arithmetic.
 */
import type { SiteSummary } from '../types/summary';
import { Callout, Card, SectionHeading } from '../components/ui';
import { CHANGE_IS_NOMINAL_HE } from '../lib/context';
import { DIARY_FINDING_BIAS_HE, STRENGTH_RULE_HE } from '../lib/insights';
import {
  HYGIENE_NOTE_HE,
  PROCUREMENT_FORMULA_HE,
  PUBLICATION_STATE_RULE_HE,
  TRANSPARENCY_FORMULA_HE,
} from '../lib/scorecards';
import { DIARY_GROUP_RULE_HE, NO_MONEY_VS_TIME_HE, SUBJECT_MATTER_RULE_HE } from '../lib/taxonomy';
import { TIMING_BASELINE_NOTE_HE, TIMING_RULE_HE } from '../lib/timing';
import { WATERFALL_RULE_HE } from '../lib/waterfall';
import { LARGE_CHANGE_RULE_HE, EXECUTION_RATE_OUTLIER_HINT } from '../lib/calc';
import { formatNumber } from '../lib/format';
import { SCOPE_WARNING } from '../lib/site';

interface Rule {
  id: string;
  title: string;
  body: string[];
}

export function HowToReadPage({ summary }: { summary: SiteSummary }): JSX.Element {
  const RULES: Rule[] = [
    {
      id: 'status',
      title: 'לכל מספר יש סטטוס, וכדאי להסתכל בו',
      body: [
        'כל מדד באתר נושא תג: ביצוע סופי, נתון חלקי, אומדן, או אין נתון. "אין נתון" אינו אפס — הוא אמירה שהמקור לא פרסם את הנתון, והאתר מסרב להשלים אותו.',
        'סכימה של מדדים נעשית תמיד על רמת היררכיה אחת בלבד, כדי שסעיף-אב וסעיפי-הבן שלו לא ייספרו יחד. אגרגט שמכיל אומדן אחד מסומן כולו כאומדן.',
      ],
    },
    {
      id: 'nominal',
      title: 'כל השינויים כאן נומינליים',
      body: [
        CHANGE_IS_NOMINAL_HE,
        'המשמעות המעשית: משרד שתקציבו "גדל ב-8%" בין 2023 ל-2026 יכול היה להתכווץ בכוח הקנייה שלו. השוואה ריאלית תתאפשר רק לאחר איסוף מדד המחירים לצרכן, שאינו בין המקורות שנאספו.',
      ],
    },
    {
      id: 'waterfall',
      title: 'איך נקרא מחזור החיים של התקציב',
      body: [WATERFALL_RULE_HE, LARGE_CHANGE_RULE_HE, EXECUTION_RATE_OUTLIER_HINT],
    },
    {
      id: 'ranking',
      title: 'איך נקבע מה מוצג בראש הרשימה',
      body: [STRENGTH_RULE_HE, HYGIENE_NOTE_HE],
    },
    {
      id: 'diaries',
      title: 'מה יומן מלמד, ומה לא',
      body: [
        'היומנים מתעדים פגישות שדווחו של שרים, סגני שרים ומנכ"לים. הם אינם מתעדים את עבודת המשרד, ופגישה בת עשר דקות ופגישה בת יומיים נספרות אותו דבר: האתר סופר שורות, לא זמן.',
        DIARY_GROUP_RULE_HE,
        SUBJECT_MATTER_RULE_HE,
        DIARY_FINDING_BIAS_HE,
      ],
    },
    {
      id: 'no-money-vs-time',
      title: 'למה אין כאן השוואה בין כסף לזמן',
      body: [NO_MONEY_VS_TIME_HE],
    },
    {
      id: 'scores',
      title: 'שני המדדים המחושבים, והנוסחה שלהם',
      body: [TRANSPARENCY_FORMULA_HE, PROCUREMENT_FORMULA_HE],
    },
    {
      id: 'ours-vs-theirs',
      title: 'מה הם לא פרסמו, ומה אנחנו לא הצלחנו לקרוא',
      body: [
        PUBLICATION_STATE_RULE_HE,
        `בגרסת הנתונים הזו: ${formatNumber(summary.counts.quartersPublishedButUnread)} רבעונים פורסמו ולא נקראו על ידינו. הם אינם משפיעים על ציון השקיפות של אף משרד.`,
      ],
    },
    {
      id: 'timing',
      title: 'פגישות ומועדי התקשרות',
      body: [TIMING_RULE_HE, TIMING_BASELINE_NOTE_HE],
    },
    {
      id: 'people',
      title: 'ייחוס לאדם, ולא לתפקיד',
      body: [
        'רבעון יומן או שנת תקציב מיוחסים לתקופה, לא למי שמכהן כרגע. בכל ציר זמן מוצגת רצועת כהונות, וכשתקופה מתחלקת בין יותר מאדם אחד — האתר אומר זאת במקום להציג מדד אישי מטעה.',
        'מדד אישי מחושב רק על תקופת הכהונה של אותו אדם. ימים בתקופה שאינם מכוסים בכהונה שנאספה מדווחים כפער.',
      ],
    },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h1>איך לקרוא את האתר</h1>
        <p className="mt-2 max-w-3xl text-ink-2">
          כל הכללים, ההסתייגויות והנוסחאות במקום אחד. אינם חוזרים בכל מסך: ליד כל מספר יש הערה
          מקופלת שנפתחת בלחיצה, ומפנה לכאן.
        </p>
        <div className="mt-4">
          <Callout tone="warning" title="ההסתייגות שמשנה כל מסקנה באתר">
            <p>{SCOPE_WARNING}</p>
            <p>
              האתר אינו מתיימר לדעת במה עוסקים עובדי המשרדים, ואינו מודד את איכות עבודתם. הוא מציג
              פרסומים פומביים, נתוני תקציב ממקורות רשמיים, וקטלוג מקורות שניתן לאמת.
            </p>
          </Callout>
        </div>
      </section>

      <section aria-labelledby="rules-heading">
        <SectionHeading
          id="rules-heading"
          title="הכללים, אחד אחד"
          description="כל כלל מיוצא מהמודול שמממש אותו בקוד, כך שהטקסט כאן אינו יכול להיפרד מהחישוב."
        />
        <div className="space-y-4">
          {RULES.map((rule) => (
            <Card key={rule.id}>
              <h3 id={rule.id}>{rule.title}</h3>
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">
                {rule.body.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
