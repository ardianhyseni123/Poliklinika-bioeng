// Printouts of the new app compared with the old one, for the same patient and report data.
//
// The old app (docs/) runs in its local-only mode: its Firebase config is replaced with null
// on the way to the browser, and its built-in laboratory account gets a throwaway password in
// the served page. Nothing reaches Firebase and no real password is used. The printed text
// must match exactly; screenshots of both (print styles applied) are saved for a visual check
// in test-results/print-parity/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { OLD_APP_URL } from '../../playwright.config';
import { editorField, login, unique } from './helpers';

const OUT = 'test-results/print-parity';
const PARITY_PASSWORD = 'parity-test-only';

interface Patient { firstName: string; lastName: string; dob: string; gender: string; phone: string }

type Kind = 'laboratory' | 'kardiologji' | 'neurologji' | 'hixhame';
// A distinct time per report, so each can be found in the report list.
const REPORT_AT: Record<Kind, string> = { laboratory: '2026-11-14T08:30', kardiologji: '2026-11-14T09:30', neurologji: '2026-11-14T10:30', hixhame: '2026-11-14T11:30' };
const shown = (kind: Kind) => REPORT_AT[kind].replace('T', ' ');

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function printedText(content: Locator): Promise<string> {
  return normalize(await content.innerText());
}

async function shoot(page: Page, content: Locator, file: string) {
  await page.emulateMedia({ media: 'print' });
  await content.screenshot({ path: `${OUT}/${file}` });
  await page.emulateMedia({ media: 'screen' });
}

// ---- Old app --------------------------------------------------------------------------

async function openOldApp(page: Page) {
  await page.route('**/firebase-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.BIOENG_FIREBASE_CONFIG = null;' }));
  await page.route(/\/(index\.html)?$/, async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/('admin@bioeng\.com':\{pass:')[^']*'/, `$1${PARITY_PASSWORD}'`);
    await route.fulfill({ response, body: html });
  });
  await page.goto(`${OLD_APP_URL}/`);
  await page.fill('#loginEmail', 'admin@bioeng.com');
  await page.fill('#loginPassword', PARITY_PASSWORD);
  await page.click('#loginButton');
  await expect(page.locator('#appShell')).toBeVisible();
}

async function oldPatient(page: Page, patient: Patient) {
  await page.locator('summary', { hasText: 'Shto pacient të ri' }).click();
  await page.fill('#firstName', patient.firstName);
  await page.fill('#lastName', patient.lastName);
  await page.fill('#dob', patient.dob);
  await page.selectOption('#gender', patient.gender);
  await page.fill('#phone', patient.phone);
  await page.click('#savePatient');
  await expect(page.locator('#status')).toContainText('Pacienti u ruajt');
}

async function oldReport(page: Page, kind: Kind): Promise<Locator> {
  await page.click('#newReport');
  await page.fill('#reportAt', REPORT_AT[kind]);
  if (kind === 'laboratory') {
    await page.selectOption('#reportType', 'laboratory');
    const pick = async (category: string, label: string) => {
      await page.selectOption('#analysisCategory', { label: category });
      await page.selectOption('#analysisCatalogSelect', { label });
    };
    await pick('Biokimi', 'Glukoza esull — mmol/L');
    await pick('Biokimi', 'Urea — mmol/L');
    await pick('Hematologji', 'HGB Hemoglobina — g/L');
    const results = page.locator('.resultInput');
    await results.nth(0).fill('7.2');
    await results.nth(1).fill('5');
    await results.nth(2).fill('102');
  } else {
    await page.selectOption('#reportType', 'specialist');
    const specialty = { kardiologji: 'Kardiologji', neurologji: 'Neurologji', hixhame: 'Hixhame' }[kind];
    await page.selectOption('#specialty', specialty);
    await page.fill('#clinician', kind === 'neurologji' ? 'Dr. Dikush Tjetër' : 'Dr. Test Kardio');
    await page.fill('#clinicianTitle', kind === 'hixhame' ? 'Njësia e Hixhames' : 'Specialist');
    await page.fill('#anamnesis', 'Ankesa prej dy javësh');
    await page.fill('#physicalExam', 'TA 140/90');
    await page.locator('#diagnoses label').first().locator('input').check();
    await page.locator('#requestedExams label').first().locator('input').check();
    await page.fill('#therapy', 'Pushim dhe kontroll');
    if (kind === 'hixhame') {
      await page.locator('.serviceCheck').first().check();
      await page.locator('.choice-buttons[data-choice="cups"] button[data-value="13"]').click();
      await page.locator('.cupPosition[value="Shpinë"]').check();
    }
  }
  await page.fill('#notes', 'Shënim shtesë për printim');
  await page.click('#saveReport');
  await expect(page.locator('#status')).toContainText('u ruajt');
  await page.locator('#reportRows tr', { hasText: shown(kind) }).locator('.openPrint').click();
  const content = page.locator('#printContent');
  await expect(content).toContainText('Raport mjekësor');
  return content;
}

// ---- New app --------------------------------------------------------------------------

async function newPatient(page: Page, patient: Patient) {
  await page.getByText('Shto pacient të ri').click();
  const card = page.getByTestId('patients-card');
  await card.getByTestId('new-first-name').fill(patient.firstName);
  await card.getByTestId('new-last-name').fill(patient.lastName);
  await card.locator('label', { hasText: 'Datëlindja' }).locator('input').fill(patient.dob);
  await card.locator('label', { hasText: 'Gjinia' }).locator('select').selectOption(patient.gender);
  await card.getByRole('textbox', { name: 'Telefoni', exact: true }).fill(patient.phone);
  await page.getByRole('button', { name: 'Ruaj pacientin' }).click();
  await expect(page.getByTestId('status')).toContainText('u ruajt');
}

async function newReport(page: Page, kind: Kind): Promise<Locator> {
  await page.getByRole('button', { name: 'Raport i ri' }).click();
  const editor = page.getByTestId('report-editor');
  await editor.getByLabel('Data dhe ora').fill(REPORT_AT[kind]);
  if (kind === 'laboratory') {
    await editor.getByLabel('Lloji i raportit').selectOption('laboratory');
    const pick = async (category: string, label: string) => {
      await editor.getByLabel('Kategoria').selectOption({ label: category });
      await page.getByTestId('analysis-picker').selectOption({ label });
    };
    await pick('Biokimi', 'Glukoza esull — mmol/L');
    await pick('Biokimi', 'Urea — mmol/L');
    await pick('Hematologji', 'HGB Hemoglobina — g/L');
    const results = page.locator('#analysisRows input[inputmode=decimal]');
    await results.nth(0).fill('7.2');
    await results.nth(1).fill('5');
    await results.nth(2).fill('102');
  } else {
    await editor.getByLabel('Lloji i raportit').selectOption('specialist');
    const specialty = { kardiologji: 'Kardiologji', neurologji: 'Neurologji', hixhame: 'Hixhame' }[kind];
    await editor.getByLabel('Specialiteti').selectOption(specialty);
    await editor.getByPlaceholder('p.sh. Dr. Emër Mbiemër').fill(kind === 'neurologji' ? 'Dr. Dikush Tjetër' : 'Dr. Test Kardio');
    await editor.getByPlaceholder('p.sh. Specialist i Kardiologjisë').fill(kind === 'hixhame' ? 'Njësia e Hixhames' : 'Specialist');
    await editorField(page, 'Anamneza dhe ankesat').fill('Ankesa prej dy javësh');
    await editorField(page, 'Ekzaminimi fizik').fill('TA 140/90');
    await editor.locator('.checks').nth(0).locator('input').first().check();
    await editor.locator('.checks').nth(1).locator('input').first().check();
    await editorField(page, kind === 'hixhame' ? 'Udhëzime pas procedurës' : 'Terapia e rekomanduar').fill('Pushim dhe kontroll');
    if (kind === 'hixhame') {
      const panel = page.getByTestId('hixhame-panel');
      await panel.locator('.checks').first().locator('input').first().check();
      await panel.getByRole('button', { name: '13 kupa' }).click();
      await panel.getByLabel('Shpinë').first().check();
    }
  }
  await editorField(page, 'Shënime shtesë').fill('Shënim shtesë për printim');
  await page.getByTestId('save-report').click();
  await expect(page.getByTestId('status')).toContainText('u ruajt');
  await page.getByTestId('report-list').locator('tbody tr', { hasText: shown(kind) }).getByRole('button', { name: 'Shfaq' }).click();
  const content = page.getByTestId('print-content');
  await expect(content).toContainText('Raport mjekësor');
  return content;
}

// ---- The comparison -------------------------------------------------------------------

test('printed reports match the old app, word for word', async ({ browser }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const patient: Patient = { firstName: 'Gentiana', lastName: unique('Printim'), dob: '1980-05-04', gender: 'Femër', phone: '044123456' };

  const oldContext = await browser.newContext();
  const oldPage = await oldContext.newPage();
  await openOldApp(oldPage);
  await oldPatient(oldPage, patient);

  const newContext = await browser.newContext();
  const newPage = await newContext.newPage();
  await login(newPage, 'lab@bioeng.test');
  await newPatient(newPage, patient);

  const results: Record<string, { old: string; new: string }> = {};
  for (const kind of ['laboratory', 'kardiologji', 'neurologji', 'hixhame'] as const) {
    const before = await oldReport(oldPage, kind);
    const after = await newReport(newPage, kind);
    results[kind] = { old: await printedText(before), new: await printedText(after) };
    await shoot(oldPage, before, `${kind}-old.png`);
    await shoot(newPage, after, `${kind}-new.png`);
  }
  writeFileSync(`${OUT}/printed-text.json`, JSON.stringify(results, null, 2));

  for (const [kind, { old, new: rebuilt }] of Object.entries(results)) {
    expect.soft(rebuilt, `${kind} printout`).toBe(old);
  }
  // The old app's fixed neurology signature is kept, whatever clinician was typed.
  expect(results.neurologji?.new).toContain('Dr. Nezir Demiolli');
  await oldContext.close();
  await newContext.close();
});
