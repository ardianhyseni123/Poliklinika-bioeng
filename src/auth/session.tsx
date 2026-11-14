import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { clearIndexedDbPersistence, doc, onSnapshot, terminate, waitForPendingWrites } from 'firebase/firestore';
import { auth, db } from '../firebase/init';
import { isRole, type Profile } from './roles';
import { errorCode } from '../data/journal';
import { sq } from '../strings/sq';

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'noProfile'; user: User }
  | { status: 'inactive'; user: User; profile: Profile }
  | { status: 'signedIn'; user: User; profile: Profile };

interface SessionApi {
  session: Session;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves false (and stays signed in) while writes are still waiting to reach the server. */
  signOut: () => Promise<boolean>;
}

const SessionContext = createContext<SessionApi | null>(null);

function toProfile(email: string, data: Record<string, unknown> | undefined): Profile | null {
  if (!data || !isRole(data.role) || typeof data.name !== 'string') return null;
  return {
    email,
    role: data.role,
    name: data.name,
    title: typeof data.title === 'string' ? data.title : '',
    active: data.active === true,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : ''
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  useEffect(() => {
    let stopProfile: (() => void) | null = null;
    const stopAuth = onAuthStateChanged(auth, user => {
      stopProfile?.();
      stopProfile = null;
      if (!user?.email) {
        setSession({ status: 'signedOut' });
        return;
      }
      setSession({ status: 'loading' });
      const email = user.email.toLowerCase();
      // Live, so a role change by the administrator applies without signing in again.
      stopProfile = onSnapshot(
        doc(db, 'users', email),
        snapshot => {
          const profile = toProfile(email, snapshot.data());
          if (!profile) setSession({ status: 'noProfile', user });
          else if (!profile.active) setSession({ status: 'inactive', user, profile });
          else setSession({ status: 'signedIn', user, profile });
        },
        error => {
          // During logout Firestore shuts down under this listener; the page reloads anyway.
          if (/shutting down/i.test(error.message)) return;
          console.error('Could not read the user profile.', error);
          setSession({ status: 'noProfile', user });
        }
      );
    });
    return () => {
      stopProfile?.();
      stopAuth();
    };
  }, []);

  const api = useMemo<SessionApi>(() => ({
    session,
    async signIn(email, password) {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    },
    async signOut() {
      if (!(await allWritesSent(3000))) return false;
      // Leave nothing from this person's session on a shared computer. The local copy goes
      // first: signing out shows the login screen, which must not appear while it still exists.
      await terminate(db);
      await clearIndexedDbPersistence(db).catch(error => console.warn('Could not clear the local copy.', error));
      await firebaseSignOut(auth);
      window.location.reload();
      return true;
    }
  }), [session]);

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

async function allWritesSent(timeoutMs: number): Promise<boolean> {
  const timeout = new Promise<false>(resolve => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([waitForPendingWrites(db).then(() => true as const), timeout]);
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error('useSession must be used inside SessionProvider.');
  return api;
}

export function signInErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email', 'auth/missing-password'].includes(code)) {
    return sq.login.wrongCredentials;
  }
  if (code === 'auth/too-many-requests') return sq.login.tooManyAttempts;
  if (code === 'auth/user-disabled') return sq.login.disabled;
  if (code === 'auth/network-request-failed') return sq.login.offline;
  return sq.login.failed;
}
