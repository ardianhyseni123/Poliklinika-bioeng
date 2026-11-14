# Switching to the rebuilt app

The rebuilt app (`src/`, built into `dist/`) replaces the old one (`docs/`) for everyone at
once, at a quiet time. Until then the old app stays live and `./deploy.sh` keeps deploying it.

Plan for about an hour on the day. Part 1 can be done days earlier.

## Part 1: preparation (any day before)

These change nothing the old app uses, so the clinic keeps working normally.

1. **Patient data in Git.** `bioeng-backup-2026-08-20.json` is in the repository and on
   GitHub. Remove it from the history (`git filter-repo --path bioeng-backup-2026-08-20.json --invert-paths`),
   force-push, and treat it as already copied.
2. **An admin key for the user tool.** Firebase console → Project settings → Service
   accounts → Generate new private key. Keep the file outside the repository, then in a
   terminal:
   ```sh
   cd tools/firebase-import
   export GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json
   ```
3. **Copy everyone's role into the new `users` collection** (the old app keeps using the
   claims, which are not touched):
   ```sh
   npm run users -- migrate            # shows what would be created
   npm run users -- migrate --commit
   ```
4. **Make yourself Administrator.** Your claim becomes `Laborator`, so the old app keeps
   working for you:
   ```sh
   npm run users -- set your.email@example.com --role Administrator --name "Your Name"
   npm run users -- list               # everyone who should work: "new app: yes"
   ```
   A doctor shown as "no (no title)" or "no (no profile)": fix with `set`.
5. **Turn off public sign-up.** Firebase console → Authentication → Settings → User
   actions → untick "Enable create (sign-up)". Accounts are only ever created in the console;
   with sign-up on, someone could register an email that already has a role.
6. **Which address do staff use?** Confirmed 2026-11-14: https://bioeng-c8397.web.app, the
   address the new app is published to, so held reports are found with no extra step.
   (The old app kept unsent reports in the browser, per address, and the new app can only
   recover them on the same address. If anyone ever used another one, such as
   `bioeng-c8397.firebaseapp.com`, they open that address once after the switch.)
7. **Dry run:**
   ```sh
   scripts/deploy-app.sh check
   ```
   Runs every test, including the end-to-end tests and the print comparison with the old
   app, and builds `dist/`. Changes nothing.

## Part 2: the switch

1. Ask staff to close the app.
2. Run, in your own terminal:
   ```sh
   scripts/deploy-app.sh cutover
   ```
   It tests and builds, asks the Part 1 questions, then publishes `firestore.v2.rules` and
   `dist/`, asking before each. Between the two, the old app no longer works, so publish the
   app right after the rules. It writes `.cutover-complete`; from then on `./deploy.sh`
   refuses to run, because it would put the old app back.
3. Commit everything (including `.cutover-complete`) and push.

## Part 3: right after

1. Open https://bioeng-c8397.web.app, reload, log in. Check the Users page.
2. **Every person logs in on every computer they used, doctors first.** Reports the old app
   could not upload are found and sent at that login; a notice says how many
   («U rikthyen ndryshime nga versioni i vjetër»). The old data stays on the computer for 30
   days.
3. A yellow «… nuk u pranuan nga serveri» box means something could not be saved; its
   content is kept on that computer with a «Kopjo përmbajtjen» button. Copy it before
   pressing «E kam ruajtur».
4. A report marked «⚠ Dy versione» was edited in two places; open the list and choose.

## Rolling back

Possible at any time; nothing is lost.

1. Delete `.cutover-complete`, then run `./deploy.sh`. It publishes the old rules
   (`firestore.rules`) and the old app (`docs/`) again. Or roll back hosting in the Firebase
   console (Hosting → Release history) and run only the rules step.
2. Data saved in the new app stays readable by the old one: same fields, plus a version
   history the old app ignores.
3. People added on the new Users page have no claims, so the old app does not know them:
   give them claims with `npm run users -- set …`.

## After about two stable weeks

- Make the new setup the only one: replace `firebase.json` with `firebase.next.json`,
  rename `firestore.v2.rules` to `firestore.rules` (update `firebase.next.json` and the two
  `firebase.emulators*.json` files), and make `scripts/deploy-app.sh` the deploy script.
- Delete `docs/`, the old `deploy.sh`, and the old tests (`tests/*.cjs` except
  `importer-validation` and `firebase-users`, which test the admin tools).
- Optionally remove the old custom claims from accounts (`users.mjs` keeps writing them
  until then, for rollback).
