import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { USERS, createEnv, dbAs, id, report, resetData, saveReport, seed, tombstone, versionOf, type ReportDoc } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await resetData(env); });

const LAB_TAG = { type: 'laboratory', specialty: 'Laborator' } as const;
const PULMO_TAG = { type: 'specialist', specialty: 'Pulmologji' } as const;

async function seedReport(head: ReportDoc, savedBy: string = USERS.kardio.email) {
  await seed(env, {
    [`reports/${head.id}`]: head,
    [`reports/${head.id}/versions/${head.lastVersionId}`]: versionOf(head, savedBy)
  });
}

describe('creating reports', () => {
  test('a specialist creates a new report in their specialty (the bug in the old rules)', async () => {
    const db = dbAs(env, 'kardio');
    const head = report({});
    // The old app read the document first; that read must work for a report that doesn't exist yet.
    await assertSucceeds(getDoc(doc(db, 'reports', head.id)));
    await assertSucceeds(saveReport(db, head, versionOf(head, USERS.kardio.email)));
  });

  test('a specialist cannot create a report for another specialty or a lab report', async () => {
    const db = dbAs(env, 'kardio');
    for (const tag of [PULMO_TAG, LAB_TAG]) {
      const head = report({ tag });
      await assertFails(saveReport(db, head, versionOf(head, USERS.kardio.email)));
    }
  });

  test("a specialist must sign with their own profile's name and title", async () => {
    const db = dbAs(env, 'kardio');
    const head = { ...report({}), clinician: 'Dr. Someone Else' };
    await assertFails(saveReport(db, head, versionOf(head, USERS.kardio.email)));
    const untitled = { ...report({}), clinicianTitle: '' };
    await assertFails(saveReport(db, untitled, versionOf(untitled, USERS.kardio.email)));
  });

  test('the laboratory and the administrator create any report, with any clinician', async () => {
    for (const who of ['lab', 'admin'] as const) {
      const db = dbAs(env, who);
      for (const tag of [LAB_TAG, PULMO_TAG]) {
        const head = { ...report({ tag, by: USERS[who] }), clinician: 'Dr. Manual Entry' };
        await assertSucceeds(saveReport(db, head, versionOf(head, USERS[who].email)));
      }
    }
  });

  test('a report cannot be written without its version, or with a mismatched one', async () => {
    const db = dbAs(env, 'kardio');
    const head = report({});
    await assertFails(setDoc(doc(db, 'reports', head.id), head));

    const otherRevision = { ...versionOf(head, USERS.kardio.email), revision: 2, report: { ...head, revision: 2 } };
    await assertFails(saveReport(db, head, otherRevision));

    const lab = dbAs(env, 'lab');
    const labHead = report({ tag: LAB_TAG, by: USERS.lab });
    await assertFails(saveReport(lab, labHead, versionOf(labHead, USERS.kardio.email))); // savedBy must be the writer
  });

  test("the app's full save (report, version and audit entry) fits within the rule limits", async () => {
    const db = dbAs(env, 'kardio');
    const head = {
      ...report({ tag: { type: 'specialist', specialty: 'Kardiologji' } }),
      diagnoses: ['Hipertension arterial', 'Aritmi'],
      requestedExams: ['Hemogram', 'EKG', 'Ekokardiografi'],
      analyses: Array.from({ length: 40 }, (_, i) => ({ parameter: `P${i}`, result: '1', unit: 'g/L', reference: '1-2', category: 'Biokimi', printGroup: 'BIOKIMI' }))
    };
    const version = versionOf(head, USERS.kardio.email);
    const auditId = id();
    const batch = writeBatch(db);
    batch.set(doc(db, 'reports', head.id), head);
    batch.set(doc(db, 'reports', head.id, 'versions', version.id), version);
    batch.set(doc(db, 'audit', auditId), {
      id: auditId, action: 'REPORT_CREATED', reportId: head.id, patientId: head.patientId, at: '2026-11-14T10:00:00.000Z', revision: 1,
      actorUid: 'uid-kardio', actorEmail: USERS.kardio.email, actorRole: 'Kardiologji', reportType: 'specialist', specialty: 'Kardiologji'
    });
    await assertSucceeds(batch.commit());
  });

  test('a version must be an exact snapshot of the report it is saved with', async () => {
    const db = dbAs(env, 'kardio');
    const head = report({});
    const version = versionOf(head, USERS.kardio.email);
    await assertFails(saveReport(db, head, { ...version, report: { ...head, notes: 'different' } }));
    await assertFails(saveReport(db, head, { ...version, kind: 'delete' }));
  });

  test('a version names the version it was based on, and may resolve other branches', async () => {
    const db = dbAs(env, 'kardio');
    const first = report({});
    await assertSucceeds(saveReport(db, first, versionOf(first, USERS.kardio.email)));
    const second = { ...first, revision: 2, lastVersionId: id() };
    const resolving = { ...versionOf(second, USERS.kardio.email, 1, first.lastVersionId), resolves: [id()] };
    await assertSucceeds(saveReport(db, second, resolving));
    const third = { ...second, revision: 3, lastVersionId: id() };
    await assertFails(saveReport(db, third, versionOf(third, USERS.kardio.email, 2, 'not-a-version-id')));
    await assertFails(saveReport(db, third, { ...versionOf(third, USERS.kardio.email, 2, second.lastVersionId), resolves: 'x' as unknown as string[] }));
  });

  test('people without an active profile cannot create reports', async () => {
    for (const who of ['inactive', 'noProfile', 'anonymous'] as const) {
      const db = dbAs(env, who);
      const head = report({});
      await assertFails(saveReport(db, head, versionOf(head, USERS.kardio.email)));
    }
  });
});

describe('editing reports', () => {
  test('a stale edit is accepted and kept as a version, not rejected', async () => {
    const head = report({ revision: 3 });
    await seedReport(head);
    const db = dbAs(env, 'kardio');
    // Written offline from revision 1 while the server moved to 3.
    const stale = report({ reportId: head.id, patientId: head.patientId, revision: 2 });
    await assertSucceeds(saveReport(db, stale, versionOf(stale, USERS.kardio.email, 1)));
  });

  test('a specialist cannot move a report to another patient or specialty', async () => {
    const head = report({});
    await seedReport(head);
    const db = dbAs(env, 'kardio');
    const moved = report({ reportId: head.id, patientId: id(), revision: 2 });
    await assertFails(saveReport(db, moved, versionOf(moved, USERS.kardio.email, 1)));
    const pulmo = report({ reportId: head.id, patientId: head.patientId, revision: 2, tag: PULMO_TAG });
    await assertFails(saveReport(db, pulmo, versionOf(pulmo, USERS.kardio.email, 1)));
  });

  test("a specialist cannot edit another specialty's report", async () => {
    const head = report({ tag: PULMO_TAG, by: USERS.pulmo });
    await seedReport(head, USERS.pulmo.email);
    const db = dbAs(env, 'kardio');
    const edit = { ...head, revision: 2, lastVersionId: id() };
    await assertFails(saveReport(db, edit, versionOf(edit, USERS.kardio.email, 1)));
  });

  test('the laboratory edits any report', async () => {
    const head = report({});
    await seedReport(head);
    const db = dbAs(env, 'lab');
    const edit = { ...head, notes: 'Shënim nga laboratori', revision: 2, lastVersionId: id() };
    await assertSucceeds(saveReport(db, edit, versionOf(edit, USERS.lab.email, 1)));
  });

  test('reports written by the old app (no lastVersionId) can be edited', async () => {
    const legacy: Record<string, unknown> = { ...report({}) };
    delete legacy.lastVersionId;
    await seed(env, { [`reports/${legacy.id as string}`]: legacy });
    const db = dbAs(env, 'kardio');
    const edit = { ...(legacy as ReportDoc), revision: 2, lastVersionId: id() };
    await assertSucceeds(saveReport(db, edit, versionOf(edit, USERS.kardio.email, 1)));
  });
});

describe('deleting reports', () => {
  test('a specialist deletes their own specialty report with a tombstone and a version', async () => {
    const head = report({});
    await seedReport(head);
    const db = dbAs(env, 'kardio');
    const gone = tombstone(head, USERS.kardio.email);
    await assertSucceeds(saveReport(db, gone, versionOf(gone, USERS.kardio.email, head.revision)));
  });

  test('a report deleted before it ever synced arrives as a tombstone create', async () => {
    const db = dbAs(env, 'kardio');
    const gone = tombstone(report({}), USERS.kardio.email);
    await assertSucceeds(saveReport(db, gone, versionOf(gone, USERS.kardio.email, 1)));
  });

  test('tombstones are terminal and documents are never hard-deleted', async () => {
    const head = report({});
    const gone = tombstone(head, USERS.kardio.email);
    await seed(env, { [`reports/${head.id}`]: gone });
    const lab = dbAs(env, 'lab');
    const revived = { ...head, revision: 2, lastVersionId: id() };
    await assertFails(saveReport(lab, revived, versionOf(revived, USERS.lab.email, 1)));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(lab, 'reports', head.id)));
  });

  test('a tombstone must name the person deleting', async () => {
    const head = report({});
    await seedReport(head);
    const db = dbAs(env, 'kardio');
    const gone = tombstone(head, USERS.lab.email);
    await assertFails(saveReport(db, gone, versionOf(gone, USERS.kardio.email, head.revision)));
  });
});

describe('reading reports', () => {
  test('specialists read their own specialty, and nothing else', async () => {
    const mine = report({});
    const theirs = report({ tag: PULMO_TAG, by: USERS.pulmo });
    const lab = report({ tag: LAB_TAG, by: USERS.lab });
    await seedReport(mine);
    await seedReport(theirs, USERS.pulmo.email);
    await seedReport(lab, USERS.lab.email);
    const db = dbAs(env, 'kardio');
    await assertSucceeds(getDoc(doc(db, 'reports', mine.id)));
    await assertFails(getDoc(doc(db, 'reports', theirs.id)));
    await assertFails(getDoc(doc(db, 'reports', lab.id)));
    await assertSucceeds(getDoc(doc(db, 'reports', mine.id, 'versions', mine.lastVersionId)));
    await assertFails(getDoc(doc(db, 'reports', theirs.id, 'versions', theirs.lastVersionId)));
  });

  test('specialist queries must filter on their own specialty', async () => {
    const db = dbAs(env, 'kardio');
    const own = query(collection(db, 'reports'), where('type', '==', 'specialist'), where('specialty', '==', 'Kardiologji'));
    await assertSucceeds(getDocs(own));
    await assertFails(getDocs(collection(db, 'reports')));
    await assertFails(getDocs(query(collection(db, 'reports'), where('type', '==', 'specialist'), where('specialty', '==', 'Pulmologji'))));
  });

  test('the laboratory and administrator read everything', async () => {
    const head = report({});
    await seedReport(head);
    for (const who of ['lab', 'admin'] as const) {
      const db = dbAs(env, who);
      await assertSucceeds(getDocs(collection(db, 'reports')));
      await assertSucceeds(getDocs(collection(db, 'reports', head.id, 'versions')));
    }
  });

  test('no access without an active profile', async () => {
    const head = report({});
    await seedReport(head);
    for (const who of ['inactive', 'noProfile', 'anonymous'] as const) {
      await assertFails(getDoc(doc(dbAs(env, who), 'reports', head.id)));
    }
  });
});

describe('versions are immutable', () => {
  test('a version cannot be changed or deleted, even by the administrator', async () => {
    const head = report({});
    await seedReport(head);
    const db = dbAs(env, 'admin');
    const ref = doc(db, 'reports', head.id, 'versions', head.lastVersionId);
    await assertFails(updateDoc(ref, { savedBy: USERS.admin.email }));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(ref));
  });

  test('a version cannot be written on its own, without its head', async () => {
    const head = report({});
    await seedReport(head);
    const db = dbAs(env, 'kardio');
    const orphan = { ...versionOf({ ...head, revision: 2, lastVersionId: id() }, USERS.kardio.email, 1) };
    const batch = writeBatch(db);
    batch.set(doc(db, 'reports', head.id, 'versions', orphan.id), orphan);
    await assertFails(batch.commit());
  });
});
