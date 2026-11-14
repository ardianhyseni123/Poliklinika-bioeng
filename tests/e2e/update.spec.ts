import { expect, test, type Page } from '@playwright/test';
import { createPatient, editorField, login, unique } from './helpers';

/** Makes the site answer as if another version had been deployed, and lets the page check now. */
async function deployAnotherVersion(page: Page): Promise<void> {
  await page.route('**/version.json', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'another-deployment' }) }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('a new deployment replaces the app with a request to reload; the reload keeps the login', async ({ page }) => {
  await login(page, 'lab@bioeng.test');
  await expect(page.getByTestId('report-editor')).toBeVisible();
  await expect(page.getByTestId('update-required')).toHaveCount(0);

  await deployAnotherVersion(page);
  await expect(page.getByTestId('update-required')).toBeVisible();
  await expect(page.locator('#appShell')).toHaveCount(0);

  // The reload loads the deployed version (here: the dev server's own), still signed in.
  await page.unroute('**/version.json');
  await page.getByRole('button', { name: 'Rifresko faqen' }).click();
  await expect(page.getByTestId('report-editor')).toBeVisible();
  await expect(page.getByTestId('update-required')).toHaveCount(0);
});

test('typed work is not thrown away: the reload request waits until it is saved', async ({ page }) => {
  await login(page, 'kardiolog@bioeng.test');
  await createPatient(page, 'Arben', unique('Version'));
  await editorField(page, 'Anamneza dhe ankesat').fill('Shkruar para versionit të ri');

  await deployAnotherVersion(page);
  await expect(page.getByTestId('update-banner')).toBeVisible();
  await expect(page.getByTestId('update-required')).toHaveCount(0);
  await expect(editorField(page, 'Anamneza dhe ankesat')).toHaveValue('Shkruar para versionit të ri');

  // Once the report is saved and has reached the server, the app gives way.
  await page.getByTestId('save-report').click();
  await expect(page.getByTestId('update-required')).toBeVisible();
});

test('an app without /version.json (a rollback to the old app) also asks for a reload', async ({ page }) => {
  await login(page, 'lab@bioeng.test');
  await expect(page.getByTestId('report-editor')).toBeVisible();
  await page.route('**/version.json', route => route.fulfill({ status: 404, body: 'Not Found' }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('update-required')).toBeVisible();
});
