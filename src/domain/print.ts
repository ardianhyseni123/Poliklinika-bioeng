// What a printed report shows, ported from the old app's final print layout.
// Signatures are fixed per kind of report; they live here, in one place.

import type { AnalysisItem, CatalogCategory, Report } from '../data/schemas';
import { printGroupFor } from './catalog';
import { referenceFlag, type Flag } from './reference';

export interface Signature {
  label: string;
  name: string;
  title: string;
}

export const SIGNATURES = {
  laboratory: [
    { label: 'Vërtetoi', name: 'Dr. Mamudije Luma', title: 'Specialiste e Biokimisë Klinike' },
    { label: 'Punoi', name: 'Mr. Sc. Ardian Hyseni', title: 'Biokimist' }
  ],
  hixhame: [
    { label: 'Punoi', name: 'Bsc. Lumnije Hyseni', title: 'Laborante' },
    { label: 'Punoi', name: 'Mr. Sc. Ardian Hyseni', title: 'Biokimist' }
  ]
} satisfies Record<string, [Signature, Signature]>;

/** Neurology reports always print this doctor, whatever the report stored. */
export const NEUROLOGY_SIGNATURE = { name: 'Dr. Nezir Demiolli', title: 'Specialist i Neurologjisë' };

export function printedClinician(report: Pick<Report, 'specialty' | 'clinician' | 'clinicianTitle'>): { name: string; title: string } {
  if (report.specialty === 'Neurologji') return NEUROLOGY_SIGNATURE;
  return { name: report.clinician || '—', title: report.clinicianTitle || report.specialty };
}

/** The two signature cells; an empty left cell for specialist reports. */
export function signaturesFor(report: Pick<Report, 'type' | 'specialty' | 'clinician' | 'clinicianTitle'>): [Signature | null, Signature] {
  if (report.type === 'laboratory') return SIGNATURES.laboratory;
  if (report.specialty === 'Hixhame') return SIGNATURES.hixhame;
  const clinician = printedClinician(report);
  return [null, { label: 'Mjeku kontrollues', name: clinician.name, title: clinician.title }];
}

export interface PrintedAnalysis {
  item: AnalysisItem;
  flag: Flag;
}

export interface AnalysisGroup {
  label: string;
  rows: PrintedAnalysis[];
}

/** Lab rows under their print headings, keeping the order they were entered in. */
export function groupAnalyses(analyses: AnalysisItem[], categories: CatalogCategory[] = []): AnalysisGroup[] {
  const groups: AnalysisGroup[] = [];
  for (const item of analyses) {
    const label = printGroupFor(item, categories);
    let group = groups.find(entry => entry.label === label);
    if (!group) {
      group = { label, rows: [] };
      groups.push(group);
    }
    group.rows.push({ item, flag: referenceFlag(item.result, item.reference) });
  }
  return groups;
}
