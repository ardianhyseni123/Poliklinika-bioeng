// Small formatting helpers, ported from the old app.

/** Text for a value that should be text; objects and empty values become ''. */
export function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Lowercase, accents removed, letters and digits only: "Ardian Hyseni" ~ "ardianhyseni". */
export function normalizeSearch(value: unknown): string {
  return toText(value)
    .toLocaleLowerCase('sq')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Local date and time for <input type="datetime-local">: YYYY-MM-DDTHH:mm. */
export function nowLocal(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Local date: YYYY-MM-DD. */
export function dateOnly(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function euro(value: unknown): string {
  return `${Number(value || 0).toFixed(2)} €`;
}

/** Parses "12,50" or "12.50"; NaN when empty or not a number. */
export function moneyValue(value: unknown): number {
  const text = toText(value).trim().replace(',', '.');
  return text === '' ? Number.NaN : Number(text);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('sq-AL');
}

/** "2026-11-14T09:30" -> "2026-11-14 09:30". */
export function showDateTime(value: string | undefined): string {
  return String(value ?? '').replace('T', ' ');
}

/** Rows a textarea needs for a multi-line reference range (old catalogTextRows). */
export function textRows(value: unknown): number {
  const rows = toText(value).split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 24)), 0);
  return Math.min(8, Math.max(1, rows));
}
