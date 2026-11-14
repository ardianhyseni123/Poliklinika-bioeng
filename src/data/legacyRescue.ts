// Rescue of changes the old app left waiting on this computer.
//
// The old app kept a per-account IndexedDB database, BioengClinicalDB-<uid>, with an outbox
// called syncQueue. Because of a rule bug, every new report a doctor created stayed there,
// "held", and never reached Firebase. On login the new app (served from the same address, so
// it can see that database) replays those changes through the normal repositories:
// - a report the server never received is created with its original id;
// - an edit made against a version the server has since moved past is saved as a separate
//   branch, so it shows up as a conflict instead of replacing anyone's work;
// - anything that cannot be written (the report was deleted meanwhile, the data is malformed)
//   goes into the write journal as failed, with its content, for a person to recover.
// It needs a connection to compare with the server; offline it stops and tries again at the
// next login. The old database is left in place for 30 days, then deleted.

import { doc, getDocFromServer, type DocumentSnapshot } from 'firebase/firestore';
import { isLabRole } from '../auth/roles';
import type { AttachmentStore } from '../local/attachments';
import { getAll, openExistingDatabase } from '../local/idb';
import { writeAuditEntry } from './audit';
import { restoreAppointment } from './appointments';
import { validated, type DataContext } from './context';
import { errorCode, type TrackInput } from './journal';
import { restorePatient } from './patients';
import { restorePayment } from './payments';
import { deleteReport, draftOf, saveReport } from './reports';
import { AuditSchema, ReportSchema, isTombstone, parseReportHead, type Report } from './schemas';

export const LEGACY_DB_PREFIX = 'BioengClinicalDB';
const KEEP_DAYS = 30;

export function legacyDatabaseName(uid: string): string {
  return `${LEGACY_DB_PREFIX}-${String(uid).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** An entry of the old app's syncQueue. */
interface LegacyMutation {
  id: string;
  store: string;
  operation: 'put' | 'delete';
  recordId: string;
  queuedAt?: string;
  queuedByEmail?: string;
  value?: Record<string, unknown> | null;
  expectedRevision?: number;
  blockedAt?: string;
}

interface LegacyAttachment {
  id: string;
  reportId: string;
  name: string;
  type: string;
  size: number;
  uploadedAt?: string;
  blob: Blob;
}

export interface RescueSummary {
  status: 'nothingFound' | 'done' | 'alreadyDone' | 'offline';
  found: number;
  patients: number;
  reports: number;
  conflicts: number;
  deletions: number;
  appointments: number;
  payments: number;
  audit: number;
  alreadyOnServer: number;
  unrestored: number;
  attachments: number;
}

export interface MarkerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RescueDeps {
  ctx: DataContext;
  uid: string;
  attachments: AttachmentStore;
  /** Content that could not be written; the journal keeps it for a person to recover. */
  recordFailure(input: TrackInput, error: string): void;
  markers: MarkerStore;
  now?: () => Date;
}

class Offline extends Error {}

const OFFLINE_CODES = ['unavailable', 'failed-precondition', 'deadline-exceeded'];

function emptySummary(status: RescueSummary['status']): RescueSummary {
  return { status, found: 0, patients: 0, reports: 0, conflicts: 0, deletions: 0, appointments: 0, payments: 0, audit: 0, alreadyOnServer: 0, unrestored: 0, attachments: 0 };
}

// The old app's send order: deletions and patients first, audit last.
function priority(mutation: LegacyMutation): number {
  if (mutation.operation === 'delete') return mutation.store === 'reports' ? 0 : 3;
  return ({ patients: 0, reports: 1, appointments: 3, payments: 3, audit: 5 } as Record<string, number>)[mutation.store] ?? 4;
}

export async function rescueLegacyChanges(deps: RescueDeps): Promise<RescueSummary> {
  const name = legacyDatabaseName(deps.uid);
  const markerKey = `bioeng-legacy-rescue:${name}`;
  const now = deps.now ?? (() => new Date());

  const marker = deps.markers.getItem(markerKey);
  if (marker) {
    const parsed: unknown = JSON.parse(marker);
    const at = typeof parsed === 'object' && parsed !== null ? (parsed as { at?: unknown }).at : undefined;
    const doneAt = typeof at === 'string' ? Date.parse(at) : Number.NaN;
    if (Number.isFinite(doneAt) && now().getTime() - doneAt > KEEP_DAYS * 86_400_000) indexedDB.deleteDatabase(name);
    return emptySummary('alreadyDone');
  }

  const legacy = await openExistingDatabase(name);
  if (!legacy) return emptySummary('nothingFound');
  try {
    const summary = emptySummary('done');
    const stores = legacy.objectStoreNames;

    // Attachments are local to local: bring them over whatever the connection.
    if (stores.contains('attachments')) {
      for (const item of await getAll<LegacyAttachment>(legacy, 'attachments')) {
        if (!(item?.blob instanceof Blob) || !item.reportId) continue;
        const imported = await deps.attachments.importExisting({
          id: item.id, reportId: item.reportId, name: item.name, type: item.type, size: item.size,
          uploadedAt: item.uploadedAt ?? now().toISOString(), blob: item.blob
        });
        if (imported) summary.attachments += 1;
      }
    }

    const mutations = stores.contains('syncQueue')
      ? (await getAll<LegacyMutation>(legacy, 'syncQueue'))
          .filter(item => !item.queuedByEmail || item.queuedByEmail.toLowerCase() === deps.ctx.actor.email)
          .filter(item => ['patients', 'reports', 'appointments', 'payments', 'audit'].includes(item.store))
          .sort((a, b) => priority(a) - priority(b) || String(a.queuedAt).localeCompare(String(b.queuedAt)))
      : [];
    summary.found = mutations.length;

    for (const mutation of mutations) {
      try {
        await replay(deps, mutation, summary);
      } catch (error) {
        if (error instanceof Offline) return { ...summary, status: 'offline' };
        summary.unrestored += 1;
        deps.recordFailure(failureInput(mutation), errorCode(error));
      }
    }

    deps.markers.setItem(markerKey, JSON.stringify({ at: now().toISOString(), summary }));
    return summary;
  } finally {
    legacy.close();
  }
}

function failureInput(mutation: LegacyMutation, label?: string): TrackInput {
  return {
    id: `legacy:${mutation.id}:${mutation.queuedAt ?? ''}`,
    label: label ?? `Ndryshim i vjetër (${mutation.store}) që nuk u ngarkua`,
    check: { path: `${mutation.store}/${mutation.recordId}`, expect: 'exists' },
    content: mutation.value ?? { [mutation.operation]: mutation.recordId }
  };
}

async function serverDoc(deps: RescueDeps, path: string): Promise<DocumentSnapshot> {
  try {
    return await getDocFromServer(doc(deps.ctx.db, path));
  } catch (error) {
    if (OFFLINE_CODES.includes(errorCode(error))) throw new Offline();
    throw error;
  }
}

function sameDraft(a: Report, b: Report): boolean {
  return JSON.stringify(draftOf(a)) === JSON.stringify(draftOf(b));
}

async function replay(deps: RescueDeps, mutation: LegacyMutation, summary: RescueSummary): Promise<void> {
  const { ctx } = deps;
  const lab = isLabRole(ctx.actor.role);
  const path = `${mutation.store}/${mutation.recordId}`;

  if (mutation.store === 'reports' && mutation.operation === 'delete') {
    const server = await serverDoc(deps, path);
    const head = server.exists() ? parseReportHead(server.data()) : null;
    if (!head?.success || isTombstone(head.data)) {
      summary.alreadyOnServer += 1;
      return;
    }
    if (!head.data.lastVersionId && head.data.revision === mutation.expectedRevision) {
      deleteReport(ctx, head.data);
      summary.deletions += 1;
      return;
    }
    // Edited elsewhere since the deletion was requested: keep it, and say so.
    summary.unrestored += 1;
    deps.recordFailure(failureInput(mutation, 'Fshirje e vjetër e anuluar: raporti ishte ndryshuar ndërkohë'), 'changed-on-server');
    return;
  }

  if (mutation.operation !== 'put' || !mutation.value) return;
  const value = mutation.value;

  if (mutation.store === 'reports') {
    const report = validated('Raporti i vjetër', ReportSchema.safeParse(value));
    const label = `Raport ${report.specialty} (rikthyer)`;
    const server = await serverDoc(deps, path);
    if (!server.exists()) {
      saveReport(ctx, draftOf(report), null, { id: report.id, createdAt: report.createdAt, label });
      summary.reports += 1;
      return;
    }
    const head = parseReportHead(server.data());
    if (!head.success) throw new Error('The server copy of this report is not readable.');
    if (isTombstone(head.data)) {
      summary.unrestored += 1;
      deps.recordFailure(failureInput(mutation, 'Raport i vjetër: ishte fshirë ndërkohë'), 'deleted-on-server');
      return;
    }
    const serverReport = head.data;
    if (sameDraft(serverReport, report)) {
      summary.alreadyOnServer += 1;
      return;
    }
    const baseRevision = mutation.expectedRevision ?? report.revision - 1;
    if (!serverReport.lastVersionId && serverReport.revision === baseRevision) {
      saveReport(ctx, draftOf(report), serverReport, { label });
      summary.reports += 1;
      return;
    }
    // The server moved on: keep both. A report from the old app has no version yet, so first
    // record what the server holds, then add the rescued edit as a separate branch.
    const anchor = serverReport.lastVersionId
      ? serverReport
      : saveReport(ctx, draftOf(serverReport), serverReport, { label: `Raport ${report.specialty} (gjendja në server)` }).head;
    saveReport(ctx, draftOf(report), anchor, { baseVersionId: '', label });
    summary.conflicts += 1;
    return;
  }

  if (mutation.store === 'patients') {
    const server = await serverDoc(deps, path);
    if (server.exists()) summary.alreadyOnServer += 1;
    else {
      restorePatient(ctx, value);
      summary.patients += 1;
    }
    return;
  }

  if (mutation.store === 'appointments' && lab) {
    const server = await serverDoc(deps, path);
    const asText = (field: unknown) => (typeof field === 'string' ? field : '');
    const newer = server.exists() && asText(value.updatedAt) > asText(server.get('updatedAt'));
    if (server.exists() && !newer) summary.alreadyOnServer += 1;
    else {
      restoreAppointment(ctx, value);
      summary.appointments += 1;
    }
    return;
  }

  if (mutation.store === 'payments' && lab) {
    const server = await serverDoc(deps, path);
    if (server.exists()) summary.alreadyOnServer += 1;
    else {
      restorePayment(ctx, value);
      summary.payments += 1;
    }
    return;
  }

  if (mutation.store === 'audit') {
    // Only the laboratory may read the audit log, so just write: an identical entry that
    // already arrived is accepted as a replay; anything else is refused and ignored.
    const entry = validated('Auditimi', AuditSchema.safeParse({ ...value, actorUid: ctx.actor.uid, actorEmail: ctx.actor.email, actorRole: ctx.actor.role }));
    writeAuditEntry(ctx, entry).catch(() => undefined);
    summary.audit += 1;
  }
}
