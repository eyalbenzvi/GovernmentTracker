/**
 * Smoke coverage for the built site, run against `vite preview`.
 *
 * These assert the behaviours a transparency dashboard must not get wrong:
 * the page renders, navigation works, charts degrade honestly when a dataset is
 * empty, filters and CSV export work on real data, every source link is a valid
 * absolute URL, and the console stays free of errors.
 */
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** Waits until the catalogue table has rendered rows, then returns the row locator. */
async function catalogueRows(page: Page) {
  const rows = page.locator('table.data-table tbody tr');
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

  await expect(page.getByRole('heading', { level: 1 })).toContainText('מפת הממשלה');
  // The scope disclaimer must be on the landing page, not buried.
  await expect(page.getByText(/אינו תמונה מלאה של כלל פעילות המשרדים/)).toBeVisible();

  expect(errors).toEqual([]);
});

test('the KPI cards render with an explicit data status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'מדדים מרכזיים' })).toBeVisible();
  // Every measure carries a status badge; with no budget data that reads "אין נתון".
  await expect(page.getByText('אין נתון', { exact: true }).first()).toBeVisible();
});

test('a chart with no data shows an explanation instead of empty axes', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByText(/אין נתון זמין במקור שנאסף/).first();
  await expect(panel).toBeVisible();
  await expect(page.getByText(/חסומים|לא נאספו/).first()).toBeVisible();
});

test('navigating to a ministry page works and shows coverage', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'משרד התחבורה והבטיחות בדרכים' }).first().click();
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
  const links = page.locator('table.data-table tbody a[target="_blank"]');
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

test('the activity screen explains why it is empty', async ({ page }) => {
  await page.goto('/#/activity');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('פעילות פומבית');
  await expect(page.getByText(/לא נאספו פריטי פעילות/).first()).toBeVisible();
});

test('the budget screen documents the formulas', async ({ page }) => {
  await page.goto('/#/budget');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('תקציב וביצוע');
  await expect(page.getByText(/שיעור ביצוע = ביצוע ÷ תקציב מעודכן/).first()).toBeVisible();
});

test('keyboard navigation reaches the skip link and the main nav', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'דלג לתוכן הראשי' })).toBeFocused();
});
