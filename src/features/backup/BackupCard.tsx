import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { useData } from '../../data/DataProvider';
import { AuditSchema, type AuditEntry } from '../../data/schemas';
import { backupFileName, buildBackupPayload, type BackupAttachment } from '../../domain/backup';
import { useWorkspace } from '../workspace/Workspace';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unexpected file contents.')));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function download(payload: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Laboratory only. Same format as before, so the importer tool keeps reading it. */
export function BackupCard() {
  const { ctx, attachments } = useData();
  const { data, say } = useWorkspace();
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    setBusy(true);
    try {
      const auditSnapshot = await getDocs(collection(ctx.db, 'audit'));
      const audit = auditSnapshot.docs
        .map(item => AuditSchema.safeParse(item.data()))
        .filter(result => result.success)
        .map(result => result.data)
        .filter((entry): entry is AuditEntry => entry !== undefined);
      const files: BackupAttachment[] = await Promise.all((await attachments.listAll()).map(async item => ({
        id: item.id, reportId: item.reportId, name: item.name, type: item.type, size: item.size, uploadedAt: item.uploadedAt,
        data: await blobToDataUrl(item.blob)
      })));
      const payload = buildBackupPayload({
        patients: data.patients.items,
        reports: data.reports.items,
        appointments: data.appointments.items,
        payments: data.payments.items,
        audit,
        attachments: files,
        analysisCatalog: data.storedCatalog,
        catalogHistory: data.catalogHistory.items
      });
      download(payload, backupFileName());
      say('Kopja rezervë u krijua. Ruaje në vend të mbrojtur.');
    } catch (error) {
      console.error(error);
      say('Kopja rezervë nuk u krijua. Provo përsëri me lidhje interneti.', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card no-print" id="backupCard" data-testid="backup-card">
      <h2>Kopje rezervë</h2>
      <p className="muted">
        Ruaj kopje rezervë rregullisht në një vend të mbrojtur. Skedari mund të përmbajë të dhëna personale dhe mjekësore.
        Bashkëngjitjet përfshihen vetëm ato të ruajtura në këtë kompjuter.
      </p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void exportBackup()}>{busy ? 'Duke përgatitur…' : 'Eksporto kopjen rezervë'}</button>
      <p className="muted">Rikthimi i një kopjeje rezervë bëhet nga administratori me mjetin e importit (tools/firebase-import), jo nga aplikacioni.</p>
    </section>
  );
}
