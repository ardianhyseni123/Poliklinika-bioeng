import { expect, test } from '@playwright/test';
import { login, serverDoc, signedIn, uidOf } from './helpers';

test("held reports of the old app are not uploaded at login; its attachments come over", async ({ browser }) => {
  const uid = await uidOf('kardiolog@bioeng.test');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');

  // The old app's database on this computer, as the rule bug left it, with a file attached.
  const ids = await page.evaluate(async uid => {
    const now = '2026-11-10T09:15:00.000Z';
    const patient = { id: crypto.randomUUID(), firstName: 'Gentiana', lastName: 'Morina', dob: '', gender: 'Femër', phone: '', address: '', archived: false, createdAt: now };
    const report = {
      id: crypto.randomUUID(), patientId: patient.id, type: 'specialist', specialty: 'Kardiologji', reportAt: '2026-11-10T09:00',
      clinician: 'Dr. Test Kardio', clinicianTitle: 'Specialist i Kardiologjisë', anamnesis: 'Raport i mbetur në kompjuter', physicalExam: '',
      existingResults: '', diagnoses: [], customDiagnoses: '', requestedExams: [], therapy: '', notes: '', analyses: [], hixhame: null,
      createdAt: now, updatedAt: now, revision: 1
    };
    const blocked = { blockedAt: now, blockedCode: 'permission-denied', blockedCategory: 'permission' };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`BioengClinicalDB-${uid}`, 7);
      request.onupgradeneeded = () => {
        for (const store of ['patients', 'reports', 'audit', 'appointments', 'payments', 'attachments', 'syncQueue', 'analysisCatalog', 'catalogHistory']) {
          request.result.createObjectStore(store, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
    });
    const transaction = db.transaction(['syncQueue', 'attachments'], 'readwrite');
    transaction.objectStore('syncQueue').put({ id: `patients:${patient.id}`, store: 'patients', operation: 'put', recordId: patient.id, queuedAt: now, queuedByEmail: 'kardiolog@bioeng.test', value: patient });
    transaction.objectStore('syncQueue').put({ id: `reports:${report.id}`, store: 'reports', operation: 'put', recordId: report.id, queuedAt: now, queuedByEmail: 'kardiolog@bioeng.test', value: report, expectedRevision: 0, ...blocked });
    transaction.objectStore('attachments').put({ id: crypto.randomUUID(), reportId: crypto.randomUUID(), name: 'ekg.pdf', type: 'application/pdf', size: 3, uploadedAt: now, blob: new Blob(['pdf'], { type: 'application/pdf' }) });
    await new Promise(resolve => { transaction.oncomplete = resolve; });
    db.close();
    return { reportId: report.id, patientId: patient.id };
  }, uid);

  await login(page, 'kardiolog@bioeng.test');
  const notice = page.getByTestId('rescue-notice');
  await expect(notice).toContainText('U sollën dokumentet e versionit të vjetër');
  await expect(notice).toContainText('1 bashkëngjitje u ruajt në këtë kompjuter.');
  await expect(notice).not.toContainText('raport');
  // The notice comes after the old database was read: nothing went to the server.
  expect(await serverDoc(`reports/${ids.reportId}`)).toBeNull();
  expect(await serverDoc(`patients/${ids.patientId}`)).toBeNull();

  // Only once.
  await page.reload();
  await expect(page.getByTestId('report-editor')).toBeVisible();
  await expect(page.getByTestId('rescue-notice')).toHaveCount(0);
  await context.close();
});

test('the Administrator gives a new person a role, and takes it away, with immediate effect', async ({ browser }) => {
  const admin = await signedIn(browser, 'admin@bioeng.test');
  const newcomer = await browser.newContext();
  const page = await newcomer.newPage();
  await login(page, 'i-ri@bioeng.test');
  await expect(page.getByRole('alert')).toContainText('nuk ka rol');

  const users = admin.page.getByTestId('users-card');
  await users.getByLabel('Email').fill('i-ri@bioeng.test');
  await users.getByLabel('Roli').selectOption('Pulmologji');
  await users.getByLabel('Emri (shfaqet dhe printohet)').fill('Dr. E Re');
  await users.getByRole('button', { name: 'Shto përdoruesin' }).click();

  // The newcomer's open page switches to the pulmonology screens without logging in again.
  await expect(page.getByRole('heading', { name: 'Kontrollet e Pulmologji' })).toBeVisible();
  await expect(page.getByTestId('logged-role')).toHaveText('Roli: Specialist i Pulmologjisë');

  await users.locator('tr', { hasText: 'i-ri@bioeng.test' }).getByRole('button', { name: 'Ndrysho' }).click();
  await users.getByLabel('Aktiv').uncheck();
  await users.getByRole('button', { name: 'Ruaj ndryshimet' }).click();
  await expect(page.getByRole('alert')).toContainText('çaktivizuar');
  await expect(page.getByTestId('report-editor')).toHaveCount(0);
  await admin.context.close();
  await newcomer.close();
});
