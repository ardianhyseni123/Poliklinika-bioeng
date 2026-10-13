(() => {
  'use strict';

  const SDK_VERSION = '12.16.0';
  const SDK_ROOT = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
  const REQUIRED_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const VALID_ROLES = ['Laborator', 'Pulmologji', 'Kardiologji', 'Neurologji', 'Hixhame'];
  // Attachments never leave the device, so Firestore holds every synchronized store.
  const FIRESTORE_STORES = ['patients', 'reports', 'appointments', 'payments', 'audit'];

  let services = null;
  let initializing = null;
  let activeIdentity = null;
  let errorListener = () => {};
  let realtimeUnsubscribers = [];

  function isFirebaseConfigured(config = window.BIOENG_FIREBASE_CONFIG) {
    return Boolean(config && REQUIRED_CONFIG_KEYS.every(key =>
      typeof config[key] === 'string' && config[key].trim() && !/^(replace|your[-_ ])/i.test(config[key].trim())
    ));
  }

  function classifyFirebaseError(error) {
    const rawCode = String(error?.code || error?.name || '').toLowerCase();
    const code = rawCode.replace(/^firebase[:/]/, '');
    const quotaCodes = ['resource-exhausted', 'quota-exceeded'];
    const offlineCodes = [
      'unavailable',
      'network-request-failed',
      'auth/network-request-failed'
    ];
    const permissionCodes = [
      'permission-denied',
      'unauthenticated',
      'auth/invalid-user-token',
      'auth/user-token-expired'
    ];
    const authenticationCodes = [
      'auth/invalid-credential',
      'auth/invalid-login-credentials',
      'auth/user-not-found',
      'auth/wrong-password',
      'auth/too-many-requests',
      'auth/user-disabled'
    ];

    if (quotaCodes.some(item => code.includes(item))) return 'quota';
    if (offlineCodes.some(item => code.includes(item))) return 'offline';
    if (permissionCodes.some(item => code.includes(item))) return 'permission';
    if (authenticationCodes.some(item => code.includes(item))) return 'authentication';
    return 'unknown';
  }

  function sanitizeForFirestore(value) {
    if (value === undefined) return null;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
    if (Array.isArray(value)) return value.map(item => sanitizeForFirestore(item)).filter(item => item !== undefined);
    if (typeof value === 'object') {
      const clean = {};
      for (const [key, item] of Object.entries(value)) {
        const sanitized = sanitizeForFirestore(item);
        if (sanitized !== undefined) clean[key] = sanitized;
      }
      return clean;
    }
    return String(value);
  }

  function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(item => stableSerialize(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function revisionConflict(message) {
    const error = new Error(message);
    error.code = 'firebase/revision-conflict';
    error.category = 'conflict';
    return error;
  }

  function makePublicError(error, operation = 'sync') {
    const wrapped = new Error('Firebase operation failed.');
    wrapped.code = String(error?.code || error?.name || 'firebase/unknown');
    wrapped.category = classifyFirebaseError(error);
    wrapped.operation = operation;
    wrapped.cause = error;
    return wrapped;
  }

  function reportError(error, operation) {
    const publicError = error?.category ? error : makePublicError(error, operation);
    try { errorListener(publicError); } catch (listenerError) { console.error(listenerError); }
    return publicError;
  }

  async function init(options = {}) {
    if (typeof options.onError === 'function') errorListener = options.onError;
    if (!isFirebaseConfigured()) return null;
    if (services) return services;
    if (initializing) return initializing;

    initializing = (async () => {
      try {
        const [appApi, authApi, firestoreApi] = await Promise.all([
          import(`${SDK_ROOT}/firebase-app.js`),
          import(`${SDK_ROOT}/firebase-auth.js`),
          import(`${SDK_ROOT}/firebase-firestore.js`)
        ]);
        const appName = 'bioeng-clinical';
        const existingApp = appApi.getApps().find(item => item.name === appName);
        const app = existingApp || appApi.initializeApp(window.BIOENG_FIREBASE_CONFIG, appName);
        const auth = authApi.getAuth(app);
        try {
          await authApi.setPersistence(auth, authApi.inMemoryPersistence);
        } catch (error) {
          throw reportError(error, 'auth-persistence');
        }
        services = {
          app,
          auth,
          db: firestoreApi.getFirestore(app),
          appApi,
          authApi,
          firestoreApi
        };
        return services;
      } catch (error) {
        initializing = null;
        throw reportError(error, 'initialize');
      }
    })();
    return initializing;
  }

  async function signIn(email, password) {
    const sdk = await init();
    if (!sdk) {
      const error = new Error('Firebase is not configured.');
      error.code = 'firebase/not-configured';
      error.category = 'offline';
      throw error;
    }
    try {
      const credential = await sdk.authApi.signInWithEmailAndPassword(sdk.auth, email, password);
      const token = await sdk.authApi.getIdTokenResult(credential.user, true);
      const role = String(token.claims.role || '');
      if (!VALID_ROLES.includes(role)) {
        await sdk.authApi.signOut(sdk.auth);
        const error = new Error('The Firebase account has no valid Bioeng role.');
        error.code = 'firebase/invalid-role';
        error.category = 'permission';
        throw error;
      }
      activeIdentity = {
        uid: credential.user.uid,
        email: String(credential.user.email || email).toLowerCase(),
        role,
        name: String(token.claims.name || credential.user.displayName || ''),
        title: String(token.claims.title || '')
      };
      return {...activeIdentity};
    } catch (error) {
      throw reportError(error, 'sign-in');
    }
  }

  async function signOut() {
    stopRealtime();
    activeIdentity = null;
    if (!services) return;
    try {
      await services.authApi.signOut(services.auth);
    } catch (error) {
      reportError(error, 'sign-out');
    }
  }

  function scopedCollection(store, role) {
    const sdk = services;
    const base = sdk.firestoreApi.collection(sdk.db, store);
    if (store === 'reports' && role !== 'Laborator') {
      return sdk.firestoreApi.query(
        base,
        sdk.firestoreApi.where('type', '==', 'specialist'),
        sdk.firestoreApi.where('specialty', '==', role)
      );
    }
    return base;
  }

  function storesForRole(role) {
    return role === 'Laborator'
      ? [...FIRESTORE_STORES]
      : ['patients', 'reports'];
  }

  function snapshotRecords(snapshot) {
    return snapshot.docs.map(item => ({...item.data(), id: item.id}));
  }

  async function pull(role) {
    const sdk = await init();
    if (!sdk || !activeIdentity) return {};
    const result = {};
    try {
      await Promise.all(storesForRole(role).map(async store => {
        const snapshot = await sdk.firestoreApi.getDocs(scopedCollection(store, role));
        result[store] = snapshotRecords(snapshot);
      }));
      return result;
    } catch (error) {
      throw reportError(error, 'pull');
    }
  }

  function stopRealtime() {
    for (const unsubscribe of realtimeUnsubscribers.splice(0)) {
      try { unsubscribe(); } catch (error) { console.error(error); }
    }
  }

  async function startRealtime(role, onChanges) {
    const sdk = await init();
    stopRealtime();
    if (!sdk || !activeIdentity || typeof onChanges !== 'function') return;
    for (const store of storesForRole(role)) {
      const unsubscribe = sdk.firestoreApi.onSnapshot(
        scopedCollection(store, role),
        snapshot => {
          const changes = snapshot.docChanges().map(change => ({
            store,
            operation: change.type === 'removed' ? 'delete' : 'put',
            recordId: change.doc.id,
            value: change.type === 'removed' ? null : {...change.doc.data(), id: change.doc.id}
          }));
          if (changes.length) Promise.resolve(onChanges(changes)).catch(error => reportError(error, 'remote-change'));
        },
        error => reportError(error, 'realtime')
      );
      realtimeUnsubscribers.push(unsubscribe);
    }
  }

  function reportTombstone(value, recordId, mutation, baseRevision) {
    return {
      id: recordId,
      patientId: String(value?.patientId || ''),
      type: String(value?.type || ''),
      specialty: String(value?.specialty || ''),
      _deleted: true,
      deletedAt: String(mutation?.queuedAt || value?.deletedAt || ''),
      deletedBy: String(mutation?.queuedByEmail || activeIdentity?.email || ''),
      baseRevision
    };
  }

  async function writeReport(documentRef, value, mutation) {
    const sdk = services;
    const target = sanitizeForFirestore({...value, id: mutation.recordId});
    const inferredRevision = Number(target?.revision) - 1;
    const expectedRevision = Number.isInteger(mutation.expectedRevision)
      ? mutation.expectedRevision
      : inferredRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw revisionConflict('The report mutation has no valid base revision.');
    }
    await sdk.firestoreApi.runTransaction(sdk.db, async transaction => {
      const snapshot = await transaction.get(documentRef);
      if (!snapshot.exists()) {
        if (expectedRevision !== 0) throw revisionConflict('The report was removed or changed before synchronization.');
        transaction.set(documentRef, target);
        return;
      }
      const existing = sanitizeForFirestore({...snapshot.data(), id: mutation.recordId});
      if (stableSerialize(existing) === stableSerialize(target)) return;
      const acceptedBase = Array.isArray(mutation.acceptedBaseSignatures)
        && mutation.acceptedBaseSignatures.includes(stableSerialize(existing));
      if (existing?._deleted === true || (Number(existing?.revision) !== expectedRevision && !acceptedBase)) {
        throw revisionConflict('The report has a newer Firebase revision.');
      }
      if (!Number.isInteger(Number(target?.revision)) || Number(target.revision) <= Number(existing.revision)) {
        throw revisionConflict('The report revision does not advance the accepted Firebase revision.');
      }
      transaction.set(documentRef, target);
    });
  }

  async function writeReportTombstone(documentRef, value, mutation) {
    const sdk = services;
    const inferredRevision = Number(value?.revision);
    const expectedRevision = Number.isInteger(mutation.expectedRevision)
      ? mutation.expectedRevision
      : inferredRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw revisionConflict('The report deletion has no valid base revision.');
    }
    await sdk.firestoreApi.runTransaction(sdk.db, async transaction => {
      const snapshot = await transaction.get(documentRef);
      if (!snapshot.exists()) {
        if (expectedRevision !== 0) throw revisionConflict('The report was removed or changed before deletion synchronized.');
        transaction.set(documentRef, reportTombstone(value, mutation.recordId, mutation, 0));
        return;
      }
      const existing = sanitizeForFirestore({...snapshot.data(), id: mutation.recordId});
      const baseRevision = existing?._deleted === true
        ? Number(existing.baseRevision)
        : Number(existing.revision);
      if (!Number.isInteger(baseRevision) || baseRevision < 0) {
        throw revisionConflict('The Firebase report has no valid revision for deletion.');
      }
      const target = reportTombstone(value, mutation.recordId, mutation, baseRevision);
      if (stableSerialize(existing) === stableSerialize(target)) return;
      const acceptedBase = Array.isArray(mutation.acceptedBaseSignatures)
        && mutation.acceptedBaseSignatures.includes(stableSerialize(existing));
      if (existing?._deleted === true || (Number(existing.revision) !== expectedRevision && !acceptedBase)) {
        throw revisionConflict('The report has a newer Firebase revision and was not deleted.');
      }
      transaction.set(documentRef, target);
    });
  }

  async function applyMutation(mutation) {
    const sdk = await init();
    if (!sdk || !activeIdentity) throw Object.assign(new Error('Firebase is not authenticated.'), {code: 'firebase/not-authenticated', category: 'offline'});
    const {store, operation, recordId, value} = mutation;
    if (!FIRESTORE_STORES.includes(store)) {
      throw Object.assign(new Error('Unknown synchronized store.'), {code: 'firebase/invalid-store'});
    }
    try {
      const documentRef = sdk.firestoreApi.doc(sdk.db, store, recordId);
      if (operation === 'delete') {
        if (store === 'reports') {
          await writeReportTombstone(documentRef, value, mutation);
        } else {
          await sdk.firestoreApi.deleteDoc(documentRef);
        }
      } else {
        const trustedValue = store === 'audit'
          ? {...value, actorUid: activeIdentity.uid, actorEmail: activeIdentity.email, actorRole: activeIdentity.role}
          : value;
        if (store === 'reports') await writeReport(documentRef, trustedValue, mutation);
        else await sdk.firestoreApi.setDoc(documentRef, sanitizeForFirestore({...trustedValue, id: recordId}));
      }
    } catch (error) {
      throw reportError(error, `${operation}-${store}`);
    }
  }

  window.BioengFirebase = {
    isConfigured: isFirebaseConfigured,
    init,
    signIn,
    signOut,
    pull,
    startRealtime,
    stopRealtime,
    applyMutation,
    classifyError: classifyFirebaseError,
    sanitizeForFirestore,
    _test: {isFirebaseConfigured, classifyFirebaseError, sanitizeForFirestore}
  };
})();
