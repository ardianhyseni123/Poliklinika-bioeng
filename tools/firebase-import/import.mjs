#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

const BACKUP_FORMAT = 'bioeng-clinical-backup';
const BACKUP_VERSION = 2;
const ACCOUNTS_FORMAT = 'bioeng-firebase-accounts';
const ACCOUNTS_VERSION = 1;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_SAFE_DOCUMENT_BYTES = 900 * 1024;
const FIRESTORE_BATCH_SIZE = 400;
const IMPORT_COLLECTION = '_bioeng_imports';
const IMPORT_MARKER_ID = 'bioeng-clinical-backup-v2';
const DATA_COLLECTIONS = ['patients', 'reports', 'appointments', 'payments', 'audit'];
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg'
]);
const EXPECTED_ACCOUNT_ROLES = new Map([
  ['admin@bioeng.com', 'Laborator'],
  ['pulmolog@bioeng.com', 'Pulmologji'],
  ['kardiolog@bioeng.com', 'Kardiologji'],
  ['neurolog@bioeng.com', 'Neurologji'],
  ['hixhama@bioeng.com', 'Hixhame']
]);
const ALLOWED_ROLES = new Set(EXPECTED_ACCOUNT_ROLES.values());
const SPECIALIST_ROLES = new Set([...ALLOWED_ROLES].filter(role => role !== 'Laborator'));

class UsageError extends Error {}
class ValidationError extends Error {}
class AlreadyImportedError extends Error {}

function usage() {
  return `Usage:
  node import.mjs <backup.json> [options]

Options:
  --commit              Write to Firebase. Without this flag, validation is read-only.
  --force               Allow a committed import marker to be replaced and data upserted.
  --project-id <id>     Override the project inferred from Application Default Credentials.
  --accounts <file>     Optionally create/update Auth users and custom claims.
  --help                Show this help.

Attachments in the backup are validated but never uploaded: they belong to the
local database of the browser that saved them.

Authentication uses Application Default Credentials. No service-account key is read
from the backup or accounts file.`;
}

function readOptionValue(args, index, flag) {
  const inlinePrefix = `${flag}=`;
  if (args[index].startsWith(inlinePrefix)) {
    const value = args[index].slice(inlinePrefix.length);
    if (!value) throw new UsageError(`${flag} requires a value.`);
    return { value, nextIndex: index };
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new UsageError(`${flag} requires a value.`);
  return { value, nextIndex: index + 1 };
}

function parseArgs(args) {
  const options = {
    backupPath: '',
    accountsPath: '',
    projectId: '',
    commit: false,
    force: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--commit') {
      options.commit = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--project-id' || arg.startsWith('--project-id=')) {
      const parsed = readOptionValue(args, index, '--project-id');
      options.projectId = parsed.value;
      index = parsed.nextIndex;
    } else if (arg === '--accounts' || arg.startsWith('--accounts=')) {
      const parsed = readOptionValue(args, index, '--accounts');
      options.accountsPath = parsed.value;
      index = parsed.nextIndex;
    } else if (arg.startsWith('--')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (!options.backupPath) {
      options.backupPath = arg;
    } else {
      throw new UsageError('Only one backup JSON file may be supplied.');
    }
  }

  if (!options.help && !options.backupPath) throw new UsageError('A backup JSON file is required.');
  if (options.force && !options.commit) throw new UsageError('--force is only valid with --commit.');
  return options;
}

async function readJson(path, label) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new UsageError(`${label} could not be read (${error.code || 'read error'}).`);
  }

  try {
    return { value: JSON.parse(bytes.toString('utf8')), bytes };
  } catch {
    throw new ValidationError(`${label} is not valid JSON.`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDateString(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isValidDocumentId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class Validator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(location, message) {
    if (this.errors.length < 100) this.errors.push(`${location}: ${message}`);
  }

  warning(message) {
    this.warnings.push(message);
  }

  require(condition, location, message) {
    if (!condition) this.error(location, message);
    return condition;
  }

  finish(label) {
    if (!this.errors.length) return;
    const shown = this.errors.slice(0, 20).map(item => `  - ${item}`).join('\n');
    const remaining = this.errors.length > 20 ? `\n  - and ${this.errors.length - 20} more error(s)` : '';
    throw new ValidationError(`${label} validation failed:\n${shown}${remaining}`);
  }
}

function validateDocumentSize(record, location, validator) {
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
  validator.require(
    bytes <= MAX_SAFE_DOCUMENT_BYTES,
    location,
    `estimated document size exceeds ${MAX_SAFE_DOCUMENT_BYTES} bytes`
  );
}

function validateId(record, location, validator) {
  validator.require(isPlainObject(record), location, 'record must be an object');
  if (!isPlainObject(record)) return false;
  return validator.require(isValidDocumentId(record.id), `${location}.id`, 'invalid Firestore document ID');
}

function validateStringArray(value, location, validator) {
  if (!validator.require(Array.isArray(value), location, 'must be an array')) return;
  value.forEach((item, index) => {
    validator.require(typeof item === 'string', `${location}[${index}]`, 'must be a string');
  });
}

function validateRequiredStringFields(record, keys, location, validator) {
  for (const key of keys) {
    validator.require(typeof record[key] === 'string', `${location}.${key}`, 'must be a string');
  }
}

function validatePatients(records, validator) {
  records.forEach((record, index) => {
    const location = `patients[${index}]`;
    if (!validateId(record, location, validator)) return;
    validator.require(isNonEmptyString(record.firstName), `${location}.firstName`, 'must be a non-empty string');
    validator.require(isNonEmptyString(record.lastName), `${location}.lastName`, 'must be a non-empty string');
    validateRequiredStringFields(record, ['dob', 'gender', 'phone', 'address'], location, validator);
    validator.require(isDateString(record.createdAt), `${location}.createdAt`, 'must be a date string');
    validator.require(typeof record.archived === 'boolean', `${location}.archived`, 'must be boolean');
    if (record.archivedAt !== undefined) validator.require(typeof record.archivedAt === 'string', `${location}.archivedAt`, 'must be a string');
    validateDocumentSize(record, location, validator);
  });
}

function validateReports(records, validator) {
  records.forEach((record, index) => {
    const location = `reports[${index}]`;
    if (!validateId(record, location, validator)) return;
    validator.require(isValidDocumentId(record.patientId), `${location}.patientId`, 'invalid patient reference');
    const typeIsValid = validator.require(
      record.type === 'laboratory' || record.type === 'specialist',
      `${location}.type`,
      'unsupported report type'
    );
    if (typeIsValid && record.type === 'laboratory') {
      validator.require(
        record.specialty === 'Laborator',
        `${location}.specialty`,
        'laboratory reports must use specialty Laborator'
      );
    } else if (typeIsValid) {
      validator.require(
        SPECIALIST_ROLES.has(record.specialty),
        `${location}.specialty`,
        'specialist reports must use Pulmologji, Kardiologji, Neurologji, or Hixhame'
      );
    }
    validator.require(isDateString(record.reportAt), `${location}.reportAt`, 'must be a date string');
    validateRequiredStringFields(record, [
      'clinician',
      'clinicianTitle',
      'anamnesis',
      'physicalExam',
      'existingResults',
      'customDiagnoses',
      'therapy',
      'notes'
    ], location, validator);
    validateStringArray(record.diagnoses, `${location}.diagnoses`, validator);
    validateStringArray(record.requestedExams, `${location}.requestedExams`, validator);
    validator.require(isDateString(record.createdAt), `${location}.createdAt`, 'must be a date string');
    validator.require(isDateString(record.updatedAt), `${location}.updatedAt`, 'must be a date string');
    validator.require(Number.isInteger(record.revision) && record.revision >= 1, `${location}.revision`, 'must be a positive integer');
    if (validator.require(Array.isArray(record.analyses), `${location}.analyses`, 'must be an array')) {
      record.analyses.forEach((analysis, analysisIndex) => {
        const analysisLocation = `${location}.analyses[${analysisIndex}]`;
        if (!validator.require(isPlainObject(analysis), analysisLocation, 'must be an object')) return;
        for (const key of ['parameter', 'result', 'unit', 'reference']) {
          validator.require(typeof analysis[key] === 'string', `${analysisLocation}.${key}`, 'must be a string');
        }
        if (analysis.category !== undefined) {
          validator.require(typeof analysis.category === 'string', `${analysisLocation}.category`, 'must be a string');
        }
      });
    }
    validator.require(record.hixhame === null || isPlainObject(record.hixhame), `${location}.hixhame`, 'must be null or an object');
    if (record.hixhame !== null && isPlainObject(record.hixhame)) {
      if (validator.require(isPlainObject(record.hixhame), `${location}.hixhame`, 'must be null or an object')) {
        validateStringArray(record.hixhame.services, `${location}.hixhame.services`, validator);
        validateStringArray(record.hixhame.cupPositions, `${location}.hixhame.cupPositions`, validator);
        validateStringArray(record.hixhame.leechPositions, `${location}.hixhame.leechPositions`, validator);
        validateRequiredStringFields(record.hixhame, ['cups', 'leeches'], `${location}.hixhame`, validator);
      }
    }
    validator.require(record._deleted === undefined, `${location}._deleted`, 'active backup reports cannot be tombstones');
    validator.require(record.deletedAt === undefined, `${location}.deletedAt`, 'active backup reports cannot contain deletion metadata');
    validator.require(record.deletedBy === undefined, `${location}.deletedBy`, 'active backup reports cannot contain deletion metadata');
    validateDocumentSize(record, location, validator);
  });
}

function validateAppointments(records, validator) {
  records.forEach((record, index) => {
    const location = `appointments[${index}]`;
    if (!validateId(record, location, validator)) return;
    validator.require(isValidDocumentId(record.patientId), `${location}.patientId`, 'invalid patient reference');
    validator.require(isDateString(record.appointmentAt), `${location}.appointmentAt`, 'must be a date string');
    validator.require(['Caktuar', 'Përfunduar', 'Anuluar', "S'u paraqit"].includes(record.status), `${location}.status`, 'unsupported appointment status');
    validator.require(ALLOWED_ROLES.has(record.specialty), `${location}.specialty`, 'unsupported appointment specialty');
    validateRequiredStringFields(record, ['patientName', 'clinician', 'phone', 'note'], location, validator);
    validator.require(isDateString(record.createdAt), `${location}.createdAt`, 'must be a date string');
    if (record.expired !== undefined) validator.require(typeof record.expired === 'boolean', `${location}.expired`, 'must be boolean');
    for (const key of ['expiredAt', 'updatedAt']) {
      if (record[key] !== undefined) validator.require(typeof record[key] === 'string', `${location}.${key}`, 'must be a string');
    }
    validateDocumentSize(record, location, validator);
  });
}

function validateOptionalMoney(value, location, validator) {
  if (value === undefined || value === null) return;
  validator.require(Number.isFinite(value) && value >= 0, location, 'must be a non-negative finite number');
}

function validatePayments(records, validator) {
  records.forEach((record, index) => {
    const location = `payments[${index}]`;
    if (!validateId(record, location, validator)) return;
    validator.require(isValidDocumentId(record.patientId), `${location}.patientId`, 'invalid patient reference');
    if (record.reportId !== undefined && record.reportId !== null && record.reportId !== '') {
      validator.require(isValidDocumentId(record.reportId), `${location}.reportId`, 'invalid report reference');
    }
    validator.require(record.status === 'PAID' || record.status === 'UNPAID', `${location}.status`, 'unsupported payment status');
    validator.require(Number.isFinite(record.amount) && record.amount >= 0, `${location}.amount`, 'must be a non-negative finite number');
    validateRequiredStringFields(record, ['patientName', 'paymentDate', 'note', 'recordedAt', 'recordedBy'], location, validator);
    validator.require(isDateString(record.recordedAt), `${location}.recordedAt`, 'must be a date string');
    if (record.reportLabel !== undefined) validator.require(typeof record.reportLabel === 'string', `${location}.reportLabel`, 'must be a string');
    validateOptionalMoney(record.reportTotal, `${location}.reportTotal`, validator);
    validateDocumentSize(record, location, validator);
  });
}

function validateAudit(records, validator) {
  records.forEach((record, index) => {
    const location = `audit[${index}]`;
    if (!validateId(record, location, validator)) return;
    validator.require(isValidDocumentId(record.patientId), `${location}.patientId`, 'invalid patient reference');
    validator.require(isValidDocumentId(record.reportId), `${location}.reportId`, 'invalid report reference');
    validator.require(
      ['REPORT_CREATED', 'REPORT_UPDATED', 'REPORT_DELETED'].includes(record.action),
      `${location}.action`,
      'unsupported audit action'
    );
    validator.require(isDateString(record.at), `${location}.at`, 'must be a date string');
    validator.require(Number.isInteger(record.revision) && record.revision >= 1, `${location}.revision`, 'must be a positive integer');
    validateDocumentSize(record, location, validator);
  });
}

// Attachments are never uploaded; they are still decoded so a corrupted backup
// is reported here instead of failing silently on the device that restores it.
function validateAttachmentPayload(record, location, validator) {
  if (!validator.require(isNonEmptyString(record.data), `${location}.data`, 'must be a base64 data URL')) return;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(record.data);
  if (!validator.require(Boolean(match), `${location}.data`, 'must be a strict base64 data URL')) return;
  if (!validator.require(match[2].length % 4 === 0, `${location}.data`, 'base64 payload has invalid length')) return;

  const mime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  validator.require(ALLOWED_ATTACHMENT_TYPES.has(mime), `${location}.data`, 'unsupported attachment MIME type');
  validator.require(record.type.toLowerCase() === mime, `${location}.type`, 'does not match data URL MIME type');
  validator.require(bytes.length === record.size, `${location}.size`, 'does not match decoded attachment size');
}

function validateAttachments(records, validator) {
  records.forEach((record, index) => {
    const location = `attachments[${index}]`;
    if (!validateId(record, location, validator)) return;
    validator.require(isValidDocumentId(record.reportId), `${location}.reportId`, 'invalid report reference');
    validator.require(isNonEmptyString(record.name), `${location}.name`, 'must be a non-empty string');
    validator.require(isNonEmptyString(record.type), `${location}.type`, 'must be a non-empty string');
    if (!isNonEmptyString(record.type)) return;
    const sizeIsValid = validator.require(
      Number.isInteger(record.size) && record.size >= 0 && record.size <= MAX_ATTACHMENT_BYTES,
      `${location}.size`,
      `must be an integer from 0 through ${MAX_ATTACHMENT_BYTES}`
    );
    if (record.uploadedAt !== undefined) {
      validator.require(isDateString(record.uploadedAt), `${location}.uploadedAt`, 'must be a date string');
    }
    if (!sizeIsValid) return;
    validateAttachmentPayload(record, location, validator);
  });
}

function findDuplicates(records) {
  const seen = new Set();
  let duplicates = 0;
  for (const record of records) {
    if (!isPlainObject(record) || typeof record.id !== 'string') continue;
    if (seen.has(record.id)) duplicates += 1;
    seen.add(record.id);
  }
  return duplicates;
}

function validIdSet(records) {
  return new Set(
    records
      .filter(record => isPlainObject(record) && isValidDocumentId(record.id))
      .map(record => record.id)
  );
}

function validateBackup(backup) {
  const validator = new Validator();
  if (!validator.require(isPlainObject(backup), 'backup', 'must be an object')) validator.finish('Backup');
  validator.require(backup.format === BACKUP_FORMAT, 'backup.format', `must equal ${BACKUP_FORMAT}`);
  validator.require(backup.version === BACKUP_VERSION, 'backup.version', `must equal ${BACKUP_VERSION}`);
  validator.require(isDateString(backup.createdAt), 'backup.createdAt', 'must be a date string');

  for (const name of [...DATA_COLLECTIONS, 'attachments']) {
    validator.require(Array.isArray(backup[name]), `backup.${name}`, 'must be an array');
  }
  validator.finish('Backup');

  for (const name of [...DATA_COLLECTIONS, 'attachments']) {
    const duplicateCount = findDuplicates(backup[name]);
    validator.require(duplicateCount === 0, `backup.${name}`, `contains ${duplicateCount} duplicate ID(s)`);
  }

  validatePatients(backup.patients, validator);
  validateReports(backup.reports, validator);
  validateAppointments(backup.appointments, validator);
  validatePayments(backup.payments, validator);
  validateAudit(backup.audit, validator);
  validateAttachments(backup.attachments, validator);

  const patientIds = validIdSet(backup.patients);
  const reportIds = validIdSet(backup.reports);
  const missingReferences = {
    reportPatients: backup.reports.filter(record => isPlainObject(record) && isValidDocumentId(record.patientId) && !patientIds.has(record.patientId)).length,
    appointmentPatients: backup.appointments.filter(record => isPlainObject(record) && isValidDocumentId(record.patientId) && !patientIds.has(record.patientId)).length,
    paymentPatients: backup.payments.filter(record => isPlainObject(record) && isValidDocumentId(record.patientId) && !patientIds.has(record.patientId)).length,
    paymentReports: backup.payments.filter(record => isPlainObject(record) && isValidDocumentId(record.reportId) && !reportIds.has(record.reportId)).length,
    auditPatients: backup.audit.filter(record => isPlainObject(record) && isValidDocumentId(record.patientId) && !patientIds.has(record.patientId)).length,
    auditReports: backup.audit.filter(record => isPlainObject(record) && isValidDocumentId(record.reportId) && !reportIds.has(record.reportId)).length,
    attachmentReports: backup.attachments.filter(record => isPlainObject(record) && isValidDocumentId(record.reportId) && !reportIds.has(record.reportId)).length
  };

  validator.require(missingReferences.reportPatients === 0, 'backup.reports', 'contains missing patient references');
  validator.require(missingReferences.appointmentPatients === 0, 'backup.appointments', 'contains missing patient references');
  validator.require(missingReferences.paymentPatients === 0, 'backup.payments', 'contains missing patient references');
  validator.require(missingReferences.auditPatients === 0, 'backup.audit', 'contains missing patient references');
  validator.require(missingReferences.attachmentReports === 0, 'backup.attachments', 'contains missing report references');

  if (missingReferences.paymentReports) {
    validator.warning(`${missingReferences.paymentReports} payment record(s) reference missing historical reports; they will be preserved.`);
  }
  if (missingReferences.auditReports) {
    validator.warning(`${missingReferences.auditReports} audit record(s) reference deleted or missing reports; they will be preserved.`);
  }

  const legacyPayments = backup.payments.filter(record => isPlainObject(record) && !record.reportId).length;
  if (legacyPayments) {
    validator.warning(`${legacyPayments} legacy payment record(s) have no report reference; they will be preserved.`);
  }

  if (backup.attachments.length) {
    validator.warning(`${backup.attachments.length} attachment(s) are validated but not imported; attachments live only in the local database of the browser that saved them.`);
  }

  validator.finish('Backup');
  return {
    backup,
    warnings: validator.warnings,
    counts: Object.fromEntries([...DATA_COLLECTIONS, 'attachments'].map(name => [name, backup[name].length]))
  };
}

function validateAccounts(accountsFile, requirePasswords) {
  const validator = new Validator();
  if (!validator.require(isPlainObject(accountsFile), 'accounts', 'must be an object')) validator.finish('Accounts');
  validator.require(accountsFile.format === ACCOUNTS_FORMAT, 'accounts.format', `must equal ${ACCOUNTS_FORMAT}`);
  validator.require(accountsFile.version === ACCOUNTS_VERSION, 'accounts.version', `must equal ${ACCOUNTS_VERSION}`);
  if (!validator.require(Array.isArray(accountsFile.accounts), 'accounts.accounts', 'must be an array')) validator.finish('Accounts');
  validator.require(
    accountsFile.accounts.length === EXPECTED_ACCOUNT_ROLES.size,
    'accounts.accounts',
    `must contain exactly the ${EXPECTED_ACCOUNT_ROLES.size} Bioeng app accounts`
  );

  const seenEmails = new Set();
  let missingPasswordEnvironmentVariables = 0;
  accountsFile.accounts.forEach((account, index) => {
    const location = `accounts.accounts[${index}]`;
    if (!validator.require(isPlainObject(account), location, 'must be an object')) return;
    validator.require(isNonEmptyString(account.email) && account.email.includes('@'), `${location}.email`, 'must be an email address');
    if (isNonEmptyString(account.email)) {
      const normalized = account.email.trim().toLowerCase();
      validator.require(!seenEmails.has(normalized), `${location}.email`, 'must be unique');
      seenEmails.add(normalized);
      validator.require(
        EXPECTED_ACCOUNT_ROLES.has(normalized),
        `${location}.email`,
        'is not one of the five Bioeng app account emails'
      );
    }
    validator.require(!Object.hasOwn(account, 'password'), `${location}.password`, 'plaintext passwords are not accepted; use passwordEnv');
    validator.require(/^[A-Z_][A-Z0-9_]*$/.test(account.passwordEnv || ''), `${location}.passwordEnv`, 'must name an environment variable');
    validator.require(isNonEmptyString(account.displayName), `${location}.displayName`, 'must be a non-empty string');
    if (account.disabled !== undefined) {
      validator.require(typeof account.disabled === 'boolean', `${location}.disabled`, 'must be boolean');
    }
    if (!validator.require(isPlainObject(account.claims), `${location}.claims`, 'must be an object')) return;
    const normalizedEmail = isNonEmptyString(account.email) ? account.email.trim().toLowerCase() : '';
    const expectedRole = EXPECTED_ACCOUNT_ROLES.get(normalizedEmail);
    validator.require(
      expectedRole !== undefined && account.claims.role === expectedRole,
      `${location}.claims.role`,
      expectedRole ? `must equal ${expectedRole} for ${normalizedEmail}` : 'email has no permitted Bioeng role mapping'
    );
    validator.require(isNonEmptyString(account.claims.name), `${location}.claims.name`, 'must be a non-empty string');
    validator.require(isNonEmptyString(account.claims.title), `${location}.claims.title`, 'must be a non-empty string');
    validator.require(Buffer.byteLength(JSON.stringify(account.claims), 'utf8') <= 900, `${location}.claims`, 'custom claims are too large');

    const password = process.env[account.passwordEnv];
    if (!password) {
      missingPasswordEnvironmentVariables += 1;
      if (requirePasswords) validator.error(`${location}.passwordEnv`, 'referenced environment variable is not set');
    } else {
      validator.require(password.length >= 6, `${location}.passwordEnv`, 'referenced password must contain at least 6 characters');
    }
  });

  for (const expectedEmail of EXPECTED_ACCOUNT_ROLES.keys()) {
    validator.require(
      seenEmails.has(expectedEmail),
      'accounts.accounts',
      `missing required account ${expectedEmail}`
    );
  }

  validator.finish('Accounts');
  return {
    accounts: accountsFile.accounts,
    missingPasswordEnvironmentVariables
  };
}

function printSummary(validated, accounts) {
  console.log('Validation passed.');
  for (const name of DATA_COLLECTIONS) {
    console.log(`  ${name}: ${validated.counts[name]}`);
  }
  console.log(`  attachments (validated, not imported): ${validated.counts.attachments}`);
  if (accounts) {
    console.log(`  auth accounts: ${accounts.accounts.length}`);
    if (accounts.missingPasswordEnvironmentVariables) {
      console.log(`  account password variables not set: ${accounts.missingPasswordEnvironmentVariables}`);
    }
  }
  for (const warning of validated.warnings) console.warn(`Warning: ${warning}`);
}

async function loadFirebaseAdmin() {
  try {
    const [appModule, firestoreModule, authModule] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
      import('firebase-admin/auth')
    ]);
    return { appModule, firestoreModule, authModule };
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new UsageError('firebase-admin is not installed. Run npm install in tools/firebase-import first.');
    }
    throw error;
  }
}

async function reserveImportMarker(db, markerData, force) {
  const markerRef = db.collection(IMPORT_COLLECTION).doc(IMPORT_MARKER_ID);
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(markerRef);
    if (existing.exists && !force) {
      throw new AlreadyImportedError('This backup format already has an import marker. Use --force only after verifying the existing import.');
    }
    const priorAttempts = existing.exists && Number.isInteger(existing.data().attempts)
      ? existing.data().attempts
      : 0;
    transaction.set(markerRef, {
      ...markerData,
      status: 'running',
      startedAt: new Date().toISOString(),
      attempts: priorAttempts + 1
    });
  });
  return markerRef;
}

async function writeCollection(db, name, records) {
  for (let offset = 0; offset < records.length; offset += FIRESTORE_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = records.slice(offset, offset + FIRESTORE_BATCH_SIZE);
    for (const record of chunk) batch.set(db.collection(name).doc(record.id), record);
    await batch.commit();
  }
  console.log(`Imported ${name}: ${records.length}`);
}

async function configureAccounts(auth, accounts) {
  if (!accounts) return { created: 0, updated: 0 };
  let created = 0;
  let updated = 0;

  for (const account of accounts.accounts) {
    const email = account.email.trim().toLowerCase();
    const password = process.env[account.passwordEnv];
    let user;
    try {
      user = await auth.getUserByEmail(email);
      user = await auth.updateUser(user.uid, {
        password,
        displayName: account.displayName,
        disabled: account.disabled === true
      });
      updated += 1;
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      user = await auth.createUser({
        email,
        password,
        displayName: account.displayName,
        disabled: account.disabled === true
      });
      created += 1;
    }
    await auth.setCustomUserClaims(user.uid, { ...account.claims });
  }

  console.log(`Configured auth accounts: ${accounts.accounts.length} (${created} created, ${updated} updated)`);
  return { created, updated };
}

async function commitImport(options, validated, accounts, backupHash) {
  const { appModule, firestoreModule, authModule } = await loadFirebaseAdmin();
  const appOptions = { credential: appModule.applicationDefault() };
  if (options.projectId) appOptions.projectId = options.projectId;

  const app = appModule.initializeApp(appOptions);
  const db = firestoreModule.getFirestore(app);
  const auth = authModule.getAuth(app);
  const markerData = {
    backupFormat: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    backupHash,
    sourceCreatedAt: validated.backup.createdAt,
    counts: validated.counts,
    projectId: options.projectId || app.options.projectId || null
  };

  let markerRef;
  try {
    markerRef = await reserveImportMarker(db, markerData, options.force);
    for (const name of DATA_COLLECTIONS) {
      await writeCollection(db, name, validated.backup[name]);
    }
    const accountResult = await configureAccounts(auth, accounts);
    await markerRef.set({
      status: 'complete',
      completedAt: new Date().toISOString(),
      accountCounts: accounts
        ? { total: accounts.accounts.length, ...accountResult }
        : { total: 0, created: 0, updated: 0 }
    }, { merge: true });
    console.log('Import complete.');
  } catch (error) {
    if (markerRef) {
      try {
        await markerRef.set({
          status: 'failed',
          failedAt: new Date().toISOString(),
          failureCode: typeof error.code === 'string' ? error.code : 'unknown'
        }, { merge: true });
      } catch {
        // Preserve the original failure; a marker update is best effort only.
      }
    }
    throw error;
  } finally {
    await appModule.deleteApp(app);
  }
}

function safeErrorMessage(error) {
  if (error instanceof UsageError || error instanceof ValidationError || error instanceof AlreadyImportedError) {
    return error.message;
  }
  const code = typeof error.code === 'string' ? ` (${error.code})` : '';
  return `Firebase operation failed${code}. No record values were printed.`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const backupFile = await readJson(options.backupPath, 'Backup file');
  const validated = validateBackup(backupFile.value);
  const backupHash = createHash('sha256').update(backupFile.bytes).digest('hex');

  let accounts = null;
  if (options.accountsPath) {
    const accountsFile = await readJson(options.accountsPath, 'Accounts file');
    accounts = validateAccounts(accountsFile.value, options.commit);
  }

  printSummary(validated, accounts);
  if (!options.commit) {
    console.log('Dry run only. Re-run with --commit to write to Firebase.');
    return;
  }

  await commitImport(options, validated, accounts, backupHash);
}

main().catch(error => {
  console.error(`Import failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
