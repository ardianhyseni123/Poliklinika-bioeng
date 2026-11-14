import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';

export const PROJECT_ID = 'demo-bioeng';

// Test identities. Each has a users/{email} profile except NO_PROFILE.
export const USERS = {
  admin: { email: 'admin@bioeng.test', role: 'Administrator', name: 'Admin', title: 'Administrator', active: true },
  lab: { email: 'lab@bioeng.test', role: 'Laborator', name: 'Laboratori', title: 'Laborator', active: true },
  kardio: { email: 'kardio@bioeng.test', role: 'Kardiologji', name: 'Dr. Kardio', title: 'Specialist i Kardiologjisë', active: true },
  pulmo: { email: 'pulmo@bioeng.test', role: 'Pulmologji', name: 'Dr. Pulmo', title: 'Specialist i Pulmologjisë', active: true },
  gastro: { email: 'gastro@bioeng.test', role: 'Gastroenterologji', name: 'Dr. Gastro', title: 'Gastroenterolog', active: true },
  inactive: { email: 'inactive@bioeng.test', role: 'Kardiologji', name: 'Dr. Ish', title: 'Specialist i Kardiologjisë', active: false }
} as const;
export const NO_PROFILE = 'stranger@bioeng.test';

export type Who = keyof typeof USERS | 'noProfile' | 'anonymous';

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.v2.rules', 'utf8') }
  });
}

export async function resetData(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore() as unknown as Firestore;
    for (const user of Object.values(USERS)) {
      await setDoc(doc(db, 'users', user.email), {
        ...user,
        updatedAt: '2026-11-01T00:00:00.000Z',
        updatedBy: USERS.admin.email
      });
    }
  });
}

export function dbAs(env: RulesTestEnvironment, who: Who): Firestore {
  if (who === 'anonymous') return env.unauthenticatedContext().firestore() as unknown as Firestore;
  const email = who === 'noProfile' ? NO_PROFILE : USERS[who].email;
  return env.authenticatedContext(`uid-${who}`, { email }).firestore() as unknown as Firestore;
}

/** Writes documents with rules disabled, for arranging test state. */
export async function seed(env: RulesTestEnvironment, docs: Record<string, object>): Promise<void> {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore() as unknown as Firestore;
    for (const [path, data] of Object.entries(docs)) await setDoc(doc(db, path), data);
  });
}

export const id = (): string => randomUUID();

const NOW = '2026-11-14T10:00:00.000Z';

export function patient(patientId = id(), extra: object = {}) {
  return {
    id: patientId,
    firstName: 'Test',
    lastName: 'Pacient',
    dob: '1980-01-01',
    gender: 'Femër',
    phone: '044000000',
    address: 'Prishtinë',
    archived: false,
    createdAt: NOW,
    ...extra
  };
}

type ReportTag = { type: 'laboratory'; specialty: 'Laborator' } | { type: 'specialist'; specialty: string };

export interface ReportDoc {
  id: string;
  patientId: string;
  type: string;
  specialty: string;
  clinician: string;
  clinicianTitle: string;
  revision: number;
  lastVersionId: string;
  [field: string]: unknown;
}

export interface TombstoneDoc {
  id: string;
  patientId: string;
  type: string;
  specialty: string;
  _deleted: true;
  deletedAt: string;
  deletedBy: string;
  baseRevision: number;
  lastVersionId: string;
}

export type VersionDoc = ReturnType<typeof versionOf>;

const isTombstone = (head: ReportDoc | TombstoneDoc): head is TombstoneDoc => head._deleted === true;

export function report(options: {
  reportId?: string;
  patientId?: string;
  tag?: ReportTag;
  by?: { name: string; title: string };
  revision?: number;
  lastVersionId?: string;
}): ReportDoc {
  const tag = options.tag ?? { type: 'specialist', specialty: 'Kardiologji' };
  const by = options.by ?? USERS.kardio;
  return {
    id: options.reportId ?? id(),
    patientId: options.patientId ?? id(),
    type: tag.type,
    specialty: tag.specialty,
    reportAt: '2026-11-14T09:30',
    clinician: by.name,
    clinicianTitle: by.title,
    anamnesis: 'Dhimbje gjoksi',
    physicalExam: '',
    existingResults: '',
    diagnoses: [],
    customDiagnoses: '',
    requestedExams: [],
    therapy: '',
    notes: '',
    analyses: [],
    hixhame: null,
    createdAt: NOW,
    updatedAt: NOW,
    revision: options.revision ?? 1,
    lastVersionId: options.lastVersionId ?? id()
  };
}

export function tombstone(head: ReportDoc, deletedBy: string, lastVersionId = id()): TombstoneDoc {
  return {
    id: head.id,
    patientId: head.patientId,
    type: head.type,
    specialty: head.specialty,
    _deleted: true,
    deletedAt: NOW,
    deletedBy,
    baseRevision: head.revision,
    lastVersionId
  };
}

export function versionOf(head: ReportDoc | TombstoneDoc, savedBy: string, baseRevision = 0, baseVersionId = '') {
  return {
    baseVersionId,
    resolves: [] as string[],
    id: head.lastVersionId,
    reportId: head.id,
    patientId: head.patientId,
    type: head.type,
    specialty: head.specialty,
    kind: isTombstone(head) ? 'delete' : 'save',
    revision: isTombstone(head) ? head.baseRevision + 1 : head.revision,
    baseRevision,
    savedAt: NOW,
    savedBy,
    report: head
  };
}

/** The app's save: head and its version in one batch. */
export function saveReport(
  db: Firestore,
  head: ReportDoc | TombstoneDoc,
  version: Omit<VersionDoc, 'report' | 'kind'> & { kind: string; report: object }
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'reports', head.id), head);
  batch.set(doc(db, 'reports', head.id, 'versions', version.id), version);
  return batch.commit();
}
