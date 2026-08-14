# External review — public administration and public policy lens

**Reviewer role:** external expert in public administration / public policy, commissioned-style pre-funding review.
**Object of review:** `/home/user/GovernmentTracker` (repository as the authority), data version `2026-08-14.1`.
**Date of review:** 14 Aug 2026.
**Written in English; quoted site wording kept in Hebrew.**

---

## 1. Verdict

This is the most methodologically self-aware Israeli budget-transparency artefact I have reviewed at the level of _process discipline_: the provenance chain, the refusal to impute, the separation of "the office did not say" from "our vocabulary did not cover it", and the 42 passing pre-deploy validations are genuinely better than what most funded civic-tech projects ship. I verified the hierarchy-sum identity, the 42/42 validation run and the 154 unit tests myself, and they hold.

But I would **not currently cite it for anything about how much a ministry spends, nor for any of its person-level or line-level "findings"** — and I would advise a journalist not to. Two failures are disqualifying as published: (a) the site displays the _regular budget section_ as "the ministry's budget" while silently excluding three further budget kinds, so the Transport Ministry appears with ₪0.62B against a true ₪38.1B (a factor of 62) and ranks 28th of 43; and (b) the deterministic "finding" layers contain systematic construct errors — 63% of published "late-night meetings" are all-day calendar markers timestamped `00:00` (fast days, staff leave, birthdays), and 76% of published "sharp year-over-year jump" findings disappear if you compare enacted-to-enacted budget instead of a year-end residual to a start-of-year allocation.

**Greatest strength:** the discipline of publishing what is _missing_ as a first-class datum, and the honesty audit that split the diary "opacity" measure from the site's own vocabulary gaps (`data/processed/diary-insights.json` `caveats[1]`) — that correction is the mark of a serious project.

**Greatest weakness:** the site measures _sections and calendar rows_ but labels them _ministries and meetings_. The construct gap is not disclosed where the numbers are, and in the finding layers it manufactures artefacts that read as impropriety against named people and named budget lines.

Fixable. Most of what follows is small-to-medium effort with high value-per-effort.

---

## 2. Factual or methodological errors

### 2.1 The "late-night meetings" measure counts all-day calendar markers — 63% of its output is artefact ★ most serious

**What is wrong.** `scripts/analyze-diaries.ts:400` counts an entry as a night meeting when `startHour >= 22 || startHour <= 5`. Hour `0` satisfies this. Diary rows with no real time are stored as `startTime: "00:00"`, and 4,463 of the 4,893 such rows also carry `endTime: "00:00"` — an unambiguous "no time recorded / all day" signature.

Across all 23 shards: **7,738 rows are flagged as late-night, of which 4,893 (63.2%) start at `00:xx`.** In `data/processed/diaries/sec-29.json` the hour histogram is `00:1053 01:5 02:1 03:1 04:2 05:2 06:2 07:9 08:99 09:521 10:607 …` — the 00:00 bucket is larger than any real working hour. Their actual subjects:

```
2023-01-03 | 00:00 | 00:00 | צום י' בטבת
2023-01-08 | 00:00 | 00:00 | גדי מארק בחופש
2023-01-19 | 00:00 | 00:00 | שילה אדלר בחופש
2023-01-23 | 00:00 | 00:00 | נתנאל לפידות במחלה
2023-01-27 | 00:00 | 00:00 | יום הזיכרון הבינלאומי לשואה
2023-02-06 | 00:00 | 00:00 | ט"ו בשבט
```

The most-flagged subjects in the 00:00 population site-wide are `מיכל ארן ביום קצר` (192), `נתנאל לפידות מסיים ב14:00` (97), `בחופש` (53), `יום הולדת ל***` (67), `פורים` (35).

**Why it matters.** The site publishes, against a named Director-General of the Housing Ministry, the finding **"984 רשומות שהחלו בשעות הלילה"** with the rule note _"שעה חריגה אינה פסולה, אך היא מסמנת פגישות שראוי לבדוק את הקשרן."_ 24.1% of that person's 4,088 entries are flagged. A reader is being invited to inspect the after-hours conduct of a named public servant on the basis of fast days and other people's vacation days. This is a false, name-attached, published behavioural claim — the single worst item on the site.

**Fix.** Treat `startTime === endTime` (and specifically `00:00`/`00:00`) as _no time recorded_: exclude from `lateNightCount`, from the marathon **span** rule, and from `longMeetingCount`. Report the excluded count openly. Effort: **small** (one predicate in `analyze-diaries.ts`).

### 2.2 The same artefact drives 70% of "marathon day" findings

Recomputing the span rule per person-day over all shards: 3,565 person-days satisfy the ≥14h span rule, and **2,508 of them (70.4%) have their earliest start before 01:00** — i.e. the span is measured from an all-day marker to a real afternoon meeting. `marathon_day` is the largest diary finding class (125 of 467). The "12+ entries" arm of the rule is sound; the span arm is not. Fix rides along with 2.1. Effort: **small**.

### 2.3 The "sharp year-over-year jump" rule compares incommensurable measures — 76% of its findings do not survive a like-for-like comparison ★ most serious

**What is wrong.** `scripts/lib/anomaly-rules.ts` compares `net_revised` in year _t_ to `net_revised` in year _t−1_. For a closed year, `net_revised` on a regulation is the _year-end_ budget after transfers out; for the open year (2026, mid-August) it is the _start-of-year_ allocation before any transfer has happened. Reserve and pass-through lines end a year near zero by design, then reappear at full value in January.

I re-ran the rule on `net_allocated` (enacted budget) for all 128 flagged codes via the Budget Key API. Of the 130 `yoy_jump` findings, **31 survive and 99 (76%) do not**. Worse, **21 findings flag a >3× jump on a line whose enacted budget moved less than 15%**:

| Line                                        | Site publishes                             | Enacted budget actually           |
| ------------------------------------------- | ------------------------------------------ | --------------------------------- |
| `0004510102` עבודה בלתי צמיתה               | "מ-1,705,000 ב-2025 ל-37,988,000 ב-2026"   | ₪37.74M → ₪37.99M (**+0.7%**)     |
| `0004530207` סוקרים לפי שעות                | "מ-420,000 ל-22,786,000"                   | ₪22.787M → ₪22.786M (**−0.004%**) |
| `0042010302` אשראי לצעירים יוצאי אתיופיה    | "מ-650,000 ל-44,650,000"                   | ₪44.65M → ₪44.65M (**identical**) |
| `0007800279` הפעלה - חרבות ברזל             | "מ-23,493,000 ב-2025 ל-100,000,000 ב-2026" | ₪103M → ₪100M (**−2.9%**)         |
| `0020700202` עתודה להסכם קואליציוני (חינוך) | "מ-4,039,000 ב-2024 ל-527,884,000 ב-2025"  | ₪983M → ₪917M (**−6.8%**)         |
| `0004700102` רזרבה ליעדים פיסקליים          | "מ-3,007,000 ל-77,513,000"                 | ₪62.2M → ₪77.5M (**+25%**)        |

**Why it matters.** The last row of that table is the point. A published claim that a coalition-agreement reserve inside the Education Ministry went from ₪4.0M to ₪527.9M is a story; the truth is that its enacted budget _fell_ 6.8%. The findings screen labels these `קפיצה חדה בין שנים` and glosses them _"תקציב התקנה השתנה בין שנתיים עוקבות בסדר גודל"_ — which is a factual claim the data does not support. Several of the affected lines carry politically charged names (`עתודה להסכם קואליציוני`, `תרבות יהודית`, `גרעינים משימתיים עירוניים`, `הפעלה - חרבות ברזל`). This is the clearest route by which the site could produce a false impression of impropriety.

**Fix.** Split into two rules with honest names: (i) **`enacted_jump`** on `net_allocated(t)` vs `net_allocated(t−1)` — "the budget the Knesset approved for this line changed by a factor of ≥3"; (ii) **`in_year_reinforcement`** on `net_revised − net_allocated` within a single year — "this line received ≥X during the year" (which is a _better_ finding than the current one and is currently missing at regulation level). Never compare `revised` across an open-year boundary. Effort: **small**.

### 2.4 Three budget kinds are excluded and only one is disclosed

`scripts/normalize-budget.ts:88` filters `budget_kind_code = '1'`. I queried Budget Key for FY2025 depth-1 by kind:

| Kind | Label                               | Original (₪B) | On the site?                                 |
| ---- | ----------------------------------- | ------------- | -------------------------------------------- |
| 1    | תקציב רגיל                          | 487.0         | **yes** — all 43 sections, verified complete |
| 2    | תקציב פיתוח                         | 52.7          | no — **disclosed**                           |
| 5    | מפעלים עסקיים                       | 95.2          | no — **not disclosed anywhere**              |
| 6    | החזר חובות (ריבית 56.2 + קרן 155.8) | 212.0         | no — **not disclosed anywhere**              |
| 7    | רזרבות (סעיף 0047 רזרבה כללית)      | 4.2           | no — **not disclosed anywhere**              |

The site's only exclusion note — README, `methodology.json` `budget-source`, `AboutPage.tsx:209`, `AnalysisPage.tsx:521` — names _only_ the development budget. A reader is therefore told that regular + development = the state budget. It is 63%.

This is not academic. Two concrete consequences:

- **Government hospitals** (`0094`, ₪25.3B in 2025), mental-health hospitals (`0093`, ₪3.0B) and geriatric hospitals (`0092`, ₪1.7B) are `budget_kind 5`. The Health Ministry's real domain spend is ~₪88.4B; the site shows ₪59.1B.
- **סעיף 0047 רזרבה כללית** (₪4.2B in 2025, ₪12.8B in 2026) is `budget_kind 7` and invisible — even though the findings screen publishes 328 Finance-Committee transfer requests, most of which read _"שימוש ברזרבה הכללית … להעברת סכום … מסעיף 47 - רזרבה כללית"_. The reader can see the withdrawals but not the account.

**Fix.** State all four exclusions with their FY totals wherever the exclusion is mentioned; collect kinds 2, 5, 6, 7 at depth 1 only, as a clearly separated "מה לא נכלל בתקציב הרגיל" panel with no attribution to ministries. Effort: **medium**.

### 2.5 "For transport in particular the development budget is significantly larger" understates by a factor of 60

`methodology.json` `budget-source`: _"עבור התחבורה בפרט, תקציב הפיתוח גדול משמעותית מהתקציב הרגיל"_. FY2025 actuals: section `0040` ₪617,993,000 vs section `0079` תחבורה ₪37,490,340,000. That is **61.7×**, not "significantly larger".

Computed for FY2025 across the sections whose domain mapping is uncontroversial by title:

| Domain                               | Site shows | Excluded | True    | Ratio     |
| ------------------------------------ | ---------- | -------- | ------- | --------- |
| תחבורה (0040 / 0079)                 | ₪0.62B     | ₪37.49B  | ₪38.11B | **×61.7** |
| בינוי ושיכון (0029 / 0042+0051+0070) | ₪0.34B     | ₪9.08B   | ₪9.42B  | **×28.1** |
| תיירות (0037 / 0078)                 | ₪0.17B     | ₪0.52B   | ₪0.70B  | ×4.0      |
| בריאות (0024 / 0067+0092+0093+0094)  | ₪59.15B    | ₪29.22B  | ₪88.36B | ×1.5      |
| חינוך (0020 / 0060)                  | ₪89.80B    | ₪2.38B   | ₪92.18B | ×1.03     |
| הגנת הסביבה (0026)                   | ₪0.37B     | —        | ₪0.37B  | ×1.0      |

**Why it matters.** `/#/ministry/transport` displays `תקציב מקורי 2026: 659.9M ₪` under the heading `סיכום תקציבי`, with **no caveat at all** — `coverage.json` shows `limitations: []` for `transport`, `education`, `health`, `sec-29` and `sec-6`. The budget table ranks Transport 28th of 43, below the Ministry of Religious Services. On the site's own numbers, the Israeli Ministry of Transport spends less than the Election Commission plus the President's Office. That is the most misleading number on the site, and it is on a landing page for the exact ministry the disclosure singles out.

**Fix (minimum, before any data work).** Put a per-section machine-generated caveat into `coverage.limitations` for every section that has a same-domain counterpart in kinds 2/5/6, naming the counterpart section, its code and its FY total, and render it in the existing `Callout tone="warning"` at `MinistryPage.tsx:160` and beside the `סיכום תקציבי` measures. Effort: **small**.

### 2.6 The exclusion rationale is weaker than stated

`normalize-budget.ts:15-18` and the methodology justify the exclusion as: _"סעיפי תקציב הפיתוח נקראים על שם התחום ולא על שם המשרד … ושיוכם למשרד אינו נגזר משם הסעיף"_. For `0060 חינוך`, `0067 בריאות`, `0078 תיירות`, `0079 תחבורה` this is a very thin claim — the mapping is no more inferential than `0038 כלכלה ותעשייה → משרד הכלכלה והתעשייה`, which the site _does_ make. And the source itself carries an official functional classification: `raw_budget.func_cls_title_1/2` gives `0079` → `תשתיות / תחבורה`. That is the Finance Ministry's own field taxonomy, not an inference, and it answers "what does the state spend on transport" properly. Not using it is a missed opportunity, not a rule violation — see proposal 5.4.

### 2.7 Two screens understate their own coverage (stale caveats)

- `FindingsPage.tsx` closing callout: _"כל הנתונים במסך זה … מכסים את התקציב הרגיל של חמשת המשרדים שנאספו בלבד"_. In fact `findings.json` has `suppliers`, `contractTotals`, `procurementMethods`, `notableContracts`, `supportRecipients`, `budgetChanges` keyed on **43** sections each, and `anomalies.json.scannedCounts` has **43** keys / 16,881 regulations.
- `AnalysisPage.tsx:521`: _"הניתוח חל על סעיפי התקציב הרגיל של חמשת המשרדים שנאספו בלבד"_. The official economic-classification layer and the volatility index cover all 43; only the theme layer covers five.

This is the mirror image of the other errors and equally damaging: a Knesset researcher reading these will discard 43 sections' worth of valid data. Effort to fix: **small** (scope the "five ministries" sentence to the theme layer only).

### 2.8 Stale methodology section published on the site

`methodology.json` → `links`: _"בגרסה זו נאספו רשומות תקציב אך לא נאספו פריטי פעילות, ולכן לא ניתן לבסס אף קשר ולא הוצג אף קשר."_ 2,386 activity items were collected. The true statement is that `activity-budget-links.json` is `[]` because no documented topic→section mapping has been authored. Published methodology should not assert a data state that the data version contradicts. Effort: **small**.

### 2.9 README limitation 6 contradicts the data by a factor of 6.6

_"רק 7 מתוך 50 מקורות אוחזרו עם checksum"_. `source-catalog.json`: 54 sources, `retrievalStatus: retrieved` = 46, `checksumSha256` present = 46, matching `data-version.json.counts`. The limitation is stale and undersells the project.

### 2.10 README misdescribes which non-ministry sections are covered

_"21 סעיפים שאינם משרד (הכנסת, בתי המשפט, ריבית, גמלאות, הוצאות שונות וכדומה)"_. Neither **בתי המשפט** nor **ריבית** is among the 43 collected sections (I listed all 43 from `ministries.json` and cross-checked against the Budget Key depth-1 set). `תשלום ריבית ועמלות` is section `0045`, `budget_kind 6`, ₪56.2B, not collected. Naming interest as covered directly reinforces the false impression of 2.4.

### 2.11 The "coverage %" callout produces a self-contradicting sentence above 100%

`AnalysisPage.tsx:230` renders, unconditionally, _"הסיווג מכסה {X}% מהתקציב המעודכן — היתרה טרם חולקה לתקנות מסווגות"_. Four sections exceed 100% in FY2026 (`sec-13` 110.9%, `sec-12` 105.0%, `sec-54` 104.3%, `sec-31` 101.3%), so the site publishes "the classification covers 110.9% … the remainder has not yet been allocated". Branch the wording and explain the >100% case (negative dedicated-income components at level 4). Effort: **small**.

### 2.12 About page labels 43 budget sections as "משרדים"

`AboutPage.tsx` counts table: `{ label: 'משרדים במאגר', value: 43 }`, `'משרדים עם נתוני תקציב': 43`. The site's own `sectionKind` split is 22 `ministry` / 21 `other`, and the home page states it correctly. Effort: **small**.

---

## 3. Misleading or unclear presentation

### 3.1 "Findings" whose thresholds sit at or below the median

Threshold audit against the 195 profiles in `diary-insights.json`:

| Rule                                             | Threshold                | Profiles meeting it                             | Median value | Max   |
| ------------------------------------------------ | ------------------------ | ----------------------------------------------- | ------------ | ----- |
| `weekend_meetings`                               | 3+                       | 125 / 195                                       | 6            | 228   |
| `late_night_meetings`                            | 3+                       | 116 / 195                                       | 7            | 984   |
| `double_booked`                                  | 5+                       | 126 / 195                                       | 29           | 2,789 |
| `marathon_day`                                   | 12+ entries or 14h span  | 125 profiles                                    | —            | —     |
| `opaque_diary`                                   | ≥50% opaque, 20+ entries | **0** (observed max 38.5%)                      | —            | —     |
| `private_sector_heavy`                           | ≥25%                     | **0**                                           | —            | —     |
| `supplier_meeting` / `support_recipient_meeting` | —                        | **0 findings** (149 rows sit in `crossMatches`) | —            | —     |

Two problems. First, calling a _below-median_ value a "finding" and attaching a person's name and a link to their diary implies exceptionality that the number does not carry — 90% of the 467 findings (`marathon_day` 125, `weekend_meetings` 102, `double_booked` 100, `late_night_meetings` 92) come from these four rules. Second, none of these is normalised by diary size: `lateNightCount` correlates with `entryCount` at r = 0.43 and `weekendCount` at r = 0.69, so the rules substantially rank _who published more rows_. Reranking by share changes the leaders materially (e.g. `מימון שמילה` 100/452 = 22.1% ranks 2nd by share but 12th by count, while an office with 3,029 entries and 356 night flags = 11.8% ranks 3rd by count).

**Also note:** the README claims _"467 ממצאים דטרמיניסטיים — לפי 10 כללים"_. Six rules fired; four produced nothing. `opaque_diary`'s threshold is set above the observed maximum, so it is a decorative rule. Publishing thresholds is good practice — but they should be _calibrated_ to the observed distribution and stated as such.

**Fix.** Express each of these as a share with a percentile, and set the finding threshold at a stated percentile of the observed distribution (e.g. top decile) rather than an absolute count. Effort: **small–medium**.

### 3.2 The diary transparency measure is conditional on publication, which inverts it

The `שקיפות היומן` ranking (`DiariesPage.tsx:185`) ranks the top 12 office-holders with ≥20 entries by `opacityPercent`. By construction it can only rank people who published. The **Ministry of Health published 7 diary datasets from which the pipeline extracted 0 rows** (all 7 have `machineReadableEntries: 0`; there is no `data/processed/diaries/health.json`), so the Health Minister and Director-General appear in no measure, no ranking and no finding at all. Offices that published nothing are likewise invisible. The most opaque behaviour available to an office — not publishing — scores as absence, while an office that published a detailed diary with some `פגישה` rows appears at the top of a screen headed _"מי כותב במה עסק"_.

The site's caveat _"היעדר יומן אינו היעדר פעילות"_ addresses the wrong direction of the bias. What is needed is the complement: a **publication-compliance grid** (ministry × quarter 2023Q1–2026Q2, from `diaries-index.json` alone, no new sources), so the reader sees who never published next to who published opaquely. Effort: **small–medium**; this is the single highest-value addition on the diaries screen.

### 3.3 A third of the opacity numerator is arguably not opacity

I enumerated the 48 distinct subjects in the `unspecified` category (the sole input to the transparency measure). The largest are `פרטי` (571), `סגור` (418), `אישי` (351), `פגישה` (250), `פ.ע.` (247), `מנהלי` (244), `פגישה אישית` (56), `צד ג'` (51). Roughly 1,050 of 3,136 rows are either **explicit private-time markers** or **calendar blocks** (`סגור`) or **required third-party redactions** (`צד ג'`) — i.e. correct application of the diary procedure's privacy rules, or not meetings at all. Meanwhile `בחופש` lands in the separate `personal_private` category and is _not_ counted. The same phenomenon is treated two ways.

Given how carefully the team separated the _other_ two non-opacity buckets, this is an inconsistency rather than a philosophy. Split `unspecified` into `private_marked` / `calendar_block` / `generic_or_redacted`, and compute the transparency measure on the last only. Effort: **small**.

### 3.4 "71.5% סווגו לנושא" over-claims policy content

`totals.classifiedPercent = 71.5`. But the categories counted as content include `internal_management` 9.36%, `personal_private` 6.00%, `travel_logistics` 5.96%, `media_pr` 4.37%, `ceremonies` 3.55%, `calendar_admin` 1.29%, `holidays_calendar` 1.05% — about **31.6% of all rows**, i.e. **44% of the "classified" mass**, is calendar logistics, personal time, travel, ceremony and holidays rather than any policy subject. The KPI card reads `סווגו לנושא: 71.5%`, and the README goes further: _"71.5% מהרשומות סווגו לנושא תוכן ממשי"_. Add a second figure — _"מהן X% נושא מדיניות"_ — with the logistics/personal/ceremonial categories flagged in the taxonomy. Effort: **small** (a boolean per category in the seed + one derived total).

Separately, publishing a per-office-holder `אישי ופרטי` share (13,377 rows site-wide) is a privacy-adjacent measure with no policy value. I would drop it from the per-person topic mix and keep it only in the aggregate.

### 3.5 The volatility index is not comparable across sections, and is displayed as a league table

`volatilityIndex` = Σ|revised − original| ÷ Σ|original| over **level-3 leaves**. The number of level-3 leaves per section in FY2025 ranges from **1** (`sec-21` ההשכלה הגבוהה, `sec-31`, `sec-35`) to **33** (`sec-4` משרד ראש הממשלה). A section with one leaf can only register its _net_ change; a section with 33 leaves accumulates _gross_ churn including offsetting internal transfers. The index therefore partly measures how finely the budget book decomposes a section, and `AnalysisPage.tsx:469-499` renders all 43 as a descending ranking — with `sec-37 משרד התיירות` at **652.5%** on 6 leaves at the top.

To the team's credit, the card shows `{leafCount} תוכניות` and the note _"הוא מודד תנועה, לא איכות"_. That is not enough: the reader has no way to know the metric is granularity-confounded. Either (a) compute it at a fixed hierarchy level for all sections, or (b) publish it alongside a net-change-only variant (|Σrevised − Σoriginal| ÷ Σoriginal), which _is_ comparable, and show both. Effort: **small**.

Tourism is a real story, incidentally, and the screen surfaces it well: line `00370208 הכשרת כח אדם ושירותי` went ₪18.45M → ₪1,008.8M in 2025. Worth noting that the _title_ of that line no longer describes what the money does — a caution for the theme layer, which classifies from titles alone.

### 3.6 "פריטי פעילות" is not comparable across ministries, and the censoring is documented but not published

The per-ministry activity counts (`coverage.json`, rendered as a KPI on `MinistryPage.tsx` and on the home page) are:

`sec-4` 400 · `sec-5` 200 · `sec-34` 200 · `sec-39` 200 · `transport` 200 · `sec-68` 200 · `health` 199 · … · `education` **1** · `sec-9` **1** · `sec-8`/`sec-15`/`sec-11` **0**

Six sections sit exactly at the cap. `activity-collection-notes.json` records that the cap is 200 per feed per ministry and that **`transport:publications` lost 5,191 older items and `sec-4:decisions` lost 3,336**, plus **44 unattributed publishing units** including `רשות מקרקעי ישראל` (2,735 items). So the Education Ministry's `1` and the Transport Ministry's `200` differ by an artefact of censoring at 200 and of publisher-name matching, not by anything about the ministries.

**Critically, `activity-collection-notes.json` and `budget-collection-notes.json` are never loaded by the application** (`src/data/datasets.ts` imports 18 files; neither is among them). The README claims _"והחיתוך מדווח"_ and _"מפרסמים שלא זוהו נספרים ומדווחים במתודולוגיה"_, and `methodology.json` says unmatched units _"נרשמות ביומן האיסוף"_ — a log the site does not surface. The disclosure the project believes it makes, it does not make.

Beyond disclosure: **a right-censored count is not a comparable measure and should not be displayed as one.** Either raise the cap and report actual totals, or replace the KPI with "≥200 (נחתך)" and remove activity counts from any side-by-side display. Effort: **small** for the honest label, **medium** to recollect uncapped.

### 3.7 "54 מקורות רשמיים בקטלוג · 46 אוחזרו עם checksum" oversells the evidentiary base

All **2,725** budget records cite `next.obudget.org` — the single source the catalogue itself marks `secondary_helper`. The 39 Knesset sources and 4 State Comptroller sources are catalogued, retrieved and checksummed but contribute to **no displayed figure** (limitation 5 explains why: no PDF/XLSX parsing). Meanwhile 51 of 54 catalogue entries carry `reliabilityLevel: primary_official`. The site is scrupulous about labelling Budget Key a helper layer in prose, but the headline source count invites the reader to infer an official evidentiary base that does not exist behind any number. Suggest a one-line derived statistic: _"מספר הנתונים המוצגים שמקורם בקטלוג הרשמי: 0 מ-2,725"_ — uncomfortable, and exactly the kind of honesty this project already practises elsewhere.

### 3.8 Cross-references pair a person's diary row with a large sum

`crossMatches[0]`: subject _"הצעת תקנות המועצה לענף הלול (פיצוי לבעלי הלולים)"_ → matched `המועצה לענף הלול` → **₪520,413,850** labelled `סך תמיכות שאושרו (מ-2023)`. That row is a _draft regulation about_ the council, not a meeting with it. The column header `סכום במאגר` beside a dated diary row does innuendo work that the caveat text cannot undo. The most frequent matches are routine governance counterparties (`סוכנות היהודית` 43, `עירית ירושלים` 18). To the team's credit the table is filtered by section, not by person, and the person's name is not a column. I would still (a) rename the column to state plainly that the sum is the _entity's_ total with the ministry and is unrelated to the meeting, and (b) suppress the match where the subject is a legislative/regulatory item naming the body rather than a meeting with it. Effort: **small**.

---

## 4. What is missing

### 4.1 No normalisation of any kind — this is the largest gap for a policy audience

There is no per-capita figure, no share-of-total-budget figure, no real-terms figure, and no per-beneficiary figure anywhere. `grep` for `לנפש`, `ריאלי`, `מחירים קבועים`, `נומינלי`, `אינפלציה`, `מדד המחירים` returns nothing in `src/`, `methodology.json` or the README.

Consequences: the multi-year trend line runs ₪380.0B (2023) → ₪472.5B (2024) → ₪487.0B (2025) → ₪544.4B (2026) original budget, labelled `מגמה רב-שנתית`, with no indication that these are **nominal** and that a large part of the +43% is war spending and price level, not policy. A reader cannot tell a policy shift from an accounting artefact — which is precisely the question the site exists to answer.

Buildable inside the constraints:

- **Share of total** — free, already in the data (each section ÷ the 43-section total, per year). Highest value per unit of effort on the whole site.
- **Real terms** — needs one public CPI series (CBS / data.gov.il), stored as a seed with source and collection date, applied as a declared deflator with the nominal figure always shown alongside. Fully within the constraints.
- **Per capita** — needs one public population series (CBS). Cheap, and it is the normalisation a foundation audience expects.

### 4.2 No fiscal-year context, so the reader cannot tell policy from calendar

FY2023–2026 is an extraordinary window and the site treats the four years as interchangeable columns. Nowhere does it say that:

- 2023 and 2024 were enacted **together** as a biennial budget in May 2023 — so a 2023→2024 "change" is largely a single decision, not two;
- the FY2025 budget was approved only in **late March 2025**, meaning the first quarter ran on a continuing budget (1/12 rules) — which distorts both execution rate and the meaning of "תקציב מקורי" for that year;
- 2024 carried **war supplementary budgets**, so `updatedBudget − originalBudget` in that year is dominated by Knesset-approved supplements, not administrative transfers.

The methodology's `measures` section defines `תקציב מעודכן` generically as _"התקציב לאחר העברות, תוספות וקיצוצים"_ and never distinguishes a **Knesset-approved supplementary budget** from a **Finance Committee s.11 transfer** from an **administrative s.12 movement**. These have completely different accountability meanings, and conflating them is what makes the volatility index and the shift lists hard to interpret.

A short, sourced "מה קרה בכל שנת תקציב" panel — four paragraphs, each citing the enacting law and the Knesset page — would do more for interpretability than any new dataset. Effort: **small** (seed file + one component). This is my second-highest-value proposal.

### 4.3 The regulation-level in-year reinforcement finding

The site has section-level "large shifts" and the _wrong_ version of a regulation-level year-over-year rule (2.3). The genuinely valuable finding — _which individual regulations received large in-year reinforcement, and from where_ — is absent, even though both inputs exist (`net_revised − net_allocated` at depth 4, and the 328 Finance-Committee requests with their official explanatory text in `findings.budgetChanges`). Linking a reinforced regulation to the transfer request that reinforced it would be the strongest accountability artefact on the site. Effort: **medium**.

### 4.4 Functional classification (what the state spends on a field)

`raw_budget.func_cls_title_1/2` is the Finance Ministry's own field taxonomy (`0079` → `תשתיות / תחבורה`). It spans all budget kinds, requires no inference and no model, and directly answers the question the section-based view cannot. This would also let the site keep its "no attribution by inference" rule intact while still telling the reader what the state spends on transport. Effort: **medium**. High value.

### 4.5 Machine-readable exports that a policy analyst will immediately want

`data/processed/csv/` covers budget, anomalies, usage, themes, suppliers, sources, coverage, activities. Missing: **diary profiles** (the 195 rows with the opacity and time measures), **diary findings** (467), **cross-matches** (149), **budget transfers** (`findings.budgetChanges`, 328 with explanatory text), **support recipients**. The screens offer filtered downloads, but there is no stable full-dataset URL to cite in a paper or load into R. Also missing at the repository level: a data dictionary mapping every field to its `measureType`, unit, and source query. Effort: **small**.

### 4.6 What is _not_ buildable inside the constraints — say so plainly

- **Outputs and outcomes.** Nothing here measures whether anything was delivered. Execution rate measures _disbursement against an amended plan_, which is close to an accounting tautology (national execution ran 94.5–95.6% in 2023–2025) and says nothing about delivery. The site should not attempt an outcome layer, and should state clearly on the budget screen that execution rate is not a delivery measure.
- **Minister tenure dates.** Correctly not inferred (`minister-tenures.json` = `[]`). But a _hand-authored seed with a source URL per row_, treated exactly like `ministries.seed.json`, is inside the project's own rules and would unlock time-slicing every measure by who held the office. The current position — that the page is not machine-retrievable, therefore no dates exist — over-applies the automation constraint to a 30-row table.
- **Final execution figures.** Correctly out of reach; the "never labelled final" discipline is right and should stay.
- **Ministries without a budget section** (ירושלים ומסורת, התפוצות, שוויון חברתי, מורשת, הנגב והגליל…). Cannot be given a budget line. But they can be given a **stub page** stating which section funds them and linking to that section — better than being absent, given the site is titled "מפת הממשלה".

---

## 5. Prioritised proposals

Ordered by value per unit of effort.

| #      | Proposal                                                                                                                                                                                                                                                                                                                                                                       | Effort           | Benefit                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | **Treat `startTime === endTime` (esp. `00:00`) as "no time recorded."** Exclude from `lateNightCount`, `longMeetingCount` and the marathon **span** rule; publish the excluded count.                                                                                                                                                                                          | **Small**        | Removes 63% of `late_night_meetings` and 70% of span-driven `marathon_day` findings, which are currently false claims about named individuals. Highest-severity fix on the site.                                              |
| **2**  | **Split `yoy_jump` into `enacted_jump` (allocated↔allocated) and `in_year_reinforcement` (revised−allocated within a year); never cross an open-year boundary on `revised`.**                                                                                                                                                                                                  | **Small**        | Removes 99 of 130 non-surviving findings, including 21 that claim >3× jumps on lines whose enacted budget moved <15%. Eliminates the site's clearest route to a false impression of impropriety, and _adds_ a better finding. |
| **3**  | **Per-section budget-scope caveat, rendered at the numbers.** Machine-generate a `coverage.limitations` entry for every section with a same-domain counterpart in kinds 2/5/6/7, naming the counterpart code and its FY total; render at `MinistryPage` `סיכום תקציבי` and on `BudgetPage`. Fix the exclusion sentence everywhere to list all four excluded kinds with totals. | **Small**        | Stops `/#/ministry/transport` from presenting ₪0.62B as the ministry's budget when the true figure is ₪38.1B (×61.7), and housing ₪0.34B vs ₪9.42B (×28.1).                                                                   |
| **4**  | **Share-of-total normalisation + a nominal-terms label** on every multi-year series and every cross-section comparison.                                                                                                                                                                                                                                                        | **Small**        | The single cheapest thing that makes cross-ministry and cross-year comparison legitimate. Requires no new data.                                                                                                               |
| **5**  | **A sourced "מה קרה בכל שנת תקציב" panel** (biennial 2023–24; continuing budget Jan–Mar 2025; war supplementaries in 2024), plus a methodology distinction between supplementary budget / s.11 committee transfer / s.12 administrative movement.                                                                                                                              | **Small**        | Lets a reader separate a policy shift from an accounting artefact — the site's core promise for this window.                                                                                                                  |
| **6**  | **Fix the stale caveats and stale text:** the "five ministries" scope on `FindingsPage` and `AnalysisPage` (actual: 43); `methodology.json` `links`; README limitation 6 (7/50 → 46/54); README's non-ministry examples (`בתי המשפט`, `ריבית` are not collected); `AboutPage` "משרדים: 43" → sections; the >100% coverage sentence.                                            | **Small**        | Six published statements the data contradicts. Cheap, and errors of this class are what a hostile reader will lead with.                                                                                                      |
| **7**  | **Surface the activity-collection notes and relabel censored counts** (`≥200 (נחתך)`), load `activity-collection-notes.json` into the app, and show the 44 unattributed publishers and the 5,191/3,336 truncations.                                                                                                                                                            | **Small**        | Closes the gap between the disclosure the project claims and the disclosure it makes; stops `education: 1` vs `transport: 200` being read as a fact about the ministries.                                                     |
| **8**  | **Recalibrate the diary finding thresholds to the observed distribution and normalise by diary size** (share + percentile, threshold at a stated percentile). Retire or re-threshold `opaque_diary` (currently unreachable) and `private_sector_heavy`.                                                                                                                        | **Small–medium** | Stops below-median behaviour being published as a named "finding"; makes 90% of the 467 findings interpretable.                                                                                                               |
| **9**  | **Publication-compliance grid** (ministry × quarter, from `diaries-index.json`), foregrounding that the Health Ministry's 7 publications yielded 0 rows and that non-publishers are absent from every measure.                                                                                                                                                                 | **Small–medium** | Corrects the inversion in the transparency measure: non-publication currently scores as absence rather than as opacity.                                                                                                       |
| **10** | **Split `unspecified` into `private_marked` / `calendar_block` / `generic_or_redacted`**, compute transparency on the last only; add an `isPolicySubject` flag per category and publish a second headline alongside the 71.5%.                                                                                                                                                 | **Small**        | Removes ~1,050 correctly-private rows from the opacity numerator; stops 44% of the "classified" mass (logistics, personal, ceremony) being read as policy content.                                                            |
| **11** | **Collect budget kinds 2, 5, 6, 7 at depth 1 only**, as a clearly separated "מה לא נכלל בתקציב הרגיל" panel, with no ministry attribution.                                                                                                                                                                                                                                     | **Medium**       | Makes the ₪851B expenditure picture visible instead of ₪487B, and makes the general reserve (`0047`) visible next to the 328 transfers drawn from it.                                                                         |
| **12** | **Functional-classification view** from `func_cls_title_1/2` across all budget kinds.                                                                                                                                                                                                                                                                                          | **Medium**       | Answers "what does the state spend on transport / health / education" using the Finance Ministry's own taxonomy — no inference, no model, no constraint violation.                                                            |
| **13** | **Regulation-level in-year reinforcement, joined to the Finance Committee request that caused it** (both inputs already collected).                                                                                                                                                                                                                                            | **Medium**       | The strongest accountability artefact available inside the constraints.                                                                                                                                                       |
| **14** | **Complete the CSV/data-dictionary layer**: full exports for diary profiles, diary findings, cross-matches, budget transfers, support recipients; a field-level data dictionary with measure type, unit and source query.                                                                                                                                                      | **Small**        | Makes the site citable and reusable by analysts, which is the difference between a dashboard and infrastructure.                                                                                                              |
| **15** | **Hand-authored minister/DG tenure seed with a source URL per row**, treated like `ministries.seed.json`; and stub pages for ministries without a budget section.                                                                                                                                                                                                              | **Medium**       | Unlocks time-slicing by office-holder — the missing spine of a "government map" — without violating any collection rule.                                                                                                      |

Also worth stating plainly on the budget screen: **execution rate is a disbursement measure, not a delivery measure.** At 94.5–95.6% nationally it carries almost no signal about whether anything was delivered, and a policy reader will otherwise read it as performance.

---

## 6. What I checked

**Read in full or in substantial part:** `README.md`; `data/processed/methodology.json` (all 12 sections); `src/pages/BudgetPage.tsx`, `AnalysisPage.tsx`, `FindingsPage.tsx`, `DiariesPage.tsx`, `ActivityPage.tsx`, `HomePage.tsx`, `MinistryPage.tsx`, `AboutPage.tsx`; `src/lib/analysis.ts`, `src/lib/budgetSeries.ts`, `src/lib/calc.ts` (aggregation and threshold sections); `src/data/datasets.ts`; `scripts/normalize-budget.ts`, `scripts/scan-anomalies.ts`, `scripts/lib/anomaly-rules.ts`, and the profile/threshold/rule sections of `scripts/analyze-diaries.ts`.

**Data files inspected programmatically:** `budget-items.json` (2,725 records), `ministries.json` (43), `coverage.json` (43), `source-catalog.json` (54), `anomalies.json` (820 findings, 16,881 regulations, `scannedCounts`), `findings.json` (all 7 keyed objects, 328 transfers), `usage-breakdown.json` (172 coverage rows), `diary-insights.json` (195 profiles, 467 findings, 149 cross-matches, thresholds, caveats, category totals), `diary-categories.json`, `diaries-index.json` (562 datasets), all 23 shards in `data/processed/diaries/` (223,032 rows), `data-version.json`, `activity-collection-notes.json`, `activity-evidence.json` (host distribution).

**Independently reproduced:**

- Hierarchy-sum identity — leaf sum equals the level-1 parent for **every section × year × measure** (0 mismatches on original, updated and executed).
- Section coverage — the 43 collected codes are exactly the Budget Key `budget_kind_code='1'`, `depth=1`, `is_proposal=false` set for FY2025 (verified against the live API). The coverage claim is true _for that definition_.
- 48 execution-rate outliers, all 48 carrying the `חריגה:` marker.
- `npx tsx scripts/validate-data.ts` → **42/42 checks pass**. `npx vitest run` → **154/154 tests pass**. Both claims accurate.
- Transport FY2025 original = ₪617,993,000, matching the README's sanity check.
- Rule-by-rule recomputation of `yoy_jump` on `net_allocated` for all 128 flagged codes (31 survive / 99 do not / 21 with <15% enacted change).
- Hour histograms and 00:00 signature across all diary shards; person-day recomputation of the marathon span rule; Pearson correlations of `lateNightCount` / `weekendCount` / `doubleBookedCount` against `entryCount`; enumeration of all 48 distinct `unspecified` subjects.
- Volatility index recomputed per section for FY2025 alongside leaf counts (range 1–33 leaves).
- Budget-kind totals for FY2025 and per-section development/enterprise/debt/reserve figures for FY2023–2026, via the Budget Key API.
- HTTP status of two sampled `gov.il` activity links (both 301, i.e. resolving).

**Not checked.** I did not run the live site or the Playwright suite, so I judged wording and layout from the JSX rather than from rendered pages; visual hierarchy and mobile behaviour are outside this review. I did not read `collect-diaries.ts`, `collect-findings.ts`, `collect-activities.ts`, `build-data.ts` or the expert-vocabulary merge in detail, so I have not audited the extraction or the 1,878-keyword vocabulary itself — only its outputs. I did not verify supplier or support-recipient figures against Accountant-General or support-database sources. I did not verify any Knesset budget-book PDF against the site's figures, since no displayed figure derives from one. I did not attempt to reconcile the site's figures with official closed-year execution reports; that reconciliation is the obvious next audit and would test the "partial, never final" labelling in the only way that matters.

**One figure I could not reproduce, stated as a finding:** README limitation 6's _"רק 7 מתוך 50 מקורות אוחזרו עם checksum"_ is not reproducible from any file in the repository; every artefact says 46 of 54.
