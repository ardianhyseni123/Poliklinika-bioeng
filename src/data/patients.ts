import { collection, doc, setDoc, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { validated, watchQuery, type DataContext, type Snapshot, type Written } from './context';
import { PatientSchema, type Patient } from './schemas';

export interface NewPatient {
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  phone: string;
  address: string;
}

export function watchPatients(db: Firestore, onData: (snapshot: Snapshot<Patient>) => void, onError: (error: Error) => void): Unsubscribe {
  return watchQuery(collection(db, 'patients'), data => PatientSchema.safeParse(data), onData, onError);
}

export function patientName(patient: Pick<Patient, 'firstName' | 'lastName'>): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

export function createPatient(ctx: DataContext, input: NewPatient): Written<Patient> {
  const patient = validated('Pacienti', PatientSchema.safeParse({
    id: ctx.newId(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    dob: input.dob,
    gender: input.gender,
    phone: input.phone.trim(),
    address: input.address.trim(),
    archived: false,
    createdAt: ctx.now()
  }));
  if (!patient.firstName || !patient.lastName) throw new Error('Emri dhe mbiemri janë të detyrueshëm.');
  const path = `patients/${patient.id}`;
  const done = setDoc(doc(ctx.db, path), patient);
  ctx.tracker.track({ id: `patient:${patient.id}`, label: `Pacient: ${patientName(patient)}`, check: { path, expect: 'exists' }, content: patient }, done);
  return { record: patient, done };
}

/** Rescue of old-app data: writes a patient with its existing id. */
export function restorePatient(ctx: DataContext, input: unknown): Written<Patient> {
  const patient = validated('Pacienti', PatientSchema.safeParse(input));
  const path = `patients/${patient.id}`;
  const done = setDoc(doc(ctx.db, path), patient);
  ctx.tracker.track({ id: `patient-restore:${patient.id}`, label: `Pacient: ${patientName(patient)}`, check: { path, expect: 'exists' }, content: patient }, done);
  return { record: patient, done };
}

/** Laboratory only (the rules refuse anyone else). */
export function setPatientArchived(ctx: DataContext, patient: Patient, archived: boolean): Written<Patient> {
  const { archivedAt: _previous, ...rest } = patient;
  const next = validated('Pacienti', PatientSchema.safeParse(archived ? { ...rest, archived: true, archivedAt: ctx.now() } : { ...rest, archived: false }));
  const path = `patients/${patient.id}`;
  const done = setDoc(doc(ctx.db, path), next);
  ctx.tracker.track({
    id: `patient-archive:${patient.id}:${ctx.newId()}`,
    label: `${archived ? 'Arkivim' : 'Rikthim'}: ${patientName(patient)}`,
    check: { path, expect: 'field', field: 'archived', value: archived },
    content: next
  }, done);
  return { record: next, done };
}
