// The printable document: a saved report, or a hixhame/hirudotherapy guidance sheet.
// Same structure and class names as the old app, so the ported print stylesheet applies
// unchanged (A4, grouped lab results, H/L flags, signature table).

import { canAccessReport } from '../../auth/permissions';
import { useData } from '../../data/DataProvider';
import { isTombstone, type Patient, type Report } from '../../data/schemas';
import { guidanceMessage, reportReadyMessage, VIBER_FORWARD_URL, whatsappUrl } from '../../domain/notify';
import { groupAnalyses, printedClinician, signaturesFor, SIGNATURES, type Signature } from '../../domain/print';
import { GUIDANCE_NOTES, GUIDANCE_SERVICE_TEXT, HIRUDOTHERAPY_SAFETY_NOTE, specialtyLabels } from '../../domain/specialties';
import { nowLocal, showDateTime } from '../../domain/text';
import { FlagMark } from '../reports/AnalysesPanel';
import { useWorkspace, type PrintTarget } from '../workspace/Workspace';

function SignatureTable({ left, right }: { left: Signature | null; right: Signature }) {
  const cell = (signature: Signature | null, align: 'left' | 'right') =>
    signature ? (
      <td style={{ border: 0, width: '50%', textAlign: align }}>
        <strong>{signature.label}:</strong>
        <div style={{ height: 26 }} />
        ________________________<br />
        <strong>{signature.name}</strong><br />
        {signature.title}
      </td>
    ) : <td style={{ border: 0, width: '50%' }} />;
  return (
    <table className="sign-table" style={{ marginTop: 28, border: 0 }}>
      <tbody><tr>{cell(left, 'left')}{cell(right, 'right')}</tr></tbody>
    </table>
  );
}

function Section({ title, value }: { title: string; value: string | undefined }) {
  if (!value) return null;
  return <><div className="section-title">{title}</div><div className="block">{value}</div></>;
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <><div className="section-title">{title}</div><div className="block"><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></div></>;
}

function PatientTable({ patient }: { patient: Patient }) {
  return (
    <table>
      <tbody>
        <tr><td><strong>Pacienti:</strong> {patient.firstName} {patient.lastName}</td><td><strong>Datëlindja:</strong> {patient.dob || '—'}</td></tr>
        <tr><td><strong>Gjinia:</strong> {patient.gender || '—'}</td><td><strong>Telefoni:</strong> {patient.phone || '—'}</td></tr>
      </tbody>
    </table>
  );
}

function ReportDocument({ report, patient }: { report: Report; patient: Patient }) {
  const { data } = useWorkspace();
  const labels = specialtyLabels(report.specialty);
  const [left, right] = signaturesFor(report);
  const clinician = printedClinician(report);
  const hixhame = report.hixhame;
  const hixhameRows = hixhame ? [
    { title: 'Hixhame', count: hixhame.cups, positions: hixhame.cupPositions, unit: 'kupa' },
    { title: 'Hirudoterapi', count: hixhame.leeches, positions: hixhame.leechPositions, unit: 'ushujza mjekësore' }
  ].filter(row => row.count) : [];

  return (
    <article id="printContent" className={`report ${report.type === 'specialist' ? 'specialist-report' : ''}`} data-testid="print-content">
      <div className="report-head">
        <div className="row">
          <img src="/logo.png" alt="Logo Bioeng" width={65} height={65} />
          <div><h1>POLIKLINIKA &amp; LABORATORI BIOENG</h1><div>Raport mjekësor</div></div>
        </div>
        <div>
          <strong>Data:</strong> {showDateTime(report.reportAt)}<br />
          <strong>Lloji:</strong> {report.type === 'laboratory' ? 'Laborator' : 'Vizitë specialistike'}<br />
          <strong>Specialiteti:</strong> {report.specialty}
        </div>
      </div>
      <PatientTable patient={patient} />
      {report.type === 'laboratory' ? (
        <>
          <h2>Rezultatet e analizave laboratorike</h2>
          <table>
            <thead><tr><th>Parametri</th><th>Rezultati</th><th>Njësia</th><th>Referenca</th></tr></thead>
            <tbody>
              {groupAnalyses(report.analyses, data.categories).flatMap(group => [
                <tr key={`group-${group.label}`} className="analysis-group"><td colSpan={4}>{group.label}</td></tr>,
                ...group.rows.map(({ item, flag }, index) => (
                  <tr key={`${group.label}-${item.parameter}-${index}`}>
                    <td>{item.parameter}</td>
                    <td>{item.result || '—'}<FlagMark flag={flag} /></td>
                    <td>{item.unit || '—'}</td>
                    <td>{item.reference || '—'}</td>
                  </tr>
                ))
              ])}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <h2>{report.specialty}</h2>
          <p><strong>{labels.printClinician}:</strong> {clinician.name} {clinician.title ? ` — ${clinician.title}` : ''}</p>
          <Section title="Anamneza dhe ankesat" value={report.anamnesis} />
          <Section title="Ekzaminimi fizik" value={report.physicalExam} />
          <Section title="Rezultate ekzistuese" value={report.existingResults} />
          <ListSection title={labels.printDiagnoses} items={[...report.diagnoses, report.customDiagnoses].filter(Boolean)} />
          <ListSection title={labels.printExams} items={report.requestedExams} />
          <Section title={labels.therapy} value={report.therapy} />
          {report.specialty === 'Hixhame' && hixhame && ((hixhame.services ?? []).length > 0 || hixhameRows.length > 0) && (
            <>
              <div className="section-title">Shërbimet e kryera</div>
              <div className="block">
                <strong>{(hixhame.services ?? []).join(' • ') || '—'}</strong>
                <table><tbody>
                  {hixhameRows.map(row => (
                    <tr key={row.title}>
                      <td><strong>{row.title}</strong></td>
                      <td>{row.count} {row.unit}<br /><span className="muted">Pozitat: {(row.positions ?? []).join(', ') || '—'}</span></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            </>
          )}
        </>
      )}
      <SignatureTable left={left} right={right} />
      <Section title="Shënime shtesë" value={report.notes} />
    </article>
  );
}

function GuidanceDocument({ target, patient }: { target: Extract<PrintTarget, { kind: 'guidance' }>; patient: Patient }) {
  const serviceText = GUIDANCE_SERVICE_TEXT[target.service];
  const [left, right] = SIGNATURES.hixhame;
  return (
    <article id="printContent" className="report specialist-report" data-testid="print-content">
      <div className="report-head">
        <div><h1>POLIKLINIKA &amp; LABORATORI BIOENG</h1><div>Këshilla {target.phase === 'para' ? 'para' : 'pas'} procedurës</div></div>
        <div><strong>Data:</strong> {showDateTime(nowLocal())}<br /><strong>Shërbimi:</strong> {serviceText}</div>
      </div>
      <table><tbody><tr>
        <td><strong>Pacienti:</strong> {patient.firstName} {patient.lastName}</td>
        <td><strong>Telefoni:</strong> {patient.phone || '—'}</td>
      </tr></tbody></table>
      <h2>{target.phase === 'para' ? 'Para trajtimit' : 'Pas trajtimit'} — {serviceText}</h2>
      <p>Kjo fletë është informuese dhe nuk zëvendëson vlerësimin individual klinik.</p>
      <ul>{GUIDANCE_NOTES[target.phase].map(note => <li key={note}>{note}</li>)}</ul>
      {target.service === 'Hirudoterapi' && <p><strong>Shënim sigurie:</strong> {HIRUDOTHERAPY_SAFETY_NOTE}</p>}
      <SignatureTable left={left} right={right} />
    </article>
  );
}

export function PrintArea() {
  const { ctx } = useData();
  const { data, print, showPrint, openReport, say } = useWorkspace();
  if (!print) return null;

  const report = print.kind === 'report' ? data.reports.items.find(item => item.id === print.reportId) : undefined;
  const activeReport = report && !isTombstone(report) && canAccessReport(ctx.actor, report) ? report : null;
  const patientId = print.kind === 'report' ? activeReport?.patientId : print.patientId;
  const patient = data.patients.items.find(item => item.id === patientId);
  if (!patient || (print.kind === 'report' && !activeReport)) return null;

  const message = print.kind === 'report'
    ? reportReadyMessage(patient.firstName)
    : guidanceMessage(patient.firstName, print.service, print.phase);

  function whatsapp() {
    const url = whatsappUrl(patient!.phone, message);
    if (!url) {
      say('Pacienti nuk ka numër telefoni.', true);
      return;
    }
    window.open(url, '_blank');
    say('U hap WhatsApp me njoftimin e përgatitur.');
  }

  async function viber() {
    try {
      await navigator.clipboard.writeText(message);
      say('Njoftimi u kopjua. Zgjidh pacientin në Viber dhe ngjite mesazhin me Ctrl + V.');
    } catch {
      say('Viber kërkon zgjedhjen manuale të pacientit; kopjo mesazhin nga njoftimi.', true);
    }
    window.open(VIBER_FORWARD_URL, '_blank');
  }

  return (
    <section className="card" id="printArea" data-testid="print-area">
      <div className="report-actions no-print">
        {activeReport && <button type="button" className="secondary" onClick={() => openReport(activeReport)}>Ndrysho raportin</button>}
        <button type="button" onClick={() => window.print()}>Printo / Ruaj si PDF</button>
        <button type="button" style={{ background: '#168f43' }} onClick={whatsapp}>Njofto me WhatsApp</button>
        <button type="button" style={{ background: '#6750a4' }} onClick={() => void viber()}>Kopjo njoftim për Viber</button>
        <button type="button" className="secondary" onClick={() => showPrint(null)}>Mbyll</button>
      </div>
      <p className="muted no-print">
        Para printimit, përdor “Ndrysho raportin” për të vendosur rezultatet, shtuar ose hequr analiza; pastaj kliko “Ruaj raportin”.
        WhatsApp hapet me njoftimin e përgatitur. Për Viber, mesazhi kopjohet dhe pacienti zgjidhet në Viber.
      </p>
      {activeReport ? <ReportDocument report={activeReport} patient={patient} /> : print.kind === 'guidance' && <GuidanceDocument target={print} patient={patient} />}
    </section>
  );
}
