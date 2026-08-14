# External reviews of this site, and what came of them

Three outside reviewers were commissioned to examine the published content: an
expert in public administration and policy, a public-transparency reviewer of the
kind a government-watchdog organisation would send, and a former member of the
Knesset. Each was given the same brief (`BRIEF.md`), the repository, and the
instruction to check figures against the data files rather than trust the prose.
Their reports are stored here in full, unedited — including the parts this project
has not acted on, and the parts it disputes.

The reports were produced with a language model at review time. That does not
make them authority: every claim below was re-checked against the collected rows
before anything was changed, and one claim did not survive that check.

## Acted on

| Finding                                                                                                                                                            | Where it was fixed                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 64% of published "night meetings" were all-day calendar markers written as 00:00 — one named official was credited with 984 midnight meetings, 943 of them markers | `hasUsableClockTime` in `scripts/analyze-diaries.ts`                                             |
| The weekend rule counted prayers, meals, travel and 71 OCR'd table headers as meetings, aimed at religious office-holders                                          | `isMeetingRow` in `scripts/analyze-diaries.ts`                                                   |
| The publication-gap rule blamed offices for diaries this site could not read — three published 2025 files, all refused, reported as the minister's gap             | `publishedQuartersOf` in `scripts/analyze-diaries.ts`                                            |
| The year-over-year budget rule compared a post-transfer residual to a fresh allocation, publishing "₪1M → ₪63.5M" on a line whose allocation barely moved          | `enacted_jump` / `in_year_reinforcement` in `scripts/lib/anomaly-rules.ts`                       |
| Minister tenures were declared uncollectable; the Knesset publishes them in an open OData service                                                                  | `scripts/collect-minister-tenures.ts`                                                            |
| The README claimed every row carried the archive address it was read from; no row did                                                                              | `scripts/backfill-diary-archive-provenance.ts`, and the collector now records it per publication |
| The methodology page read "there is no budget data on the site: 2,725 budget records were collected"                                                               | `src/pages/MethodologyPage.tsx`                                                                  |
| Only the development budget was disclosed as excluded; business enterprises, debt service and the general reserve were not mentioned                               | `scripts/build-data.ts`, README                                                                  |

## Disputed

One reviewer reported that 67 rows are freedom-of-information redaction notices
under §9(a)(3). There are three. The reviewer was reading the rare-subject sample
rather than the corpus, and no rule was built for three rows.

## Open — recommended and not yet done

- **A ministry that published is shown as one that did not.** Sections whose
  publications all failed to parse never appear in the diaries selector at all
  (Health published seven diaries; six were refused, one was a legacy XLS).
  "Published but unreadable by us" needs to be a first-class state.
- **Tenure-aware measures.** The tenure data now exists but no diary measure or
  budget chart uses it, so a quarter is still attributed to whoever holds the
  office now.
- **The transparency measure may now understate opacity.** An office writing
  "פ.ע מנכ״ל" is arguably being opaque, and the site files that under "a meeting
  with no stated subject" (14.5%) rather than under the transparency measure
  (1.4%). This is an editorial decision, not a defect.
- **No normalisation of any kind.** No per-capita, no share-of-total, and the
  multi-year trend is unlabelled nominal.
- **Anomaly findings include lawful budget mechanics** — reserves, commitment
  authority, earmarked-revenue lines — and are not joined to the Finance
  Committee transfer that explains them.
- **Findings scale with how much a person published**, which means the site
  attaches more adverse-looking items to whoever published more fully. This
  should be disclosed on the screen.
- **No operator identity, right of reply, or corrections log**, on a site that
  publishes measures against named individuals.
