import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Journal } from '../../src/data/journal';
import { legacyDatabaseName, rescueLegacyChanges, type MarkerStore } from '../../src/data/legacyRescue';
import { findConflict } from '../../src/domain/history';
import type { Report, Version } from '../../src/data/schemas';
import { AttachmentStore } from '../../src/local/attachments';
import { openDatabase } from '../../src/local/idb';
import { USERS, createEnv, id, patient, resetData, seed } from '../rules/helpers';
import { device, sampleDraft, serverList, serverRead, uniqueSuffix } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await resetData(env); });

const NOW = '2026-11-01T10:00:00.000Z';

/** A report as the old app stored it: no lastVersionId. */
function oldReport(overrides: Record<string, unknown> = {}) {
  return {
    ...sampleDraft(id()),
    id: id(),
    clinician: USERS.kardio.name,
    clinicianTitle: USERS.kardio.title,
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1,
    ...overrides
  };
}

/** Builds the old app's per-account database the way it was left on a doctor's computer. */
async function createLegacyDatabase(uid: string, queue: object[], attachments: object[] = []): Promise<void> {
  const db = await openDatabase(legacyDatabaseName(uid), 7, database => {
    for (const store of ['patients', 'reports', 'audit', 'appointments', 'payments', 'attachments', 'syncQueue', 'analysisCatalog', 'catalogHistory']) {
      database.createObjectStore(store, { keyPath: 'id' });
    }
  });
  const transaction = db.transaction(['syncQueue', 'attachments'], 'readwrite');
  for (const item of queue) transaction.objectStore('syncQueue').put(item);
  for (const item of attachments) transaction.objectStore('attachments').put(item);
  await new Promise(resolve => { transaction.oncomplete = resolve; });
  db.close();
}

function held(store: string, operation: 'put' | 'delete', value: Record<string, unknown>, extra: object = {}) {
  return {
    id: `${store}:${value.id as string}`, generationToken: id(), store, operation, recordId: value.id, queuedAt: NOW,
    queuedByEmail: USERS.kardio.email, queuedByRole: 'Kardiologji', value,
    blockedAt: NOW, blockedCode: 'permission-denied', blockedCategory: 'permission', ...extra
  };
}

function memoryMarkers(): MarkerStore {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('the old app on this computer, as the app handles it now', () => {
  test('nothing it held back is uploaded; its attachments come over; it is deleted after 30 days', async () => {
    const uid = `uid-kardio-${uniqueSuffix()}`;
    const heldPatient = patient();
    const heldReport = oldReport({ patientId: heldPatient.id, anamnesis: 'Raport i futur sërish nga mjeku' });
    await createLegacyDatabase(uid, [
      held('patients', 'put', heldPatient),
      held('reports', 'put', heldReport, { expectedRevision: 0 })
    ], [
      { id: id(), reportId: id(), name: 'eho.png', type: 'image/png', size: 3, uploadedAt: NOW, blob: new Blob(['png'], { type: 'image/png' }) }
    ]);
    const attachments = await AttachmentStore.open(USERS.kardio.email);
    const markers = memoryMarkers();
    const run = (extra: { uploadHeldChanges?: boolean; now?: () => Date } = {}) =>
      rescueLegacyChanges({ ctx: device(env, 'kardio'), uid, attachments, recordFailure: () => undefined, markers, ...extra });

    expect(await run()).toMatchObject({ status: 'done', found: 0, reports: 0, patients: 0, attachments: 1 });
    expect(await serverRead(env, `reports/${heldReport.id}`)).toBeUndefined();
    expect(await serverRead(env, `patients/${heldPatient.id}`)).toBeUndefined();
    expect((await run()).status).toBe('alreadyDone');

    // Within the 30 days, turning the upload back on would still find the held changes.
    expect(await run({ uploadHeldChanges: true })).toMatchObject({ status: 'done', found: 2, reports: 1, patients: 1 });
    await expect.poll(() => serverRead(env, `reports/${heldReport.id}`)).toBeDefined();

    // After 30 days the old database is removed from the computer.
    await run({ now: () => new Date(Date.now() + 31 * 86_400_000) });
    await expect.poll(async () => (await indexedDB.databases()).some(item => item.name === legacyDatabaseName(uid))).toBe(false);
    attachments.close();
  });
});

describe('rescue of changes held by the old app (switched off in the app; kept working)', () => {
  test('held reports, patients and attachments reach the server; edits that raced are kept as conflicts', async () => {
    const uid = `uid-kardio-${uniqueSuffix()}`;
    const newPatient = patient();
    const neverSynced = oldReport({ patientId: newPatient.id, anamnesis: 'Raport që mbeti në kompjuter' });

    // On the server since before: one report untouched since, one edited elsewhere meanwhile.
    const untouched = oldReport({ revision: 2 });
    const editedElsewhere = oldReport({ revision: 3, therapy: 'Ndryshuar nga laboratori' });
    const toDelete = oldReport({ revision: 1 });
    await seed(env, {
      [`reports/${untouched.id}`]: untouched,
      [`reports/${editedElsewhere.id}`]: editedElsewhere,
      [`reports/${toDelete.id}`]: toDelete
    });

    await createLegacyDatabase(uid, [
      held('patients', 'put', newPatient),
      held('reports', 'put', neverSynced, { expectedRevision: 0 }),
      held('reports', 'put', { ...untouched, revision: 3, notes: 'Shënim offline' }, { expectedRevision: 2 }),
      held('reports', 'put', { ...editedElsewhere, revision: 2, notes: 'Shënim i vjetër offline' }, { expectedRevision: 1 }),
      held('reports', 'delete', { id: toDelete.id, patientId: toDelete.patientId, type: 'specialist', specialty: 'Kardiologji' }, { expectedRevision: 1 }),
      held('audit', 'put', { id: id(), action: 'REPORT_CREATED', reportId: neverSynced.id, patientId: newPatient.id, at: NOW, revision: 1, reportType: 'specialist', specialty: 'Kardiologji' }),
      // Someone else's change in the same queue is not replayed under this account.
      held('patients', 'put', patient(), { queuedByEmail: 'someone.else@bioeng.test' })
    ], [
      { id: id(), reportId: neverSynced.id, name: 'ekg.pdf', type: 'application/pdf', size: 3, uploadedAt: NOW, blob: new Blob(['pdf'], { type: 'application/pdf' }) }
    ]);

    const journal = await Journal.open(`kardio-${uniqueSuffix()}@bioeng.test`);
    const ctx = device(env, 'kardio', journal);
    const attachments = await AttachmentStore.open(USERS.kardio.email);
    const markers = memoryMarkers();
    const summary = await rescueLegacyChanges({ ctx, uid, attachments, recordFailure: (input, error) => journal.recordFailure(input, error), markers, uploadHeldChanges: true });

    expect(summary).toMatchObject({
      status: 'done', found: 6, patients: 1, reports: 2, conflicts: 1, deletions: 1, audit: 1, unrestored: 0, attachments: 1
    });

    // Everything reaches the server.
    await expect.poll(() => serverRead(env, `patients/${newPatient.id}`)).toBeDefined();
    // A patient the doctor registered is assigned to the doctor, as a new one would be.
    expect((await serverRead<{ specialties?: string[] }>(env, `patients/${newPatient.id}`))?.specialties).toEqual(['Kardiologji']);
    await expect.poll(async () => (await serverRead<Report>(env, `reports/${neverSynced.id}`))?.anamnesis).toBe('Raport që mbeti në kompjuter');
    await expect.poll(async () => (await serverRead<Report>(env, `reports/${untouched.id}`))?.notes).toBe('Shënim offline');
    await expect.poll(async () => (await serverRead<Record<string, unknown>>(env, `reports/${toDelete.id}`))?._deleted).toBe(true);

    // The edit that raced is kept next to what the server had, flagged as a conflict.
    await expect.poll(async () => (await serverList(env, `reports/${editedElsewhere.id}/versions`)).length).toBe(2);
    const head = await serverRead<Report>(env, `reports/${editedElsewhere.id}`);
    const versions = await serverList<Version>(env, `reports/${editedElsewhere.id}/versions`);
    const conflict = findConflict(head!, versions);
    expect(conflict?.current?.report).toMatchObject({ notes: 'Shënim i vjetër offline' });
    expect(conflict?.others[0]?.report).toMatchObject({ therapy: 'Ndryshuar nga laboratori' });

    // The attachment is now in the new local store.
    expect((await attachments.list(neverSynced.id)).map(item => item.name)).toEqual(['ekg.pdf']);

    // Running again does nothing.
    expect((await rescueLegacyChanges({ ctx, uid, attachments, recordFailure: () => undefined, markers, uploadHeldChanges: true })).status).toBe('alreadyDone');
    attachments.close();
  });

  test('an edit to a report deleted meanwhile is kept in the journal for a person to recover', async () => {
    const uid = `uid-kardio-${uniqueSuffix()}`;
    const report = oldReport();
    await seed(env, {
      [`reports/${report.id}`]: { id: report.id, patientId: report.patientId, type: 'specialist', specialty: 'Kardiologji', _deleted: true, deletedAt: NOW, deletedBy: USERS.lab.email, baseRevision: 1 }
    });
    await createLegacyDatabase(uid, [held('reports', 'put', { ...report, revision: 2, therapy: 'Terapi e rëndësishme' }, { expectedRevision: 1 })]);

    const journal = await Journal.open(`kardio-${uniqueSuffix()}@bioeng.test`);
    const attachments = await AttachmentStore.open(USERS.kardio.email);
    const summary = await rescueLegacyChanges({
      ctx: device(env, 'kardio', journal), uid, attachments, recordFailure: (input, error) => journal.recordFailure(input, error), markers: memoryMarkers(), uploadHeldChanges: true
    });
    expect(summary).toMatchObject({ status: 'done', unrestored: 1, reports: 0 });
    expect(journal.failed()[0]).toMatchObject({ error: 'deleted-on-server', content: { therapy: 'Terapi e rëndësishme' } });
    attachments.close();
  });

  test('a held patient that is already on the server, assigned to others, is left as it is', async () => {
    const uid = `uid-kardio-${uniqueSuffix()}`;
    const onServer = patient(id(), { specialties: ['Pulmologji'], assignedAt: NOW });
    await seed(env, { [`patients/${onServer.id}`]: onServer });
    const asTheOldAppHadIt = patient(onServer.id); // same patient, no assignment
    await createLegacyDatabase(uid, [held('patients', 'put', asTheOldAppHadIt)]);

    const attachments = await AttachmentStore.open(USERS.kardio.email);
    const summary = await rescueLegacyChanges({
      ctx: device(env, 'kardio'), uid, attachments, recordFailure: () => undefined, markers: memoryMarkers(), uploadHeldChanges: true
    });
    expect(summary).toMatchObject({ status: 'done', alreadyOnServer: 1, patients: 0 });
    expect((await serverRead<{ specialties?: string[] }>(env, `patients/${onServer.id}`))?.specialties).toEqual(['Pulmologji']);
    attachments.close();
  });

  test('a computer that never ran the old app has nothing to rescue', async () => {
    const attachments = await AttachmentStore.open(USERS.kardio.email);
    const summary = await rescueLegacyChanges({
      ctx: device(env, 'kardio'), uid: `uid-never-${uniqueSuffix()}`, attachments, recordFailure: () => undefined, markers: memoryMarkers()
    });
    expect(summary.status).toBe('nothingFound');
    expect((await indexedDB.databases()).some(item => item.name?.includes('uid-never'))).toBe(false);
    attachments.close();
  });
});
