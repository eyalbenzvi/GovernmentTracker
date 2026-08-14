# Brief for the external reviewers

You are reviewing a live public transparency dashboard, as an outside expert. You were not
involved in building it. Your job is to judge what it publishes, say where it is wrong,
weak or misleading, and propose specific improvements.

## What the site is

**מפת הממשלה — פעילות, תקציב וביצוע** — a Hebrew, right-to-left, static public dashboard on
Israeli government ministries during the 37th government (from 29 Dec 2022), fiscal years
2023–2026.

Live: https://eyalbenzvi.github.io/GovernmentTracker/
Repository: /home/user/GovernmentTracker (read it; it is the authority, not this brief)

Screens: home, ministry pages, budget, analysis (where the money goes), findings (suppliers,
support recipients, mid-year transfers, anomaly scan), diaries (ministers'/deputies'/DGs'
published meeting diaries), sources catalogue, methodology, about.

## Hard constraints — proposals that violate these cannot be built

1. **No backend.** GitHub Pages only: static files, no server, no database, no login, no API
   keys. Everything is computed at build time.
2. **No network calls at runtime.** The published page loads only static files from its own
   origin.
3. **No language model at runtime.** Classification in the live site is deterministic
   keyword matching from a stored vocabulary. A model may be used at build time, and when it
   is, its output is stored in full with reasoning and confidence.
4. **No fabricated data, ever.** A missing figure is shown as missing. Every displayed number
   carries measure type, year, source URL and collection date.
5. Budget figures come from Budget Key (מפתח התקציב), a public mirror of Finance Ministry
   data — treated as a helper layer, never as authoritative, so nothing is ever labelled
   "final execution".
6. Sources that refuse automated clients (gov.il, foi.gov.il) are not impersonated. Where a
   repository refuses file downloads, files are read from a public web archive copy and each
   row records the copy it was read from.

## Where to look

Read the repository directly. The most informative paths:

- `README.md` — what the project claims, its data state table, and its declared limitations.
- `src/pages/*.tsx` — exactly what each screen shows and how it is worded. The wording is
  part of what you are reviewing.
- `data/processed/methodology.json` — the methodology text published on the site.
- `data/processed/*.json` — the actual data. Check the numbers rather than trusting prose.
  `diary-insights.json` holds the diary measures, findings and cross-references;
  `diary-categories.json` the taxonomy and its counts; `anomalies.json` the budget anomaly
  rules and findings; `findings.json` suppliers, support recipients and transfers;
  `coverage.json` per-ministry coverage; `source-catalog.json` every source with its
  retrieval status.
- `data/raw/seeds/` — the hand-authored and model-authored inputs, including
  `diary-categories.seed.json` (classification vocabulary with per-keyword confidence) and
  `diary-experts/` (five domain experts' proposals, stored verbatim, plus the merge report).
- `scripts/` — how each figure is produced. `analyze-diaries.ts` has the diary rules and
  thresholds; `scan-anomalies.ts` the budget anomaly rules; `validate-data.ts` the 42 checks
  that must pass before deployment.

## Current state, so you review the real thing

- 43 budget sections (22 ministries + 21 non-ministry sections), 2,725 budget records
  (FY 2023–2026, hierarchy levels 1–3), 2,386 public activity items across 21 ministries.
- 223,032 diary rows from 349 of 562 publications, extracted four ways (structured API,
  spreadsheet, PDF text layer, OCR of scans) with the method recorded per row.
- Diary subjects: 71.5% classified to a content topic; 16.6% state that a meeting happened
  or with whom but not about what; 9.6% have real text the vocabulary does not cover; 1.4%
  generic or redacted text (this, and only this, is the published "diary transparency"
  measure); 0.9% no subject text at all.
- 195 office-holder profiles, 467 deterministic findings across 10 published rules, 149
  cross-references between diary subjects and suppliers/support recipients.
- 54 catalogued sources, 46 retrieved with a checksum, 8 refused by the source and marked so.
- Minister tenure dates are **not** collected (0 records) — the source is not accessible to
  automated collection and dates are not inferred.

## What your review must contain

Write a markdown report. Be specific and cite file paths, figures or wording. Structure it:

1. **Verdict** — 3–5 sentences. Would you, in your professional role, rely on this site or
   cite it? What is its single greatest strength and its single greatest weakness?
2. **Factual or methodological errors** — anything that is wrong, or that a reader would
   reasonably read as a claim the data does not support. Highest priority. For each: what is
   wrong, where, why it matters, and the fix.
3. **Misleading or unclear presentation** — where the number is right but the framing,
   wording or emphasis would mislead a journalist, a citizen or a Knesset researcher.
4. **What is missing** — content, comparisons or context that a site with these goals ought
   to have. Say what is high-value and buildable inside the constraints, and be explicit when
   something valuable is _not_ buildable.
5. **Prioritised proposals** — a numbered list, each with the effort you estimate (small /
   medium / large) and the benefit. Put the highest value-per-effort first.
6. **What you checked** — say what you actually opened and verified, so the team knows the
   coverage of your review. Do not claim to have checked what you did not.

Be a critical reviewer, not a flatterer. If something is genuinely well done, say it once
and briefly, then spend your effort on what should change. If you find a figure you cannot
reproduce from the data files, say so explicitly — that is a finding in itself.

Write in Hebrew or English, whichever you prefer; the team reads both. Do not modify any
file in the repository — your only write is your own report file.
