import { expect, test } from '@playwright/test';
import { createPatient, editorField, selectPatient, serverList, signedIn, unique } from './helpers';

test('a doctor creates a patient and a report; the laboratory sees and prints it', async ({ browser }) => {
  const lastName = unique('Doktor');
  const doctor = await signedIn(browser, 'kardiolog@bioeng.test');
  await createPatient(doctor.page, 'Valon', lastName);
  await editorField(doctor.page, 'Anamneza dhe ankesat').fill('Dhimbje gjoksi gjatë ecjes');
  await doctor.page.getByTestId('report-editor').getByLabel('Hipertension arterial').check();
  await editorField(doctor.page, 'Terapia e rekomanduar').fill('Bisoprolol 2.5 mg');
  await doctor.page.getByTestId('save-report').click();
  await expect(doctor.page.getByTestId('status')).toContainText('versioni 1');
  await expect(doctor.page.getByTestId('report-list').locator('tbody tr')).toHaveCount(1);

  // On the server, with the doctor's own signature (this is what the old app could not do).
  await expect.poll(async () => (await serverList('reports')).filter(report => report.therapy === 'Bisoprolol 2.5 mg').map(report => report.clinician)).toEqual(['Dr. Test Kardio']);

  const lab = await signedIn(browser, 'lab@bioeng.test');
  await selectPatient(lab.page, lastName);
  await lab.page.getByTestId('report-list').getByRole('button', { name: 'Shfaq' }).click();
  const print = lab.page.getByTestId('print-content');
  await expect(print).toContainText('Bisoprolol 2.5 mg');
  await expect(print).toContainText('Hipertension arterial');
  await expect(print).toContainText('Mjeku kontrollues');
  await expect(print).toContainText('Dr. Test Kardio');
  await doctor.context.close();
  await lab.context.close();
});

test('the laboratory builds a lab report from the analysis list, with H/L marks and payments', async ({ browser }) => {
  const lastName = unique('Lab');
  const { context, page } = await signedIn(browser, 'lab@bioeng.test');
  await createPatient(page, 'Arbër', lastName);
  const picker = page.getByTestId('analysis-picker');
  await picker.selectOption({ label: 'Glukoza esull — mmol/L' });
  await picker.selectOption({ label: 'Urea — mmol/L' });
  await picker.selectOption({ label: 'Glukoza esull — mmol/L' });
  await expect(page.getByTestId('status')).toContainText('tashmë në listë');
  const results = page.locator('#analysisRows input[inputmode=decimal]');
  await results.nth(0).fill('7.4');
  await results.nth(1).fill('5');
  await expect(page.locator('#analysisRows .resultFlag')).toHaveText(['H']);
  await page.getByTestId('save-report').click();
  await expect(page.getByTestId('status')).toContainText('versioni 1');

  const payments = page.getByTestId('payments-card');
  await payments.locator('select').first().selectOption({ index: 1 });
  await payments.getByLabel('Vlera totale e raportit (€)').fill('30');
  await payments.getByLabel('Pagesa e bërë tani (€)').fill('10');
  await payments.getByRole('button', { name: 'Ruaj pagesën' }).click();
  await expect(payments.locator('.payment-history tbody tr').first()).toContainText('20.00 €');
  await payments.getByLabel('Pagesa e bërë tani (€)').fill('25');
  await payments.getByRole('button', { name: 'Ruaj pagesën' }).click();
  await expect(page.getByTestId('status')).toHaveText('Pagesa nuk mund të jetë më e madhe se vlera e mbetur e raportit.');
  await context.close();
});
