import { useEffect, useState } from 'react';
import { can } from '../../auth/permissions';
import { isSpecialty, SPECIALTIES } from '../../auth/roles';
import { useData } from '../../data/DataProvider';
import { patientName } from '../../data/patients';
import { saveReport, type ReportDraft } from '../../data/reports';
import { isTombstone, type AnalysisItem, type Report, type ReportSpecialty, type ReportType } from '../../data/schemas';
import { diagnosesFor, examsFor, specialtyLabels } from '../../domain/specialties';
import { formatDateTime, nowLocal } from '../../domain/text';
import { AttachmentProblem, MAX_ATTACHMENT_BYTES, type AttachmentInfo } from '../../local/attachments';
import { useWorkspace } from '../workspace/Workspace';
import { AnalysesPanel } from './AnalysesPanel';
import { HixhamePanel, hixhameFormOf, hixhameOf, type HixhameForm } from './HixhamePanel';

const SPECIALTY_LABELS: Record<string, string> = { Hixhame: 'Njësia Hixhame' };

interface FormState {
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
  hixhame: HixhameForm;
}

function initialForm(report: Report | null, role: string): FormState {
  const specialist = isSpecialty(role as never);
  return {
    type: report?.type ?? (specialist ? 'specialist' : 'laboratory'),
    specialty: report?.specialty ?? (specialist ? (role as ReportSpecialty) : 'Laborator'),
    reportAt: report?.reportAt ?? nowLocal(),
    clinician: report?.clinician ?? '',
    clinicianTitle: report?.clinicianTitle ?? '',
    anamnesis: report?.anamnesis ?? '',
    physicalExam: report?.physicalExam ?? '',
    existingResults: report?.existingResults ?? '',
    diagnoses: report?.diagnoses ?? [],
    customDiagnoses: report?.customDiagnoses ?? '',
    requestedExams: report?.requestedExams ?? [],
    therapy: report?.therapy ?? '',
    notes: report?.notes ?? '',
    analyses: report?.analyses ?? [],
    hixhame: hixhameFormOf(report?.hixhame)
  };
}

function Checks({ options, values, onChange }: { options: string[]; values: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="checks">
      {options.map(option => (
        <label key={option}>
          <input
            type="checkbox"
            checked={values.includes(option)}
            onChange={event => onChange(event.target.checked ? [...values, option] : values.filter(value => value !== option))}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

export function ReportEditor() {
  const { editor } = useWorkspace();
  // A new key (another report, or "Raport i ri") starts the form afresh.
  return <ReportForm key={editor.key} />;
}

function ReportForm() {
  const { ctx, attachments } = useData();
  const { data, patientId, editor, openReport, rebaseEditor, showPrint, say } = useWorkspace();
  const actor = ctx.actor;
  const specialist = isSpecialty(actor.role);
  const [form, setForm] = useState<FormState>(() => initialForm(editor.report, actor.role));
  const [staged, setStaged] = useState<File[]>([]);
  const [saved, setSaved] = useState<AttachmentInfo[]>([]);
  const base = editor.report;
  const patient = data.patients.items.find(item => item.id === patientId) ?? null;

  const set = (patch: Partial<FormState>) => setForm(current => ({ ...current, ...patch }));

  // Device-only attachments of the open report.
  useEffect(() => {
    let current = true;
    if (!base) return;
    attachments.list(base.id).then(list => { if (current) setSaved(list); }).catch(error => console.error(error));
    return () => { current = false; };
  }, [attachments, base]);

  // Has someone else changed or deleted this report since it was opened?
  const live = base ? data.reports.items.find(item => item.id === base.id) : undefined;
  const deletedElsewhere = Boolean(live && isTombstone(live));
  // While settling a conflict the editor starts from one branch on purpose; the current
  // version is one of the branches this save resolves, so that is not news.
  const changedElsewhere = Boolean(
    live && !isTombstone(live) && base?.lastVersionId && live.lastVersionId !== base.lastVersionId
    && !editor.resolves.includes(live.lastVersionId ?? '')
  );

  const labels = specialtyLabels(form.specialty);
  const isSpecialistReport = form.type === 'specialist';

  function chooseType(type: ReportType) {
    set({ type, specialty: type === 'laboratory' ? 'Laborator' : 'Kardiologji' });
  }

  function addFiles(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) say('Pranohen vetëm PDF, PNG dhe JPG.', true);
      else if (file.size > MAX_ATTACHMENT_BYTES) say('Skedari është më i madh se 10 MB.', true);
      else setStaged(current => [...current, file]);
    }
  }

  async function openAttachment(id: string) {
    const blob = await attachments.blob(id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function save() {
    if (!patient) {
      say('Zgjidh pacientin para ruajtjes.', true);
      return;
    }
    if (!form.reportAt) {
      say('Data dhe ora janë të detyrueshme.', true);
      return;
    }
    if (deletedElsewhere) {
      say('Ky raport është fshirë ndërkohë në një pajisje tjetër dhe nuk mund të ruhet. Kopjo përmbajtjen në një raport të ri.', true);
      return;
    }
    const draft: ReportDraft = {
      patientId: patient.id,
      type: form.type,
      specialty: form.specialty,
      reportAt: form.reportAt,
      clinician: form.clinician.trim(),
      clinicianTitle: form.clinicianTitle.trim(),
      anamnesis: isSpecialistReport ? form.anamnesis.trim() : '',
      physicalExam: isSpecialistReport ? form.physicalExam.trim() : '',
      existingResults: isSpecialistReport ? form.existingResults.trim() : '',
      diagnoses: isSpecialistReport ? form.diagnoses : [],
      customDiagnoses: isSpecialistReport ? form.customDiagnoses.trim() : '',
      requestedExams: isSpecialistReport ? form.requestedExams : [],
      therapy: isSpecialistReport ? form.therapy.trim() : '',
      notes: form.notes.trim(),
      analyses: isSpecialistReport ? [] : form.analyses,
      hixhame: form.specialty === 'Hixhame' ? hixhameOf(form.hixhame) : null
    };
    try {
      const { head } = saveReport(ctx, draft, base, { resolves: editor.resolves, label: `Raport: ${patientName(patient)}` });
      for (const file of staged) await attachments.add(head.id, file);
      setStaged([]);
      setSaved(await attachments.list(head.id));
      rebaseEditor(head);
      say(`Raporti u ruajt si rekord i veçantë (versioni ${head.revision}).${changedElsewhere ? ' Versioni tjetër u ruajt gjithashtu: zgjidhe te lista e raporteve.' : ''}`);
    } catch (error) {
      console.error(error);
      say(error instanceof AttachmentProblem ? error.message : 'Raporti nuk u ruajt. Kontrollo fushat dhe provo përsëri.', true);
    }
  }

  return (
    <section className="card" id="editorCard" data-testid="report-editor">
      <h2>{base ? 'Redakto raportin' : 'Raport i ri'}</h2>
      <p className="muted">Çdo ruajtje krijon ose përditëson vetëm raportin e hapur. Raportet nuk bashkohen sipas datës.</p>
      {editor.resolves.length > 0 && (
        <p className="sync-notice" role="status">Po zgjidh një konflikt: kur ta ruash, ky bëhet versioni i vetëm i raportit.</p>
      )}
      {changedElsewhere && (
        <p className="sync-notice" role="alert" data-testid="changed-elsewhere">
          Ky raport u ndryshua ndërkohë në një pajisje tjetër.{' '}
          <button type="button" className="secondary" onClick={() => live && !isTombstone(live) && openReport(live)}>Hap versionin e ri</button>{' '}
          ose ruaje këtë: të dy versionet ruhen dhe shënohen si konflikt për t’u zgjidhur.
        </p>
      )}
      {deletedElsewhere && <p className="sync-notice local" role="alert">Ky raport u fshi ndërkohë në një pajisje tjetër.</p>}

      <div className="three grid">
        <label>
          Lloji i raportit
          <select value={form.type} disabled={!can(actor, 'reports.chooseType')} onChange={event => chooseType(event.target.value as ReportType)}>
            <option value="laboratory">Laborator</option>
            <option value="specialist">Vizitë specialistike</option>
          </select>
        </label>
        <label>
          Specialiteti
          <select value={form.specialty} disabled={specialist} onChange={event => set({ specialty: event.target.value as ReportSpecialty, diagnoses: [], requestedExams: [] })}>
            {form.type === 'laboratory'
              ? <option value="Laborator">Laborator</option>
              : SPECIALTIES.map(item => <option key={item} value={item}>{SPECIALTY_LABELS[item] ?? item}</option>)}
          </select>
        </label>
        <label>Data dhe ora<input type="datetime-local" value={form.reportAt} onChange={event => set({ reportAt: event.target.value })} /></label>
      </div>

      {isSpecialistReport && (
        <>
          <div className="grid">
            <label>
              Mjeku / specialisti
              <input placeholder="p.sh. Dr. Emër Mbiemër" readOnly={specialist} value={specialist ? actor.name : form.clinician} onChange={event => set({ clinician: event.target.value })} />
            </label>
            <label>
              Titulli profesional
              <input placeholder="p.sh. Specialist i Kardiologjisë" readOnly={specialist} value={specialist ? actor.title : form.clinicianTitle} onChange={event => set({ clinicianTitle: event.target.value })} />
            </label>
          </div>
          <label>Anamneza dhe ankesat<textarea rows={3} value={form.anamnesis} onChange={event => set({ anamnesis: event.target.value })} /></label>
          <label>Ekzaminimi fizik<textarea rows={3} value={form.physicalExam} onChange={event => set({ physicalExam: event.target.value })} /></label>
          <label>Rezultate ekzistuese<textarea rows={3} value={form.existingResults} onChange={event => set({ existingResults: event.target.value })} /></label>
          <h3>{labels.diagnosisHeading}</h3>
          <Checks options={diagnosesFor(form.specialty)} values={form.diagnoses} onChange={diagnoses => set({ diagnoses })} />
          <label>{labels.customDiagnoses}<textarea rows={2} value={form.customDiagnoses} onChange={event => set({ customDiagnoses: event.target.value })} /></label>
          <h3>{labels.examHeading}</h3>
          <Checks options={examsFor(form.specialty)} values={form.requestedExams} onChange={requestedExams => set({ requestedExams })} />
          <label>{labels.therapy}<textarea rows={4} value={form.therapy} onChange={event => set({ therapy: event.target.value })} /></label>
          {form.specialty === 'Hixhame' && (
            <HixhamePanel
              value={form.hixhame}
              onChange={hixhame => set({ hixhame })}
              onGuidance={(service, phase) => {
                if (!patient) say('Zgjidh pacientin para përgatitjes së këshillave.', true);
                else showPrint({ kind: 'guidance', patientId: patient.id, service, phase });
              }}
            />
          )}
        </>
      )}

      {!isSpecialistReport && <AnalysesPanel categories={data.categories} analyses={form.analyses} onChange={analyses => set({ analyses })} say={say} />}

      <label>
        Dokument laboratorik / imazh (opsional)
        <input type="file" accept="application/pdf,image/png,image/jpeg" multiple onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
      </label>
      <p className="muted">Pranohen PDF, PNG dhe JPG deri në 10 MB. Dokumenti ruhet vetëm në këtë kompjuter, i lidhur me këtë raport.</p>
      <div className="muted" data-testid="attachments">
        {!saved.length && !staged.length && <span>Nuk ka dokument të bashkëngjitur.</span>}
        {saved.map(item => (
          <div key={item.id}>
            {item.name} ({Math.ceil(item.size / 1024)} KB) — ruajtur{' '}
            <button type="button" className="secondary" onClick={() => void openAttachment(item.id)}>Hap</button>
          </div>
        ))}
        {staged.map((file, index) => (
          <div key={`${file.name}-${index}`}>
            {file.name} ({Math.ceil(file.size / 1024)} KB){' '}
            <button type="button" className="secondary" onClick={() => setStaged(current => current.filter((_, i) => i !== index))}>Hiq</button>
          </div>
        ))}
      </div>

      <label>Shënime shtesë<textarea rows={2} value={form.notes} onChange={event => set({ notes: event.target.value })} /></label>
      <div className="row">
        <button type="button" data-testid="save-report" onClick={() => void save()}>Ruaj raportin</button>
        <button type="button" className="secondary" onClick={() => openReport(null)}>Raport i ri</button>
        <span className="muted">{base ? `Versioni ${base.revision}; përditësuar ${formatDateTime(base.updatedAt)}` : ''}</span>
      </div>
    </section>
  );
}
