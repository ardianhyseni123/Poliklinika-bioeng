import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { USERS, createEnv, dbAs, id, resetData, seed } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await resetData(env); });

const NOW = '2026-11-14T10:00:00.000Z';

function appointment(appointmentId = id()) {
  return {
    id: appointmentId, patientId: id(), patientName: 'Test Pacient', appointmentAt: '2026-11-15T09:00',
    status: 'Caktuar', specialty: 'Kardiologji', clinician: 'Dr. Kardio', phone: '044000000', note: '', createdAt: NOW
  };
}

function payment(recordedBy: string, paymentId = id()) {
  return {
    id: paymentId, patientId: id(), patientName: 'Test Pacient', amount: 25, status: 'PAID',
    paymentDate: '2026-11-14', note: '', recordedAt: NOW, recordedBy, reportId: id(), reportLabel: 'Laborator', reportTotal: 25
  };
}

function auditEntry(actor: (typeof USERS)[keyof typeof USERS], who: string, tag = { reportType: 'specialist', specialty: 'Kardiologji' }) {
  return {
    id: id(), action: 'REPORT_CREATED', reportId: id(), patientId: id(), at: NOW, revision: 1,
    actorUid: `uid-${who}`, actorEmail: actor.email, actorRole: actor.role, ...tag
  };
}

describe('appointments and payments are laboratory-only', () => {
  test('administrator and laboratory manage them', async () => {
    for (const who of ['admin', 'lab'] as const) {
      const db = dbAs(env, who);
      const a = appointment();
      await assertSucceeds(setDoc(doc(db, 'appointments', a.id), a));
      await assertSucceeds(setDoc(doc(db, 'appointments', a.id), { ...a, status: 'Përfunduar', updatedAt: NOW }));
      await assertSucceeds(getDocs(collection(db, 'appointments')));
      const p = payment(USERS[who].email);
      await assertSucceeds(setDoc(doc(db, 'payments', p.id), p));
      await assertSucceeds(getDocs(collection(db, 'payments')));
    }
  });

  test('specialists and people without a profile have no access', async () => {
    for (const who of ['kardio', 'inactive', 'noProfile'] as const) {
      const db = dbAs(env, who);
      const a = appointment();
      await assertFails(setDoc(doc(db, 'appointments', a.id), a));
      await assertFails(getDocs(collection(db, 'appointments')));
      const p = payment(USERS.kardio.email);
      await assertFails(setDoc(doc(db, 'payments', p.id), p));
      await assertFails(getDocs(collection(db, 'payments')));
    }
  });

  test('a payment is recorded under the signed-in email and never deleted', async () => {
    const db = dbAs(env, 'lab');
    const forged = payment(USERS.admin.email);
    await assertFails(setDoc(doc(db, 'payments', forged.id), forged));
    const p = payment(USERS.lab.email);
    await seed(env, { [`payments/${p.id}`]: p });
    await assertFails(deleteDoc(doc(db, 'payments', p.id)));
    await assertFails(setDoc(doc(db, 'payments', p.id), { ...p, status: 'OWED' }));
  });
});

describe('audit', () => {
  test('a specialist writes audit entries only as themselves and for their specialty', async () => {
    const db = dbAs(env, 'kardio');
    const ok = auditEntry(USERS.kardio, 'kardio');
    await assertSucceeds(setDoc(doc(db, 'audit', ok.id), ok));
    const asSomeoneElse = { ...auditEntry(USERS.kardio, 'kardio'), actorEmail: USERS.lab.email };
    await assertFails(setDoc(doc(db, 'audit', asSomeoneElse.id), asSomeoneElse));
    const otherSpecialty = auditEntry(USERS.kardio, 'kardio', { reportType: 'specialist', specialty: 'Pulmologji' });
    await assertFails(setDoc(doc(db, 'audit', otherSpecialty.id), otherSpecialty));
    await assertFails(getDocs(collection(db, 'audit'))); // only the laboratory reads the audit log
  });

  test('the audit log is append-only', async () => {
    const db = dbAs(env, 'lab');
    const entry = auditEntry(USERS.lab, 'lab', { reportType: 'laboratory', specialty: 'Laborator' });
    await assertSucceeds(setDoc(doc(db, 'audit', entry.id), entry));
    await assertSucceeds(setDoc(doc(db, 'audit', entry.id), entry)); // an unchanged resend is fine
    await assertFails(setDoc(doc(db, 'audit', entry.id), { ...entry, action: 'REPORT_DELETED' }));
    await assertFails(deleteDoc(doc(db, 'audit', entry.id)));
    await assertSucceeds(getDocs(collection(dbAs(env, 'admin'), 'audit')));
  });
});

describe('analysis catalog', () => {
  function catalog(revision: number, by: string) {
    return { id: 'current', revision, updatedAt: NOW, updatedBy: by, categories: [] };
  }
  function history(revision: number, by: string) {
    return { id: id(), at: NOW, by, revision, changes: [] };
  }
  function saveCatalog(db: ReturnType<typeof dbAs>, revision: number, by: string, historyRevision = revision) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'analysisCatalog', 'current'), catalog(revision, by));
    const entry = history(historyRevision, by);
    batch.set(doc(db, 'catalogHistory', entry.id), entry);
    return batch.commit();
  }

  test('the laboratory saves revisions one at a time, each with its history entry', async () => {
    const db = dbAs(env, 'lab');
    await assertSucceeds(saveCatalog(db, 1, USERS.lab.email));
    await assertFails(saveCatalog(db, 3, USERS.lab.email)); // revisions cannot skip
    await assertSucceeds(saveCatalog(dbAs(env, 'admin'), 2, USERS.admin.email));
    await assertFails(saveCatalog(db, 3, USERS.lab.email, 2)); // history must match the new revision
  });

  test('a history entry cannot be written on its own', async () => {
    await seed(env, { 'analysisCatalog/current': catalog(1, USERS.lab.email) });
    const db = dbAs(env, 'lab');
    const entry = history(2, USERS.lab.email);
    await assertFails(setDoc(doc(db, 'catalogHistory', entry.id), entry));
  });

  test('specialists cannot read or change the catalog', async () => {
    await seed(env, { 'analysisCatalog/current': catalog(1, USERS.lab.email) });
    const db = dbAs(env, 'kardio');
    await assertFails(getDocs(collection(db, 'analysisCatalog')));
    await assertFails(saveCatalog(db, 2, USERS.kardio.email));
  });
});

describe('everything else is closed', () => {
  test('unknown collections and the import marker are denied', async () => {
    const db = dbAs(env, 'admin');
    await assertFails(setDoc(doc(db, 'anything', 'x'), { a: 1 }));
    await assertFails(getDocs(collection(db, '_bioeng_imports')));
  });
});
