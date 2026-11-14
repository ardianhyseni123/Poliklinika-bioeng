import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { NO_PROFILE, USERS, createEnv, dbAs, id, patient, resetData, seed } from './helpers';

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
  test('everyone with a role reads and creates patients', async () => {
    for (const who of ['admin', 'lab', 'kardio'] as const) {
      const db = dbAs(env, who);
      const p = patient();
      await assertSucceeds(setDoc(doc(db, 'patients', p.id), p));
      await assertSucceeds(getDocs(collection(db, 'patients')));
    }
  });

  test('without an active profile there is no access', async () => {
    for (const who of ['inactive', 'noProfile', 'anonymous'] as const) {
      const db = dbAs(env, who);
      const p = patient();
      await assertFails(setDoc(doc(db, 'patients', p.id), p));
      await assertFails(getDocs(collection(db, 'patients')));
    }
  });

  test('only the laboratory changes or archives a patient', async () => {
    const p = patient();
    await seed(env, { [`patients/${p.id}`]: p });
    const archived = { ...p, archived: true, archivedAt: '2026-11-14T11:00:00.000Z' };
    await assertFails(setDoc(doc(dbAs(env, 'kardio'), 'patients', p.id), archived));
    await assertSucceeds(setDoc(doc(dbAs(env, 'kardio'), 'patients', p.id), p)); // an unchanged resend is fine
    await assertSucceeds(setDoc(doc(dbAs(env, 'lab'), 'patients', p.id), archived));
    await assertSucceeds(setDoc(doc(dbAs(env, 'admin'), 'patients', p.id), { ...archived, archived: false }));
  });

  test('patients are validated and never deleted', async () => {
    const db = dbAs(env, 'lab');
    const p = patient();
    await assertFails(setDoc(doc(db, 'patients', 'not-a-uuid'), { ...p, id: 'not-a-uuid' }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, archived: 'no' }));
    await assertFails(setDoc(doc(db, 'patients', p.id), { ...p, id: id() }));
    await seed(env, { [`patients/${p.id}`]: p });
    await assertFails(deleteDoc(doc(db, 'patients', p.id)));
  });
});
