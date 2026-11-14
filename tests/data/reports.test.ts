import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createPatient, setPatientArchived } from '../../src/data/patients';
import { deleteReport, saveReport, watchReports } from '../../src/data/reports';
import { findConflict } from '../../src/domain/history';
import type { Report, ReportHead, Version } from '../../src/data/schemas';
import { createEnv, id, resetData } from '../rules/helpers';
import { device, sampleDraft, serverList, serverRead } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await resetData(env); });

describe('reports through the data layer', () => {
  test('a doctor creates a report: head, version and audit entry reach the server', async () => {
    const doctor = device(env, 'kardio');
    const { record: patient, done: patientDone } = createPatient(doctor, {
      firstName: 'Arta', lastName: 'Krasniqi', dob: '1985-03-12', gender: 'Femër', phone: '044111222', address: 'Prishtinë'
    });
    await patientDone;

    // The doctor's own name and title are used, whatever the form said.
    const saved = saveReport(doctor, sampleDraft(patient.id, { clinician: 'Someone else' }), null);
    await saved.done;

    const head = await serverRead<Report>(env, `reports/${saved.head.id}`);
    expect(head?.clinician).toBe('Dr. Kardio');
    expect(head?.clinicianTitle).toBe('Specialist i Kardiologjisë');
    expect(head?.revision).toBe(1);
    expect(head?.lastVersionId).toBe(saved.version.id);
    const versions = await serverList<Version>(env, `reports/${saved.head.id}/versions`);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.baseVersionId).toBe('');
    await expect.poll(async () => (await serverList(env, 'audit')).length).toBe(1);
  });

  test('the laboratory sees the doctor report; another specialty does not', async () => {
    const doctor = device(env, 'kardio');
    const saved = saveReport(doctor, sampleDraft(id()), null);
    await saved.done;

    const seen = async (who: 'lab' | 'pulmo') => new Promise<ReportHead[]>((resolve, reject) => {
      const ctx = device(env, who);
      const stop = watchReports(ctx.db, ctx.actor, snapshot => {
        if (snapshot.fromCache) return;
        stop();
        resolve(snapshot.items);
      }, reject);
    });
    expect((await seen('lab')).map(report => report.id)).toEqual([saved.head.id]);
    expect(await seen('pulmo')).toEqual([]);
  });

  test('edits form a chain; two devices editing the same version are flagged and can be resolved', async () => {
    const deviceA = device(env, 'kardio');
    const deviceB = device(env, 'kardio');
    const first = saveReport(deviceA, sampleDraft(id()), null);
    await first.done;

    // Both devices start from version 1 (one of them was offline).
    const fromB = saveReport(deviceB, { ...sampleDraft(first.head.patientId), therapy: 'Nga pajisja B' }, first.head);
    await fromB.done;
    const fromA = saveReport(deviceA, { ...sampleDraft(first.head.patientId), therapy: 'Nga pajisja A' }, first.head);
    await fromA.done;

    let versions = await serverList<Version>(env, `reports/${first.head.id}/versions`);
    let head = await serverRead<Report>(env, `reports/${first.head.id}`);
    const conflict = findConflict(head!, versions);
    expect(conflict?.current?.id).toBe(fromA.version.id);
    expect(conflict?.others.map(version => version.id)).toEqual([fromB.version.id]);

    // Someone reads both and saves the combined text, settling B's branch.
    const merged = saveReport(deviceA, { ...sampleDraft(first.head.patientId), therapy: 'A + B' }, head!, { resolves: [fromB.version.id] });
    await merged.done;
    versions = await serverList<Version>(env, `reports/${first.head.id}/versions`);
    head = await serverRead<Report>(env, `reports/${first.head.id}`);
    expect(findConflict(head!, versions)).toBeNull();
    expect(head?.therapy).toBe('A + B');
    expect(head?.revision).toBe(3);
  });

  test('deleting leaves a tombstone, and the content stays in the history', async () => {
    const doctor = device(env, 'kardio');
    const saved = saveReport(doctor, sampleDraft(id()), null);
    await saved.done;
    const gone = deleteReport(doctor, saved.head);
    await gone.done;

    const head = await serverRead<Record<string, unknown>>(env, `reports/${saved.head.id}`);
    expect(head?._deleted).toBe(true);
    expect(head?.anamnesis).toBeUndefined();
    const versions = await serverList<Version>(env, `reports/${saved.head.id}/versions`);
    expect(versions.map(version => version.kind).sort()).toEqual(['delete', 'save']);
    expect(versions.find(version => version.kind === 'save')?.report).toMatchObject({ anamnesis: 'Dhimbje gjoksi' });
  });

  test('the laboratory archives a patient; a doctor cannot', async () => {
    const lab = device(env, 'lab');
    const { record: patient, done } = createPatient(lab, { firstName: 'Blerim', lastName: 'Gashi', dob: '', gender: 'Mashkull', phone: '', address: '' });
    await done;
    await setPatientArchived(lab, patient, true).done;
    expect((await serverRead<Record<string, unknown>>(env, `patients/${patient.id}`))?.archived).toBe(true);
    await expect(setPatientArchived(device(env, 'kardio'), patient, false).done).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
