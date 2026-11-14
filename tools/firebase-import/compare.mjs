#!/usr/bin/env node
// Compares a Bioeng backup file with the records in Firestore. Read-only: it never writes,
// updates or deletes anything, in Firestore or on disk.

import { readFileSync } from 'node:fs';
import process from 'node:process';

const COLLECTIONS = ['patients', 'reports', 'appointments', 'payments', 'audit'];
// Collections whose individual records are listed; audit only grows, so counts are enough.
const LISTED = new Set(['patients', 'reports', 'appointments', 'payments']);
// Values are shown for these when names are on; report bodies are too long to print.
const SHOW_VALUES = new Set(['patients', 'appointments', 'payments']);

class UsageError extends Error {}

function usage() {
  return `Usage:
  node compare.mjs <backup.json> [options]

Compares the backup with Firestore and prints what differs. Nothing is written.

Options:
  --project-id <id>   Defaults to the project in .firebaserc.
  --no-names          Print record ids and dates only, without patient names or values
                      (for output you want to share).
  --help              Show this help.

Authentication uses Application Default Credentials, for example:
  export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/firebase-admin.json`;
}

function parseArgs(argv) {
  const options = { backupPath: '', projectId: '', names: true, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--no-names') options.names = false;
    else if (arg === '--project-id') {
      options.projectId = argv[index + 1] || '';
      index += 1;
      if (!options.projectId || options.projectId.startsWith('--')) throw new UsageError('--project-id requires a value.');
    } else if (arg.startsWith('--project-id=')) options.projectId = arg.slice('--project-id='.length);
    else if (arg.startsWith('--')) throw new UsageError(`Unknown option: ${arg}`);
    else if (!options.backupPath) options.backupPath = arg;
    else throw new UsageError('Only one backup file may be given.');
  }
  if (!options.help && !options.backupPath) throw new UsageError('A backup JSON file is required.');
  return options;
}

function defaultProjectId() {
  try {
    const config = JSON.parse(readFileSync(new URL('../../.firebaserc', import.meta.url), 'utf8'));
    return String(config?.projects?.default || '');
  } catch {
    return '';
  }
}

function readBackup(path) {
  let backup;
  try {
    backup = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`The backup could not be read (${error.code || 'not valid JSON'}).`);
  }
  if (backup?.format !== 'bioeng-clinical-backup' || Number(backup?.version) !== 2) {
    throw new UsageError('The file is not a Bioeng backup (format bioeng-clinical-backup, version 2).');
  }
  for (const name of COLLECTIONS) {
    if (!Array.isArray(backup[name])) throw new UsageError(`The backup has no ${name} section.`);
  }
  return backup;
}

const isEmpty = value => value === null || value === undefined || value === '';

// Firestore keeps a missing value as null while the backup leaves it out or has ''; all
// three count as "no value".
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (!isEmpty(value[key])) out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

function differingFields(backupRecord, liveRecord) {
  const a = normalize(backupRecord);
  const b = normalize(liveRecord);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete('id');
  return [...keys].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();
}

function compareCollection(name, backupRecords, liveDocs) {
  const backup = new Map(backupRecords.filter(record => record._deleted !== true).map(record => [String(record.id), record]));
  const live = new Map();
  const deletedLive = new Set();
  for (const doc of liveDocs) {
    const data = doc.data();
    if (data._deleted === true) deletedLive.add(doc.id);
    else live.set(doc.id, data);
  }

  const result = {
    name, backup, live,
    same: 0, onlyBackup: [], deletedLive: [], onlyLive: [], liveNewer: [], backupNewer: [], different: []
  };
  for (const [id, record] of backup) {
    const current = live.get(id);
    if (!current) {
      (deletedLive.has(id) ? result.deletedLive : result.onlyBackup).push(id);
      continue;
    }
    const fields = differingFields(record, current);
    if (!fields.length) {
      result.same += 1;
      continue;
    }
    const entry = { id, fields };
    const liveRevision = Number(current.revision);
    const backupRevision = Number(record.revision);
    if (name === 'reports' && liveRevision > backupRevision) result.liveNewer.push(entry);
    else if (name === 'reports' && backupRevision > liveRevision) result.backupNewer.push(entry);
    else result.different.push(entry);
  }
  for (const id of live.keys()) if (!backup.has(id)) result.onlyLive.push(id);
  return result;
}

function text(value, max = 60) {
  if (isEmpty(value)) return '(empty)';
  const string = typeof value === 'string' ? value : JSON.stringify(value);
  return string.length > max ? `${string.slice(0, max - 1)}…` : string;
}

function makeDescriber(options, results) {
  const patientName = id => {
    const patient = results.patients.live.get(id) || results.patients.backup.get(id);
    if (!patient) return 'unknown patient';
    return `${patient.lastName || ''} ${patient.firstName || ''}`.trim() || 'unnamed patient';
  };
  const day = value => String(value || '').slice(0, 10) || 'no date';

  return (name, record) => {
    const who = options.names ? patientName(record.patientId) : '';
    switch (name) {
      case 'patients':
        return options.names
          ? `${patientName(record.id)}, born ${record.dob || '?'}, added ${day(record.createdAt)}`
          : `added ${day(record.createdAt)}`;
      case 'reports':
        return [record.specialty || record.type, day(record.reportAt || record.createdAt), `revision ${record.revision ?? '?'}`, who]
          .filter(Boolean).join(', ');
      case 'appointments':
        return [record.specialty, day(record.appointmentAt), record.status, who].filter(Boolean).join(', ');
      case 'payments':
        return [`${record.amount ?? '?'} €`, day(record.paymentDate || record.recordedAt), record.status, who].filter(Boolean).join(', ');
      default:
        return day(record.at || record.createdAt);
    }
  };
}

function printList(title, ids, lookup, describe, name, extra) {
  if (!ids.length) return;
  console.log(`\n  ${title} (${ids.length}):`);
  for (const id of ids) {
    const record = lookup(id);
    console.log(`    ${id}  ${record ? describe(name, record) : ''}${extra ? extra(id) : ''}`);
  }
}

function printChanged(title, entries, result, describe, options) {
  if (!entries.length) return;
  console.log(`\n  ${title} (${entries.length}):`);
  for (const { id, fields } of entries) {
    console.log(`    ${id}  ${describe(result.name, result.live.get(id))}`);
    if (options.names && SHOW_VALUES.has(result.name)) {
      for (const field of fields) {
        console.log(`        ${field}: backup ${text(result.backup.get(id)[field])}  →  live ${text(result.live.get(id)[field])}`);
      }
    } else {
      console.log(`        fields: ${fields.join(', ')}`);
      if (fields.includes('revision')) {
        console.log(`        revision: backup ${result.backup.get(id).revision}  →  live ${result.live.get(id).revision}`);
      }
    }
  }
}

async function openFirestore(projectId) {
  let appModule;
  let firestoreModule;
  try {
    [appModule, firestoreModule] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new UsageError('firebase-admin is not installed. Run npm install in tools/firebase-import first.');
    }
    throw error;
  }
  const appOptions = { credential: appModule.applicationDefault() };
  if (projectId) appOptions.projectId = projectId;
  const app = appModule.initializeApp(appOptions, 'bioeng-compare');
  return { db: firestoreModule.getFirestore(app), close: () => appModule.deleteApp(app) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const backup = readBackup(options.backupPath);
  const projectId = options.projectId || defaultProjectId();
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  console.log(`Backup:    ${options.backupPath} (exported ${backup.createdAt || 'unknown'})`);
  console.log(`Firestore: ${emulator ? `emulator at ${emulator}` : 'LIVE'}, project ${projectId || '(from credentials)'} (read only)`);

  const firestore = await openFirestore(projectId);
  const results = {};
  try {
    for (const name of COLLECTIONS) {
      const snapshot = await firestore.db.collection(name).get();
      results[name] = compareCollection(name, backup[name], snapshot.docs);
    }
  } catch (error) {
    if (/default credentials/i.test(String(error?.message))) {
      throw new UsageError('No Firebase credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key (see README).');
    }
    throw error;
  } finally {
    await firestore.close();
  }

  console.log('\n                  backup    live    same  only in backup  only live  differ');
  for (const name of COLLECTIONS) {
    const r = results[name];
    const differ = r.different.length + r.liveNewer.length + r.backupNewer.length;
    const onlyBackup = r.onlyBackup.length + r.deletedLive.length;
    console.log(`  ${name.padEnd(14)}${String(r.backup.size).padStart(8)}${String(r.live.size).padStart(8)}${String(r.same).padStart(8)}`
      + `${String(onlyBackup).padStart(16)}${String(r.onlyLive.length).padStart(11)}${String(differ).padStart(8)}`);
  }

  const describe = makeDescriber(options, results);
  const exported = String(backup.createdAt || '');
  for (const name of COLLECTIONS) {
    const r = results[name];
    if (!LISTED.has(name)) continue;
    const hasDetails = r.onlyBackup.length || r.deletedLive.length || r.onlyLive.length
      || r.different.length || r.liveNewer.length || r.backupNewer.length;
    if (!hasDetails) continue;
    console.log(`\n── ${name} ──`);
    printList('MISSING from live (only in the backup)', r.onlyBackup, id => r.backup.get(id), describe, name);
    printList('Deleted in live, still in the backup (leave deleted)', r.deletedLive, id => r.backup.get(id), describe, name);
    printChanged('Backup is NEWER than live', r.backupNewer, r, describe, options);
    printChanged('Different in backup and live', r.different, r, describe, options);
    printChanged('Live is newer (normal: changed after the backup)', r.liveNewer, r, describe, options);
    printList('Only in live', r.onlyLive, id => r.live.get(id), describe, name, id => {
      const created = String(r.live.get(id).createdAt || r.live.get(id).recordedAt || '');
      return created && exported && created < exported ? '  ← older than the backup' : '';
    });
  }

  const needsAttention = COLLECTIONS.some(name => results[name].onlyBackup.length
    || results[name].backupNewer.length || results[name].different.length);
  console.log(needsAttention
    ? '\nSome backup records are missing from live or differ from it: see MISSING / NEWER / Different above.'
    : '\nNothing in the backup is missing from live Firestore or newer than it.');
}

main().catch(error => {
  console.error(error instanceof UsageError ? `Error: ${error.message}` : error);
  if (error instanceof UsageError) console.error(`\n${usage()}`);
  process.exitCode = 1;
});
