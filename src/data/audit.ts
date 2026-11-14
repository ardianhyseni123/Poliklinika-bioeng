import { collection, doc, setDoc, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { validated, watchQuery, type DataContext, type Snapshot } from './context';
import { AuditSchema, type AuditEntry, type ReportHead } from './schemas';

export type AuditAction = AuditEntry['action'];

export function buildAuditEntry(ctx: DataContext, action: AuditAction, report: ReportHead, revision: number): AuditEntry {
  return validated('Regjistrimi i auditimit', AuditSchema.safeParse({
    id: ctx.newId(),
    action,
    reportId: report.id,
    patientId: report.patientId,
    at: ctx.now(),
    revision: Math.max(1, revision),
    actorUid: ctx.actor.uid,
    actorEmail: ctx.actor.email,
    actorRole: ctx.actor.role,
    reportType: report.type,
    specialty: report.specialty
  }));
}

/**
 * Audit entries are secondary to the report's own version history, so they are written on
 * their own: a problem with one can never hold back the report it describes.
 */
export function writeAuditEntry(ctx: DataContext, entry: AuditEntry): Promise<void> {
  const done = setDoc(doc(ctx.db, 'audit', entry.id), entry);
  done.catch(error => console.warn('An audit entry was not saved.', error));
  return done;
}

/** Laboratory only. */
export function watchAudit(db: Firestore, onData: (snapshot: Snapshot<AuditEntry>) => void, onError: (error: Error) => void): Unsubscribe {
  return watchQuery(collection(db, 'audit'), data => AuditSchema.safeParse(data), onData, onError);
}
