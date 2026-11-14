import { useEffect, useState, type ReactNode } from 'react';
import { sq } from '../../strings/sq';
import { useHasUnsavedWork } from './unsavedWork';
import { isOtherDeployment, readDeployedVersion, RUNNING_VERSION } from './version';

const CHECK_EVERY_MS = 5 * 60_000;

/** Becomes true once the site serves another version of the app than this page runs. */
function useOtherVersionDeployed(): boolean {
  const [deployed, setDeployed] = useState(false);

  useEffect(() => {
    if (deployed || !RUNNING_VERSION) return;
    let stopped = false;
    let inFlight = false;

    async function check() {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      const version = await readDeployedVersion();
      inFlight = false;
      if (!stopped && isOtherDeployment(RUNNING_VERSION, version)) setDeployed(true);
    }
    const checkNow = () => void check();

    // Also on load: a browser may have shown a cached copy of an older page.
    checkNow();
    const timer = setInterval(checkNow, CHECK_EVERY_MS);
    window.addEventListener('focus', checkNow);
    window.addEventListener('online', checkNow);
    document.addEventListener('visibilitychange', checkNow);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', checkNow);
      window.removeEventListener('online', checkNow);
      document.removeEventListener('visibilitychange', checkNow);
    };
  }, [deployed]);

  return deployed;
}

/**
 * When a new version is deployed, replaces the whole app with a request to reload, so that
 * nobody keeps working in an outdated version. Unsaved work goes first: until it is saved,
 * the app stays usable under a banner.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const deployed = useOtherVersionDeployed();
  const unsaved = useHasUnsavedWork();

  if (deployed && !unsaved) {
    return (
      <div className="page">
        <section className="card update-required" role="alert" data-testid="update-required">
          <img src="/logo.png" alt={sq.logoAlt} width={70} height={70} />
          <h1>{sq.update.title}</h1>
          <p>{sq.update.body}</p>
          <button type="button" onClick={() => window.location.reload()}>{sq.update.reload}</button>
        </section>
      </div>
    );
  }

  return (
    <>
      {deployed && (
        <div className="update-banner no-print">
          <p className="sync-notice" role="status" data-testid="update-banner">
            {sq.update.waiting}{' '}
            <button type="button" className="secondary" onClick={() => window.location.reload()}>{sq.update.reloadNow}</button>
          </p>
        </div>
      )}
      {children}
    </>
  );
}
