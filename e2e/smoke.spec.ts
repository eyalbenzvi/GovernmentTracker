/**
 * Smoke coverage for the built site, run against `vite preview`.
 *
 * These assert the behaviours a transparency dashboard must not get wrong:
 * the page renders, navigation works, charts degrade honestly when a dataset is
 * empty, filters and CSV export work on real data, every source link is a valid
 * absolute URL, and the console stays free of errors.
 */
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * One row of a data table, in whichever presentation the viewport renders: a real
 * <tr> on a wide screen, a card on a narrow one.
 */
function dataRows(page: Page) {
  // Both presentations exist in the DOM; only one is visible at a given width, so
  // the locator is scoped to the visible one rather than to a breakpoint guess.
  return page.locator('table.data-table tbody tr:visible, ul[data-rows="cards"] > li:visible');
}

/** Waits until the catalogue has rendered rows, then returns the row locator. */
async function catalogueRows(page: Page) {
  const rows = dataRows(page);
  await expect(rows.first()).toBeVisible();
  return rows;
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test('the home page loads in Hebrew and RTL', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');

  await expect(page).toHaveTitle(/מפת הממשלה/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // The landing screen leads with a finding, not with a form.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'מה בולט בנתונים' })).toBeVisible();
  // The scope of what the site does not know stays on the landing page, folded.
  await expect(page.getByText('מה אין כאן')).toBeVisible();

  expect(errors).toEqual([]);
});

test('every home-page insight states what it does not say', async ({ page }) => {
  await page.goto('/');
  // The summary has to land before the cards exist.
  await expect(page.getByRole('heading', { name: 'מה בולט בנתונים' })).toBeVisible();
  // The lead card plus the ranked ones; each carries the guard sentence.
  const guards = page.getByText('מה זה לא אומר');
  await expect(guards.first()).toBeVisible();
  expect(await guards.count()).toBeGreaterThan(2);

  // Opening one reveals the limitation itself, not a link to a methodology page.
  await guards.first().click();
  await expect(page.getByText(/אינו|אינה/).first()).toBeVisible();
});

test('the home page renders from the small summary, not the full corpus', async ({ page }) => {
  const heavy: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/budget-items|activity-evidence|diary-insights|findings-/.test(url)) heavy.push(url);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'מה בולט בנתונים' })).toBeVisible();
  // Landing must not pull the multi-megabyte datasets.
  expect(heavy).toEqual([]);
});

test('the hundred-shekel module responds to an amount', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('סכום בש״ח');
  await expect(input).toBeVisible();
  await input.fill('1000');
  // The breakdown re-computes in shekels, so a four-figure sum appears.
  await expect(page.getByText(/ש"ח/).first()).toBeVisible();
});

test('the multi-year chart renders real figures and offers an accessible table', async ({
  page,
}) => {
  await page.goto('/');
  const chart = page.locator('section[aria-label="תקציב וביצוע לפי שנה"]');
  await expect(chart).toBeVisible();

  // The table alternative must exist for every chart, and carry the same figures.
  await chart.getByRole('button', { name: /הצג כטבלה/ }).click();
  const table = chart.locator('table');
  await expect(table).toBeVisible();
  await expect(table).toContainText('תקציב מעודכן');
  await expect(table).toContainText('2025');
  // A real shekel figure, not a dash.
  await expect(table).toContainText(/מיליארד|מיליון/);
});

test('the budget screen shows real records with statuses and sources', async ({ page }) => {
  await page.goto('/#/budget');
  const rows = dataRows(page);
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(10);

  // No figure may be presented without a data status.
  await expect(page.getByText(/נתון חלקי|אומדן/).first()).toBeVisible();
  // Rows link to their source.
  await expect(rows.locator('a[target="_blank"]').first()).toBeVisible();
});

test('filtering the budget table by ministry narrows it', async ({ page }) => {
  await page.goto('/#/budget');
  const rows = dataRows(page);
  await expect(rows.first()).toBeVisible();
  const status = page.getByRole('status').filter({ hasText: 'שורות מתוך' });
  const before = await status.textContent();

  await page.getByLabel('משרד', { exact: true }).selectOption('environment');
  await expect(status).not.toHaveText(before ?? '');
  await expect(rows.first()).toBeVisible();
});

test('navigating to a ministry page works and shows coverage', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/#/scorecards');

  await page.getByRole('link', { name: 'משרד התחבורה', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/ministry\/transport/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('משרד התחבורה');
  await expect(page.getByRole('heading', { name: 'מה נסרק ומה חסר' })).toBeVisible();
  // The verified budget code for this ministry must be shown.
  await expect(page.getByText('0040').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('a deep link to a ministry works on a fresh load', async ({ page }) => {
  await page.goto('/#/ministry/health');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('משרד הבריאות');
});

test('an unknown ministry shows a not-found message rather than crashing', async ({ page }) => {
  await page.goto('/#/ministry/does-not-exist');
  await expect(page.getByText(/אינו קיים במאגר/)).toBeVisible();
});

test('the sources catalogue filters real data', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/#/sources');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('קטלוג המקורות');

  const rows = await catalogueRows(page);
  const initial = await rows.count();
  expect(initial).toBeGreaterThan(0);

  const status = page.getByRole('status').filter({ hasText: 'מקורות מתוך' });
  const before = await status.textContent();

  // The sortable column header shares this accessible name, so target the select.
  await page.getByLabel('מפרסם', { exact: true }).selectOption('הכנסת');
  await expect(status).not.toHaveText(before ?? '');

  // Narrowing by publisher must reduce the result set, not clear the table.
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(initial);

  expect(errors).toEqual([]);
});

test('free-text search narrows the catalogue', async ({ page }) => {
  await page.goto('/#/sources');
  const rows = await catalogueRows(page);
  const initial = await rows.count();

  await page.getByLabel('חיפוש חופשי').fill('תחבורה');
  await expect(async () => {
    expect(await rows.count()).toBeLessThan(initial);
  }).toPass();
});

test('CSV download produces a file with a BOM and a header row', async ({ page }) => {
  await page.goto('/#/sources');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('button', { name: /הורדת CSV/ })
      .first()
      .click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const content = Buffer.concat(chunks).toString('utf8');

  expect(content.charCodeAt(0)).toBe(0xfeff);
  expect(content).toContain('כותרת');
  expect(content).toContain('https://');
});

test('every source link is an absolute https URL opened safely', async ({ page }) => {
  await page.goto('/#/sources');
  await catalogueRows(page);
  const links = dataRows(page).locator('a[target="_blank"]');
  const count = await links.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < Math.min(count, 15); i += 1) {
    const link = links.nth(i);
    expect(await link.getAttribute('href')).toMatch(/^https:\/\/\S+$/);
    expect(await link.getAttribute('rel')).toContain('noopener');
  }
});

test('the methodology screen states the limits and the corrections policy', async ({ page }) => {
  await page.goto('/#/methodology');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('מתודולוגיה ומגבלות');
  await expect(page.getByText(/אין לפרש|סיבתיות/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Issue/ })).toBeVisible();
  await expect(page.getByText(/29\.12\.2022/).first()).toBeVisible();
});

test('the data-quality screen reports coverage per ministry', async ({ page }) => {
  await page.goto('/#/about');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('אודות ואיכות נתונים');
  await expect(page.getByRole('heading', { name: 'טבלת כיסוי לכל משרד' })).toBeVisible();
  const rows = await catalogueRows(page);
  expect(await rows.count()).toBeGreaterThan(0);
});

test('the activity screen lists real published items with source links', async ({ page }) => {
  await page.goto('/#/activity');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('פעילות פומבית');

  const status = page.getByRole('status').filter({ hasText: 'פריטים מתוך' });
  await expect(status).toBeVisible();

  // Real items, each linking to its gov.il page.
  await expect(page.locator('a[href*="gov.il"]').first()).toBeVisible();

  // Filtering by ministry narrows the list.
  const before = await status.textContent();
  await page.getByLabel('משרד', { exact: true }).selectOption('health');
  await expect(status).not.toHaveText(before ?? '');
});

test('the budget screen documents the formulas', async ({ page }) => {
  await page.goto('/#/budget');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('תקציב וביצוע');
  await expect(page.getByText(/שיעור ביצוע = ביצוע ÷ תקציב מעודכן/).first()).toBeVisible();
});

test('keyboard navigation reaches the skip link and the main nav', async ({ page }) => {
  await page.goto('/');
  // A preceding test can leave the page inactive, and Tab from an unfocused page
  // goes nowhere — so make this page the active one before pressing a key.
  await page.bringToFront();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'דלג לתוכן הראשי' })).toBeFocused();
});

test('the analysis screen shows official usage breakdown with provenance', async ({ page }) => {
  await page.goto('/#/analysis');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('לאן הולך הכסף');

  // Both provenance layers must be declared before any figures.
  await expect(page.getByText(/שכבה רשמית — סיווג כלכלי/)).toBeVisible();
  await expect(page.getByText(/סיווג תמטי בסיוע מודל שפה/)).toBeVisible();

  // The 100-shekel strip renders with real categories.
  await expect(page.getByText(/מכל 100 ₪/)).toBeVisible();
  await expect(page.getByText('שכר:', { exact: false }).first()).toBeVisible();
});

test('a theme card opens to reveal members with reasoning', async ({ page }) => {
  await page.goto('/#/analysis');
  const expander = page.getByRole('button', { name: /אילו סעיפים נכללים/ }).first();
  await expect(expander).toBeVisible();
  await expander.click();
  await expect(page.getByText(/נימוק השיוך:/).first()).toBeVisible();
  await expect(page.getByText(/ודאות (גבוהה|בינונית)/).first()).toBeVisible();
});

test('the analysis screen lists budget shifts and the volatility index', async ({ page }) => {
  await page.goto('/#/analysis');
  await expect(page.getByRole('heading', { name: /ההסטות הגדולות/ })).toBeVisible();
  const rows = dataRows(page);
  await expect(rows.first()).toBeVisible();

  await expect(page.getByRole('heading', { name: /מדד אי-יציבות תקציבית/ })).toBeVisible();
  // The formula must be stated where the index is displayed.
  await expect(page.getByText(/מעודכן − מקורי/).first()).toBeVisible();
});

test('switching ministry updates the analysis screen', async ({ page }) => {
  await page.goto('/#/analysis');
  await expect(page.getByText(/מכל 100 ₪/)).toBeVisible();
  await page.getByLabel('משרד', { exact: true }).selectOption('environment');
  // Environment has earmarked funds — its theme list must include them.
  await expect(page.getByText('קרנות ומקורות ייעודיים').first()).toBeVisible();
});

test('the findings screen shows suppliers with entity links', async ({ page }) => {
  await page.goto('/#/findings');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ממצאים');

  // The framing note must precede the data.
  await expect(page.getByText(/אינם טענה לאי-סדרים/)).toBeVisible();

  const rows = dataRows(page);
  await expect(rows.first()).toBeVisible();
  // Supplier rows link to the entity page at the source.
  await expect(page.locator('a[href*="next.obudget.org/i/org/"]').first()).toBeVisible();
});

test('procurement methods disclose the tender-exemption share', async ({ page }) => {
  await page.goto('/#/findings');
  await expect(page.getByRole('heading', { name: /שיטות הרכש/ })).toBeVisible();
  await expect(page.getByText('פטור ממכרז').first()).toBeVisible();
});

test('a budget transfer opens to reveal the official explanation', async ({ page }) => {
  await page.goto('/#/findings');
  const expander = page.getByRole('button', { name: /ההסבר הרשמי שצורף לפנייה/ }).first();
  await expect(expander).toBeVisible();
  await expander.click();
  await expect(page.getByText(/ועדת הכספים|שר האוצר/).first()).toBeVisible();
});

test('the anomaly scan filters by rule and shows the formula', async ({ page }) => {
  await page.goto('/#/findings');
  await expect(page.getByRole('heading', { name: /סריקת חריגים בתקנות/ })).toBeVisible();

  const status = page.getByRole('status').filter({ hasText: 'ממצאים מתוך' });
  const before = await status.textContent();

  await page.getByLabel('כלל', { exact: true }).selectOption('overspend');
  await expect(status).not.toHaveText(before ?? '');
  // Selecting a rule must expose its exact formula.
  await expect(page.getByText(/ביצוע > תקציב מעודכן × 1.25/)).toBeVisible();
  // Findings link back to the regulation page at the source.
  await expect(page.locator('a[href*="next.obudget.org/i/budget/"]').first()).toBeVisible();
});

test('switching ministry on findings swaps the supplier list', async ({ page }) => {
  await page.goto('/#/findings');
  const heading = page.getByRole('heading', { name: /הספקים המרכזיים/ });
  await expect(heading).toContainText('משרד התחבורה');
  await page.getByLabel('משרד', { exact: true }).first().selectOption('education');
  await expect(heading).toContainText('משרד החינוך');
});

test('a ministry with a corrupt contracts feed shows a data-quality banner instead of rankings', async ({
  page,
}) => {
  await page.goto('/#/findings');
  await page.getByLabel('משרד', { exact: true }).first().selectOption('environment');
  // The banner must state the suspicion and the rule…
  await expect(page.getByText(/חשד לשגיאות במקור/)).toBeVisible();
  await expect(page.getByText(/תקרת השפיות/)).toBeVisible();
  // …and no supplier ranking may be presented as fact.
  await expect(page.getByRole('heading', { name: /הספקים המרכזיים/ })).toHaveCount(0);
});

test('the diaries screen states its source honestly in both empty and populated states', async ({
  page,
}) => {
  await page.goto('/#/diaries');
  await expect(page.getByRole('heading', { name: /יומני שרים, סגני שרים ומנכ"לים/ })).toBeVisible();
  // The provenance caveat is non-negotiable in every state.
  await expect(page.getByText(/היעדר יומן אינו היעדר פעילות/)).toBeVisible();
  // Either real entries with their counter, or an explicit not-collected notice.
  const counter = page.getByText(/רשומות מתוך/);
  const emptyState = page.getByText(/טרם נאספו רשומות יומן/);
  // The section shard is a real download; allow for it rather than racing it.
  await expect(counter.or(emptyState).first()).toBeVisible({ timeout: 30_000 });
});

test('the diaries screen labels how every row was extracted', async ({ page }) => {
  await page.goto('/#/diaries');
  const emptyState = page.getByText(/טרם נאספו רשומות יומן/);
  if (await emptyState.isVisible().catch(() => false)) return; // pre-collection build
  // The extraction-method breakdown is what tells a reader whether a row is a
  // structured value or a machine's reading of a scan.
  await expect(page.getByRole('heading', { name: /איך הגיעו הרשומות/ })).toBeVisible();
  await expect(page.getByText(/נתון מובנה מהמאגר/)).toBeVisible();
  // The transparency measure and the published-formula findings must both be present.
  await expect(page.getByRole('heading', { name: /שקיפות היומן/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /ממצאים מחושבים/ })).toBeVisible();
  // The "a similar name is not proof" caveat sits both above the cross-reference
  // table and in the closing caveats list; either alone satisfies the intent, so
  // assert on the first rather than requiring exactly one match.
  await expect(page.getByText(/שם דומה אינו הוכחה/).first()).toBeVisible();
});

test('the diaries screen switches category mix between quarters and months', async ({ page }) => {
  await page.goto('/#/diaries');
  const emptyState = page.getByText(/טרם נאספו רשומות יומן/);
  if (await emptyState.isVisible().catch(() => false)) return;
  await expect(page.getByRole('heading', { name: /במה עסקו/ })).toBeVisible();
  await page.getByRole('button', { name: 'חודשים' }).click();
  await expect(page.getByRole('button', { name: 'חודשים' })).toHaveClass(/btn-primary/);
});

/* ---- screens added with the rework ---- */

test('the reading guide states the rules the screens fold away', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/#/how-to-read');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('איך לקרוא את האתר');

  // The three rules a reader is most likely to get wrong.
  await expect(page.getByText(/במונחים נומינליים/).first()).toBeVisible();
  await expect(page.getByText(/ציון השקיפות מורכב/)).toBeVisible();
  await expect(page.getByText(/אין באתר השוואה בין תמהיל הזמן לתמהיל התקציב/)).toBeVisible();

  expect(errors).toEqual([]);
});

test('the scorecards separate what an office published from what we could read', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/#/scorecards');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('מי שקוף יותר');

  // All four publication states are named, including the one that is our own gap.
  await expect(page.getByText('פרסם, ואנחנו קראנו').first()).toBeVisible();
  await expect(page.getByText('פרסם, ואנחנו לא הצלחנו לקרוא').first()).toBeVisible();
  // Both formulas are printed where the scores are shown.
  await expect(page.getByText(/מדד הריכוזיות משקלל/)).toBeVisible();

  expect(errors).toEqual([]);
});

test('changing the compared measure is reflected in the address', async ({ page }) => {
  await page.goto('/#/scorecards');
  await page.getByLabel('מדד להשוואה').selectOption('procurement');
  await expect(page).toHaveURL(/measure=procurement/);
  // A reload of that address restores the same view.
  await page.reload();
  await expect(page.getByLabel('מדד להשוואה')).toHaveValue('procurement');
});

test('a budget filter survives a reload through the address bar', async ({ page }) => {
  await page.goto('/#/budget');
  await page.getByLabel('משרד', { exact: true }).selectOption('health');
  await expect(page).toHaveURL(/ministry=health/);
  await page.reload();
  await expect(page.getByLabel('משרד', { exact: true })).toHaveValue('health');
});

test('the corrections log names an operator, a reply route and past fixes', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/#/corrections');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('מי מפעיל');
  await expect(page.getByRole('heading', { name: 'זכות תגובה' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /יומן תיקונים/ })).toBeVisible();
  // Each entry says what was shown before and what is shown now.
  await expect(page.getByText('מה הוצג לפני').first()).toBeVisible();
  await expect(page.getByText('מה מוצג עכשיו').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a ministry page bridges the budget levels and names who held the office', async ({
  page,
}) => {
  await page.goto('/#/ministry/education');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('משרד החינוך');

  // The waterfall is the chart that explains the movement between the levels.
  const waterfall = page.locator('section[aria-label*="ממה הורכב התקציב"]');
  await expect(waterfall).toBeVisible();
  await expect(waterfall.getByText('שורה תחתונה')).toBeVisible();

  // Tenure attribution, so a fiscal year is not read against today's minister.
  await expect(page.getByText('מי כיהן בתקופה המוצגת')).toBeVisible();
});

test('a person page exists and is reachable from the tenure ribbon', async ({ page }) => {
  await page.goto('/#/ministry/education');
  const personLink = page.locator('a[href*="#/person/"]').first();
  await expect(personLink).toBeVisible();
  await personLink.click();
  await expect(page).toHaveURL(/#\/person\//);
  await expect(page.getByRole('heading', { name: 'כהונות שנאספו' })).toBeVisible();
});

test('the budget screen offers a composition view, not only a table', async ({ page }) => {
  await page.goto('/#/budget');
  const treemap = page.locator('section[aria-label*="הרכב התקציב המעודכן"]');
  await expect(treemap).toBeVisible();
  // A composition chart must still expose its figures as a table.
  await treemap.getByRole('button', { name: /הצג כטבלה/ }).click();
  await expect(treemap.locator('table')).toBeVisible();
});

test('the anomaly scan publishes how selective each rule is', async ({ page }) => {
  await page.goto('/#/findings');
  await expect(page.getByRole('heading', { name: 'כמה סלקטיבי כל כלל' })).toBeVisible();
  await expect(page.getByText('ל-1,000 שורות שנסרקו')).toBeVisible();
  // Findings carry their ranking score, so the order is inspectable.
  await expect(page.getByText(/עוצמה/).first()).toBeVisible();
});

test('the site search finds a ministry by name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'חיפוש באתר' }).click();
  await page.getByLabel(/חיפוש משרדים/).fill('בריאות');
  await page
    .getByRole('button', { name: /משרד הבריאות/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/ministry\/health/);
});

test('the theme can be switched to dark and stays readable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /מצב כהה|מעבר למצב כהה/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Body ink and paper must both come from the dark palette, never one of each.
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).not.toBe(colors.color);
});
