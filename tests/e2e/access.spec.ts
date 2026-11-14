import { expect, test } from '@playwright/test';
import { login, sections, signedIn } from './helpers';

test('a wrong password is refused with a clear message', async ({ page }) => {
  await page.goto('/');
  await page.locator('#loginCard input[type=email]').fill('lab@bioeng.test');
  await page.locator('#loginCard input[type=password]').fill('wrong-password');
  await page.locator('#loginCard button[type=submit]').click();
  await expect(page.getByRole('alert')).toHaveText('Emaili ose fjalëkalimi nuk është i saktë.');
});

const SECTIONS = {
  'admin@bioeng.test': ['Pacienti', 'Pagesat sipas raportit', 'Terminet', 'Raport i ri', 'Raportet e pacientit', 'Analizat dhe vlerat referente', 'Kopje rezervë', 'Përdoruesit'],
  'lab@bioeng.test': ['Pacienti', 'Pagesat sipas raportit', 'Terminet', 'Raport i ri', 'Raportet e pacientit', 'Analizat dhe vlerat referente', 'Kopje rezervë'],
  'kardiolog@bioeng.test': ['Pacienti', 'Raport i ri', 'Kontrollet e Kardiologji'],
  'hixhama@bioeng.test': ['Pacienti', 'Raport i ri', 'Kontrollet e Hixhame']
};

for (const [email, expected] of Object.entries(SECTIONS)) {
  test(`${email} sees exactly the sections of the role`, async ({ browser }) => {
    const { context, page } = await signedIn(browser, email);
    expect(await sections(page)).toEqual(expected);
    await context.close();
  });
}

test('a specialist has no finances, payments or appointments, and signs as themselves', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'kardiolog@bioeng.test');
  await expect(page.getByTestId('finance')).toHaveCount(0);
  await expect(page.getByTestId('payments-card')).toHaveCount(0);
  const editor = page.getByTestId('report-editor');
  await expect(editor.locator('select').first()).toBeDisabled();
  await expect(editor.getByPlaceholder('p.sh. Dr. Emër Mbiemër')).toHaveValue('Dr. Test Kardio');
  await context.close();
});

test('an account without a role, or deactivated, gets in but sees nothing', async ({ page }) => {
  await login(page, 'pa-rol@bioeng.test');
  await expect(page.getByRole('alert')).toContainText('nuk ka rol');
  await expect(page.getByTestId('report-editor')).toHaveCount(0);
  // Logout ends with a reload of the page.
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Dil' }).click()]);
  await login(page, 'joaktiv@bioeng.test');
  await expect(page.getByRole('alert')).toContainText('çaktivizuar');
  await expect(page.getByTestId('report-editor')).toHaveCount(0);
});

test('a refresh keeps the session; logout ends it and leaves no cached data', async ({ page }) => {
  await login(page, 'lab@bioeng.test');
  await expect(page.getByTestId('report-editor')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('report-editor')).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Dil' }).click()]);
  await expect(page.locator('#loginCard')).toBeVisible();
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map(item => item.name ?? ''));
  expect(databases.filter(name => name.startsWith('firestore/'))).toEqual([]);
});
