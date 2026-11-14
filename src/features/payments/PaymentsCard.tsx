import { useMemo, useState } from 'react';
import { can } from '../../auth/permissions';
import { useData } from '../../data/DataProvider';
import { patientName } from '../../data/patients';
import { createPayment } from '../../data/payments';
import { financeSummary, paymentProblem, paymentSummaries, reportPaymentLabel, type Totals } from '../../domain/payments';
import { dateOnly, euro, moneyValue } from '../../domain/text';
import { useWorkspace } from '../workspace/Workspace';

const statusLabel = (status: 'PAID' | 'UNPAID') => (status === 'PAID' ? 'E paguar' : 'E pa paguar');

function TotalsCard({ title, totals }: { title: string; totals: Totals }) {
  return <div><strong>{title}</strong><br />Faturuar: {euro(totals.billed)}<br />Paguar: {euro(totals.paid)}<br />Mbetur: {euro(totals.remaining)}</div>;
}

export function PaymentsCard() {
  const { ctx } = useData();
  const { data, patientId, editor, say } = useWorkspace();
  const patient = data.patients.items.find(item => item.id === patientId) ?? null;
  const payments = data.payments.items;
  const summaries = useMemo(() => paymentSummaries(payments), [payments]);
  const reports = useMemo(
    () => data.activeReports.filter(report => report.patientId === patientId).sort((a, b) => b.reportAt.localeCompare(a.reportAt)),
    [data.activeReports, patientId]
  );

  const [reportId, setReportId] = useState('');
  const [form, setForm] = useState({ total: '', amount: '', status: 'PAID' as 'PAID' | 'UNPAID', date: dateOnly(), note: '' });
  // Default to the report open in the editor when it belongs to this patient.
  const chosenId = reports.some(report => report.id === reportId)
    ? reportId
    : (reports.some(report => report.id === editor.report?.id) ? editor.report!.id : '');

  function chooseReport(id: string) {
    setReportId(id);
    const summary = summaries.get(id);
    setForm(current => ({ ...current, total: summary?.total ? String(summary.total) : '', amount: '', status: summary && summary.remaining > 0 ? 'UNPAID' : 'PAID' }));
  }

  function save() {
    if (!patient) {
      say('Zgjidh pacientin para ruajtjes së pagesës.', true);
      return;
    }
    const report = reports.find(item => item.id === chosenId);
    if (!report) {
      say('Ruaje raportin e pacientit dhe zgjidhe te fusha “Raporti i pacientit”.', true);
      return;
    }
    const total = moneyValue(form.total);
    const amount = form.status === 'UNPAID' ? 0 : moneyValue(form.amount);
    const problem = paymentProblem({ total, amount, status: form.status, alreadyPaid: summaries.get(report.id)?.paid ?? 0 });
    if (problem) {
      say(problem, true);
      return;
    }
    createPayment(ctx, {
      patientId: patient.id,
      patientName: patientName(patient),
      reportId: report.id,
      reportLabel: reportPaymentLabel(report),
      reportTotal: total,
      amount,
      status: form.status,
      paymentDate: form.date || dateOnly(),
      note: form.note.trim()
    });
    setForm(current => ({ ...current, amount: '', note: '' }));
    say(form.status === 'PAID' ? 'Pagesa u ruajt për raportin e zgjedhur.' : 'Raporti u ruajt me status E pa paguar.');
  }

  const finance = useMemo(() => financeSummary(payments), [payments]);
  const patientPayments = payments.filter(payment => payment.patientId === patientId);
  const legacyPaid = patientPayments.filter(payment => !payment.reportId && payment.status === 'PAID').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const patientSummaries = reports.map(report => summaries.get(report.id)).filter(Boolean);
  const paidTotal = patientSummaries.reduce((sum, summary) => sum + (summary?.paid ?? 0), 0);
  const remainingTotal = patientSummaries.reduce((sum, summary) => sum + (summary?.remaining ?? 0), 0);

  return (
    <section className="card no-print" id="paymentsCard" data-testid="payments-card">
      <h2>Pagesat sipas raportit</h2>
      <p className="muted">Së pari ruaje raportin. Pastaj zgjidhe këtu, shëno vlerën totale dhe pagesën e bërë. Çdo pagesë lidhet vetëm me raportin e zgjedhur.</p>
      <div className="grid">
        <label>Pacienti i zgjedhur<input readOnly placeholder="Zgjidh pacientin më lart" value={patient ? patientName(patient) : ''} /></label>
        <label>
          Raporti i pacientit
          <select value={chosenId} onChange={event => chooseReport(event.target.value)}>
            <option value="">{patient ? '— Zgjidh raportin e ruajtur —' : '— Zgjidh pacientin së pari —'}</option>
            {reports.map(report => <option key={report.id} value={report.id}>{reportPaymentLabel(report)}</option>)}
          </select>
        </label>
        <label>Vlera totale e raportit (€)<input type="number" min={0} step={0.01} inputMode="decimal" placeholder="p.sh. 30.00" value={form.total} onChange={event => setForm({ ...form, total: event.target.value })} /></label>
        <label>Pagesa e bërë tani (€)<input type="number" min={0} step={0.01} inputMode="decimal" placeholder="p.sh. 20.00" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></label>
        <label>
          Statusi
          <select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as 'PAID' | 'UNPAID' })}>
            <option value="PAID">E paguar</option>
            <option value="UNPAID">E pa paguar</option>
          </select>
        </label>
        <label>Data e pagesës<input type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label>
        <label>Shënim (opsional)<input placeholder="p.sh. Analiza laboratorike" value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></label>
      </div>
      <div className="row">
        <button type="button" onClick={save}>Ruaj pagesën</button>
        <strong data-testid="daily-total">Sot — faturuar: {euro(finance.day.billed)} | paguar: {euro(finance.day.paid)} | mbetur: {euro(finance.day.remaining)}</strong>
      </div>
      <div className="payment-summary muted" aria-live="polite">
        {!patient && 'Zgjidh pacientin dhe raportin për të parë pagesat.'}
        {patient && !reports.length && <><strong>Nuk ka raport të ruajtur për këtë pacient.</strong> Ruaje raportin, pastaj regjistro pagesën.</>}
        {patient && reports.length > 0 && (
          <>
            <strong>Raporte të ruajtura:</strong> {reports.length}. <strong>Gjithsej e paguar:</strong> {euro(paidTotal)}. <strong>Gjithsej e mbetur:</strong> {euro(remainingTotal)}.
            {legacyPaid > 0 && <span className="muted"> Regjistrime të mëhershme pa raport të lidhur: {euro(legacyPaid)}.</span>}
          </>
        )}
      </div>
      <table className="payment-history">
        <thead><tr><th>Raporti</th><th>Vlera totale</th><th>Paguar</th><th>Mbetur</th><th>Statusi</th></tr></thead>
        <tbody>
          {!reports.length && <tr><td colSpan={5} className="muted">Nuk ka raporte për t’u shfaqur.</td></tr>}
          {reports.map(report => {
            const summary = summaries.get(report.id);
            const total = summary?.total ?? 0;
            return (
              <tr key={report.id}>
                <td>{reportPaymentLabel(report)}</td>
                <td>{total > 0 ? euro(total) : '—'}</td>
                <td>{euro(summary?.paid ?? 0)}</td>
                <td>{total > 0 ? euro(summary?.remaining ?? 0) : '—'}</td>
                <td className={summary?.status === 'PAID' ? 'payment-paid' : 'payment-unpaid'}>{total > 0 ? statusLabel(summary?.status ?? 'UNPAID') : 'Pa vlerë'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {can(ctx.actor, 'finance.view') && (
        <details data-testid="finance">
          <summary>Shiko totalet javore, mujore dhe vjetore</summary>
          <div className="grid three" style={{ marginTop: 12 }}>
            <TotalsCard title="Java aktuale" totals={finance.week} />
            <TotalsCard title="Muaji aktual" totals={finance.month} />
            <TotalsCard title="Viti aktual" totals={finance.year} />
          </div>
        </details>
      )}
    </section>
  );
}
