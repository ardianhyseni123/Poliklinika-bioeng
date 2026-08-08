# Poliklinika Bioeng

The clinical app is a static, local-first browser application. It keeps using
IndexedDB immediately and optionally synchronizes the same records with Firebase
after a user signs in.

## Firebase behavior

- With `window.BIOENG_FIREBASE_CONFIG` left as `null` in `firebase-config.js`,
  the app behaves as the existing local-only version.
- With a valid configuration, the same five email accounts authenticate through
  Firebase Authentication and their trusted `role` claim controls Firestore
  access. A partial non-null configuration blocks login.
- Report attachments are never synchronized. Cloud Storage is not used at all:
  a PDF, PNG, or JPG stays in the IndexedDB database of the browser that saved
  it, and only a backup exported from that device carries it elsewhere.
- Firebase mode keeps a separate local database per Firebase UID and never falls
  back to the built-in local passwords when Firebase authentication is offline.
- Every change is written locally together with its durable Firebase retry
  entry. Offline and quota failures retry with bounded backoff while displaying
  a non-blocking warning.
- Permission or concurrent-report conflicts remain local and are isolated from
  unrelated queued work, so one rejected record cannot stop the rest of the
  app from synchronizing. The warning asks for administrator reconciliation
  instead of silently overwriting clinical data.
- If IndexedDB itself cannot write, the app remains usable with an in-memory
  session fallback and warns that those changes can be lost on refresh.
- The one-time JSON import utility is isolated under `tools/firebase-import` and
  is never loaded by `index.html`.

See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) for project setup and security-rule
deployment. See [tools/firebase-import/README.md](tools/firebase-import/README.md)
for the dry run, account provisioning, and one-time import command.

## Verification

```sh
npm test
node tools/firebase-import/import.mjs /absolute/path/to/bioeng-backup.json
```

The import command is a read-only validation unless `--commit` is explicitly
provided.
