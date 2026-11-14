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
4. **Make yourself Administrator**, with an account of your own (if it does not exist yet,
   create it first under Authentication → Users → Add user):
   ```sh
   npm run users -- set your.email@example.com --role Administrator --name "Your Name"
   npm run users -- list               # everyone who should work: "new app: yes"
   ```
   Not one of the five accounts staff use today. Until the switch, the live app admits those
   only with exactly the role, name and title it has built in, and `set` rewrites them: an
   Administrator's title would lock that account out of the live app. (To make the shared
   laboratory account Administrator, do it on the day, right before Part 2.) For the same
   reason, when `list` shows one of the five as "no (no title)" or "no (no profile)", fix it
   with `set` and exactly the name the live app uses, for example `--name "Dr. Refik Sylaj"`;
   the default titles already match.
5. **Accounts for Gastroenterologji and Urologji.** These two specialties exist only in the
   new app. Create `gastrolog@bioeng.com` and `urolog@bioeng.com` under Authentication →
   Users → Add user, with new passwords (not the ones written in `new/UDHEZIMI-V28.txt`),
   then:
   ```sh
   npm run users -- set gastrolog@bioeng.com --role Gastroenterologji --name "Dr. Shqiprim Aliu"
   npm run users -- set urolog@bioeng.com --role Urologji --name "Dr. Agron Uruqi"
   ```
   The titles default to "Gastroenterolog" and "Urolog". `list` shows both as "old app: no
   (new app only)", which is expected.
6. **Turn off public sign-up.** Firebase console → Authentication → Settings → User
   actions → untick "Enable create (sign-up)". Accounts are only ever created in the console;
   with sign-up on, someone could register an email that already has a role.
7. **Which address do staff use?** Confirmed 2026-11-14: https://bioeng-c8397.web.app, the
   address the new app is published to, so attachments are found with no extra step.
   (The old app kept attachments in the browser, per address, and the new app can only
   bring them over on the same address. If anyone ever used another one, such as
   `bioeng-c8397.firebaseapp.com`, they open that address once after the switch.)
8. **Dry run:**
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
2. **Every person logs in on every computer they used.** Attachments (PDF, images) exist
   only on the computer they were added on; the first login there copies the old app's into
   the new one, and a notice says how many («U sollën dokumentet e versionit të vjetër»).
   Reports the old app could not upload are **not** sent: the clinic decided on 2026-11-14
   not to restore them, because the doctors entered them again and they would be
   duplicated. The old app's copy stays on the computer for 30 days, then is deleted.
   (Within those 30 days the upload could still be turned on: `uploadHeldChanges` in
   `src/data/DataProvider.tsx`.)
3. A yellow «… nuk u pranuan nga serveri» box means something could not be saved; its
   content is kept on that computer with a «Kopjo përmbajtjen» button. Copy it before
   pressing «E kam ruajtur».
4. A report marked «⚠ Dy versione» was edited in two places; open the list and choose.
5. **Who sees which patient.** A doctor now sees only the patients assigned to their
   specialty, the ones they register themselves, and old patients they have a report for.
   Every patient from before the switch is "old", and the old app never managed to save a
   doctor's report, so doctors see none of the existing patients until the laboratory
   assigns them: Pacienti → select the patient → «Specialistët e pacientit» → tick the
   specialists → «Ruaj caktimin». An appointment with a specialty also assigns the patient
   to it, and a specialist report the laboratory writes for an old patient shows it to that
   specialist.

## Rolling back

Possible at any time; nothing is lost.

1. Delete `.cutover-complete`, then run `./deploy.sh`. It publishes the old rules
   (`firestore.rules`) and the old app (`docs/`) again. Or roll back hosting in the Firebase
   console (Hosting → Release history) and run only the rules step.
2. Data saved in the new app stays readable by the old one: same fields, plus a version
   history the old app ignores.
3. People added on the new Users page have no claims, so the old app does not know them:
   give them claims with `npm run users -- set …`.
4. The old app ignores who is assigned to whom: there, every doctor sees every patient
   again. Gastroenterologji and Urologji exist only in the new app, so those two doctors
   cannot sign in to the old one; the laboratory still sees their reports.

## After about two stable weeks

- Make the new setup the only one: replace `firebase.json` with `firebase.next.json`,
  rename `firestore.v2.rules` to `firestore.rules` (update `firebase.next.json` and the two
  `firebase.emulators*.json` files), and make `scripts/deploy-app.sh` the deploy script.
- Delete `docs/`, the old `deploy.sh`, and the old tests (`tests/*.cjs` except
  `importer-validation` and `firebase-users`, which test the admin tools).
- Optionally remove the old custom claims from accounts (`users.mjs` keeps writing them
  until then, for rollback).
