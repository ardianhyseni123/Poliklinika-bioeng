import { useSession } from './auth/session';
import { DataProvider } from './data/DataProvider';
import { USING_EMULATORS } from './firebase/init';
import { LoginCard } from './features/login/LoginCard';
import { AppShell, SignedInCard } from './features/shell/AppShell';
import { sq } from './strings/sq';

export function App() {
  const { session } = useSession();

  return (
    <div className="page">
      <header>
        <div className="row">
          <img src="/logo.png" alt={sq.logoAlt} width={70} height={70} />
          <div>
            <h1>{sq.appTitle}</h1>
            <p className="muted">{sq.appSubtitle}</p>
          </div>
        </div>
      </header>
      {USING_EMULATORS && <p className="sync-notice no-print" data-testid="emulator-banner">{sq.sync.emulators}</p>}

      {session.status === 'loading' && <p className="muted">{sq.session.loading}</p>}
      {session.status === 'signedOut' && <LoginCard />}
      {session.status === 'noProfile' && (
        <SignedInCard profile={null}>
          <p className="sync-notice" role="alert">{sq.session.noProfile}</p>
        </SignedInCard>
      )}
      {session.status === 'inactive' && (
        <SignedInCard profile={session.profile}>
          <p className="sync-notice" role="alert">{sq.session.inactive}</p>
        </SignedInCard>
      )}
      {session.status === 'signedIn' && (
        <DataProvider uid={session.user.uid} profile={session.profile}>
          <AppShell profile={session.profile} />
        </DataProvider>
      )}
    </div>
  );
}
