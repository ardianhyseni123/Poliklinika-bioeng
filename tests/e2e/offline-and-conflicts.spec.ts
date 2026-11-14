import { expect, test } from '@playwright/test';
import { createPatient, editorField, login, selectPatient, serverList, signedIn, unique } from './helpers';

test('work done offline is kept, survives closing the tab, and uploads when back online', async ({ browser }) => {
  const lastName = unique('Offline');
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, 'kardiolog@bioeng.test');
  await createPatient(page, 'Blerta', lastName);
  // Let the new patient reach the server before the connection drops.
  await expect(page.getByTestId('sync-state')).toHaveText('● Në linjë');

  await context.setOffline(true);
  await expect(page.getByTestId('sync-state')).toContainText('Pa lidhje');
  await editorField(page, 'Anamneza dhe ankesat').fill('Shkruar pa internet');
  await page.getByTestId('save-report').click();
  await expect(page.getByTestId('status')).toContainText('versioni 1');
  await expect(page.getByTestId('report-list').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('sync-state')).toContainText('1 në pritje');

  // Logging out now would lose the report: refused.
  await page.getByRole('button', { name: 'Dil' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ende nuk janë dërguar' })).toBeVisible();
  expect((await serverList('reports')).some(report => report.anamnesis === 'Shkruar pa internet')).toBe(false);

  // The tab is closed while still offline; later the connection is back and the doctor logs in again.
  await page.close();
  await context.setOffline(false);
  const again = await context.newPage();
  await login(again, 'kardiolog@bioeng.test');
  await expect.poll(async () => (await serverList('reports')).some(report => report.anamnesis === 'Shkruar pa internet'), { timeout: 20_000 }).toBe(true);
  await context.close();
});

test('two people editing the same report: both versions are kept, flagged, and settled', async ({ browser }) => {
  const lastName = unique('Konflikt');
  const doctor = await signedIn(browser, 'kardiolog@bioeng.test');
  await createPatient(doctor.page, 'Dardan', lastName);
  await editorField(doctor.page, 'Anamneza dhe ankesat').fill('Versioni i parë');
  await doctor.page.getByTestId('save-report').click();
  await expect(doctor.page.getByTestId('status')).toContainText('versioni 1');
  await doctor.page.getByTestId('report-list').getByRole('button', { name: 'Redakto' }).click();

  const lab = await signedIn(browser, 'lab@bioeng.test');
  await selectPatient(lab.page, lastName);
  await lab.page.getByTestId('report-list').getByRole('button', { name: 'Redakto' }).click();
  await editorField(lab.page, 'Terapia e rekomanduar').fill('Ndryshuar nga laboratori');
  await lab.page.getByTestId('save-report').click();
  await expect(lab.page.getByTestId('status')).toContainText('versioni 2');

  // The doctor, still on version 1, is told; saving keeps both versions.
  await expect(doctor.page.getByTestId('changed-elsewhere')).toBeVisible();
  await editorField(doctor.page, 'Shënime shtesë').fill('Shënim i mjekut');
  await doctor.page.getByTestId('save-report').click();
  await expect(doctor.page.getByTestId('conflict-badge')).toBeVisible();
  const card = doctor.page.getByTestId('conflict-card');
  await expect(card).toContainText('Ndryshuar nga laboratori');
  await expect(card).toContainText('Shënim i mjekut');
  await expect(lab.page.getByTestId('conflict-badge')).toBeVisible();

  // Settled by keeping the laboratory's version: gone for everyone.
  await card.locator('.payment-summary', { hasText: 'Ndryshuar nga laboratori' }).getByRole('button', { name: 'Mbaj këtë version' }).click();
  await expect(doctor.page.getByTestId('conflict-card')).toHaveCount(0);
  await expect(lab.page.getByTestId('conflict-badge')).toHaveCount(0);
  await doctor.context.close();
  await lab.context.close();
});
