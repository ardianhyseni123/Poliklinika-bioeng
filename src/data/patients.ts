import { collection, doc, onSnapshot, query, setDoc, where, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { isLabRole, isSpecialty, type Specialty } from '../auth/roles';
import { inSpecialtyOrder } from '../domain/assignment';
import { validated, watchQuery, type Actor, type DataContext, type Snapshot, type Written } from './context';
import { errorCode } from './journal';
import { PatientSchema, type Patient } from './schemas';

export interface NewPatient {
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  phone: string;
  address: string;
  /** Chosen by the laboratory; a specialist's patient is always assigned to that specialist. */
  specialties?: string[];
}

/**
 * The laboratory watches every patient; a specialist the patients assigned to their specialty
 * (the rules only allow that query). Old patients they have reports for come from watchPatient.
 */
export function watchPatients(
  db: Firestore,
  actor: Pick<Actor, 'role'>,
  onData: (snapshot: Snapshot<Patient>) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const patients = collection(db, 'patients');
  const scoped = isLabRole(actor.role) ? patients : query(patients, where('specialties', 'array-contains', actor.role));
  return watchQuery(scoped, data => PatientSchema.safeParse(data), onData, onError);
}

/**
 * One patient by id. `null` when it does not exist, or when this person may not read it (a
 * specialist asking for a patient that is assigned to others).
 */
export function watchPatient(db: Firestore, id: string, onData: (patient: Patient | null) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'patients', id),
    snapshot => {
      const parsed = snapshot.exists() ? PatientSchema.safeParse(snapshot.data()) : null;
      onData(parsed?.success ? parsed.data : null);
    },
    error => {
      if (errorCode(error) !== 'permission-denied' && !/shutting down/i.test(error.message)) console.warn('Could not read a patient.', error);
      onData(null);
    }
  );
}

export function patientName(patient: Pick<Patient, 'firstName' | 'lastName'>): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

function ownAssignment(actor: Actor, chosen: string[] | undefined): Specialty[] {
  if (isSpecialty(actor.role)) return [actor.role];
  return inSpecialtyOrder(chosen ?? []);
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
    createdAt: ctx.now(),
    specialties: ownAssignment(ctx.actor, input.specialties)
  }));
  if (!patient.firstName || !patient.lastName) throw new Error('Emri dhe mbiemri janë të detyrueshëm.');
  const path = `patients/${patient.id}`;
  const done = setDoc(doc(ctx.db, path), patient);
  ctx.tracker.track({ id: `patient:${patient.id}`, label: `Pacient: ${patientName(patient)}`, check: { path, expect: 'exists' }, content: patient }, done);
  return { record: patient, done };
}

/**
 * Rescue of old-app data: writes a patient with its existing id. A patient a specialist
 * registered in the old app is assigned to that specialist, as a new one would be; the
 * laboratory's stay old patients.
 */
export function restorePatient(ctx: DataContext, input: unknown): Written<Patient> {
  const record = validated('Pacienti', PatientSchema.safeParse(input));
  const patient = isSpecialty(ctx.actor.role) ? { ...record, specialties: [ctx.actor.role] } : record;
  const path = `patients/${patient.id}`;
  const done = setDoc(doc(ctx.db, path), patient);
  ctx.tracker.track({ id: `patient-restore:${patient.id}`, label: `Pacient: ${patientName(patient)}`, check: { path, expect: 'exists' }, content: patient }, done);
  return { record: patient, done };
}

function writePatient(ctx: DataContext, next: Patient, label: string, check: { field: string; value: string | boolean }): Written<Patient> {
  const path = `patients/${next.id}`;
  const done = setDoc(doc(ctx.db, path), next);
  ctx.tracker.track({ id: `patient-change:${next.id}:${ctx.newId()}`, label, check: { path, expect: 'field', ...check }, content: next }, done);
  return { record: next, done };
}

/** Laboratory only (the rules refuse anyone else). */
export function setPatientArchived(ctx: DataContext, patient: Patient, archived: boolean): Written<Patient> {
  const { archivedAt: _previous, ...rest } = patient;
  const next = validated('Pacienti', PatientSchema.safeParse(archived ? { ...rest, archived: true, archivedAt: ctx.now() } : { ...rest, archived: false }));
  return writePatient(ctx, next, `${archived ? 'Arkivim' : 'Rikthim'}: ${patientName(patient)}`, { field: 'archived', value: archived });
}

/** «Ruaj caktimin»: replaces who sees the patient. Laboratory only. */
export function assignPatient(ctx: DataContext, patient: Patient, specialties: string[]): Written<Patient> {
  const assignedAt = ctx.now();
  const next = validated('Pacienti', PatientSchema.safeParse({ ...patient, specialties: inSpecialtyOrder(specialties), assignedAt }));
  return writePatient(ctx, next, `Caktimi: ${patientName(patient)}`, { field: 'assignedAt', value: assignedAt });
}

/**
 * An appointment with a specialty also assigns the patient to it, keeping who already sees
 * the patient (`current`: the saved list, or the specialties with reports for an old patient).
 * Laboratory only. Returns null when nothing changes.
 */
export function addPatientSpecialty(ctx: DataContext, patient: Patient, current: Specialty[], specialty: Specialty): Written<Patient> | null {
  if (patient.specialties?.includes(specialty)) return null;
  const assignedAt = ctx.now();
  const next = validated('Pacienti', PatientSchema.safeParse({ ...patient, specialties: inSpecialtyOrder([...current, specialty]), assignedAt }));
  return writePatient(ctx, next, `Caktimi: ${patientName(patient)} → ${specialty}`, { field: 'assignedAt', value: assignedAt });
}
