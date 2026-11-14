# Poliklinika Bioeng

The clinical app is a static, local-first browser application. It keeps using
IndexedDB immediately and optionally synchronizes the same records with Firebase
after a user signs in.

## Firebase behavior

- With `window.BIOENG_FIREBASE_CONFIG` left as `null` in `docs/firebase-config.js`,
  the app behaves as the existing local-only version.
- With a valid configuration, Firebase Authentication is the list of users:
  anyone there with a `role` and `name` custom claim can sign in, and the role
  controls Firestore access. The app has no built-in account list in this mode.
  Add or change users as described in
  [Managing users](tools/firebase-import/README.md#managing-users). A partial
  non-null configuration blocks login.
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

## The rebuilt app (`src/`)

A rebuilt app (Vite + TypeScript + React) replaces the old one at the cutover described in
[CUTOVER.md](CUTOVER.md). Until then hosting serves `docs/`, the new rules wait in
`firestore.v2.rules`, and `deploy.sh` keeps shipping the old app unchanged.

What changes for the clinic:
- Firebase's own offline cache does the syncing: work saved offline is kept and uploads
  by itself, also after the tab was closed. Logging out is refused while something has not
  reached the server yet.
- Every report save is kept as a version. Two people editing the same report never
  overwrite each other: the report is marked «⚠ Dy versione» and someone chooses.
- Roles live in the Firestore `users` collection and are managed on the Administrator's
  «Përdoruesit» page (accounts and passwords are still created in the Firebase console).
- On the first login after the switch, reports the old app could not upload are found on
  that computer and uploaded.
- Printouts match the old app word for word (checked by the end-to-end tests).

Working on it:
- `npm run dev` starts local Firebase emulators with sample data (accounts and
  password in `scripts/seed.mjs`) and the new app at http://localhost:5173. It never
  touches the clinic's data. The emulators need Java 21+ (`.sdkmanrc` picks SDKMAN's).
- `npm test` runs the type check, ESLint, unit tests, the emulator tests (Firestore
  rules and the data layer), and the old app's tests.
- `npm run test:e2e` runs the browser tests on their own emulators, including the print
  comparison with the old app (screenshots in `test-results/print-parity/`). They use the
  installed Google Chrome.
- `scripts/deploy-app.sh check` runs all of it and builds; `scripts/deploy-app.sh cutover`
  does the switch.

See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) for project setup and security-rule
deployment. See [tools/firebase-import/README.md](tools/firebase-import/README.md)
for managing users and roles, and for the one-time import command.

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
