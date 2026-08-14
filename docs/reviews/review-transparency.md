# External review — public transparency, FOI and accountability

**Reviewer role:** outside reviewer, government-watchdog perspective (transparency, freedom of
information, accountability). No involvement in building the site.
**Reviewed:** repository at `/home/user/GovernmentTracker`, data version `2026-08-14.1`,
HEAD `a4b55fc`. Files read, not the running site.
**Date:** 2026-08-14

---

## 1. Verdict

This is the most carefully sourced civic dataset on Israeli ministerial diaries I have seen, and I
would cite its **raw corpus** — 223,032 rows, extraction method per row, refusals logged rather
than papered over. I would **not** currently cite its **headline diary measures or its 467 named
"findings"**, and I would advise a journalist against quoting the transparency ranking as it
renders. The single greatest strength is the discipline about whose limitation a gap is: the team
found that its own vocabulary gaps were being published as office-holders' opacity, and fixed it
(`31628c0`). The single greatest weakness is that the same discipline was not applied one level up
— a ministry whose diary files the collector could not download (Health: all seven publications,
minister and DG, 2023–2026) is **absent from the diaries screen entirely**, indistinguishable from
a ministry that never published. Compounding this, the correction to the opacity measure
over-swung: 59 keywords, including `פ"ע`, `פגישה`, `ישיבה`, `שוטף` and `לשכה`, were moved out of
the transparency measure by an undisclosed build-time override, leaving the site's flagship
accountability metric standing on **four low-confidence keywords and 1.4% of rows**, with a
threshold rule that consequently fires for nobody. The site holds government to a standard it does
not yet meet itself: it publishes named findings about individuals while naming no operator,
offering no right of reply outside a public GitHub Issue, and keeping no corrections log.

---

## 2. Factual and methodological errors

### E1. The methodology page publishes statements its own data contradicts

`src/pages/MethodologyPage.tsx`:

- line 106: `אין באתר נתוני תקציב או ביצוע: {budgetItems} רשומות תקציב נאספו` → renders as
  "**The site has no budget or execution data:** 2,725 budget records were collected."
- line 110: `אין באתר פריטי פעילות: 2,386 פריטים נאספו.`
- line 107–108 refers the reader to "סעיף מגבלת סביבת הבנייה" — **no such section exists** in
  `methodology.json` (sections are: scope, collection, collection-limits, diaries, budget-source,
  measures, aggregation, analysis, findings, topics, links, corrections).

`data/processed/methodology.json`, section `links`:

> "בגרסה זו נאספו רשומות תקציב אך **לא נאספו פריטי פעילות**, ולכן לא ניתן לבסס אף קשר"

2,386 activity items were collected (`data-version.json.counts.activityItems`).

`README.md`, known limitation 6:

> "רק **7 מתוך 50** מקורות אוחזרו עם checksum"

The data-state table in the same README says 54 sources, 46 retrieved with a checksum; the
catalogue confirms 46/54.

**Why it matters.** These are sentences written for a zero-data state and never conditionalised.
They sit on the two pages a sceptical reader opens first. A site whose central promise is "if there
is no datum, say there is no datum" cannot afford to assert absence where 2,725 records exist —
it invites the reader to discount every other caveat as boilerplate.

**Fix.** Derive each limitation sentence from its count with a conditional, and add a check to
`validate-data.ts`: a limitation string asserting `אין באתר X` fails the build when `count(X) > 0`.

### E2. The published "diary transparency measure" excludes the most common form of Israeli diary opacity, by an override that is invisible on the site

The measure is `unspecified` — 3,136 rows, **1.4%**. Its entire vocabulary is
**4 keywords, all `low` confidence** (`data/processed/diary-categories.json`,
`categories[unspecified].keywordsByConfidence` = `{high: 0, medium: 0, low: 4}`), plus an
exact-string list.

`data/raw/seeds/diary-experts/merge-report.json` → `appliedOverrides` records **59** entries, every
one `remap → meeting_without_subject`, every one with the reason
_"הועברה מקטגוריית האטימות"_. The list:

> `פ"ע · פ.ע · פע · פ.ע. · פ"א · פ.א · פ.היכרות · שוטף · מנכ"ל · מנכל · מנכ"לית · מנכ"לים ·
סמנכ"ל · סמנכ"לית · רמ"ט · משנה למנכ"ל · יועצים · פנימי · פנימית · הכנה · פגישה · פגישת ·
פגישות · ישיבה · ישיבות · מפגש · מפגשים · דיון · דיונים · דיוני · שיחה · שיחת · שיחות ·
התייעצות · … · לשכה · היכרות · הכרות · הכירות`

Consequences I measured:

|                                              | rows   | share |
| -------------------------------------------- | ------ | ----- |
| `unspecified` — the published measure        | 3,136  | 1.4%  |
| `meeting_without_subject` — excluded from it | 32,413 | 14.5% |
| `named_person_meeting` — excluded from it    | 4,648  | 2.1%  |

- `opaque_diary` (≥50% generic, 20+ rows) yields **zero findings** across 195 profiles. Maximum
  opacity anywhere in the corpus is 38.5%; the **median for single-person profiles is 0.1%**. A
  rule that cannot fire is published on screen as one of "10 כללים עם נוסחה וסף מפורסמים".
- The README's own attribution table assigns both `meeting_without_subject` and
  `named_person_meeting` to "**של הלשכה**" — the office's limitation, not the site's. So by the
  site's own attribution, 16.6% of rows are the office's opacity, and 1.4% is the measure.
- `isGenericSubject` (`scripts/classify-diary-categories.ts:115–128`) requires **exact equality**
  after punctuation stripping. Therefore `פ.ע` counts as opacity and `פ.ע מנכ"ל` (251 rows) does
  not; `פגישה` counts and `פגישה פוליטית` (300 rows) does not. I counted **36,095 rows** that begin
  with a generic meeting word and continue with something, 15,335 of which land in
  `meeting_without_subject`. The measure rewards adding any word at all, and is biased downward
  precisely where offices are laziest.
- `דיון מסווג` (201 rows) — an explicit refusal to state the subject — is filed as "a meeting
  happened", not as opacity or as redaction.

**Why it matters.** This is the site's most quotable number and it is not a measure of opacity;
it is a measure of how many offices wrote a bare one-word cell. The split between "the office's
choice" and "our vocabulary gap" was the right correction. Moving 59 office-choice words to the
office-choice-but-not-counted bucket was one step too far, and it was taken in a script override
that appears nowhere in the UI.

**Fix.** Publish two named measures side by side, and make the second the headline:
(a) "נושא גנרי או מושחר" 1.4%; (b) "**רשומות שאינן מלמדות במה עסקה הפגישה**" 16.6% =
`unspecified + meeting_without_subject + named_person_meeting`. Keep `unclassified` and
`no_subject_recorded` out of both, as now — that part is right. Recompute `opaque_diary` against
(b), or delete the rule rather than publish one that never fires. List the 59 overrides on screen.

### E3. "Every archive-read row carries the address of the copy it was read from" is false in the published data

README and `methodology.json` (diaries §4) both state:

> "כל רשומה שהופקה כך נושאת את כתובת העותק שנקרא"

The collector does capture it — `scripts/collect-diaries.ts:1398–1401` builds
`provenanceNote` = `הקובץ נקרא מעותק שמור בארכיון האינטרנט: {url}` and attaches it as
`extractionNote` on the entry (`:1281`).

It is then dropped. The shipped shard row has 13 fields:
`id, datasetId, subject, date, startTime, endTime, location, participants, extractionMethod,
categoryId, matchedKeyword, matchedConfidence, inferredFrom`. `extractionNote` is not in
`src/types/domain.ts`'s `DiaryEntry`, is not referenced anywhere in `src/`, and **no shard file
contains the string "ארכיון"**.

**Why it matters.** Under constraint 6, the archive copy is the site's ethical justification for
reading files a repository refused. A reader cannot re-verify a single archive-derived row, and the
site claims they can. That is the one provenance claim on the diaries screen that fails.

**Fix.** Carry `archiveUrl: string | null` onto the published row and render it beside the OCR
badge.

### E4. The source catalogue does not cover 98% of the site's records, and the entry the diaries point to is marked "not retrieved"

- 54 catalogued sources for ~228,000 records, of which **223,032 are diary rows**.
- Only two `odata.org.il` entries exist in the catalogue and **both** are `not_retrieved_error`,
  HTTP 403: `https://www.odata.org.il/dataset` and `https://www.odata.org.il/dataset/2023`.
- Meanwhile 7,708 diary rows (profile "שרי ממשלת ישראל שנת 2023") carry
  `sourceUrl: https://www.odata.org.il/dataset/2023` — a URL the site's own catalogue records as
  unfetchable. The rows in fact came from the datastore API, which is **not catalogued at all** and
  carries no checksum.
- The 562 publication URLs live in `diaries-index.json`, are not in `source-catalog.json`, are
  unreachable from the Sources screen, and none has a checksum.

Credit where due: the 8 refusals are handled correctly — real URLs, `retrievalStatus`,
`retrievalNote: "גוף המסמך לא אוחזר: HTTP 403."`, `checksumSha256: null`, no impersonation. That
part is exemplary. The problem is coverage, not honesty.

**Fix.** Register the 562 publications as catalogue entries (a `diaries_publication` source type)
with per-entry retrieval status, and record the endpoint actually read on each row.

### E5. The time-based findings run on an inconsistent base, and `0` is published where the datum is missing

- **29 of 163** single-person profiles have `timedEntryCount == 0`; **43** are under 50% timed.
  Among the zero-time group: אייל זמיר (3,218 rows), רון דרמר (2,660), יהלי רוטנברג (1,812),
  מאיר פורוש (1,484), יחזקאל ליפשיץ (1,296), יואב גלנט (650).
- Part of the cause is the site's own mapper: the column `התחלה` was dropped in **70** resources
  and `סוף` in **64** (`diaries-index.json`, unparsedResources notes).
- 92 profiles contain undated rows, so `weekendCount` has the same defect.
- The profile card (`DiariesPage.tsx:476–500`) prints `שעות לילה`, `ימי מרתון`, `פגישות חופפות`
  and `שישי-שבת` as plain numbers. Those people render **0** — indistinguishable from "measured,
  none found".

**Why it matters.** Four of the six rules that actually produce findings depend on times.
Office-holders whose publisher used a header the mapper does not recognise are structurally
incapable of appearing, and are simultaneously shown a clean `0`. This violates the site's own
headline rule, stated on the same build at `MethodologyPage.tsx:22–25`:
"אם אין נתון — כתוב שאין נתון. **לא אפס**".

**Fix.** Replace `0` with "לא ניתן למדוד — X% מהרשומות פורסמו ללא שעה", and gate the three
time rules on a minimum timed-row share.

### E6. The transparency ranking includes aggregate publications that the site's own rule bars from personal attribution

`insights.caveats[2]` and the README are explicit: a file aggregating several office-holders
"לא מיוחס לו שם ולא מופק ממנו שום ממצא אישי". The **findings list honours this** — I verified 0 of
467 findings attach to a `coversMultiplePeople` profile. Good.

The ranking does not. `opacityRanking` (`DiariesPage.tsx:185–192`) filters only on
`entryCount >= 20`. Reproducing the rendered top-12:

| #   | opacity | rows  | profile type | rendered name                                                      |
| --- | ------- | ----- | ------------ | ------------------------------------------------------------------ |
| 1   | 38.5%   | 408   | single       | יעקב מרגי                                                          |
| 2   | 34.8%   | 445   | single       | עמי כהן                                                            |
| 3   | 28.0%   | 189   | single       | _(no name parsed)_ "מנכ״ל משרד הביטחון אמיר אשל לשנת 2023 (ינואר)" |
| 4   | 21.8%   | 650   | single       | יואב גלנט                                                          |
| 5   | 19.4%   | 310   | single       | יעקב מרגי                                                          |
| 6   | 18.9%   | 772   | single       | ינון אהרוני                                                        |
| 7   | 14.6%   | 775   | **shared**   | _(no name parsed)_ "שר הרווחה יעקב מרגי ויומן מנכ״ל משרד הרווחה"   |
| 8   | 12.8%   | 3,218 | single       | אייל זמיר                                                          |
| …   |         |       |              |                                                                    |
| 12  | 8.0%    | 1,785 | **shared**   | "השר לביטחון לאומי"                                                |

Rows 7 and 12 are shared-file profiles. Because `personLabel` is `null`, the table falls back to
`roleLabelHe` — which for row 7 **prints a named minister** inside a personal transparency ranking,
on the strength of a file that also contains his DG's diary. That is exactly the harm the caveat
was written to prevent.

**Fix.** Add `.filter(p => !p.coversMultiplePeople)` to the ranking, and never substitute
`roleLabelHe` for a missing `personLabel` in a person-labelled column.

### E7. The same individual is ranked three times with three different numbers

יעקב מרגי occupies rows 1, 5 and (inside the shared file) 7 of the rendered top-12: 38.5%, 19.4%,
14.6%. One person, three adjacent rows, three numbers, no indication they are the same person.
A journalist will quote 38.5% as "the most opaque minister" — it is the score of one publication of
his, covering 408 rows.

Rows 3 and 11 display raw publication titles as names, including the period
("לשנת 2023 (ינואר)", "(תקופה משלימה)"). Row 3 covers **one month**, 189 rows, and is ranked third
against people with four years. The header caveat says two office-holders are not comparable if one
published fully and the other one quarter — and the table then sorts them into a single league.

**Fix.** Consolidate profiles per person before ranking; add a "period covered" column; either
remove the sort or segment by comparable period length.

### E8. Repository claims I could not reproduce

- README: "ו-**41** מילות פורמט הועברו לקטגוריה נפרדת". `merge-report.json` records **59**
  remaps, all to `meeting_without_subject`. (`וובינר` also appears twice — a duplicate override.)
- README: "רמת הביטחון נוסעת עד לרשומה הבודדת **ומוצגת בפילוח לכל קטגוריה**." Not in the published
  site. `matchedConfidence` exists on every row and is typed at `domain.ts:374`, and
  `validate-data.ts:748–757` enforces that keyword and confidence travel together, with the comment
  _"a reader who is shown a category must be able to see how firm the keyword behind it was"_ — but
  `grep -rn 'confidence' src/**/*.tsx` finds it **only on the Analysis page**. Neither per-row
  confidence, nor per-category confidence breakdown, nor `matchedKeyword` is rendered anywhere in
  the diaries UI. The invariant is enforced; the reader-facing purpose it exists for is not
  delivered.
- The classifier's own docstring says the firing keyword is stored on the row "so any reader can
  audit or dispute a single assignment". From the site, they cannot — only by cloning the repo.

### E9. The limitation text published on screen says "three categories" where there are five, and omits the two largest

`diary-categories.json` → `limitations[4]`, rendered verbatim at `DiariesPage.tsx:919–931`:

> "**שלוש קטגוריות** אינן קטגוריות תוכן והן נפרדות במכוון: …"

It names `unspecified`, `no_subject_recorded`, `unclassified`. It omits
`meeting_without_subject` (14.5%) and `named_person_meeting` (2.1%) — the two categories that hold
the actual opacity. This is the block a careful reader goes to precisely to understand the split.

---

## 3. Misleading or unclear presentation

### M1. "Findings" that fire on most of the population, and reward publishing more

Hit rates among the 163 single-person profiles:

| rule                                                                                    | people flagged | share   |
| --------------------------------------------------------------------------------------- | -------------- | ------- |
| `marathon_day`                                                                          | 125            | **77%** |
| `weekend_meetings`                                                                      | 102            | **63%** |
| `double_booked`                                                                         | 100            | **61%** |
| `late_night_meetings`                                                                   | 92             | **56%** |
| `publication_gap`                                                                       | 45             | 28%     |
| `opaque_diary`, `private_sector_heavy`, `supplier_meeting`, `support_recipient_meeting` | 0              | 0%      |

Findings per person by volume published:

| rows published | n   | mean findings |
| -------------- | --- | ------------- |
| 20–99          | 20  | 1.00          |
| 100–499        | 46  | 2.28          |
| 500–1,999      | 65  | 3.23          |
| 2,000+         | 32  | **4.12**      |

Pearson r between `entryCount` and finding count = **0.44**.

So the site attaches more items to the name of the office-holder who published **more fully**,
under a heading a reader parses as adverse. That is a transparency-hostile incentive published by a
transparency site. It also drowns the two rules that would carry real signal (`opaque_diary`,
`private_sector_heavy`) in 419 findings about long days and overlapping calendar entries.

**Fix.** Print the base rate beside every rule ("102 מתוך 163 בעלי תפקיד חוצים סף זה"), normalise
per published row, and set thresholds that mark the tail rather than the middle.

### M2. "פגישות בשישי-שבת" merges two unlike things and reads as an allegation

Corpus: 2,546 Friday rows, 1,631 Saturday rows. In Israel Friday is a working morning and the
main day for ceremonies; Saturday is Shabbat. Merging them under one label with a threshold of
**3 records over up to four years** produces 102 findings, and the rule's own
`whyInterestingHe` offers three benign readings — which is an admission that the flag carries no
information. About a religious office-holder it will not be read benignly.

The exposure is compounded by the corpus itself, which classifies "תפילת מנחה", "תפילת ערבית"
(hundreds of rows) and 7,796 `religious_lifecycle` rows per person. The site does not intend a
religiosity profile of named individuals; it assembles the materials for one and ranks them.

Credit: I checked OCR contamination here and it is negligible — 25 of 4,177 weekend rows came from
OCR. The problem is the rule, not the extraction.

**Fix.** Split Friday from Saturday, report both as descriptive counts on the profile card only,
and remove them from the "ממצאים" list.

### M3. Most of the money cross-references are not conflicts of interest, and each row pairs a name with an unrelated sum

All 149 cross-matches by matched entity:

> הסוכנות היהודית 43 · פארק אריאל שרון 21 · עירית ירושלים 18 · גילת טלקום 9 · מוזיאון ישראל 7 ·
> עיריית נתניה 6 · בנק הפועלים 5 · החברה לשירותי איכות הסביבה 5 · מכבי תנועה עולמית 5 ·
> החברה להגנת הטבע 3 · הקרן לידידות 3 · … · אוניברסיטת תל-אביב 2 · עירית חיפה 2 · ישראכרט 2 ·
> בנק מזרחי טפחות 2 · המועצה לענף הלול 2 · התאגיד לפיקוח וטרינרי 1

Roughly 80 of 149 are municipalities, statutory councils, parastatals, banks or universities —
bodies a minister or DG meets as a matter of ordinary work. The rule text claims the normalisation
excludes "גופי ממשלה"; municipalities and statutory corporations pass straight through.

Each row places a large figure beside a meeting, e.g.
`מטה מול מטה-הסוכנות היהודית · ₪441M · היקף התקשרויות מצטבר (רב-שנתי)`. That amount is the
entity's cumulative multi-year contract volume with the ministry; it has nothing to do with that
meeting, that year, or that person. The disclaimer says so in prose above the table. The row —
which is what gets screenshotted — does not.

Credit: the table deliberately does not carry an office-holder column. That is the right instinct.
But `personLabel` is on every cross-match in `diary-insights.json` and in the exports, so the
pairing is one download away.

**Fix.** Exclude local authorities and statutory bodies from the rule or label them as a separate
lower-salience class; move the amount out of the row and onto the linked entity.

### M4. The language model behind the diary classification is disclosed in the wrong place, and contradicted in another

The 30-category taxonomy and all 1,878 keywords were authored by a language model at build time,
and the five "domain experts" are model-generated (`diary-categories.json.methodNote`,
`expertPanel.method`). The stored-in-full, deterministic-at-runtime design is genuinely good
practice.

But:

- On the diaries screen the disclosure appears **once**, as grey sub-text under the chart
  "במה עסקו — לפי קטגוריה ולפי זמן" (`DiariesPage.tsx:542`) — **below** the transparency ranking,
  the personal profile card and the findings list, all three of which depend on it.
- The methodology page's `diaries` section (7 paragraphs) **never mentions a language model at
  all**, while the `topics` section on the same page states:

  > "הסיווג דטרמיניסטי לחלוטין ואינו משתמש במודל שפה — לא בזמן ריצה **ולא בזמן בנייה**."

  That sentence is true of the activity taxonomy and false of the diary taxonomy, and nothing on
  the page distinguishes them. A reader who does the diligent thing — read the methodology page —
  ends up with a false belief about the classification behind every diary measure.

- **The corrections to the experts' proposals are not visible on the site.** `merge-report.json`
  holds 36 resolved conflicts (with the rejected side and the tie-break) and 63 applied overrides.
  `grep -rn 'merge-report\|conflicts' src/` returns nothing. The README describes 4 of the 63
  accurately and gets the count of the rest wrong (see E8). The reader is told a panel exists and
  is not told what the team overruled — including the 59 remaps that define the transparency
  measure.

### M5. The KPI card labels files as publications

Card: "**פרסומים שלא פוענחו — 1,508** · מדווחים בגלוי". 1,508 is `unparsedResources`, a count of
**files**, including files inside publications that did yield rows. The section body ~600 lines
later gets it right ("1,508 **קבצים** … 212 **פרסומים** לא הניבו אף רשומה"). The card is the number
that will be quoted.

Neither `562` (publications examined) nor `349` (publications that yielded rows) is displayed
anywhere on the site — I checked every use of `index.totals.*` in `DiariesPage.tsx`.

### M6. The site's budget total is presented without a denominator

Level-1 sections sum to **₪487.0B** original / **₪544.9B** updated for FY2025 (2023: 380.0B;
2024: 472.5B; 2026: 544.4B). The published 2025 state budget is materially larger. The site
correctly explains that the development budget is excluded, but never states its own total as a
share of the state budget, so a reader cannot tell whether 487B is nearly all of it or two thirds.
The collector also filters `budget_kind_code = '1'`, visible only inside each record's
`rawReference` string and disclosed in no methodology text.

In passing: the FY2025 sub-line "תחבורה ציבורית — ₪35,206,000" is not plausible as the state's
public-transport line. The README's one sanity check (transport section total = ₪617,993,000,
matching the Knesset budget proposal) validates the same slice and so cannot detect this. I could
not determine from the repository which budget kinds the slice omits — which is itself the finding.

### M7. No right of reply, no named operator, no corrections record, no third-party-data policy

- The only correction route is a **public GitHub Issue** (`MethodologyPage.tsx:137–155`). It
  requires an account, it is public, and it is not a channel a minister's spokesperson or a
  wrongly-named DG will use.
- **No page names who operates the site** or takes editorial responsibility. `הצהרת שקיפות`
  (`AboutPage.tsx:246–265`) says the site is not an official source; it does not say who it is.
- **No corrections log.** `data-version.json.changelog` holds a single build note. A reader cannot
  see that anything was ever corrected, or what.
- **No policy on third-party personal data.** The corpus republishes — searchable and exportable —
  13,377 rows classified `personal_private`, including recurring entries about named non-office-
  holders: `"קלאודיה בטיפול אישי כל יום שלישי עד 11:00"` (31 rows), `"X בחופש עד 29.10"`,
  `"אישי מנכ״ל"`, weddings, prayer times, birthdays. The offices published these rows; that makes
  republication defensible. But the site adds classification, per-person aggregation, full-text
  search across 223,032 rows and CSV export — which changes their character. That is the classic
  FOI aggregation problem, and the site has taken no visible position on it.

For a site publishing 467 findings and 195 personal profiles about named people, this asymmetry is
the most serious non-data criticism in this review. It demands of government exactly what it does
not provide: an identified responsible party, a usable correction channel, and a public record of
corrections made.

---

## 4. What is missing

### W1. "No diary published" is invisible — and worse, indistinguishable from "we could not read it"

This is the highest-value gap on the site.

`sectionsWithDiaries` (`DiariesPage.tsx:49–64`) is built from `index.shards`. A section with zero
readable rows **never appears in the selector at all**. 21 of the 43 sections have no shard.

The Ministry of Health is in that group. It published seven diary publications:

| publication                                         | rows | reason                      |
| --------------------------------------------------- | ---- | --------------------------- |
| יומן מנכ"ל משרד הבריאות, משה בר סימן טוב, 2025 Q4   | 0    | 403, no archive snapshot    |
| יומן שר הבריאות, חיים כץ, 2026 Q1                   | 0    | 403, no archive snapshot    |
| יומן מנכ"ל משרד הבריאות, 2026 Q1                    | 0    | 403, no archive snapshot    |
| יומן מנכ"ל משרד הבריאות, 2025 Q3                    | 0    | 403, no archive snapshot    |
| יומן שר הבריאות, אוריאל בוסו, 2023 Q4 + 2024 + 2025 | 0    | 403, no archive snapshot    |
| יומן מנכ"ל משרד הבריאות, 2023 Q3–Q4                 | 0    | legacy binary XLS, not read |
| יומן מנכ"ל משרד הבריאות, 2023 Q2                    | 0    | 403, no archive snapshot    |

The minister and the DG of the Ministry of Health published diaries across the whole period, and
the site shows nothing at all. A reader concludes Health does not publish.

Corpus-wide: **213** of 562 publications yielded zero rows, and **187** of those failed because the
repository refused the download **and** the archive had no snapshot — a site-side failure with no
bearing on the office. One zero-yield publication records no reason whatsoever.

This is the identical error the team correctly fixed at the row level in `31628c0`
("stop publishing our own gaps as other people's opacity"), unfixed one level up. Everything needed
is already in `diaries-index.json`.

**Fix.** Make the section selector enumerate all 43 sections, with an explicit state per section:
readable rows / published-but-unreadable-by-us (with count and reason) / no publication found in
the repository. Show the same three states on each ministry page.

### W2. A quarterly compliance grid — the artefact the procedure actually calls for

The duty is quarterly. The site holds, for all 562 publications, `personLabel`, `roleLabelHe`,
`periodLabel`, `ministryId`, plus first/last quarter per profile — and never draws the table:
**office-holder × quarter**, four states (published and readable · published but unreadable by us ·
no publication found · tenure unknown).

Related defect: `publication_gap` detects only holes **between** the first and last published
quarter, so a diary that simply **stops** is never a finding. I counted **111 of 163**
single-person profiles whose last record predates 2025Q1 — 18+ months before the collection date —
and none of that appears as a finding. Trailing non-compliance is invisible by construction.

Honest limit to state in the cell rather than guess: with `ministerTenures: 0`, the site cannot
distinguish "stopped publishing" from "left office".

### W3. The redaction-reason column — which the offices publish and the site discards

From the unmapped-column notes in `diaries-index.json`:

| dropped column                                                                  | resources |
| ------------------------------------------------------------------------------- | --------- |
| `סיבת_השחרה`                                                                    | 20        |
| `myd' shhvsr v'ylh lpy khvq khvpsh hmyd'` (מידע שהוסר ועילה לפי חוק חופש המידע) | 26        |
| `עילת_השחרהשינוי_לפי_חוק_חופש_המידע`                                            | 13        |
| `עילת_השחרה`                                                                    | 12        |

≈70 resources in which the office stated **which statutory ground it invoked to withhold** — and
the site drops every one, while inferring opacity from subject text. For a diaries watchdog this is
the single most valuable field in the files. Mapping four column aliases would let the site publish
a redaction-grounds breakdown per office: the strongest FOI artefact available here, and cheap.

### W4. A bulk diary export

`data/processed/csv/` ships CSVs for budget-items (2,725 rows), anomalies, top-suppliers,
usage-breakdown, coverage — and **none for the 223,032 diary rows** (removed in
`b2b3774 perf(diaries): drop the duplicate per-section CSV exports`). The on-page CSV button
exports only the currently filtered rows of the currently loaded shard. An FOI practitioner cannot
obtain the corpus as a table without cloning the repo and merging 23 JSON shards. This is the
difference between a tool used weekly and one looked at once.

### W5. Row-level auditability in the interface

Every row stores `matchedKeyword` and `matchedConfidence`, and the build refuses to ship without
them. Neither is rendered (E8). Two extra spans per row would make every single classification
disputable from the page — which is the stated point of storing them.

### W6. An encoding bug reported to the reader as a data limitation

**133** unparsed-resource notes carry transliterated Hebrew column names — `mshttpym drvshym`
(משתתפים דרושים), `mrgn hpgyshh` (מארגן הפגישה), `nvsh,tryk htkhlh,sh't ht…`
(נושא, תאריך התחלה, שעת ה…) — and several header failures show `����`. Those columns exist and are
recognisable; the reader is told they were "not mapped", which reads as the office's problem.
Separately, **9 of 44** header-recognition failures are plain English headers
(`Subject`, `Start Date`, `Start Time`) — trivially mappable. Fixing the XLSX code path and adding
English aliases would recover publications currently reported as unreadable, including the
start/end-time columns that E5 depends on.

### W7. Explicitly _not_ buildable as automated collection — and worth doing by hand

Minister tenure dates. Without them the site cannot say who bore the duty in a given quarter,
cannot compute per-tenure rates, and cannot distinguish departure from non-compliance. The site's
position ("0 records, not inferred") is honest but self-defeating for the compliance question. A
**hand-authored, per-row sourced tenure seed** (appointments are published in the official gazette
and on the Knesset site) is fully inside the "no fabricated data" rule — each row carries a source
URL — and needs no live retrieval. That is the difference between "we cannot get this
automatically" and "this cannot be known".

### W8. Diaries are absent from the rest of the site

`coverage.json` (per-ministry coverage, 43 entries) has **no diary fields**. Neither `HomePage.tsx`
nor `MinistryPage.tsx` mentions diaries; the only reference outside the diaries screen is the nav
link in `Layout.tsx:13`. Diaries are 98% of the site's records and its most newsworthy content, and
a reader on the Ministry of Transport page learns nothing about whether its minister publishes.

---

## 5. Prioritised proposals

Ordered by value per unit of effort.

1. **Show "published but unreadable by us" and "no publication found" as first-class states** on
   the diaries screen and on every ministry page; enumerate all 43 sections in the selector.
   _(small–medium)_ — Removes the site's single worst inaccuracy: the Ministry of Health, which
   published throughout, currently appears not to publish. All inputs already exist in
   `diaries-index.json`.
2. **Republish the opacity headline honestly.** Two named measures: "נושא גנרי או מושחר" 1.4% and
   "רשומות שאינן מלמדות במה עסקה הפגישה" 16.6%, the second as the headline. Recompute or delete
   `opaque_diary`. _(small)_ — Turns an inert 1.4% figure resting on 4 low-confidence keywords into
   the measure the diaries procedure exists to support.
3. **Fix the transparency ranking:** exclude `coversMultiplePeople`, consolidate profiles per
   person, add a period-covered column, never print `roleLabelHe` in a name column.
   _(small)_ — Removes the two most defamation-exposed artefacts on the site: a named minister
   ranked off a shared file, and one person ranked three times with three numbers.
4. **Correct the four self-contradicting sentences and add a validation guard** against
   "אין באתר X" where `count(X) > 0`; fix the dangling section reference and the 41-vs-59 and
   confidence-is-displayed claims in the README. _(small)_ — Cheapest credibility repair available.
5. **Add operator identity, a non-public correction address, a published corrections log, and a
   third-party personal-data policy.** _(small)_ — Closes the accountability asymmetry. Without it
   the site cannot claim to hold itself to the standard it applies.
6. **Publish base rates beside every rule; normalise findings per published row; move Friday and
   Saturday out of "findings" onto the profile card as separate descriptive counts.**
   _(small)_ — Stops the site rewarding fuller publication with more adverse-looking items
   (r = 0.44) and defuses the Shabbat framing.
7. **Carry `archiveUrl`, `matchedKeyword` and `matchedConfidence` onto the published row and render
   them.** _(small–medium)_ — Makes the archive-provenance claim true and makes every single
   classification disputable from the page.
8. **Ship a bulk diary CSV** (one file, or one per shard, generated at build time).
   _(small)_ — The single change most likely to make this a weekly FOI tool rather than a
   one-visit site.
9. **Map the redaction-reason columns** (`סיבת_השחרה`, `עילת_השחרה`, the FOI-Act variant, and the
   mojibake form) and publish a redaction-grounds breakdown per office. _(medium)_ — The highest-
   value new content available in the existing files: which statutory exemption each office invokes.
10. **Build the quarterly compliance grid** (office-holder × quarter, four states), and extend
    `publication_gap` to trailing gaps with an explicit "tenure unknown" state.
    _(medium)_ — The artefact a Knesset researcher or FOI practitioner actually needs.
11. **Fix the XLSX encoding path and add English column aliases**, then re-run collection.
    _(medium)_ — Recovers publications now reported as unreadable, and recovers the start/end-time
    columns that four of the six active rules depend on.
12. **Catalogue the 562 diary publications as sources** with per-entry retrieval status; record the
    endpoint each row was actually read from. _(medium)_ — Ends the situation where 98% of the
    site's records trace to a catalogue entry marked "HTTP 403, not retrieved".
13. **Move the language-model disclosure into the diaries page header callout**, correct the
    `topics` methodology paragraph to scope itself to the activity taxonomy, and publish a short
    "מה תוקן בהצעות המומחים" table from `merge-report.json`. _(small)_
14. **Tighten the money cross-reference:** exclude local authorities and statutory bodies, move the
    amount out of the row. _(small)_
15. **Hand-author a per-row sourced minister-tenure seed.** _(medium)_ — Unlocks per-tenure
    compliance and lets the compliance grid distinguish departure from non-publication.

---

## 6. What I checked

Read in full or in substantial part:

- `README.md` (all 391 lines), `data/processed/methodology.json` (all 12 sections, every
  paragraph), `data/processed/DATA-REPORT.md` (listing only).
- `src/pages/DiariesPage.tsx` (all 962 lines), `src/pages/MethodologyPage.tsx`,
  `src/pages/AboutPage.tsx`, `src/lib/site.ts`, `src/components/Layout.tsx` (nav only).
  Skimmed `AnalysisPage.tsx`, `FindingsPage.tsx`, `HomePage.tsx`, `SourcesPage.tsx`,
  `MinistryPage.tsx` for diary references and confidence rendering only.
- `scripts/classify-diary-categories.ts` (normalisation, `isGenericSubject`, `matchesAsWord`),
  `scripts/analyze-diaries.ts` (rules, thresholds, `publication_gap` logic),
  `scripts/collect-diaries.ts` (archive fallback, `buildEntries`, provenance note),
  `scripts/validate-data.ts` (diary checks, §16–17), `scripts/merge-diary-expert-vocabulary.ts`
  (referenced, not read line-by-line).

Data verified computationally against the files (not taken from prose):

- Summed all 23 shards: 223,032 rows — matches the published total exactly. Recomputed every
  headline percentage from category counts: 1.4% / 9.6% / 16.6% / 71.5% / 0.9% all reproduce
  exactly. Credit for that.
- Category counts for all 30 categories; the 5 non-subject categories and their seed keyword lists
  and confidences.
- Reproduced the rendered top-12 opacity ranking exactly as `DiariesPage.tsx:185–192` computes it,
  including the two shared-file rows and the three מרגי rows.
- All 467 findings by rule and by person; per-rule hit rates against the 163 single-person
  profiles; findings-per-person by publication volume; Pearson r = 0.44. Verified 0 findings attach
  to shared-file profiles.
- All 149 cross-matches grouped by matched entity.
- `timedEntryCount` / `datedEntryCount` distributions across profiles; last-published quarter for
  all 163 single-person profiles.
- Friday/Saturday row counts and their extraction-method mix.
- All 562 publications: zero-yield count, failure reasons, per-ministry distribution; the Health
  ministry's seven publications individually; all unmapped-column names with frequencies.
- All 54 catalogue entries and all 8 refusals with their notes; confirmed no diary row carries an
  archive URL by grepping every shard.
- `merge-report.json`: all 63 overrides by action, all 59 remap targets and reasons.
- Budget: level-1 totals for 2023–2026; the FY2025 transport section and its sub-lines; verified
  0 budget rows lack `sourceUrl`.

**Not checked.** I did not run the site, the build, the test suite (154 Vitest + 60 Playwright) or
the collector; all findings about rendering are read from the JSX and the data it consumes. I did
not review the anomaly rules, the supplier/support/transfer layer, the usage-type or theme layers
beyond their treatment on the methodology page, or the accessibility and RTL behaviour of any
screen. I did not verify any figure against an external official source — including the transport
sanity check and the FY2025 budget total, where my observations in M6 are flagged as unresolved
rather than as errors.
