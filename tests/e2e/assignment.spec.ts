import { expect, test, type Page } from '@playwright/test';
import { createPatient, editorField, selectPatient, serverList, signedIn, unique } from './helpers';

// Seeded (scripts/seed.mjs): Blerim Gashi and Drita Berisha are old patients with a Kardiologji
// and a Hixhame report; Arta Krasniqi and Fatmir Hoxha are old patients without specialist
// reports; Gentiana Rexhepi is assigned to Gastroenterologji and Urologji; Ilir Morina to nobody.

async function patientOptions(page: Page): Promise<string> {
  return (await page.getByTestId('patient-select').locator('option').allTextContents()).join('\n');
}

async function specialtiesOnServer(lastName: string): Promise<unknown> {
  return (await serverList('patients')).find(patient => patient.lastName === lastName)?.specialties;
}

test('a specialist sees only the patients assigned to them, and old patients they have a report for', async ({ browser }) => {
  const kardio = await signedIn(browser, 'kardiolog@bioeng.test');
  await expect.poll(() => patientOptions(kardio.page)).toContain('Blerim Gashi');
  for (const name of ['Arta Krasniqi', 'Fatmir Hoxha', 'Drita Berisha', 'Gentiana Rexhepi', 'Ilir Morina']) {
    expect(await patientOptions(kardio.page)).not.toContain(name);
  }
  // The search only looks among them too.
  await kardio.page.getByPlaceholder('p.sh. Ardian, Hyseni ose 044123456').fill('Rexhepi');
  await expect(kardio.page.getByText('0 pacientë u gjetën.')).toBeVisible();

  const gastro = await signedIn(browser, 'gastrolog@bioeng.test');
  await expect.poll(() => patientOptions(gastro.page)).toContain('Gentiana Rexhepi');
  expect(await patientOptions(gastro.page)).not.toContain('Blerim Gashi');
  expect(await patientOptions(gastro.page)).not.toContain('Ilir Morina');

  // The laboratory sees everyone; an old patient shows who sees it now.
  const lab = await signedIn(browser, 'lab@bioeng.test');
  await selectPatient(lab.page, 'Gashi');
  const panel = lab.page.getByTestId('assign-panel');
  await expect(panel.getByTestId('assign-info')).toContainText('Pacient i vjetër');
  await expect(panel.getByLabel('Kardiologji', { exact: true })).toBeChecked();
  await expect(panel.getByLabel('Pulmologji', { exact: true })).not.toBeChecked();
  await selectPatient(lab.page, 'Morina');
  await expect(panel.getByTestId('assign-info')).toHaveText('');
  await expect(panel.locator('input:checked')).toHaveCount(0);
  for (const session of [kardio, gastro, lab]) await session.context.close();
});

test('the laboratory assigns a patient; the specialists see the change at once', async ({ browser }) => {
  const lastName = unique('Caktim');
  const lab = await signedIn(browser, 'lab@bioeng.test');
  await lab.page.getByText('Shto pacient të ri').click();
  await lab.page.getByTestId('new-first-name').fill('Besa');
  await lab.page.getByTestId('new-last-name').fill(lastName);
  await lab.page.getByTestId('new-patient-specialists').getByLabel('Gastroenterologji', { exact: true }).check();
  await lab.page.getByRole('button', { name: 'Ruaj pacientin' }).click();
  await expect(lab.page.getByTestId('status')).toContainText('u ruajt');
  await expect.poll(() => specialtiesOnServer(lastName)).toEqual(['Gastroenterologji']);

  const gastro = await signedIn(browser, 'gastrolog@bioeng.test');
  const uro = await signedIn(browser, 'urolog@bioeng.test');
  await expect.poll(() => patientOptions(gastro.page)).toContain(lastName);
  expect(await patientOptions(uro.page)).not.toContain(lastName);

  // The new patient is selected; move it from Gastroenterologji to Urologji.
  const panel = lab.page.getByTestId('assign-panel');
  await expect(panel.getByLabel('Gastroenterologji', { exact: true })).toBeChecked();
  await panel.getByLabel('Gastroenterologji', { exact: true }).uncheck();
  await panel.getByLabel('Urologji', { exact: true }).check();
  await panel.getByRole('button', { name: 'Ruaj caktimin' }).click();
  await expect(lab.page.getByTestId('status')).toHaveText('Pacienti u caktua te: Urologji.');
  await expect.poll(() => patientOptions(uro.page)).toContain(lastName);
  await expect.poll(() => patientOptions(gastro.page)).not.toContain(lastName);

  // Assigned to nobody: only the laboratory sees it.
  await panel.getByLabel('Urologji', { exact: true }).uncheck();
  await panel.getByRole('button', { name: 'Ruaj caktimin' }).click();
  await expect(lab.page.getByTestId('status')).toContainText('e sheh vetëm laboratori');
  await expect.poll(() => patientOptions(uro.page)).not.toContain(lastName);
  await expect.poll(() => specialtiesOnServer(lastName)).toEqual([]);
  for (const session of [lab, gastro, uro]) await session.context.close();
});

test('a patient a doctor registers is theirs; an appointment adds another specialist', async ({ browser }) => {
  const lastName = unique('Termin');
  const kardio = await signedIn(browser, 'kardiolog@bioeng.test');
  await expect(kardio.page.getByTestId('new-patient-specialists')).toHaveCount(0);
  await expect(kardio.page.getByTestId('assign-panel')).toHaveCount(0);
  await createPatient(kardio.page, 'Driton', lastName);
  await expect.poll(() => specialtiesOnServer(lastName)).toEqual(['Kardiologji']);

  const lab = await signedIn(browser, 'lab@bioeng.test');
  await selectPatient(lab.page, lastName);
  const appointments = lab.page.getByTestId('appointments-card');
  await appointments.getByLabel('Specialiteti').selectOption('Neurologji');
  await appointments.getByRole('button', { name: 'Ruaj termin' }).click();
  await expect(lab.page.getByTestId('status')).toHaveText('Termini u ruajt.');
  await expect.poll(() => specialtiesOnServer(lastName)).toEqual(['Kardiologji', 'Neurologji']);

  const neuro = await signedIn(browser, 'neurolog@bioeng.test');
  await expect.poll(() => patientOptions(neuro.page)).toContain(lastName);
  for (const session of [kardio, lab, neuro]) await session.context.close();
});

test('Gastroenterologji: a template fills in the report, and the print carries the fixed doctor', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'gastrolog@bioeng.test');
  await selectPatient(page, 'Rexhepi');
  const editor = page.getByTestId('report-editor');
  const templates = editor.getByTestId('specialty-templates');
  await expect(templates).toContainText('Shabllone diagnozash — Gastroenterologji');
  await templates.getByRole('button', { name: 'Apliko shabllonin' }).click();
  await expect(page.getByTestId('status')).toHaveText('Zgjidh një shabllon diagnoze.');
  await templates.getByLabel('Shablloni').selectOption({ label: 'Gastrit kronik — K29.5' });
  await expect(templates).toContainText('Ekzaminime të sugjeruara: Gastroskopi (EGDS), Testi i H. pylori (antigjen në feces), Hemogram');
  await templates.getByRole('button', { name: 'Apliko shabllonin' }).click();
  await expect(page.getByTestId('status')).toContainText('u aplikua');
  await expect(editor.getByLabel('Gastrit kronik — K29.5', { exact: true })).toBeChecked();
  await expect(editor.getByLabel('Gastroskopi (EGDS)', { exact: true })).toBeChecked();
  await expect(editor.getByLabel('Kolonoskopi', { exact: true })).not.toBeChecked();
  await expect(editorField(page, 'Terapia e rekomanduar')).toHaveValue(/^Rekomandime: ushqim i rregullt/);

  await page.getByTestId('save-report').click();
  await expect(page.getByTestId('status')).toContainText('versioni 1');
  await page.getByTestId('report-list').getByRole('button', { name: 'Shfaq' }).first().click();
  const print = page.getByTestId('print-content');
  await expect(print).toContainText('Gastrit kronik — K29.5');
  await expect(print).toContainText('Dr. Shqiprim Aliu');
  await expect(print).toContainText('Gastroenterolog');
  await expect(print).not.toContainText('Dr. Test Gastro');
  await context.close();
});
