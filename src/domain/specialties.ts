// Checklists and wording per specialty, ported from the old app.

import type { Specialty } from '../auth/roles';
import { GASTRO_TEMPLATES, SPECIALTY_EXAMS, URO_TEMPLATES, type DiagnosisTemplate } from './specialtyTemplates';

export const DIAGNOSES: Record<Specialty, string[]> = {
  Kardiologji: ['Hipertension arterial', 'Sëmundje koronare iskemike', 'Fibrilacion atrial', 'Insuficiencë kardiake', 'Angina pectoris'],
  Pulmologji: ['Astma bronkiale', 'SPOK', 'Pneumoni', 'Bronkit akut', 'Bronkit kronik', 'Alergji respiratore'],
  Neurologji: ['Migrenë / kokëdhimbje', 'Sëmundja Parkinson', 'Skleroza multiple', 'Epilepsi', 'Insult cerebrovaskular'],
  // The diagnoses of these two are the names of their templates.
  Gastroenterologji: GASTRO_TEMPLATES.map(template => template.name),
  Urologji: URO_TEMPLATES.map(template => template.name),
  Hixhame: ['Ankesa muskuloskeletale e deklaruar', 'Dhimbje koke e deklaruar', 'Lodhje e deklaruar', 'Kërkesë për procedurë hixhame', 'Kontroll / ndjekje pas procedure']
};

export const EXAMS = ['Hemogram', 'CRP', 'D-dimer', 'Troponinë', 'EKG', 'Ekokardiografi', 'Spirometri', 'CT / MRI', 'Laboratori komplet'];

export const HIXHAME_CHECKS = [
  'Pëlqimi i pacientit',
  'Matja e tensionit arterial',
  'Vlerësim për rrezik gjakderdhjeje',
  'Kontroll mjekësor paraprak kur kërkohet'
];

export const HIXHAME_SERVICES = [
  'Hixhame (terapi me kupa)',
  'Hirudoterapi (terapi me ushujza mjekësore)',
  'Këshillim dhe vlerësim individual para trajtimit',
  'Ndjekje pas procedurës'
];

export const CUP_COUNTS = ['11', '13', '15'];
export const LEECH_COUNTS = ['5', '10', '15', '20', '25', '30'];
export const BODY_POSITIONS = ['Kokë', 'Qafë', 'Shpinë', 'Sup / krahë', 'Këmbë', 'Bark / kraharor', 'Komplet trupi'];

/** Form and print wording; Hixhame relabels the specialist fields. */
export function specialtyLabels(specialty: string) {
  const hixhame = specialty === 'Hixhame';
  return {
    diagnosisHeading: hixhame ? 'Arsye / ankesë e deklaruar' : 'Diagnoza',
    customDiagnoses: hixhame ? 'Shënim tjetër për procedurën' : 'Diagnoza të tjera',
    examHeading: hixhame ? 'Kontrolle para procedurës' : 'Ekzaminime të kërkuara',
    therapy: hixhame ? 'Udhëzime pas procedurës' : 'Terapia e rekomanduar',
    printDiagnoses: hixhame ? 'Arsye / ankesa e deklaruar' : 'Diagnozat',
    printExams: hixhame ? 'Kontrolle para procedurës' : 'Ekzaminime të kërkuara',
    printClinician: hixhame ? 'Njësia / praktikuesi' : 'Mjeku'
  };
}

export function examsFor(specialty: string): string[] {
  if (specialty === 'Hixhame') return HIXHAME_CHECKS;
  return SPECIALTY_EXAMS[specialty as keyof typeof SPECIALTY_EXAMS] ?? EXAMS;
}

const TEMPLATES: Partial<Record<Specialty, DiagnosisTemplate[]>> = {
  Gastroenterologji: GASTRO_TEMPLATES,
  Urologji: URO_TEMPLATES
};

/** Diagnosis templates of the specialty; none for most. */
export function templatesFor(specialty: string): DiagnosisTemplate[] {
  return TEMPLATES[specialty as Specialty] ?? [];
}

/** What applying a template does: only adds, never unticks; the recommendations are appended once. */
export function applyTemplate(
  current: { diagnoses: string[]; requestedExams: string[]; therapy: string },
  template: DiagnosisTemplate,
  exams: string[]
): { diagnoses: string[]; requestedExams: string[]; therapy: string } {
  const add = (values: string[], extra: string[]) => [...values, ...extra.filter(item => !values.includes(item))];
  const therapy = current.therapy.trim();
  return {
    diagnoses: add(current.diagnoses, [template.name]),
    requestedExams: add(current.requestedExams, template.exams.filter(exam => exams.includes(exam))),
    therapy: therapy.includes(template.therapy) ? current.therapy : [therapy, template.therapy].filter(Boolean).join('\n\n')
  };
}

export type { DiagnosisTemplate };

export function diagnosesFor(specialty: string): string[] {
  return DIAGNOSES[specialty as Specialty] ?? [];
}

export type GuidanceService = 'Hixhame' | 'Hirudoterapi';
export type GuidancePhase = 'para' | 'pas';

export const GUIDANCE_SERVICE_TEXT: Record<GuidanceService, string> = {
  Hixhame: 'Hixhame (terapi me kupa)',
  Hirudoterapi: 'Hirudoterapi (terapi me ushujza mjekësore)'
};

export const GUIDANCE_NOTES: Record<GuidancePhase, string[]> = {
  para: [
    'Konfirmoni termin dhe paraqituni në kohën e caktuar.',
    'Njoftoni profesionistin për të gjitha barnat, alergjitë, shtatzëninë/gjidhënien, çrregullimet e gjakderdhjes, sëmundjet kronike dhe infeksionet aktive.',
    'Mos e ndaloni ose ndryshoni asnjë ilaç pa udhëzim të mjekut që e ka përshkruar.',
    'Procedura kryhet vetëm pas vlerësimit individual, pëlqimit të informuar dhe vendimit të profesionistit përgjegjës.'
  ],
  pas: [
    'Ndiqni udhëzimet individuale të dhëna në klinikë dhe mbajeni zonën e trajtuar të pastër sipas këtyre udhëzimeve.',
    'Mos përdorni produkte ose trajtime shtesë në zonë pa miratim profesional.',
    'Kontaktoni klinikën menjëherë nëse vëreni gjakderdhje të zgjatur, temperaturë, skuqje ose ënjtje në rritje, dhimbje të fortë, marramendje ose shqetësim tjetër.',
    'Në rast urgjence, kërkoni ndihmë urgjente mjekësore.'
  ]
};

export const HIRUDOTHERAPY_SAFETY_NOTE =
  'Hirudoterapia kërkon vlerësim klinik, material mjekësor të aprovuar dhe monitorim profesional; kjo fletë nuk zëvendëson planin individual të trajtimit.';
