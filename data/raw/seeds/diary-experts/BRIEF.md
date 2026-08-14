# Brief for the diary-subject classification experts

## What this is

A public Hebrew transparency dashboard publishes 223,032 diary entries of Israeli
ministers, deputy ministers and directors-general (37th government). Each entry has a
subject line as the office wrote it. We classify each subject into one content category.

**42.1% is classified today. The goal is at least 90%.**

## Non-negotiable constraints

1. **The published site runs no language model.** You are producing a *vocabulary*: keywords
   and the category each implies. At build time a deterministic matcher applies it. Your
   output is data, stored in full with your reasoning, and auditable by any reader.
2. **Never guess.** If a subject genuinely does not say what the meeting was about, it must
   stay unclassified. Inflating coverage by guessing would destroy the site's value. Mark
   your real confidence honestly.
3. **A category is not a judgement.** "Private sector" is not an allegation of a conflict of
   interest.

## How matching works — this determines what a useful keyword looks like

A keyword matches only as a **whole Hebrew word**:

- Before it, only Hebrew's one-letter proclitics are allowed (ו, ה, ב, ל, כ, מ, ש). So the
  keyword `כנסת` matches "בכנסת" and "ולכנסת".
- After it, **a Hebrew letter is not allowed**. So `ועד` does NOT match "ועדה" or "ועדת",
  and `תקציב` does NOT match "תקציבים".
- **Therefore: list every inflected form you want matched, explicitly.** There is no
  morphological analysis. `ועדה`, `ועדת`, `ועדות` are three separate keywords.
- Multi-word keywords are fine and are preferred when a single word is ambiguous.
- A keyword ending in a space + one letter (e.g. `ביקור ב`) is treated as an attaching
  prefix and may match the word that follows.

**Longest match wins**, so a specific multi-word keyword always beats a short generic one.

### The trap that already cost us 21,173 misclassifications

Hebrew words contain each other. `נסיעה` (a trip) contains `סיעה` (a party faction);
`הכנסות` and `התכנסות` contain `כנס`; `חברתי` contains `חברת`. The whole-word rule fixes
these, but you must still avoid short keywords that are legitimately whole words in another
sense. `שר` matches "בשר". `ספק` matches "הספק". When a word is ambiguous, either use a
multi-word form or mark it `low` confidence.

## Reaching 90% requires generalisation, not a lookup table

**22.4% of all rows are a subject that appears exactly once.** Mapping frequent subjects
one by one cannot reach the goal. What generalises:

- **Named entities in your domain** — countries, courts, parties, outlets, regulators,
  organisations, common titles. A subject seen once, "פגישה עם שגריר צ'ילה", is caught by
  `שגריר`.
- **Domain terms and their inflections** — `עתירה`, `עתירות`, `עותרים`.
- **Abbreviations and acronyms as actually written** — Israeli diaries are full of them
  (`בג"ץ`, `ח"כ`, `מל"ל`, `רה"מ`, `פ.ע`). Note quotes vary: `"` and `״` are normalised to
  `"` before matching, so write them with a straight `"`.
- **Common role titles** — `שגריר`, `רב`, `ראש עיריית`, `יו"ר דירקטוריון`.

## Your inputs (read these files)

- `head.tsv` — every subject appearing 3+ times: `count<TAB>subject`. 6,611 distinct
  subjects covering 40,573 rows. Read all of it.
- `tail-sample.txt` — a deterministic sample of 2,500 rare subjects (1–2 occurrences).
  This is where you learn what generalises. Read all of it.
- `taxonomy.json` — the 18 existing categories, with example keywords and current counts.

Note: some rows come from OCR of scans and carry mangled text, RTL control characters or
embedded dates/times. Do not build vocabulary from the noise; treat those as unclassifiable.

## Your output

Write **one JSON file** to the path given in your task, exactly this shape:

```json
{
  "expert": "<your domain id>",
  "summary": "<2-4 sentences in Hebrew: what you saw in the data and your approach>",
  "keywords": [
    {
      "keyword": "בג\"ץ",
      "categoryId": "legal_judicial",
      "confidence": "high",
      "reasoning": "<short Hebrew justification>"
    }
  ],
  "proposedCategories": [
    {
      "id": "legal_judicial",
      "labelHe": "משפט, בתי משפט ורגולציה",
      "description": "<Hebrew>",
      "color": "#hexcode",
      "reasoning": "<Hebrew: why the existing 18 categories cannot hold these entries>"
    }
  ],
  "unclassifiableNote": "<Hebrew: what you deliberately left unclassified, and why>"
}
```

Rules for the output:

- `categoryId` must be an existing category from `taxonomy.json`, or one you propose in
  `proposedCategories`. Prefer existing categories; propose a new one only when a real
  body of entries has no honest home.
- `confidence` is one of `high`, `medium`, `low`, and it means: how certain are you that a
  subject containing this keyword is about this category.
  - `high` — the keyword is unambiguous in this domain (`בג"ץ`, `שגריר`).
  - `medium` — usually right, with a plausible other reading.
  - `low` — a real signal, but it collides with other meanings.
- Never propose a keyword whose only purpose is to catch one specific subject string.
- Aim for breadth. A few hundred well-chosen keywords per expert is the right order of
  magnitude; more is fine if each one earns its place.
- Do not edit any file in the repository. Your only write is your own JSON output file.
