// Reports: a head document (the current version, same fields as the old app wrote) plus an
// immutable version per save under reports/{id}/versions. Head and version go out in one
// batch; the rules require both. Nothing is refused for being based on an older revision:
// concurrent edits become branches in the version history (see domain/history.ts).

import {
  collection,
  doc,
  query,
  where,
  writeBatch,
  type Firestore,
  type Query,
  type Unsubscribe
} from 'firebase/firestore';
import { isLabRole, isSpecialty } from '../auth/roles';
import { buildAuditEntry, writeAuditEntry } from './audit';
import { validated, watchQuery, type Actor, type DataContext, type Snapshot } from './context';
import {
  ReportSchema,
  TombstoneSchema,
  VersionSchema,
  isTombstone,
  parseReportHead,
  type AnalysisItem,
  type Hixhame,
  type Report,
  type ReportHead,
  type ReportSpecialty,
  type ReportType,
  type Tombstone,
  type Version
} from './schemas';

/** What the report form edits. */
export interface ReportDraft {
  patientId: string;
  type: ReportType;
  specialty: ReportSpecialty;
  reportAt: string;
  clinician: string;
  clinicianTitle: string;
  anamnesis: string;
  physicalExam: string;
  existingResults: string;
  diagnoses: string[];
  customDiagnoses: string;
  requestedExams: string[];
  therapy: string;
  notes: string;
  analyses: AnalysisItem[];
  hixhame: Hixhame | null;
}

export interface SavedReport {
  head: Report;
  version: Version;
  done: Promise<void>;
}

export interface DeletedReport {
  head: Tombstone;
  version: Version;
  done: Promise<void>;
}

/** Specialists may only query their own specialty, so the query must say so. */
function scopedReports(db: Firestore, actor: Pick<Actor, 'role'>, base: Query): Query {
  if (isLabRole(actor.role)) return base;
  return query(base, where('type', '==', 'specialist'), where('specialty', '==', actor.role));
}

export function watchReports(
  db: Firestore,
  actor: Pick<Actor, 'role'>,
  onData: (snapshot: Snapshot<ReportHead>) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return watchQuery(scopedReports(db, actor, collection(db, 'reports')), data => parseReportHead(data), onData, onError);
}

export function watchVersions(
  db: Firestore,
  actor: Pick<Actor, 'role'>,
  reportId: string,
  onData: (snapshot: Snapshot<Version>) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return watchQuery(scopedReports(db, actor, collection(db, 'reports', reportId, 'versions')), data => VersionSchema.safeParse(data), onData, onError);
}

/** A specialist always writes their own specialty and signs with their own profile. */
function enforceAuthor(actor: Actor, draft: ReportDraft): ReportDraft {
  if (isLabRole(actor.role)) return draft;
  if (!isSpecialty(actor.role)) throw new Error('This account cannot write reports.');
  return { ...draft, type: 'specialist', specialty: actor.role, clinician: actor.name, clinicianTitle: actor.title };
}

export interface SaveOptions {
  /** Other open branches this save settles. */
  resolves?: string[];
  label?: string;
  /** Rescue of old-app data: keep the report's id and creation time. */
  id?: string;
  createdAt?: string;
  /**
   * Rescue of an edit made against an older state: '' records it as unanchored, so it shows up
   * as a conflict next to what the server has, instead of silently replacing it.
   */
  baseVersionId?: string;
}

/**
 * Saves a new report (existing = null) or a new version of an existing one. `existing` is the
 * head the editor started from.
 */
export function saveReport(
  ctx: DataContext,
  draft: ReportDraft,
  existing: Report | null,
  options: SaveOptions = {}
): SavedReport {
  const now = ctx.now();
  const versionId = ctx.newId();
  const authored = enforceAuthor(ctx.actor, draft);
  const baseRevision = existing?.revision ?? 0;
  const revision = baseRevision + 1;

  const head = validated('Raporti', ReportSchema.safeParse({
    // Keep any fields an older version of the app stored that this one does not edit.
    ...(existing ?? {}),
    ...authored,
    id: existing?.id ?? options.id ?? ctx.newId(),
    createdAt: existing?.createdAt ?? options.createdAt ?? now,
    updatedAt: now,
    revision,
    lastVersionId: versionId
  }));
  if (existing && (head.patientId !== existing.patientId || head.type !== existing.type || head.specialty !== existing.specialty) && !isLabRole(ctx.actor.role)) {
    throw new Error('A specialist cannot move a report to another patient or specialty.');
  }

  const version = validated('Versioni i raportit', VersionSchema.safeParse({
    id: versionId,
    reportId: head.id,
    patientId: head.patientId,
    type: head.type,
    specialty: head.specialty,
    kind: 'save',
    revision,
    baseRevision,
    baseVersionId: options.baseVersionId ?? existing?.lastVersionId ?? '',
    resolves: options.resolves ?? [],
    savedAt: now,
    savedBy: ctx.actor.email,
    report: head
  }));

  const done = commitPair(ctx, head, version);
  ctx.tracker.track({
    id: versionId,
    label: options.label ?? `Raport ${head.specialty}`,
    check: { path: `reports/${head.id}/versions/${versionId}`, expect: 'exists' },
    content: head
  }, done);
  void writeAuditEntry(ctx, buildAuditEntry(ctx, existing ? 'REPORT_UPDATED' : 'REPORT_CREATED', head, revision));
  return { head, version, done };
}

/** Replaces the report with a tombstone. The content stays in the version history. */
export function deleteReport(ctx: DataContext, existing: Report, options: { label?: string } = {}): DeletedReport {
  const now = ctx.now();
  const versionId = ctx.newId();
  const head = validated('Fshirja e raportit', TombstoneSchema.safeParse({
    id: existing.id,
    patientId: existing.patientId,
    type: existing.type,
    specialty: existing.specialty,
    _deleted: true,
    deletedAt: now,
    deletedBy: ctx.actor.email,
    baseRevision: existing.revision,
    lastVersionId: versionId
  }));
  const version = validated('Versioni i fshirjes', VersionSchema.safeParse({
    id: versionId,
    reportId: head.id,
    patientId: head.patientId,
    type: head.type,
    specialty: head.specialty,
    kind: 'delete',
    revision: existing.revision + 1,
    baseRevision: existing.revision,
    baseVersionId: existing.lastVersionId ?? '',
    resolves: [],
    savedAt: now,
    savedBy: ctx.actor.email,
    report: head
  }));

  const done = commitPair(ctx, head, version);
  ctx.tracker.track({
    id: versionId,
    label: options.label ?? `Fshirje raporti ${head.specialty}`,
    check: { path: `reports/${head.id}/versions/${versionId}`, expect: 'exists' },
    content: { deleted: existing }
  }, done);
  void writeAuditEntry(ctx, buildAuditEntry(ctx, 'REPORT_DELETED', existing, existing.revision));
  return { head, version, done };
}

/** The editable fields of a stored report. */
export function draftOf(report: Report): ReportDraft {
  return {
    patientId: report.patientId,
    type: report.type,
    specialty: report.specialty,
    reportAt: report.reportAt,
    clinician: report.clinician,
    clinicianTitle: report.clinicianTitle,
    anamnesis: report.anamnesis,
    physicalExam: report.physicalExam,
    existingResults: report.existingResults,
    diagnoses: report.diagnoses,
    customDiagnoses: report.customDiagnoses,
    requestedExams: report.requestedExams,
    therapy: report.therapy,
    notes: report.notes,
    analyses: report.analyses,
    hixhame: report.hixhame
  };
}

function commitPair(ctx: DataContext, head: ReportHead, version: Version): Promise<void> {
  const batch = writeBatch(ctx.db);
  batch.set(doc(ctx.db, 'reports', head.id), head);
  batch.set(doc(ctx.db, 'reports', head.id, 'versions', version.id), version);
  return batch.commit();
}

export { isTombstone };
