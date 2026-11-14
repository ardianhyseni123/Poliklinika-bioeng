import 'fake-indexeddb/auto';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, type Firestore } from 'firebase/firestore';
import { createContext, type Actor, type DataContext } from '../../src/data/context';
import { untracked, type WriteTracker } from '../../src/data/journal';
import { USERS, dbAs } from '../rules/helpers';

export type Staff = keyof typeof USERS;

export function actorFor(who: Staff): Actor {
  const user = USERS[who];
  return { uid: `uid-${who}`, email: user.email, role: user.role, name: user.name, title: user.title };
}

/** A device signed in as `who`, talking to the emulator with the real rules. */
export function device(env: RulesTestEnvironment, who: Staff, tracker: WriteTracker = untracked): DataContext {
  return createContext(dbAs(env, who), actorFor(who), tracker);
}

/** Reads with rules disabled, to check what actually reached the server. */
export async function serverRead<T = Record<string, unknown>>(env: RulesTestEnvironment, path: string): Promise<T | undefined> {
  let data: T | undefined;
  await env.withSecurityRulesDisabled(async context => {
    const snapshot = await getDoc(doc(context.firestore() as unknown as Firestore, path));
    data = snapshot.exists() ? (snapshot.data() as T) : undefined;
  });
  return data;
}

export async function serverList<T = Record<string, unknown>>(env: RulesTestEnvironment, path: string): Promise<T[]> {
  let items: T[] = [];
  await env.withSecurityRulesDisabled(async context => {
    const snapshot = await getDocs(collection(context.firestore() as unknown as Firestore, path));
    items = snapshot.docs.map(item => item.data() as T);
  });
  return items;
}

export function sampleDraft(patientId: string, overrides: Record<string, unknown> = {}) {
  return {
    patientId,
    type: 'specialist' as const,
    specialty: 'Kardiologji' as const,
    reportAt: '2026-11-14T09:30',
    clinician: '',
    clinicianTitle: '',
    anamnesis: 'Dhimbje gjoksi',
    physicalExam: '',
    existingResults: '',
    diagnoses: ['Hipertension arterial'],
    customDiagnoses: '',
    requestedExams: ['EKG'],
    therapy: '',
    notes: '',
    analyses: [],
    hixhame: null,
    ...overrides
  };
}

let deviceCounter = 0;
/** Unique email per test so journal entries from different tests never mix. */
export function uniqueSuffix(): string {
  deviceCounter += 1;
  return `${Date.now()}-${deviceCounter}`;
}
