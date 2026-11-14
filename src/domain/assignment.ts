// Which specialists see a patient (V28 «Specialistët e pacientit»).
//
// - A patient carries the specialties it is assigned to. The laboratory sets them; a patient
//   a specialist registers is assigned to that specialist; an appointment with a specialty
//   adds that specialty.
// - An "old" patient, from before the assignment existed, has no list yet. It is shown to the
//   specialists who have a report for it, until the laboratory saves an assignment.
// - [] means nobody: only the laboratory sees the patient.

import { SPECIALTIES, type Specialty } from '../auth/roles';
import type { Patient, Report } from '../data/schemas';

export function isOldPatient(patient: Pick<Patient, 'specialties'>): boolean {
  return !Array.isArray(patient.specialties);
}

/** In the order of the app's specialty lists, without duplicates. */
export function inSpecialtyOrder(specialties: readonly string[]): Specialty[] {
  return SPECIALTIES.filter(specialty => specialties.includes(specialty));
}

/** The specialties that have a specialist report for this patient. */
export function reportSpecialties(patientId: string, reports: readonly Report[]): Specialty[] {
  return inSpecialtyOrder(reports.filter(report => report.patientId === patientId && report.type === 'specialist').map(report => report.specialty));
}

/** Who sees the patient now: the saved assignment, or for an old patient the specialties with reports. */
export function patientSpecialties(patient: Pick<Patient, 'id' | 'specialties'>, reports: readonly Report[]): Specialty[] {
  return patient.specialties ? inSpecialtyOrder(patient.specialties) : reportSpecialties(patient.id, reports);
}

/** For a specialist: the patient is assigned to them, or is old and they have a report for it. */
export function visibleToSpecialist(patient: Pick<Patient, 'id' | 'specialties'>, specialty: Specialty, ownReports: readonly Report[]): boolean {
  return patient.specialties
    ? patient.specialties.includes(specialty)
    : ownReports.some(report => report.patientId === patient.id && report.type === 'specialist' && report.specialty === specialty);
}

export function assignmentSummary(specialties: readonly string[]): string {
  return specialties.length
    ? `Pacienti u caktua te: ${specialties.join(', ')}.`
    : 'Pacienti nuk është caktuar te asnjë specialist; e sheh vetëm laboratori.';
}
