// The one place the app decides who may do what. It mirrors firestore.v2.rules: the rules
// are the real protection, this only decides what the screens offer.

import { isLabRole, isSpecialty, type Profile, type Role } from './roles';

export type Action =
  | 'patients.create'
  | 'patients.archive'
  | 'reports.create'
  | 'reports.chooseType'
  | 'reports.anySpecialty'
  | 'appointments.manage'
  | 'payments.manage'
  | 'finance.view'
  | 'catalog.edit'
  | 'backup.export'
  | 'users.manage';

const LAB_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'patients.create',
  'patients.archive',
  'reports.create',
  'reports.chooseType',
  'reports.anySpecialty',
  'appointments.manage',
  'payments.manage',
  'finance.view',
  'catalog.edit',
  'backup.export'
]);

const SPECIALIST_ACTIONS: ReadonlySet<Action> = new Set<Action>(['patients.create', 'reports.create']);

export function can(profile: Pick<Profile, 'role'> | null, action: Action): boolean {
  if (!profile) return false;
  if (action === 'users.manage') return profile.role === 'Administrator';
  if (isLabRole(profile.role)) return LAB_ACTIONS.has(action);
  return SPECIALIST_ACTIONS.has(action);
}

export interface ReportTag {
  type: string;
  specialty: string;
}

/** Laboratory roles see every report; a specialist sees only their own specialty's. */
export function canAccessReport(profile: Pick<Profile, 'role'> | null, report: ReportTag): boolean {
  if (!profile) return false;
  if (isLabRole(profile.role)) return true;
  return report.type === 'specialist' && report.specialty === profile.role;
}

/** The specialty a new report gets when the user cannot choose it. */
export function fixedSpecialty(role: Role): Role | null {
  return isSpecialty(role) ? role : null;
}
