# Firebase setup

The app expects Firebase Authentication with the Email/Password provider and
Cloud Firestore. Cloud Storage is not used: report attachments stay in the local
IndexedDB database of the browser that saved them and are never uploaded. The
client configuration is intentionally supplied separately.

## Client configuration

Register a Web app in the Firebase project, then paste its configuration object
into `docs/firebase-config.js`. The required fields are `apiKey`, `authDomain`,
`projectId`, and `appId`. No `storageBucket` is needed. Leave the value as `null`
for the existing local-only mode. Once a non-null object is supplied, all four
fields are required; an incomplete production configuration blocks login instead
of silently accepting the built-in local credentials.

Enable Email/Password authentication before provisioning accounts. The account
template in `tools/firebase-import/accounts.example.json` contains the same five
emails, roles, names, and titles as the current app, but no passwords. Passwords
are read only from the environment during the one-time Admin SDK run.
Use new, strong Firebase passwords; do not reuse the legacy passwords embedded
for the unchanged local-only mode. Those legacy values are never accepted as a
fallback after a valid Firebase configuration is supplied.

Recommended activation order:

1. Create Firestore and the Email/Password sign-in provider.
2. Deploy the Firestore rules and indexes below.
3. Dry-run, then commit the standalone backup import with the account template.
4. Paste the web configuration into `docs/firebase-config.js` last.

This order keeps the deployed app in local-only mode until its data, accounts,
claims, and server rules are ready together.

When Firebase is active, each Firebase UID uses a separate IndexedDB database
and reload still signs the user out, matching the existing session behavior.
There is no fallback to the built-in local password if Firebase sign-in is
offline or fails. An already authenticated session keeps writing locally and
queues its changes when Firebase becomes unavailable or reaches quota.
Transient synchronization failures retry automatically with bounded backoff.
An authorization failure or a report revision conflict remains in that
account's local queue but is quarantined so unrelated records continue to
synchronize; reconcile the reported record before editing it again instead of
overwriting the Firebase copy.

For clinical use on a computer shared by different staff, use separate operating
system or browser profiles as an additional privacy boundary. Browser storage is
controlled by the local browser profile and should not be treated as protection
against another person who can inspect that same profile with developer tools.

## Attachments

Attachments are deliberately outside synchronization. A PDF, PNG, or JPG saved
with a report is written to that browser's IndexedDB database and stays there:

- Another device that opens the same report through Firebase sees the report but
  not its attachments.
- Clearing the browser profile, or switching to another machine, loses them.
- Deleting a report deletes its local attachments on that device; other devices
  drop their own copies when the deletion reaches them.
- Only a backup exported from that device contains its attachments, and the
  standalone importer validates but never uploads them.

Treat the exported backup as the only durable copy of an attachment.

## Account claims

Provision exactly the five existing accounts outside the browser app. Their
trusted `role` claim must use this exact mapping:

| Email | Required role |
| --- | --- |
| `admin@bioeng.com` | `Laborator` |
| `pulmolog@bioeng.com` | `Pulmologji` |
| `kardiolog@bioeng.com` | `Kardiologji` |
| `neurolog@bioeng.com` | `Neurologji` |
| `hixhama@bioeng.com` | `Hixhame` |

The standalone importer rejects missing accounts, extra accounts, and any role
assigned to the wrong email. It also writes the template's `name` and `title`
claims. Claims must be assigned with the Admin SDK or another trusted admin
environment. Never let a client write its own role. Users must sign in again (or
refresh their ID token) after a claim changes.

## Rule contracts

- Report deletion is a terminal update in `reports/{reportId}`. The tombstone
  contains only `id`, `patientId`, `type`, `specialty`, `_deleted: true`,
  `deletedAt`, `deletedBy`, and `baseRevision`; `deletedBy` is the signed-in
  token email, while `baseRevision` prevents a stale device from deleting a
  newer report revision.
- New audit records are append-only and include `actorUid`, `actorEmail`,
  `actorRole`, `reportType`, and `specialty`. Legacy audit records are accepted
  only through the Admin SDK importer, which bypasses client rules.
- Active specialist reports must use the signed-in account's trusted `name` and
  `title` claims for `clinician` and `clinicianTitle`; payment attribution must
  match the signed-in token email.
- Specialist report listeners must constrain both `type == "specialist"` and
  `specialty == <token role>`. Sort locally when tombstones must be observed,
  because an `orderBy` excludes documents that do not contain its field.

## Deploy

After selecting the correct Firebase project with the Firebase CLI, deploy the
rules and indexes:

```sh
firebase deploy --only firestore:rules,firestore:indexes
```

No Storage rules or bucket CORS configuration are needed, because no attachment
ever leaves the browser.

## Hosting

`firebase.json` serves `docs/`, which contains only the four files the browser
loads. The folder is named `docs` because GitHub Pages can serve a repository
root or a folder named `/docs` and nothing else, so the same directory works as
the document root for either host without a second branch or a build step.
`docs/.nojekyll` stops GitHub Pages from running Jekyll over the folder;
Firebase skips that file through the `**/.*` ignore rule.

```sh
firebase deploy --only hosting
```

This serves the app at `https://bioeng-c8397.web.app` and
`https://bioeng-c8397.firebaseapp.com`. Preview a change on a temporary URL
before publishing it to the clinic:

```sh
firebase hosting:channel:deploy preview --expires 7d
```

`index.html`, `firebase-sync.js`, and `firebase-config.js` are served with
`Cache-Control: no-cache` because they carry no content hash; a revalidation
request is cheap and a stale clinical build is not. The logo is cached for a
week. Responses also carry `X-Content-Type-Options`, `X-Frame-Options`, and
`Referrer-Policy`. These headers come from `firebase.json` and therefore apply
to Firebase Hosting only — GitHub Pages ignores them and applies its own
caching.

### Authorized domains

Firebase Authentication rejects a sign-in from a domain it does not know.
`bioeng-c8397.web.app` and `bioeng-c8397.firebaseapp.com` are authorized
automatically, so a Firebase Hosting deployment needs no further action. Any
other origin must be added first under **Authentication → Settings → Authorized
domains** in the Firebase console, including a GitHub Pages domain such as
`<account>.github.io` and any custom domain. Without that entry the app loads
and then fails at login.

The `apiKey` in `docs/firebase-config.js` is a public project identifier, not a
secret; it is safe in a public repository. Access is controlled by the
Authentication providers and the Firestore rules in this repository, which is
why the authorized-domain list and the rules matter and the key does not.

Run the one-time JSON import from the separate `tools/firebase-import` utility;
the production app contains no import command.
