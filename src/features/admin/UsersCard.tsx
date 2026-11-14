// Administrator only: who may use the app, with which role, name and title.
// Accounts and passwords are created in the Firebase console; this page assigns the role.

import { useState } from 'react';
import { DEFAULT_TITLES, ROLES, type Role } from '../../auth/roles';
import { useData } from '../../data/DataProvider';
import { ValidationError } from '../../data/context';
import type { User } from '../../data/schemas';
import { saveUser, warningsFor, type UserInput } from '../../data/users';
import { formatDateTime } from '../../domain/text';
import { useWorkspace } from '../workspace/Workspace';

const EMPTY: UserInput = { email: '', role: 'Laborator', name: '', title: '', active: true };

export function UsersCard() {
  const { ctx } = useData();
  const { data, say } = useWorkspace();
  const [form, setForm] = useState<UserInput>(EMPTY);
  const users = [...data.users.items].sort((a, b) => Number(b.active) - Number(a.active) || a.email.localeCompare(b.email));
  const editing = users.find(user => user.email === form.email.trim().toLowerCase());

  function edit(user: User) {
    setForm({ email: user.email, role: user.role, name: user.name, title: user.title, active: user.active });
  }

  function save() {
    if (!form.email.trim() || !form.name.trim()) {
      say('Shkruaj emailin dhe emrin.', true);
      return;
    }
    const warnings = warningsFor(form, data.users.items, ctx.actor.email);
    if (warnings.some(warning => warning.kind === 'lastAdministrator')
      && !window.confirm('Ky është administratori i fundit aktiv. Pa administrator, askush nuk mund të ndryshojë rolet nga aplikacioni. Të vazhdoj?')) return;
    if (warnings.some(warning => warning.kind === 'self')
      && !window.confirm('Po heq të drejtat e administratorit nga vetja. Të vazhdoj?')) return;
    try {
      saveUser(ctx, form);
      say(`${form.email.trim().toLowerCase()}: roli u ruajt. Ndryshimi vlen menjëherë.`);
      setForm(EMPTY);
    } catch (error) {
      say(error instanceof ValidationError ? 'Kontrollo fushat: specialisti ka nevojë për titull, emri nuk mund të jetë bosh.' : 'Përdoruesi nuk u ruajt.', true);
    }
  }

  return (
    <section className="card no-print" data-testid="users-card">
      <h2>Përdoruesit</h2>
      <p className="muted">
        Llogaria dhe fjalëkalimi krijohen te Firebase Console → Authentication → Users. Këtu i caktohet roli, emri dhe titulli;
        pa rol, llogaria hyn por nuk sheh asgjë. Çaktivizimi e ndalon menjëherë qasjen.
      </p>
      <div className="grid three">
        <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
        <label>
          Roli
          <select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })}>
            {ROLES.map(role => <option key={role}>{role}</option>)}
          </select>
        </label>
        <label>Emri (shfaqet dhe printohet)<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Titulli<input placeholder={DEFAULT_TITLES[form.role]} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label className="inline-check"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} />Aktiv</label>
      </div>
      <div className="row">
        <button type="button" onClick={save}>{editing ? 'Ruaj ndryshimet' : 'Shto përdoruesin'}</button>
        {form.email && <button type="button" className="secondary" onClick={() => setForm(EMPTY)}>Pastro</button>}
      </div>
      <table>
        <thead><tr><th>Email</th><th>Roli</th><th>Emri</th><th>Titulli</th><th>Statusi</th><th>Ndryshuar</th><th /></tr></thead>
        <tbody>
          {users.map(user => (
            <tr key={user.email} className={user.active ? undefined : 'catalog-inactive'}>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>{user.name}</td>
              <td>{user.title}</td>
              <td>{user.active ? 'Aktiv' : 'Joaktiv'}{data.users.pendingIds.has(user.email) ? ' ●' : ''}</td>
              <td className="muted">{formatDateTime(user.updatedAt)} · {user.updatedBy}</td>
              <td><button type="button" className="secondary" onClick={() => edit(user)}>Ndrysho</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
