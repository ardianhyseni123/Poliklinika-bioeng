import { useState } from 'react';
import type { Profile } from '../../auth/roles';
import { useSession } from '../../auth/session';
import { useData, useJournalState } from '../../data/DataProvider';
import { sq } from '../../strings/sq';
import { useUnsavedWork } from '../update/unsavedWork';
import { Workspace } from '../workspace/Workspace';
import { RefusedWrites, RescueNotice, SyncIndicator } from './SyncIndicator';

export function SignedInCard({ profile, children }: { profile: Pick<Profile, 'name' | 'title' | 'role'> | null; children?: React.ReactNode }) {
  const { signOut } = useSession();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    setMessage('');
    const done = await signOut();
    if (!done) {
      setMessage(sq.session.pendingWrites);
      setBusy(false);
    }
  }

  return (
    <section className="card no-print">
      <div className="row">
        <div className="grow">
          <strong data-testid="logged-user">{profile?.name ?? ''}</strong>
          {profile && <div className="muted" data-testid="logged-role">{sq.session.role(profile.title || profile.role)}</div>}
        </div>
        <SyncIndicator />
        <button type="button" className="secondary" onClick={() => void logout()} disabled={busy}>{sq.session.logout}</button>
      </div>
      {message && <p className="sync-notice" role="alert">{message}</p>}
      {children}
    </section>
  );
}

export function AppShell({ profile }: { profile: Profile }) {
  // Changes still on their way to the server count as unsaved until they arrive.
  const { pending } = useJournalState(useData().journal);
  useUnsavedWork(pending.length > 0);
  return (
    <div id="appShell">
      <SignedInCard profile={profile} />
      <RescueNotice />
      <RefusedWrites />
      <Workspace />
    </div>
  );
}
