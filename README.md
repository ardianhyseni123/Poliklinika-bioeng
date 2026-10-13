# Poliklinika Bioeng

The clinical app is a static, local-first browser application. It keeps using
IndexedDB immediately and optionally synchronizes the same records with Firebase
after a user signs in.

## Firebase behavior

- With `window.BIOENG_FIREBASE_CONFIG` left as `null` in `docs/firebase-config.js`,
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
  is never loaded by `docs/index.html`. The in-app backup restore works only
  for the laboratory account in local-only mode, because it writes straight
  into the browser's database and never reaches Firebase.

## Analysis list and reference ranges

The laboratory account edits the analysis list in the app, under
"Analizat dhe vlerat referente": names, units, reference ranges, categories,
their order, and the heading each category prints under. Reagent changes no
longer need a code change.

- The list is one revisioned document (`analysisCatalog/current` in Firestore,
  or the browser's database in local-only mode). Every save advances the
  revision by one and appends an entry to `catalogHistory` recording who
  changed which value, from what, to what. The history is shown in the app.
- A save is rejected when another device saved a newer list first, so nothing
  is silently overwritten. In Firebase mode, saving needs a connection; the
  list can still be read and used offline.
- `analysisCatalog` in `docs/index.html` is only the starting list. The first
  laboratory login stores it in the database; after that, editing it in the
  code has no effect on the app.
- Each saved report keeps its own copy of every row's unit, reference range,
  and print heading, so changing the list never alters existing reports. The
  unit and range can also be overridden on a single report.
- Backups include the list and its history.

## Layout

The served site is exactly the four files in `docs/`: `index.html`,
`firebase-config.js`, `firebase-sync.js`, and `logo.png.png`. Nothing else in
the repository is deployable, which keeps clinical backups and the Admin SDK
importer off any public host by construction rather than by an ignore rule.
The Firebase SDK is fetched from `gstatic.com` at runtime, so there is no build
step and no bundled dependency to refresh.

See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) for project setup and security-rule
deployment. See [tools/firebase-import/README.md](tools/firebase-import/README.md)
for the dry run, account provisioning, and one-time import command.

## Deploying

`./deploy.sh check` checks that everything is ready and changes nothing.
`./deploy.sh` then deploys in order, asking before every step that changes
something: it runs the tests, commits, publishes the Firestore rules, optionally
deploys a 7-day preview, publishes `docs/` to Firebase Hosting, and pushes to
GitHub. It publishes the rules before the site, because a new feature can depend on
a new rule. It never touches users, passwords, or data in Firebase, and it refuses
to run without a terminal.

## Verification

```sh
npm test
node tools/firebase-import/import.mjs /absolute/path/to/bioeng-backup.json
```

The import command is a read-only validation unless `--commit` is explicitly
provided.
