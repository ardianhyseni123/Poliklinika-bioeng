// Automatic H (high) / L (low) marking of lab results, ported unchanged from the old app.
// Works for "3.3 - 6.1", "<40" and ">5"; ranges by sex, age, phase or written over several
// lines are printed as they are, without a flag.

import { toText } from './text';

export type Flag = 'H' | 'L' | '';

const UNFLAGGABLE = /[;\n]|Meshkujt|Femrat|Fazat|sipas|Java|Ditë|Negativ|Pozitiv|Normal|Deri/i;
const NUMBER = '(\\d+(?:[.,]\\d+)?)';
const toNumber = (text: string) => Number(text.replace(',', '.'));

export function referenceFlag(result: unknown, reference: unknown): Flag {
  const value = Number(toText(result).trim().replace(',', '.'));
  const ref = toText(reference).trim();
  if (!Number.isFinite(value) || !ref || UNFLAGGABLE.test(ref)) return '';
  let match = ref.match(new RegExp(`^<\\s*${NUMBER}$`));
  if (match?.[1]) return value > toNumber(match[1]) ? 'H' : '';
  match = ref.match(new RegExp(`^>\\s*${NUMBER}$`));
  if (match?.[1]) return value < toNumber(match[1]) ? 'L' : '';
  match = ref.match(new RegExp(`^${NUMBER}\\s*(?:-|–|—)\\s*${NUMBER}$`));
  if (!match?.[1] || !match[2]) return '';
  const low = toNumber(match[1]);
  const high = toNumber(match[2]);
  return value < low ? 'L' : value > high ? 'H' : '';
}

export function referenceSupportsFlag(reference: unknown): boolean {
  return Boolean(referenceFlag('-1e15', reference) || referenceFlag('1e15', reference));
}
