# Bioeng one-time Firebase import

This directory is a standalone administration utility. Nothing here is loaded by
the clinical app. It validates a Bioeng backup in dry-run mode by default and only
writes when `--commit` is supplied.

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

Do not copy a credential into this repository.

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

## Optional account and role setup

Copy `accounts.example.json` to the ignored `accounts.local.json` and keep its five
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
