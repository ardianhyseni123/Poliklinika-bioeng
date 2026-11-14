import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { NO_PROFILE, USERS, createEnv, dbAs, id, patient, report, resetData, saveReport, seed, versionOf } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await resetData(env); });

function userDoc(email: string, role: string, extra: object = {}) {
  return {
    email,
    role,
    name: 'Emri Mbiemri',
    title: role === 'Laborator' || role === 'Administrator' ? '' : 'Specialist',
    active: true,
    updatedAt: '2026-11-14T10:00:00.000Z',
    updatedBy: USERS.admin.email,
    ...extra
  };
}

describe('users', () => {
  test('everyone with an account reads their own profile, even when inactive or missing', async () => {
    await assertSucceeds(getDoc(doc(dbAs(env, 'kardio'), 'users', USERS.kardio.email)));
    await assertSucceeds(getDoc(doc(dbAs(env, 'inactive'), 'users', USERS.inactive.email)));
    await assertSucceeds(getDoc(doc(dbAs(env, 'noProfile'), 'users', NO_PROFILE)));
    await assertFails(getDoc(doc(dbAs(env, 'anonymous'), 'users', USERS.kardio.email)));
  });

  test('only the administrator reads other profiles and lists users', async () => {
    await assertSucceeds(getDocs(collection(dbAs(env, 'admin'), 'users')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'admin'), 'users', USERS.kardio.email)));
    for (const who of ['lab', 'kardio'] as const) {
      await assertFails(getDocs(collection(dbAs(env, who), 'users')));
      await assertFails(getDoc(doc(dbAs(env, who), 'users', USERS.admin.email)));
    }
  });

  test('only the administrator assigns roles', async () => {
    const email = 'new.doctor@bioeng.test';
    await assertSucceeds(setDoc(doc(dbAs(env, 'admin'), 'users', email), userDoc(email, 'Neurologji')));
    await assertFails(setDoc(doc(dbAs(env, 'lab'), 'users', email), userDoc(email, 'Neurologji', { updatedBy: USERS.lab.email })));
    // Nobody can promote themselves.
    await assertFails(setDoc(doc(dbAs(env, 'kardio'), 'users', USERS.kardio.email),
      userDoc(USERS.kardio.email, 'Administrator', { updatedBy: USERS.kardio.email })));
  });

  test('profiles are validated', async () => {
    const admin = dbAs(env, 'admin');
    await assertFails(setDoc(doc(admin, 'users', 'x@bioeng.test'), userDoc('x@bioeng.test', 'Superuser')));
    await assertFails(setDoc(doc(admin, 'users', 'x@bioeng.test'), userDoc('x@bioeng.test', 'Kardiologji', { title: '' }))); // a specialist needs a title
    await assertFails(setDoc(doc(admin, 'users', 'x@bioeng.test'), userDoc('x@bioeng.test', 'Laborator', { name: '' })));
    await assertFails(setDoc(doc(admin, 'users', 'Upper@bioeng.test'), userDoc('Upper@bioeng.test', 'Laborator'))); // document ids are lowercase emails
    await assertFails(setDoc(doc(admin, 'users', 'x@bioeng.test'), userDoc('y@bioeng.test', 'Laborator')));
    await assertFails(setDoc(doc(admin, 'users', 'x@bioeng.test'), userDoc('x@bioeng.test', 'Laborator', { extra: 1 })));
    await assertFails(setDoc(doc(admin, 'users', 'x@bioeng.test'), userDoc('x@bioeng.test', 'Laborator', { updatedBy: 'someone@else' })));
  });

  test('profiles are never deleted (deactivate instead)', async () => {
    await assertFails(deleteDoc(doc(dbAs(env, 'admin'), 'users', USERS.kardio.email)));
  });

  test('a deactivated administrator loses access', async () => {
    await seed(env, { [`users/${USERS.admin.email}`]: { ...USERS.admin, active: false, updatedAt: 'x', updatedBy: USERS.admin.email } });
    await assertFails(getDocs(collection(dbAs(env, 'admin'), 'users')));
  });
});

describe('patients', () => {
  test('the laboratory reads every patient and creates them with any assignment', async () => {
    for (const who of ['admin', 'lab'] as const) {
      const db = dbAs(env, who);
      for (const specialties of [undefined, [], ['Kardiologji', 'Urologji']]) {
        const p = patient(id(), specialties ? { specialties } : {});
        await assertSucceeds(setDoc(doc(db, 'patients', p.id), p));
      }
      await assertSucceeds(getDocs(collection(db, 'patients')));
    }
  });

  test('a patient a specialist registers is assigned to that specialist only', async () => {
    const db = dbAs(env, 'kardio');
    const own = patient(id(), { specialties: ['Kardiologji'] });
    await assertSucceeds(setDoc(doc(db, 'patients', own.id), own));
    for (const extra of [{}, { specialties: [] }, { specialties: ['Pulmologji'] }, { specialties: ['Kardiologji', 'Pulmologji'] }]) {
      const p = patient(id(), extra);
      await assertFails(setDoc(doc(db, 'patients', p.id), p));
    }
    // The new specialties register patients too.
    const gastro = patient(id(), { specialties: ['Gastroenterologji'] });
    await assertSucceeds(setDoc(doc(dbAs(env, 'gastro'), 'patients', gastro.id), gastro));
  });

  test('a specialist lists only the patients assigned to their specialty', async () => {
    const mine = patient(id(), { specialties: ['Kardiologji', 'Urologji'] });
    const others = patient(id(), { specialties: ['Pulmologji'] });
    await seed(env, { [`patients/${mine.id}`]: mine, [`patients/${others.id}`]: others });
    const db = dbAs(env, 'kardio');
    await assertFails(getDocs(collection(db, 'patients')));
    await assertFails(getDocs(query(collection(db, 'patients'), where('specialties', 'array-contains', 'Pulmologji'))));
    const listed = await assertSucceeds(getDocs(query(collection(db, 'patients'), where('specialties', 'array-contains', 'Kardiologji'))));
    if (listed.docs.map(item => item.id).join() !== mine.id) throw new Error('expected only the assigned patient');
  });

  test('a specialist reads an assigned or old patient by id, never one assigned to others or to nobody', async () => {
    const assigned = patient(id(), { specialties: ['Kardiologji'] });
    const old = patient();
    const others = patient(id(), { specialties: ['Pulmologji'] });
    const nobody = patient(id(), { specialties: [] });
    await seed(env, Object.fromEntries([assigned, old, others, nobody].map(p => [`patients/${p.id}`, p])));
    const db = dbAs(env, 'kardio');
    await assertSucceeds(getDoc(doc(db, 'patients', assigned.id)));
    await assertSucceeds(getDoc(doc(db, 'patients', old.id)));
    await assertSucceeds(getDoc(doc(db, 'patients', id()))); // one that does not exist yet
    await assertFails(getDoc(doc(db, 'patients', others.id)));
    await assertFails(getDoc(doc(db, 'patients', nobody.id)));
    await assertSucceeds(getDoc(doc(dbAs(env, 'lab'), 'patients', nobody.id)));
  });

  test('without an active profile there is no access', async () => {
    for (const who of ['inactive', 'noProfile', 'anonymous'] as const) {
      const db = dbAs(env, who);
      const p = patient(id(), { specialties: ['Kardiologji'] });
      await assertFails(setDoc(doc(db, 'patients', p.id), p));
      await assertFails(getDocs(collection(db, 'patients')));
      await assertFails(getDocs(query(collection(db, 'patients'), where('specialties', 'array-contains', 'Kardiologji'))));
    }
  });

  test('only the laboratory changes, archives or assigns a patient', async () => {
    const p = patient(id(), { specialties: ['Kardiologji'] });
    await seed(env, { [`patients/${p.id}`]: p });
    const archived = { ...p, archived: true, archivedAt: '2026-11-14T11:00:00.000Z' };
    const reassigned = { ...p, specialties: ['Kardiologji', 'Pulmologji'], assignedAt: '2026-11-14T11:00:00.000Z' };
    await assertFails(setDoc(doc(dbAs(env, 'kardio'), 'patients', p.id), archived));
    await assertFails(setDoc(doc(dbAs(env, 'kardio'), 'patients', p.id), reassigned));
    await assertSucceeds(setDoc(doc(dbAs(env, 'kardio'), 'patients', p.id), p)); // an unchanged resend is fine
    await assertSucceeds(setDoc(doc(dbAs(env, 'lab'), 'patients', p.id), archived));
    await assertSucceeds(setDoc(doc(dbAs(env, 'lab'), 'patients', p.id), reassigned));
    await assertSucceeds(setDoc(doc(dbAs(env, 'admin'), 'patients', p.id), { ...reassigned, specialties: [] }));
  });

  test('patients are validated and never deleted', async () => {
    const db = dbAs(env, 'lab');
    const p = patient();
    await assertFails(setDoc(doc(db, 'patients', 'not-a-uuid'), { ...p, id: 'not-a-uuid' }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, archived: 'no' }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, id: id() }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, specialties: 'Kardiologji' }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, specialties: ['Laborator'] }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, specialties: ['Dermatologji'] }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, specialties: [], assignedAt: 5 }));
    await seed(env, { [`patients/${p.id}`]: p });
    await assertFails(deleteDoc(doc(db, 'patients', p.id)));
  });
});

describe('the new specialties', () => {
  test('a gastroenterologist writes reports of their own specialty, signed as themselves', async () => {
    const db = dbAs(env, 'gastro');
    const own = report({ tag: { type: 'specialist', specialty: 'Gastroenterologji' }, by: USERS.gastro });
    await assertSucceeds(saveReport(db, own, versionOf(own, USERS.gastro.email)));
    const other = report({ tag: { type: 'specialist', specialty: 'Urologji' }, by: USERS.gastro });
    await assertFails(saveReport(db, other, versionOf(other, USERS.gastro.email)));
    const unsigned = report({ tag: { type: 'specialist', specialty: 'Gastroenterologji' }, by: { name: 'Dikush', title: 'Gastroenterolog' } });
    await assertFails(saveReport(db, unsigned, versionOf(unsigned, USERS.gastro.email)));
  });

  test('the laboratory books appointments for them', async () => {
    const appointment = {
      id: id(), patientId: id(), patientName: 'Test Pacient', appointmentAt: '2026-11-20T09:00', status: 'Caktuar',
      specialty: 'Urologji', clinician: '', phone: '', note: '', createdAt: '2026-11-14T10:00:00.000Z'
    };
    await assertSucceeds(setDoc(doc(dbAs(env, 'lab'), 'appointments', appointment.id), appointment));
  });

  test('the administrator gives the new roles', async () => {
    const email = 'urolog@bioeng.test';
    await assertSucceeds(setDoc(doc(dbAs(env, 'admin'), 'users', email), userDoc(email, 'Urologji')));
  });
});
