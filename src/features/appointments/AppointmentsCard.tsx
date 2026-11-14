import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../data/DataProvider';
import { createAppointment, updateAppointment } from '../../data/appointments';
import { patientName } from '../../data/patients';
import { APPOINTMENT_STATUSES, type Appointment } from '../../data/schemas';
import { nowLocal, showDateTime } from '../../domain/text';
import { patientOptionLabel, workingList } from '../patients/PatientsCard';
import { useWorkspace } from '../workspace/Workspace';

const SPECIALTIES = ['Laborator', 'Kardiologji', 'Pulmologji', 'Neurologji', 'Hixhame'] as const;
const EXPIRE_AFTER_MS = 4 * 60 * 60 * 1000;

const emptyForm = () => ({ patientId: '', specialty: 'Laborator' as Appointment['specialty'], appointmentAt: nowLocal(), status: 'Caktuar' as Appointment['status'], clinician: '', phone: '', note: '' });

export function AppointmentsCard() {
  const { ctx } = useData();
  const { data, patientId, say } = useWorkspace();
  const [form, setForm] = useState(() => ({ ...emptyForm(), patientId }));
  const [now, setNow] = useState(() => Date.now());
  const expiring = useRef(new Set<string>());
  const patients = useMemo(() => workingList(data.patients.items), [data.patients.items]);

  // Re-check every minute; appointments 4 hours past their time leave the list.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const appointment of data.appointments.items) {
      if (appointment.expired || expiring.current.has(appointment.id)) continue;
      if (new Date(appointment.appointmentAt).getTime() > now - EXPIRE_AFTER_MS) continue;
      expiring.current.add(appointment.id);
      updateAppointment(ctx, appointment, { expired: true });
    }
  }, [ctx, data.appointments.items, now]);

  const visible = data.appointments.items
    .filter(appointment => !appointment.expired && new Date(appointment.appointmentAt).getTime() > now - EXPIRE_AFTER_MS)
    .sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt))
    .slice(0, 50);

  function save() {
    const patient = data.patients.items.find(item => item.id === (form.patientId || patientId));
    if (!patient || !form.appointmentAt) {
      say('Zgjidh pacientin dhe datën/orën e terminit.', true);
      return;
    }
    createAppointment(ctx, {
      patientId: patient.id,
      patientName: patientName(patient),
      appointmentAt: form.appointmentAt,
      status: form.status,
      specialty: form.specialty,
      clinician: form.clinician.trim(),
      phone: form.phone.trim(),
      note: form.note.trim()
    });
    setForm({ ...emptyForm(), patientId: patient.id });
    say('Termini u ruajt.');
  }

  return (
    <section className="card no-print" id="appointmentsCard" data-testid="appointments-card">
      <h2>Terminet</h2>
      <div className="three grid">
        <label>
          Pacienti
          <select value={form.patientId || patientId} onChange={event => setForm({ ...form, patientId: event.target.value })}>
            <option value="">— Zgjidh pacientin —</option>
            {patients.map(patient => <option key={patient.id} value={patient.id}>{patientOptionLabel(patient)}</option>)}
          </select>
        </label>
        <label>
          Specialiteti
          <select value={form.specialty} onChange={event => setForm({ ...form, specialty: event.target.value as Appointment['specialty'] })}>
            {SPECIALTIES.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Data dhe ora<input type="datetime-local" value={form.appointmentAt} onChange={event => setForm({ ...form, appointmentAt: event.target.value })} /></label>
        <label>
          Statusi
          <select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as Appointment['status'] })}>
            {APPOINTMENT_STATUSES.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Specialisti / mjeku<input value={form.clinician} onChange={event => setForm({ ...form, clinician: event.target.value })} /></label>
        <label>Telefoni (opsional)<input inputMode="tel" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
        <label>Shënim<input value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></label>
      </div>
      <button type="button" onClick={save}>Ruaj termin</button>
      <table>
        <thead><tr><th>Data / ora</th><th>Pacienti</th><th>Specialiteti</th><th>Statusi</th><th>Mjeku</th><th>Shënim</th></tr></thead>
        <tbody>
          {visible.map(appointment => (
            <tr key={appointment.id}>
              <td>{showDateTime(appointment.appointmentAt)}</td>
              <td>{appointment.patientName}</td>
              <td>{appointment.specialty}</td>
              <td>
                <select aria-label="Statusi i terminit" value={appointment.status} onChange={event => {
                  updateAppointment(ctx, appointment, { status: event.target.value as Appointment['status'] });
                  say('Statusi i terminit u përditësua.');
                }}>
                  {APPOINTMENT_STATUSES.map(item => <option key={item}>{item}</option>)}
                </select>
              </td>
              <td>{appointment.clinician || '—'}</td>
              <td>{appointment.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
