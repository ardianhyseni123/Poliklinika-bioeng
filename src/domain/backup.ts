// Backup export in the old app's format (bioeng-clinical-backup, version 2), so the existing
// importer in tools/firebase-import keeps reading it. Deleted reports are left out, and so are
// attachments of reports that are not in the backup.

import type { Appointment, AuditEntry, Catalog, CatalogHistoryEntry, Patient, Payment, ReportHead } from '../data/schemas';
import { isTombstone } from '../data/schemas';

export interface BackupAttachment {
  id: string;
  reportId: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  /** data:<type>;base64,... */
  data: string;
}

export interface BackupInput {
  patients: Patient[];
  reports: ReportHead[];
  appointments: Appointment[];
  payments: Payment[];
  audit: AuditEntry[];
  attachments: BackupAttachment[];
  analysisCatalog: Catalog | null;
  catalogHistory: CatalogHistoryEntry[];
}

/** Removes the new app's history pointer, which the old format does not know. */
function withoutVersionPointer<T extends object>(record: T): T {
  const { lastVersionId: _pointer, ...rest } = record as T & { lastVersionId?: string };
  return rest as T;
}

export function buildBackupPayload(input: BackupInput, createdAt = new Date().toISOString()) {
  const reports = input.reports.filter(report => !isTombstone(report)).map(withoutVersionPointer);
  const reportIds = new Set(reports.map(report => report.id));
  return {
    format: 'bioeng-clinical-backup',
    version: 2,
    createdAt,
    patients: input.patients,
    reports,
    appointments: input.appointments,
    payments: input.payments,
    audit: input.audit,
    attachments: input.attachments.filter(attachment => reportIds.has(attachment.reportId)),
    analysisCatalog: input.analysisCatalog,
    catalogHistory: input.catalogHistory
  };
}

export function backupFileName(prefix = 'bioeng-backup', date = new Date()): string {
  return `${prefix}-${date.toISOString().slice(0, 10)}.json`;
}
