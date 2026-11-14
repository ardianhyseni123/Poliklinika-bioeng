// Patient notifications through WhatsApp and Viber, as in the old app. Nothing is sent
// automatically: WhatsApp opens with the text prepared; Viber gets it on the clipboard.

import type { GuidancePhase, GuidanceService } from './specialties';
import { toText } from './text';

/** Kosovo numbers: a leading 0 becomes 383; a leading + is dropped. */
export function normalizePhone(phone: unknown): string {
  const value = toText(phone).replace(/[^0-9+]/g, '');
  if (value.startsWith('0')) return `383${value.slice(1)}`;
  if (value.startsWith('+')) return value.slice(1);
  return value;
}

export function reportReadyMessage(firstName: string): string {
  return `Përshëndetje ${firstName}, raporti juaj mjekësor nga Poliklinika BIOENG është gati. Ju lutem kontaktoni klinikën për ta pranuar në mënyrë të sigurt.`;
}

export function guidanceMessage(firstName: string, service: GuidanceService, phase: GuidancePhase): string {
  return `Përshëndetje ${firstName}, këshillat ${phase === 'para' ? 'para' : 'pas'} ${service === 'Hixhame' ? 'hixhames' : 'hirudoterapisë'} janë përgatitur nga Poliklinika BIOENG. PDF-ja duhet të bashkëngjitet në këtë bisedë.`;
}

export function whatsappUrl(phone: string, text: string): string | null {
  const number = normalizePhone(phone);
  return number ? `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(text)}` : null;
}

export const VIBER_FORWARD_URL = 'viber://forward';
