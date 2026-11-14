// Who may use the app. Accounts and passwords are created in the Firebase console; this
// assigns them a role. Administrator only (the rules refuse anyone else).

import { collection, doc, setDoc, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { DEFAULT_TITLES, type Role } from '../auth/roles';
import { validated, watchQuery, type DataContext, type Snapshot, type Written } from './context';
import { UserSchema, type User } from './schemas';

export function watchUsers(db: Firestore, onData: (snapshot: Snapshot<User>) => void, onError: (error: Error) => void): Unsubscribe {
  return watchQuery(collection(db, 'users'), data => UserSchema.safeParse(data), onData, onError);
}

export interface UserInput {
  email: string;
  role: Role;
  name: string;
  title?: string;
  active: boolean;
}

export function saveUser(ctx: DataContext, input: UserInput): Written<User> {
  const now = ctx.now();
  const user = validated('Përdoruesi', UserSchema.safeParse({
    email: input.email.trim().toLowerCase(),
    role: input.role,
    name: input.name.trim(),
    title: (input.title ?? '').trim() || DEFAULT_TITLES[input.role],
    active: input.active,
    updatedAt: now,
    updatedBy: ctx.actor.email
  }));
  const path = `users/${user.email}`;
  const done = setDoc(doc(ctx.db, path), user);
  ctx.tracker.track({ id: `user:${user.email}:${now}`, label: `Përdoruesi: ${user.email}`, check: { path, expect: 'field', field: 'updatedAt', value: now }, content: user }, done);
  return { record: user, done };
}

export interface UserChangeWarning {
  kind: 'lastAdministrator' | 'self';
}

/** Changes that would lock the clinic or the admin out; the page asks before making them. */
export function warningsFor(change: UserInput, current: User[], actorEmail: string): UserChangeWarning[] {
  const email = change.email.trim().toLowerCase();
  const before = current.find(user => user.email === email);
  const losesAdmin = before?.role === 'Administrator' && before.active && (change.role !== 'Administrator' || !change.active);
  const warnings: UserChangeWarning[] = [];
  if (losesAdmin) {
    const otherAdmins = current.filter(user => user.role === 'Administrator' && user.active && user.email !== email);
    if (otherAdmins.length === 0) warnings.push({ kind: 'lastAdministrator' });
  }
  if (email === actorEmail.toLowerCase() && (losesAdmin || !change.active)) warnings.push({ kind: 'self' });
  return warnings;
}
