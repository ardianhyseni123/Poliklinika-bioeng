import { useMemo, useState, type FormEvent } from 'react';
import { can } from '../../auth/permissions';
import { SPECIALTIES } from '../../auth/roles';
import { useData } from '../../data/DataProvider';
import { assignPatient, createPatient, patientName, setPatientArchived } from '../../data/patients';
import type { Patient } from '../../data/schemas';
import { assignmentSummary, isOldPatient, patientSpecialties } from '../../domain/assignment';
import { normalizeSearch } from '../../domain/text';
import { useUnsavedWork } from '../update/unsavedWork';
import { useWorkspace } from '../workspace/Workspace';

const EMPTY_FORM = { firstName: '', lastName: '', dob: '', gender: '', phone: '', address: '' };

export function patientOptionLabel(patient: Patient): string {
  return `${patientName(patient)}${patient.dob ? ` — ${patient.dob}` : ''}`;
}

/** Not archived, newest first. */
export function workingList(patients: Patient[]): Patient[] {
  return patients
    .filter(patient => !patient.archived)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
      || `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
}

function SpecialtyChecks({ values, onChange, testId }: { values: string[]; onChange: (next: string[]) => void; testId: string }) {
  return (
    <div className="checks compact" data-testid={testId}>
      {SPECIALTIES.map(specialty => (
        <label key={specialty}>
          <input
            type="checkbox"
            checked={values.includes(specialty)}
            onChange={event => onChange(event.target.checked ? [...values, specialty] : values.filter(value => value !== specialty))}
          />
          {specialty}
        </label>
      ))}
    </div>
  );
}

/** «Specialistët e pacientit»: the laboratory decides which specialists see the selected patient. */
function AssignPanel({ patient, current }: { patient: Patient | null; current: string[] }) {
  const { ctx } = useData();
  const { say } = useWorkspace();
  const [chosen, setChosen] = useState(current);
  useUnsavedWork([...chosen].sort().join() !== [...current].sort().join());

  function save() {
    if (!patient) {
      say('Zgjidh pacientin para caktimit.', true);
      return;
    }
    try {
      assignPatient(ctx, patient, chosen);
      say(assignmentSummary(chosen));
    } catch (error) {
      console.error(error);
      say('Caktimi nuk u ruajt.', true);
    }
  }

  return (
    <div className="service-card" data-testid="assign-panel">
      <h3>Specialistët e pacientit</h3>
      <p className="muted">Specialisti sheh vetëm pacientët që i janë caktuar nga laboratori ose që i ka regjistruar vetë. Zgjidh pacientin, shëno specialistët dhe kliko “Ruaj caktimin”.</p>
      <SpecialtyChecks values={chosen} onChange={setChosen} testId="patient-specialists" />
      <div className="row">
        <button type="button" className="secondary" disabled={!patient} onClick={save}>Ruaj caktimin</button>
        <span className="muted" data-testid="assign-info">
          {patient && isOldPatient(patient) ? 'Pacient i vjetër: shfaqet te specialistët që kanë raporte. Ruaje caktimin për ta fiksuar.' : ''}
        </span>
      </div>
    </div>
  );
}

export function PatientsCard() {
  const { ctx } = useData();
  const { data, patientId, selectPatient, say } = useWorkspace();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [newSpecialties, setNewSpecialties] = useState<string[]>([]);
  useUnsavedWork(newSpecialties.length > 0 || JSON.stringify(form) !== JSON.stringify(EMPTY_FORM));
  const assigns = can(ctx.actor, 'patients.assign');

  const all = useMemo(() => workingList(data.patients.items), [data.patients.items]);
  const term = normalizeSearch(search.trim());
  const shown = term
    ? all.filter(patient => normalizeSearch(patientName(patient)).includes(term) || normalizeSearch(patient.phone).includes(term))
    : all;
  const selected = data.patients.items.find(patient => patient.id === patientId) ?? null;
  const selectedSpecialties = selected && assigns ? patientSpecialties(selected, data.activeReports) : [];

  function save(event: FormEvent) {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      say('Emri dhe mbiemri janë të detyrueshëm.', true);
      return;
    }
    try {
      const { record } = createPatient(ctx, { ...form, specialties: newSpecialties });
      setForm(EMPTY_FORM);
      setNewSpecialties([]);
      setFormOpen(false);
      setSearch('');
      selectPatient(record.id);
      say(`Pacienti ${patientName(record)} u ruajt.`);
    } catch (error) {
      console.error(error);
      say('Pacienti nuk u ruajt. Kontrollo të dhënat.', true);
    }
  }

  function archive() {
    if (!selected) {
      say('Zgjidh pacientin që do të hiqet nga lista.', true);
      return;
    }
    if (!window.confirm(`Ta heq ${patientName(selected)} nga lista e punës? Historiku mjekësor ruhet.`)) return;
    setPatientArchived(ctx, selected, true);
    selectPatient('');
    say(`${patientName(selected)} u hoq nga lista.`);
  }

  const field = (name: keyof typeof EMPTY_FORM) => ({
    value: form[name],
    onChange: (event: { target: { value: string } }) => setForm(current => ({ ...current, [name]: event.target.value }))
  });

  return (
    <section className="card" data-testid="patients-card">
      <h2>Pacienti</h2>
      <div className="grid">
        <label>
          Kërko / zgjidh pacientin
          <select data-testid="patient-select" value={shown.some(p => p.id === patientId) || !patientId ? patientId : ''} onChange={event => selectPatient(event.target.value)}>
            <option value="">— Zgjidh pacientin —</option>
            {selected && !shown.some(p => p.id === selected.id) && <option value={selected.id}>{patientOptionLabel(selected)}</option>}
            {shown.map(patient => <option key={patient.id} value={patient.id}>{patientOptionLabel(patient)}</option>)}
          </select>
        </label>
        <label>
          Kërko sipas emrit ose telefonit
          <input autoComplete="off" placeholder="p.sh. Ardian, Hyseni ose 044123456" value={search} onChange={event => setSearch(event.target.value)} />
          <span className="muted">{search.trim() ? `${shown.length} pacient${shown.length === 1 ? ' u gjet' : 'ë u gjetën'}.` : ''}</span>
        </label>
      </div>
      {assigns && <AssignPanel key={`${selected?.id ?? ''}|${selectedSpecialties.join(',')}`} patient={selected} current={selectedSpecialties} />}
      {can(ctx.actor, 'patients.archive') && (
        <div className="row">
          <button type="button" className="danger" onClick={archive}>Hiq pacientin nga lista</button>
          <span className="muted">Pacienti nuk fshihet përgjithmonë; hiqet vetëm nga lista e punës për të mbrojtur historikun mjekësor.</span>
        </div>
      )}
      <details open={formOpen} onToggle={event => setFormOpen((event.target as HTMLDetailsElement).open)}>
        <summary>Shto pacient të ri</summary>
        <form onSubmit={save}>
          <div className="grid" style={{ marginTop: 12 }}>
            <label>Emri<input {...field('firstName')} data-testid="new-first-name" /></label>
            <label>Mbiemri<input {...field('lastName')} data-testid="new-last-name" /></label>
            <label>Datëlindja<input type="date" {...field('dob')} /></label>
            <label>
              Gjinia
              <select {...field('gender')}>
                <option value="">—</option>
                <option>Femër</option>
                <option>Mashkull</option>
                <option>Tjetër</option>
              </select>
            </label>
            <label>Telefoni<input inputMode="tel" {...field('phone')} /></label>
            <label>Adresa<input {...field('address')} /></label>
          </div>
          {assigns && (
            <div style={{ marginTop: 12 }}>
              <strong>Cakto specialistit (opsionale)</strong>
              <SpecialtyChecks values={newSpecialties} onChange={setNewSpecialties} testId="new-patient-specialists" />
            </div>
          )}
          <button type="submit">Ruaj pacientin</button>
        </form>
      </details>
    </section>
  );
}
