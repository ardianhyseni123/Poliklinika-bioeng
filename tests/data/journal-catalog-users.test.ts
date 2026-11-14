import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { CatalogConflictError, saveCatalog } from '../../src/data/catalog';
import { Journal } from '../../src/data/journal';
import { createPatient } from '../../src/data/patients';
import { saveUser, warningsFor } from '../../src/data/users';
import type { User } from '../../src/data/schemas';
import { USERS, createEnv, id, patient, resetData, seed } from '../rules/helpers';
import { device, serverRead, uniqueSuffix } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await resetData(env); });

const NEW_PATIENT = { firstName: 'Drita', lastName: 'Berisha', dob: '', gender: 'Femër', phone: '', address: '' };

describe('write journal', () => {
  test('a confirmed write leaves nothing behind', async () => {
    const journal = await Journal.open(`lab-${uniqueSuffix()}@bioeng.test`);
    const { done } = createPatient(device(env, 'lab', journal), NEW_PATIENT);
    expect(journal.pending()).toHaveLength(1);
    await done;
    await journal.flushed();
    expect(journal.pending()).toHaveLength(0);
    expect(journal.failed()).toHaveLength(0);
  });

  test('closing right after a write is confirmed still clears it from storage', async () => {
    // The page can close the journal the moment a write arrives (a new app version does so).
    const journal = await Journal.open(`lab-${uniqueSuffix()}@bioeng.test`);
    let arrive = () => undefined as void;
    const commit = new Promise<void>(resolve => { arrive = resolve; });
    journal.track({ id: 'w', label: 'patient', check: { path: 'patients/x', expect: 'exists' }, content: {} }, commit);
    await journal.flushed();
    const closedRightAway = new Promise<void>(resolve => {
      journal.subscribe(() => {
        if (journal.pending().length === 0) {
          journal.close();
          resolve();
        }
      });
    });
    arrive();
    await closedRightAway;
    await journal.flushed();
    expect((await Journal.open(journal.email)).pending()).toHaveLength(0);
  });

  test('a write the server refuses is kept, with its content, as failed', async () => {
    const journal = await Journal.open(`inactive-${uniqueSuffix()}@bioeng.test`);
    const { done } = createPatient(device(env, 'inactive', journal), NEW_PATIENT);
    await done.catch(() => undefined);
    await journal.flushed();
    const [failed] = journal.failed();
    expect(failed?.error).toBe('permission-denied');
    expect(failed?.content).toMatchObject({ firstName: 'Drita', lastName: 'Berisha' });

    // It survives a reload.
    const reopened = await Journal.open(journal.email);
    expect(reopened.failed()).toHaveLength(1);
    await reopened.dismiss(failed!.id);
    await reopened.flushed();
    expect((await Journal.open(journal.email)).failed()).toHaveLength(0);
  });

  test('after a reload, entries are checked against the server', async () => {
    const email = `lab-${uniqueSuffix()}@bioeng.test`;
    const arrived = patient();
    const lost = patient();
    await seed(env, { [`patients/${arrived.id}`]: arrived });

    // A page that recorded two writes, then was closed before either was answered.
    const before = await Journal.open(email);
    const never = new Promise<void>(() => undefined);
    before.track({ id: 'a', label: 'arrived', check: { path: `patients/${arrived.id}`, expect: 'exists' }, content: arrived }, never);
    before.track({ id: 'b', label: 'lost', check: { path: `patients/${lost.id}`, expect: 'exists' }, content: lost }, never);
    await before.flushed();

    const after = await Journal.open(email);
    expect(after.pending().map(entry => entry.id).sort()).toEqual(['a', 'b']);
    await after.verify(device(env, 'lab').db);
    await after.flushed();
    expect(after.pending()).toHaveLength(0);
    expect(after.failed().map(entry => [entry.id, entry.error])).toEqual([['b', 'not-on-server']]);
  });
});

describe('analysis catalog', () => {
  const category = { id: 'bio', name: 'Biokimi', printGroup: 'BIOKIMIA', bulkAdd: false, active: true, analyses: [{ id: 'glu', name: 'Glukoza', unit: 'mmol/L', reference: '3.3-6.1', active: true }] };

  test('revisions are saved one after another, each with its history entry', async () => {
    const lab = device(env, 'lab');
    const first = await saveCatalog(lab, [category], 0, [{ target: 'Biokimi', field: 'created', from: null, to: 'Biokimi' }]);
    expect(first.revision).toBe(1);
    const second = await saveCatalog(device(env, 'admin'), [{ ...category, name: 'Biokimia' }], 1, []);
    expect(second.revision).toBe(2);
    expect((await serverRead<{ updatedBy: string }>(env, 'analysisCatalog/current'))?.updatedBy).toBe(USERS.admin.email);
  });

  test('a device holding an older list cannot overwrite a newer one', async () => {
    const lab = device(env, 'lab');
    await saveCatalog(lab, [category], 0, []);
    await expect(saveCatalog(lab, [category], 0, [])).rejects.toBeInstanceOf(CatalogConflictError);
  });
});

describe('users', () => {
  test('the administrator assigns a role; the default title follows the role', async () => {
    const { record, done } = saveUser(device(env, 'admin'), { email: 'Dr.New@Bioeng.test', role: 'Neurologji', name: 'Dr. New', active: true });
    await done;
    expect(record.email).toBe('dr.new@bioeng.test');
    expect(await serverRead<User>(env, 'users/dr.new@bioeng.test')).toMatchObject({ role: 'Neurologji', title: 'Specialist i Neurologjisë' });
    await expect(saveUser(device(env, 'lab'), { email: 'x@bioeng.test', role: 'Laborator', name: 'X', active: true }).done)
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('warns before removing the last administrator or locking yourself out', () => {
    const now = '2026-11-14T10:00:00.000Z';
    const current: User[] = [
      { email: 'admin@bioeng.test', role: 'Administrator', name: 'A', title: 'Administrator', active: true, updatedAt: now, updatedBy: 'x' },
      { email: 'lab@bioeng.test', role: 'Laborator', name: 'L', title: 'Laborator', active: true, updatedAt: now, updatedBy: 'x' }
    ];
    expect(warningsFor({ email: 'admin@bioeng.test', role: 'Laborator', name: 'A', active: true }, current, 'admin@bioeng.test').map(w => w.kind))
      .toEqual(['lastAdministrator', 'self']);
    expect(warningsFor({ email: 'lab@bioeng.test', role: 'Laborator', name: 'L', active: false }, current, 'admin@bioeng.test')).toEqual([]);
    expect(warningsFor({ email: 'new@bioeng.test', role: 'Administrator', name: 'N', active: true }, current, 'admin@bioeng.test')).toEqual([]);
    void id;
  });
});
