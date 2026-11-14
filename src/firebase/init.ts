import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, initializeAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager
} from 'firebase/firestore';

// The web config is a public project identifier, not a secret; access is controlled by
// Firebase Authentication and the Firestore rules.
const PRODUCTION_CONFIG = {
  apiKey: 'AIzaSyC6a_8CQV83tpPaIeaZ2nTrsHrVK-jihIk',
  authDomain: 'bioeng-c8397.firebaseapp.com',
  projectId: 'bioeng-c8397',
  messagingSenderId: '883275376121',
  appId: '1:883275376121:web:0a5cf9146e6cf9b8e64928'
};

// `npm run dev` and the tests always use the local emulators with a demo project, which
// cannot reach any real Firebase resource. Only a production build talks to the clinic's data.
export const USING_EMULATORS = import.meta.env.DEV || import.meta.env.VITE_USE_EMULATORS === 'true';

const app = initializeApp(
  USING_EMULATORS
    ? { apiKey: 'demo-key', authDomain: 'demo-bioeng.firebaseapp.com', projectId: 'demo-bioeng', appId: 'demo-app' }
    : PRODUCTION_CONFIG
);

// Signed in until the tab or browser closes; a refresh keeps the session.
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });

// Firestore keeps its own copy on the device: writes apply at once, queue while offline,
// and upload by themselves when the connection returns, also after a refresh.
//
// Single-tab on purpose. In multi-tab mode one tab makes the network requests for all tabs
// with its own login, but sessions here are per tab: the laboratory in one tab and a doctor
// in another would have the doctor's requests sent as the laboratory. With a single-tab
// cache, the first tab owns the offline copy and any further tab falls back to a memory-only
// cache with its own login. A write left unsent when such a tab closes is still caught by the
// write journal.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: false }) })
});

if (USING_EMULATORS) {
  // The end-to-end tests run their own emulators on other ports (firebase.emulators.test.json).
  const authPort = Number(import.meta.env.VITE_EMULATOR_AUTH_PORT ?? 9099);
  const firestorePort = Number(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT ?? 8080);
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', firestorePort);
}
