import { describe, expect, test } from 'vitest';
import { can, canAccessReport, type Action } from '../../src/auth/permissions';
import { ROLES, SPECIALTIES, type Role } from '../../src/auth/roles';

const ALL_ACTIONS: Action[] = [
  'patients.create', 'patients.archive', 'patients.assign', 'reports.create', 'reports.chooseType', 'reports.anySpecialty',
  'appointments.manage', 'payments.manage', 'finance.view', 'catalog.edit', 'backup.export', 'users.manage'
];

function allowed(role: Role): Action[] {
  return ALL_ACTIONS.filter(action => can({ role }, action));
}

describe('permissions', () => {
  test('Administrator can do everything', () => {
    expect(allowed('Administrator')).toEqual(ALL_ACTIONS);
  });

  test('Laborator can do everything except manage users, finances included', () => {
    expect(allowed('Laborator')).toEqual(ALL_ACTIONS.filter(action => action !== 'users.manage'));
  });

  test.each(SPECIALTIES)('%s can only create patients and reports', role => {
    expect(allowed(role)).toEqual(['patients.create', 'reports.create']);
  });

  test('without a profile nothing is allowed', () => {
    expect(ALL_ACTIONS.some(action => can(null, action))).toBe(false);
    expect(canAccessReport(null, { type: 'laboratory', specialty: 'Laborator' })).toBe(false);
  });

  test('report visibility matches the Firestore rules', () => {
    const lab = { type: 'laboratory', specialty: 'Laborator' };
    const kardio = { type: 'specialist', specialty: 'Kardiologji' };
    for (const role of ROLES) {
      const isLab = role === 'Administrator' || role === 'Laborator';
      expect(canAccessReport({ role }, lab)).toBe(isLab);
      expect(canAccessReport({ role }, kardio)).toBe(isLab || role === 'Kardiologji');
    }
  });
});
