// Roles must match firestore.v2.rules.

export const LAB_ROLES = ['Administrator', 'Laborator'] as const;
// The order of the specialty lists in the app (the V28 order).
export const SPECIALTIES = ['Kardiologji', 'Pulmologji', 'Neurologji', 'Gastroenterologji', 'Urologji', 'Hixhame'] as const;
export const ROLES = [...LAB_ROLES, ...SPECIALTIES] as const;

export type LabRole = (typeof LAB_ROLES)[number];
export type Specialty = (typeof SPECIALTIES)[number];
export type Role = (typeof ROLES)[number];

/** A users/{email} document. */
export interface Profile {
  email: string;
  role: Role;
  name: string;
  title: string;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_TITLES: Record<Role, string> = {
  Administrator: 'Administrator',
  Laborator: 'Laborator',
  Kardiologji: 'Specialist i Kardiologjisë',
  Pulmologji: 'Specialist i Pulmologjisë',
  Neurologji: 'Specialist i Neurologjisë',
  Gastroenterologji: 'Gastroenterolog',
  Urologji: 'Urolog',
  Hixhame: 'Njësia e Hixhames'
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isLabRole(role: Role): role is LabRole {
  return (LAB_ROLES as readonly string[]).includes(role);
}

export function isSpecialty(role: Role): role is Specialty {
  return (SPECIALTIES as readonly string[]).includes(role);
}
