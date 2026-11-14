import { useMemo } from 'react';
import { canAccessReport } from '../../auth/permissions';
import { isLabRole } from '../../auth/roles';
import { useData } from '../../data/DataProvider';
import { deleteReport, draftOf, saveReport } from '../../data/reports';
import type { Report, Version } from '../../data/schemas';
import type { Conflict } from '../../domain/history';
import { formatDateTime, showDateTime } from '../../domain/text';
import { useConflicts } from '../workspace/useWorkspaceData';
import { useWorkspace } from '../workspace/Workspace';

export function ReportList() {
  const { ctx, attachments } = useData();
  const { data, patientId, editor, openReport, showPrint, say } = useWorkspace();
  const actor = ctx.actor;

  const reports = useMemo(
    () => data.activeReports
      .filter(report => report.patientId === patientId && canAccessReport(actor, report))
      .sort((a, b) => String(b.reportAt).localeCompare(String(a.reportAt))),
    [data.activeReports, patientId, actor]
  );
  const { conflicts } = useConflicts(reports);

  async function remove(report: Report) {
    if (!window.confirm('Ta fshij këtë raport? Përmbajtja ruhet në historikun e raportit.')) return;
    deleteReport(ctx, report, { label: `Fshirje raporti ${report.specialty}` });
    await attachments.deleteForReport(report.id);
    if (editor.report?.id === report.id) openReport(null);
    say('Raporti u fshi.');
  }

  return (
    <>
      <section className="card" id="reportListCard" data-testid="report-list">
        <h2>{isLabRole(actor.role) ? 'Raportet e pacientit' : `Kontrollet e ${actor.role}`}</h2>
        <p className="muted">Për rezultatet e marra më vonë, kliko “Redakto”, vendos vlerat dhe ruaje raportin para printimit.</p>
        {!patientId && <p className="muted">Zgjidh pacientin për të parë raportet.</p>}
        <table>
          <thead><tr><th>Data / ora</th><th>Lloji</th><th>Specialiteti</th><th>Mjeku</th><th>Versioni</th><th>Veprimet</th></tr></thead>
          <tbody>
            {reports.map(report => (
              <tr key={report.id} className="pick" onClick={event => { if (!(event.target as HTMLElement).closest('button')) openReport(report); }}>
                <td>{showDateTime(report.reportAt)}</td>
                <td>{report.type === 'laboratory' ? 'Laborator' : 'Vizitë specialistike'}</td>
                <td>{report.specialty}</td>
                <td>{report.clinician || '—'}</td>
                <td>
                  {report.revision}
                  {data.reports.pendingIds.has(report.id) && <span className="muted" title="Ende pa u dërguar në server"> ●</span>}
                  {conflicts.has(report.id) && <strong className="payment-unpaid" data-testid="conflict-badge"> ⚠ Dy versione</strong>}
                </td>
                <td>
                  <button type="button" onClick={() => openReport(report)}>Redakto</button>
                  <button type="button" className="secondary" onClick={() => showPrint({ kind: 'report', reportId: report.id })}>Shfaq</button>
                  <button type="button" className="danger" onClick={() => void remove(report)}>Fshie raportin</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {reports.filter(report => conflicts.has(report.id)).map(report => (
        <ConflictCard key={report.id} report={report} conflict={conflicts.get(report.id)!} />
      ))}
    </>
  );
}

function summary(report: Report): string[] {
  const lines = [
    report.anamnesis && `Anamneza: ${report.anamnesis}`,
    report.diagnoses.length || report.customDiagnoses ? `Diagnozat: ${[...report.diagnoses, report.customDiagnoses].filter(Boolean).join(', ')}` : '',
    report.therapy && `Terapia: ${report.therapy}`,
    report.analyses.length ? `Analizat: ${report.analyses.map(item => `${item.parameter} ${item.result || '—'}`).join(', ')}` : '',
    report.notes && `Shënime: ${report.notes}`
  ];
  return lines.filter((line): line is string => Boolean(line));
}

/** Two devices edited the same report: show both versions and let a person choose. */
function ConflictCard({ report, conflict }: { report: Report; conflict: Conflict<Version> }) {
  const { ctx } = useData();
  const { openReport, say } = useWorkspace();
  const branches = [conflict.current, ...conflict.others].filter((version): version is Version => version !== undefined && version.kind === 'save');
  const ids = branches.map(version => version.id);

  function keep(version: Version) {
    const chosen = version.report as Report;
    saveReport(ctx, draftOf(chosen), chosen, { resolves: ids.filter(id => id !== version.id), label: 'Zgjidhje konflikti' });
    say('Konflikti u zgjidh: versioni i zgjedhur u bë versioni i raportit.');
  }

  return (
    <section className="card warning" data-testid="conflict-card">
      <h3>Ky raport u ndryshua në dy pajisje ({report.specialty}, {showDateTime(report.reportAt)})</h3>
      <p>Asnjë ndryshim nuk humbi. Zgjidh versionin që duhet të mbetet, ose hape njërin, plotësoje me pjesët e tjetrit dhe ruaje.</p>
      <div className="grid">
        {branches.map(version => (
          <div key={version.id} className="payment-summary">
            <strong>{version.id === conflict.current?.id ? 'Versioni që shfaqet tani' : 'Versioni tjetër'}</strong>
            <div className="muted">Ruajtur nga {version.savedBy} më {formatDateTime(version.savedAt)}</div>
            <ul>{summary(version.report as Report).map(line => <li key={line}>{line}</li>)}</ul>
            <button type="button" onClick={() => keep(version)}>Mbaj këtë version</button>
            <button type="button" className="secondary" onClick={() => openReport(version.report as Report, ids.filter(id => id !== version.id))}>Hape për ta bashkuar</button>
          </div>
        ))}
      </div>
    </section>
  );
}
