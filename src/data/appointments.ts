import { collection, doc, setDoc, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { validated, watchQuery, type DataContext, type Snapshot, type Written } from './context';
import { AppointmentSchema, type Appointment } from './schemas';

export type NewAppointment = Pick<Appointment, 'patientId' | 'patientName' | 'appointmentAt' | 'specialty' | 'clinician' | 'phone' | 'note'> &
  Partial<Pick<Appointment, 'status'>>;

/** Laboratory only. */
export function watchAppointments(db: Firestore, onData: (snapshot: Snapshot<Appointment>) => void, onError: (error: Error) => void): Unsubscribe {
  return watchQuery(collection(db, 'appointments'), data => AppointmentSchema.safeParse(data), onData, onError);
}

function write(ctx: DataContext, appointment: Appointment, label: string, checkField: { field: string; value: string | boolean }): Written<Appointment> {
  const path = `appointments/${appointment.id}`;
  const done = setDoc(doc(ctx.db, path), appointment);
  ctx.tracker.track({ id: `appointment:${appointment.id}:${ctx.newId()}`, label, check: { path, expect: 'field', ...checkField }, content: appointment }, done);
  return { record: appointment, done };
}

export function createAppointment(ctx: DataContext, input: NewAppointment): Written<Appointment> {
  const appointment = validated('Termini', AppointmentSchema.safeParse({ status: 'Caktuar', ...input, id: ctx.newId(), createdAt: ctx.now() }));
  return write(ctx, appointment, `Termin: ${appointment.patientName}`, { field: 'createdAt', value: appointment.createdAt });
}

/** Rescue of old-app data: writes an appointment with its existing id. */
export function restoreAppointment(ctx: DataContext, input: unknown): Written<Appointment> {
  const appointment = validated('Termini', AppointmentSchema.safeParse(input));
  return write(ctx, appointment, `Termin: ${appointment.patientName}`, { field: 'createdAt', value: appointment.createdAt });
}

export function updateAppointment(
  ctx: DataContext,
  appointment: Appointment,
  changes: Partial<Pick<Appointment, 'status' | 'expired'>>
): Written<Appointment> {
  const now = ctx.now();
  const next = validated('Termini', AppointmentSchema.safeParse({
    ...appointment,
    ...changes,
    ...(changes.expired && !appointment.expired ? { expiredAt: now } : {}),
    updatedAt: now
  }));
  return write(ctx, next, `Termin: ${next.patientName}`, { field: 'updatedAt', value: now });
}
