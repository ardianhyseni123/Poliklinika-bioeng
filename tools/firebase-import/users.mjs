#!/usr/bin/env node

// Manage who can use the Bioeng app, with the Admin SDK.
//
// Until cutover two apps read roles from two places, and this tool keeps both in step:
// - the new app reads users/{lowercase email} in Firestore (also editable on its admin page);
// - the old app (docs/) reads the `role`, `name` and `title` custom claims, which the
//   Firebase console cannot edit. They stay so a rollback to the old app keeps working.
// The old app has no Administrator role, so an Administrator's claim is Laborator.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_TITLES = new Map([
  ['Administrator', 'Administrator'],
  ['Laborator', 'Laborator'],
  ['Pulmologji', 'Specialist i Pulmologjisë'],
  ['Kardiologji', 'Specialist i Kardiologjisë'],
  ['Neurologji', 'Specialist i Neurologjisë'],
  ['Hixhame', 'Njësia e Hixhames']
]);
/** Roles of the new app (src/auth/roles.ts, firestore.v2.rules). */
export const ROLES = [...DEFAULT_TITLES.keys()];
/** Roles the old app accepts in claims (VALID_ROLES in docs/firebase-sync.js). */
export const OLD_APP_ROLES = ROLES.filter(role => role !== 'Administrator');
const LAB_ROLES = ['Administrator', 'Laborator'];
const PROFILE_CLAIMS = ['role', 'name', 'title'];
const TOOL_AUTHOR = 'admin-tool';

export class UsageError extends Error {}

export function usage() {
  return `Usage:
  npm run users -- list
  npm run users -- set <email> --role <role> --name "<name>" [--title "<title>"]
  npm run users -- remove <email>
  npm run users -- migrate [--commit]

Commands:
  list     Show every Firebase Authentication user and whether it can use the app.
  set      Give an existing Firebase user its role, name, and title.
           Create the user and its password in the Firebase console first.
  remove   Take the role away and end the user's sessions. The Firebase user itself
           is kept; delete or disable it in the console if needed.
  migrate  Before cutover: create the Firestore profile of every user that has a role
           claim but no profile yet. Shows what it would do; --commit writes.

Options:
  --role <role>         One of: ${ROLES.join(', ')}.
  --name <name>         Shown in the app and printed on specialist reports.
  --title <title>       Defaults to the role's usual title.
  --project-id <id>     Defaults to the project in .firebaserc.
  --commit              With migrate: actually write.
  --help                Show this help.

Authentication uses Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS
or "gcloud auth application-default login"). The user must sign in again before a
change applies to the old app; the new app picks it up at once.`;
}

function readOptionValue(args, index, flag) {
  const inlinePrefix = `${flag}=`;
  if (args[index].startsWith(inlinePrefix)) {
    const value = args[index].slice(inlinePrefix.length);
    if (!value.trim()) throw new UsageError(`${flag} requires a value.`);
    return { value, nextIndex: index };
  }
  const value = args[index + 1];
  if (value === undefined || !value.trim() || value.startsWith('--')) throw new UsageError(`${flag} requires a value.`);
  return { value, nextIndex: index + 1 };
}

export function parseArgs(args) {
  const options = { command: '', email: '', role: '', name: '', title: '', projectId: '', commit: false, help: false };
  const positional = [];
  const valueFlags = { '--role': 'role', '--name': 'name', '--title': 'title', '--project-id': 'projectId' };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const flag = Object.keys(valueFlags).find(item => arg === item || arg.startsWith(`${item}=`));
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--commit') {
      options.commit = true;
    } else if (flag) {
      const parsed = readOptionValue(args, index, flag);
      options[valueFlags[flag]] = parsed.value.trim();
      index = parsed.nextIndex;
    } else if (arg.startsWith('--')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (options.help) return options;

  [options.command = '', options.email = ''] = positional;
  options.email = options.email.trim().toLowerCase();
  if (!['list', 'set', 'remove', 'migrate'].includes(options.command)) {
    throw new UsageError(options.command ? `Unknown command: ${options.command}` : 'A command is required: list, set, remove, or migrate.');
  }
  const takesEmail = ['set', 'remove'].includes(options.command);
  const expectedPositional = takesEmail ? 2 : 1;
  if (positional.length > expectedPositional) throw new UsageError(`Unexpected argument: ${positional[expectedPositional]}`);
  if (takesEmail && !/^[^\s@]+@[^\s@]+$/.test(options.email)) {
    throw new UsageError(`${options.command} requires the user's email address.`);
  }
  if (options.command !== 'set' && (options.role || options.name || options.title)) {
    throw new UsageError('--role, --name, and --title are only valid with set.');
  }
  if (options.commit && options.command !== 'migrate') throw new UsageError('--commit is only valid with migrate.');
  if (options.command === 'set') {
    if (!ROLES.includes(options.role)) throw new UsageError(`--role must be one of: ${ROLES.join(', ')}.`);
    if (!options.name) throw new UsageError('--name is required with set.');
  }
  return options;
}

/** The role the old app should see. */
export function claimRole(role) {
  return role === 'Administrator' ? 'Laborator' : role;
}

// Keeps any claims that are not part of the app profile.
export function profileClaims(existing, { role, name, title }) {
  return { ...(existing || {}), role: claimRole(role), name, title: title || DEFAULT_TITLES.get(role) };
}

export function claimsWithoutProfile(existing) {
  const claims = { ...(existing || {}) };
  for (const key of PROFILE_CLAIMS) delete claims[key];
  return claims;
}

/** A users/{email} document as firestore.v2.rules expects it. */
export function userDocument({ email, role, name, title, active = true }, now) {
  const lower = String(email).trim().toLowerCase();
  if (!ROLES.includes(role)) throw new UsageError(`Unknown role: ${role}`);
  if (!String(name || '').trim()) throw new UsageError(`${lower} has no name.`);
  const finalTitle = String(title || '').trim() || DEFAULT_TITLES.get(role);
  return { email: lower, role, name: String(name).trim(), title: finalTitle, active, updatedAt: now, updatedBy: TOOL_AUTHOR };
}

/** The profile an Auth user's claims describe, or null when they give no usable role. */
export function profileFromClaims(user) {
  const claims = user.customClaims || {};
  const name = String(claims.name || user.displayName || '').trim();
  if (!user.email || !OLD_APP_ROLES.includes(claims.role) || !name) return null;
  return { email: user.email.toLowerCase(), role: claims.role, name, title: String(claims.title || ''), active: !user.disabled };
}

// Mirrors the old app's sign-in checks (docs/firebase-sync.js signIn and docs/index.html login).
export function appAccess(user) {
  const claims = user.customClaims || {};
  if (user.disabled) return 'no (disabled)';
  if (!OLD_APP_ROLES.includes(claims.role)) return 'no (no role)';
  if (!String(claims.name || user.displayName || '')) return 'no (no name)';
  if (claims.role !== 'Laborator' && !String(claims.title || '')) return 'no (no title)';
  return 'yes';
}

// Mirrors the new app: an active users document with a known role.
export function newAppAccess(user, profile) {
  if (user.disabled) return 'no (disabled)';
  if (!profile) return 'no (no profile)';
  if (profile.active !== true) return 'no (deactivated)';
  if (!ROLES.includes(profile.role)) return 'no (no role)';
  return 'yes';
}

function defaultProjectId() {
  try {
    const config = JSON.parse(readFileSync(new URL('../../.firebaserc', import.meta.url), 'utf8'));
    return String(config?.projects?.default || '');
  } catch {
    return '';
  }
}

async function openAdmin(projectId) {
  let appModule;
  let authModule;
  let firestoreModule;
  try {
    [appModule, authModule, firestoreModule] = await Promise.all([
      import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore')
    ]);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new UsageError('firebase-admin is not installed. Run npm install in tools/firebase-import first.');
    }
    throw error;
  }
  const appOptions = { credential: appModule.applicationDefault() };
  if (projectId) appOptions.projectId = projectId;
  const app = appModule.initializeApp(appOptions, 'bioeng-users');
  return { auth: authModule.getAuth(app), db: firestoreModule.getFirestore(app), close: () => appModule.deleteApp(app) };
}

async function getUser(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      throw new UsageError(`No Firebase user has the email ${email}. Add it in the Firebase console under Authentication → Users first.`);
    }
    throw error;
  }
}

async function allUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function profiles(db) {
  const snapshot = await db.collection('users').get();
  return new Map(snapshot.docs.map(item => [item.id, item.data()]));
}

async function listUsers({ auth, db }) {
  const known = await profiles(db);
  const rows = (await allUsers(auth)).map(user => {
    const email = (user.email || '').toLowerCase();
    const profile = known.get(email);
    const claims = user.customClaims || {};
    return {
      email: user.email || `(no email, uid ${user.uid})`,
      'new app': newAppAccess(user, profile),
      'old app': appAccess(user),
      role: profile?.role || claims.role || '',
      name: profile?.name || claims.name || user.displayName || '',
      'last sign-in': user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString().slice(0, 16).replace('T', ' ') : 'never'
    };
  });
  rows.sort((a, b) => a.email.localeCompare(b.email));
  if (rows.length) console.table(rows);
  console.log(`${rows.length} Firebase user(s): ${rows.filter(row => row['new app'] === 'yes').length} can use the new app, ${rows.filter(row => row['old app'] === 'yes').length} the old one.`);
}

async function setUser({ auth, db }, options) {
  const user = await getUser(auth, options.email);
  const profile = userDocument({ ...options, active: true }, new Date().toISOString());
  await db.doc(`users/${profile.email}`).set(profile);
  await auth.setCustomUserClaims(user.uid, profileClaims(user.customClaims, profile));
  if (!user.displayName) await auth.updateUser(user.uid, { displayName: profile.name });
  console.log(`${profile.email}: role ${profile.role}, name "${profile.name}", title "${profile.title}".`);
  if (user.disabled) console.log('Warning: this user is disabled in Firebase and still cannot sign in. Enable it in the console.');
}

async function removeUser({ auth, db }, options) {
  const user = await getUser(auth, options.email);
  const ref = db.doc(`users/${options.email}`);
  const existing = await ref.get();
  if (existing.exists) await ref.update({ active: false, updatedAt: new Date().toISOString(), updatedBy: TOOL_AUTHOR });
  await auth.setCustomUserClaims(user.uid, claimsWithoutProfile(user.customClaims));
  await auth.revokeRefreshTokens(user.uid);
  console.log(`${options.email} can no longer use the app and its sessions were ended. The Firebase user was kept.`);
}

async function migrate({ auth, db }, options) {
  const known = await profiles(db);
  const now = new Date().toISOString();
  const planned = [];
  const skipped = [];
  for (const user of await allUsers(auth)) {
    const email = (user.email || '').toLowerCase();
    if (known.has(email)) continue;
    const fromClaims = profileFromClaims(user);
    if (!fromClaims) {
      if (email) skipped.push(email);
      continue;
    }
    try {
      planned.push(userDocument(fromClaims, now));
    } catch (error) {
      skipped.push(`${email} (${error.message})`);
    }
  }
  if (planned.length) console.table(planned.map(({ email, role, name, title, active }) => ({ email, role, name, title, active })));
  if (skipped.length) console.log(`No usable role claim, not migrated: ${skipped.join(', ')}`);
  if (!options.commit) {
    console.log(`${planned.length} profile(s) would be created. Nothing written; run again with --commit.`);
    return;
  }
  for (const profile of planned) await db.doc(`users/${profile.email}`).create(profile);
  console.log(`${planned.length} profile(s) created. Make yourself Administrator with: npm run users -- set <your email> --role Administrator --name "<name>"`);
}

function safeErrorMessage(error) {
  if (error instanceof UsageError) return error.message;
  const code = typeof error.code === 'string' ? ` (${error.code})` : '';
  const hint = /credential|default credentials/i.test(String(error.message))
    ? ' Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key, or run "gcloud auth application-default login".'
    : '';
  return `Firebase operation failed${code}.${hint}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const projectId = options.projectId || defaultProjectId();
  const admin = await openAdmin(projectId);
  try {
    console.log(`Project: ${projectId || '(from credentials)'}`);
    if (options.command === 'list') await listUsers(admin);
    if (options.command === 'set') await setUser(admin, options);
    if (options.command === 'remove') await removeUser(admin, options);
    if (options.command === 'migrate') await migrate(admin, options);
  } finally {
    await admin.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Failed: ${safeErrorMessage(error)}`);
    if (error instanceof UsageError) console.error('\nRun with --help for usage.');
    process.exitCode = 1;
  });
}
