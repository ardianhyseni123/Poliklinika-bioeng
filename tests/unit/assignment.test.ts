import { describe, expect, test } from 'vitest';
import { DEFAULT_TITLES, SPECIALTIES } from '../../src/auth/roles';
import type { Report } from '../../src/data/schemas';
import { assignmentSummary, isOldPatient, patientSpecialties, reportSpecialties, visibleToSpecialist } from '../../src/domain/assignment';
import { printedClinician, signaturesFor } from '../../src/domain/print';
import { applyTemplate, diagnosesFor, examsFor, EXAMS, templatesFor } from '../../src/domain/specialties';

const report = (patientId: string, specialty: string, type = 'specialist') => ({ id: `${patientId}-${specialty}`, patientId, type, specialty }) as Report;

describe('who sees a patient', () => {
  const reports = [report('old', 'Kardiologji'), report('old', 'Neurologji'), report('old', 'Laborator', 'laboratory'), report('assigned', 'Kardiologji')];

  test('an old patient has no list; [] is an assignment to nobody', () => {
    expect(isOldPatient({})).toBe(true);
    expect(isOldPatient({ specialties: [] })).toBe(false);
  });

  test('an old patient is seen by the specialists with a report for it, in the usual order', () => {
    expect(reportSpecialties('old', reports)).toEqual(['Kardiologji', 'Neurologji']);
    expect(patientSpecialties({ id: 'old' }, reports)).toEqual(['Kardiologji', 'Neurologji']);
  });

  test('a saved assignment replaces what the reports say', () => {
    expect(patientSpecialties({ id: 'assigned', specialties: ['Urologji'] }, reports)).toEqual(['Urologji']);
    expect(patientSpecialties({ id: 'assigned', specialties: [] }, reports)).toEqual([]);
  });

  test('a specialist sees assigned patients and old patients with a report of their own', () => {
    expect(visibleToSpecialist({ id: 'old' }, 'Kardiologji', reports)).toBe(true);
    expect(visibleToSpecialist({ id: 'old' }, 'Pulmologji', reports)).toBe(false);
    expect(visibleToSpecialist({ id: 'assigned', specialties: ['Urologji'] }, 'Urologji', [])).toBe(true);
    // Once assigned, a report no longer makes the patient visible.
    expect(visibleToSpecialist({ id: 'assigned', specialties: ['Urologji'] }, 'Kardiologji', reports)).toBe(false);
    expect(visibleToSpecialist({ id: 'new', specialties: [] }, 'Kardiologji', reports)).toBe(false);
  });

  test('the confirmation says who sees the patient', () => {
    expect(assignmentSummary(['Kardiologji', 'Urologji'])).toBe('Pacienti u caktua te: Kardiologji, Urologji.');
    expect(assignmentSummary([])).toContain('e sheh vetëm laboratori');
  });
});

describe('Gastroenterologji and Urologji', () => {
  test('are specialties with the titles of V28', () => {
    expect(SPECIALTIES).toEqual(['Kardiologji', 'Pulmologji', 'Neurologji', 'Gastroenterologji', 'Urologji', 'Hixhame']);
    expect(DEFAULT_TITLES.Gastroenterologji).toBe('Gastroenterolog');
    expect(DEFAULT_TITLES.Urologji).toBe('Urolog');
  });

  test.each(['Gastroenterologji', 'Urologji'])('%s: the diagnoses are the templates, whose exams are all on its own list', specialty => {
    const templates = templatesFor(specialty);
    expect(templates.length).toBe(specialty === 'Gastroenterologji' ? 17 : 18);
    expect(diagnosesFor(specialty)).toEqual(templates.map(template => template.name));
    const exams = examsFor(specialty);
    expect(exams).not.toEqual(EXAMS);
    for (const template of templates) {
      expect(exams).toEqual(expect.arrayContaining(template.exams));
      expect(template.therapy.startsWith('Rekomandime:')).toBe(true);
    }
    // Every exam on the list is suggested by some template.
    expect(new Set(templates.flatMap(template => template.exams))).toEqual(new Set(exams));
  });

  test('the other specialties have no templates and keep the shared exam list', () => {
    expect(templatesFor('Kardiologji')).toEqual([]);
    expect(examsFor('Kardiologji')).toEqual(EXAMS);
  });

  test('applying a template only adds, and adds the recommendations once', () => {
    const [template] = templatesFor('Urologji');
    const exams = examsFor('Urologji');
    const first = applyTemplate({ diagnoses: ['Tjetër'], requestedExams: ['Hemogram'], therapy: 'Tamsulosin 0.4 mg' }, template!, exams);
    expect(first.diagnoses).toEqual(['Tjetër', template!.name]);
    expect(first.requestedExams).toEqual(['Hemogram', ...template!.exams]);
    expect(first.therapy).toBe(`Tamsulosin 0.4 mg\n\n${template!.therapy}`);
    expect(applyTemplate(first, template!, exams)).toEqual(first);
  });

  test('print their fixed doctor, whatever the report stored', () => {
    const gastro = { type: 'specialist' as const, specialty: 'Gastroenterologji' as const, clinician: 'Dikush tjetër', clinicianTitle: 'X' };
    expect(printedClinician(gastro)).toEqual({ name: 'Dr. Shqiprim Aliu', title: 'Gastroenterolog' });
    expect(signaturesFor({ ...gastro, specialty: 'Urologji' })[1]).toEqual({ label: 'Mjeku kontrollues', name: 'Dr. Agron Uruqi', title: 'Urolog' });
    expect(printedClinician({ specialty: 'Kardiologji', clinician: 'Dr. K', clinicianTitle: 'Kardiolog' })).toEqual({ name: 'Dr. K', title: 'Kardiolog' });
  });
});
