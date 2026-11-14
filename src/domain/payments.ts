// Payment totals per report, per day and per period, ported from the old app.
// A report can be paid in several parts; its total is the latest total recorded for it.

import type { Payment, ReportHead } from '../data/schemas';
import { showDateTime } from './text';

export interface PaymentSummary {
  reportId: string;
  total: number;
  paid: number;
  remaining: number;
  status: 'PAID' | 'UNPAID';
  /** The date of the first payment record: the day the report was billed. */
  billingDate: string;
  entries: Payment[];
}

export function paymentSummaries(records: Payment[]): Map<string, PaymentSummary> {
  const groups = new Map<string, PaymentSummary>();
  const linked = records
    .filter(payment => payment.reportId)
    .sort((a, b) => `${a.paymentDate || ''}${a.recordedAt || ''}`.localeCompare(`${b.paymentDate || ''}${b.recordedAt || ''}`));
  for (const payment of linked) {
    const reportId = payment.reportId as string;
    let group = groups.get(reportId);
    if (!group) {
      group = { reportId, total: 0, paid: 0, remaining: 0, status: 'UNPAID', billingDate: payment.paymentDate || '', entries: [] };
      groups.set(reportId, group);
    }
    const total = Number(payment.reportTotal || 0);
    if (total > 0) group.total = total;
    if (payment.status === 'PAID') group.paid += Number(payment.amount || 0);
    group.entries.push(payment);
  }
  for (const group of groups.values()) {
    group.remaining = Math.max(0, group.total - group.paid);
    group.status = group.total > 0 && group.remaining === 0 ? 'PAID' : 'UNPAID';
  }
  return groups;
}

export function reportPaymentLabel(report: Pick<ReportHead, 'type' | 'specialty'> & { reportAt?: string }): string {
  return `${showDateTime(report.reportAt)} — ${report.type === 'laboratory' ? 'Laborator' : report.specialty}`;
}

export interface Totals {
  billed: number;
  paid: number;
  remaining: number;
}

/** Billed and remaining by billing date, paid by payment date, all from `start` (YYYY-MM-DD) on. */
export function totalsSince(records: Payment[], start: string, end?: string): Totals {
  const inRange = (date: string) => Boolean(date) && date >= start && (end === undefined || date <= end);
  const linked = records.filter(payment => payment.reportId);
  const invoices = [...paymentSummaries(linked).values()].filter(summary => inRange(summary.billingDate));
  return {
    billed: invoices.reduce((sum, summary) => sum + summary.total, 0),
    remaining: invoices.reduce((sum, summary) => sum + summary.remaining, 0),
    paid: linked.filter(payment => payment.status === 'PAID' && inRange(payment.paymentDate)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  };
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Today, the current week (from Monday), month and year. */
export function financeSummary(records: Payment[], today = new Date()): { day: Totals; week: Totals; month: Totals; year: Totals } {
  const day = isoDate(today);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return {
    day: totalsSince(records, day, day),
    week: totalsSince(records, isoDate(monday)),
    month: totalsSince(records, isoDate(new Date(today.getFullYear(), today.getMonth(), 1))),
    year: totalsSince(records, isoDate(new Date(today.getFullYear(), 0, 1)))
  };
}

/** Why a new payment cannot be recorded, or null. Messages are shown as they are. */
export function paymentProblem(input: { total: number; amount: number; status: 'PAID' | 'UNPAID'; alreadyPaid: number }): string | null {
  if (!Number.isFinite(input.total) || input.total <= 0) return 'Shëno vlerën totale të raportit në euro.';
  if (input.status === 'PAID' && (!Number.isFinite(input.amount) || input.amount <= 0)) return 'Shëno pagesën e vlefshme.';
  if (input.total < input.alreadyPaid || input.alreadyPaid + input.amount > input.total) {
    return 'Pagesa nuk mund të jetë më e madhe se vlera e mbetur e raportit.';
  }
  return null;
}
