# Bioeng Firebase administration

This directory holds two standalone administration utilities. Nothing here is
loaded by the clinical app.

- `npm run users` manages who can sign in to the app and with which role.
- `npm run import` is the one-time backup import. It validates a Bioeng backup in
  dry-run mode by default and only writes when `--commit` is supplied.

## Setup

Use Node.js 20 or newer:

```sh
cd tools/firebase-import
npm install
```

Authenticate with [Application Default Credentials](https://cloud.google.com/docs/authentication/provide-credentials-adc), for example with a narrowly protected service-account key:

```sh
export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/firebase-admin.json
```

Do not copy a credential into this repository. A key for this project is created
in the Firebase console under **Project settings → Service accounts → Generate new
private key**; keep the downloaded file outside the repository.

## Managing users

A Firebase Authentication user can sign in once it has a role. Until the rebuilt app
replaces the old one, roles live in two places and this tool keeps both in step: the
new app reads the Firestore document `users/{email}` (also editable on its
Administrator page), the old app reads custom claims. An `Administrator` gets the
claim `Laborator`, because the old app has no Administrator role.

Before cutover, create the Firestore profiles of everyone who already has a role:

```sh
npm run users -- migrate            # shows what it would create
npm run users -- migrate --commit   # creates them; existing profiles are left alone
```

Adding someone takes two steps:

1. In the Firebase console, **Authentication → Users → Add user**: enter the
   email and a password.
2. From this directory, give the user a role and the name the app shows:

   ```sh
   npm run users -- set doctor@example.com --role Kardiologji --name "Dr. Emri Mbiemri"
   ```

   `--role` is one of `Laborator`, `Pulmologji`, `Kardiologji`, `Neurologji`,
   or `Hixhame`. `--title` is optional and defaults to the role's usual title
   (for example `Specialist i Kardiologjisë`). Running `set` again changes the
   role, name, or title; the user then signs out and in again.

To see every user and whether it can use each app:

```sh
npm run users -- list
```

To take app access away while keeping the Firebase user, and end its sessions:

```sh
npm run users -- remove doctor@example.com
```

Passwords are never handled by this tool: change them, disable users, or delete
them in the Firebase console. The project defaults to the one in `.firebaserc`;
pass `--project-id` to use another.

## Validate first

From this directory:

```sh
npm run import -- ../../bioeng-backup-2026-08-08.json
```

Dry-run validation checks the backup format/version, UUID record/document IDs,
duplicate IDs, required references, estimated Firestore document sizes, and
attachment MIME types, declared sizes, and data URLs. It also enforces the app's
exact report matrix: `laboratory` means `Laborator`, while `specialist` means one
of `Pulmologji`, `Kardiologji`, `Neurologji`, or `Hixhame`. Historical
payment/audit references to deleted reports are reported as aggregate warnings
and preserved. No patient values are printed.

## Commit once

```sh
npm run import -- ../../bioeng-backup-2026-08-08.json \
  --commit \
  --project-id YOUR_FIREBASE_PROJECT_ID
```

`--project-id` is optional when ADC/default app configuration can infer it.
Firestore records are upserted into `patients`, `reports`, `appointments`,
`payments`, and `audit`, retaining each record's existing `id` as the document
ID. Firestore commits use chunks of 400 operations.

Attachments are validated but never uploaded, because the app keeps them in the
local database of the browser that saved them. A committed import therefore
restores clinical records to every device, while the attachments in the backup
remain readable only from that backup file.

Before writes begin, the tool reserves the marker
`_bioeng_imports/bioeng-clinical-backup-v2`. Any later committed run is refused,
including after an interrupted/failed run. Inspect the project first, then use
`--force` only when an intentional retry or replacement is required. A forced run
upserts supplied records; it does not delete unrelated cloud records.

## Optional account and role setup during the import

This only provisions the original five accounts in one go; use
[Managing users](#managing-users) for everyone else. Copy `accounts.example.json` to the ignored `accounts.local.json` and keep its five
email-to-role mappings intact. The validator requires exactly `admin@bioeng.com →
Laborator`, `pulmolog@bioeng.com → Pulmologji`, `kardiolog@bioeng.com →
Kardiologji`, `neurolog@bioeng.com → Neurologji`, and `hixhama@bioeng.com →
Hixhame`; missing, extra, or remapped accounts are rejected. Keep passwords only
in environment variables named by each `passwordEnv` field:

```sh
export BIOENG_ADMIN_PASSWORD='set-outside-the-repository'
```

Validate the account file without contacting Firebase:

```sh
npm run import -- ../../bioeng-backup-2026-08-08.json \
  --accounts accounts.local.json
```

Add `--accounts accounts.local.json` to the committed import to create missing
Firebase Authentication users, update existing users, and set exact custom claims
for `role`, `name`, and `title`. Plaintext `password` fields in JSON are rejected.
The example contains the app's real account identities but no credentials.

Run `node import.mjs --help` for all options.
