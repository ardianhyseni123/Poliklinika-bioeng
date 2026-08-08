const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = path.join(ROOT, 'tools', 'firebase-import', 'import.mjs');
const ACCOUNTS_EXAMPLE = path.join(ROOT, 'tools', 'firebase-import', 'accounts.example.json');
const IMPORTER_SOURCE = fs.readFileSync(IMPORTER, 'utf8');
const uuid = suffix => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const PATIENT_ID = uuid(1);

function patient() {
  return {
    id: PATIENT_ID,
    firstName: 'Test',
    lastName: 'Patient',
    dob: '',
    gender: '',
    phone: '',
    address: '',
    archived: false,
    createdAt: '2026-08-08T10:00:00.000Z'
  };
}

function report(id, type, specialty) {
  return {
    id,
    patientId: PATIENT_ID,
    type,
    specialty,
    reportAt: '2026-08-08T10:00:00.000Z',
    clinician: '',
    clinicianTitle: '',
    anamnesis: '',
    physicalExam: '',
    existingResults: '',
    diagnoses: [],
    customDiagnoses: '',
    requestedExams: [],
    therapy: '',
    notes: '',
    revision: 1,
    analyses: [],
    hixhame: null,
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z'
  };
}

function appointment() {
  return {
    id: uuid(11),
    patientId: PATIENT_ID,
    patientName: 'Test Patient',
    appointmentAt: '2026-08-08T11:00:00.000Z',
    status: 'Caktuar',
    specialty: 'Laborator',
    clinician: '',
    phone: '',
    note: '',
    createdAt: '2026-08-08T10:00:00.000Z'
  };
}

function payment(reportId) {
  return {
    id: uuid(12),
    patientId: PATIENT_ID,
    patientName: 'Test Patient',
    reportId,
    reportLabel: 'Laborator — 08.08.2026',
    reportTotal: 25,
    amount: 10,
    status: 'PAID',
    paymentDate: '2026-08-08',
    note: '',
    recordedAt: '2026-08-08T10:00:00.000Z',
    recordedBy: 'admin@bioeng.com'
  };
}

function audit(reportId) {
  return {
    id: uuid(13),
    action: 'REPORT_CREATED',
    reportId,
    patientId: PATIENT_ID,
    at: '2026-08-08T10:00:00.000Z',
    revision: 1
  };
}

function backup(reports, attachments = []) {
  return {
    format: 'bioeng-clinical-backup',
    version: 2,
    createdAt: '2026-08-08T10:00:00.000Z',
    patients: [patient()],
    reports,
    appointments: [appointment()],
    payments: [],
    audit: [],
    attachments
  };
}

function runImporter(backupValue, {accountsValue, accountsPath} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bioeng-import-test-'));
  const backupPath = path.join(directory, 'backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(backupValue));
  let resolvedAccountsPath = accountsPath;
  if (accountsValue) {
    resolvedAccountsPath = path.join(directory, 'accounts.json');
    fs.writeFileSync(resolvedAccountsPath, JSON.stringify(accountsValue));
  }
  const args = [IMPORTER, backupPath];
  if (resolvedAccountsPath) args.push('--accounts', resolvedAccountsPath);
  const result = spawnSync(process.execPath, args, {encoding: 'utf8'});
  fs.rmSync(directory, {recursive: true, force: true});
  return result;
}

test('importer accepts only the exact laboratory and specialist report classification matrix', () => {
  const valid = runImporter(backup([
    report(uuid(2), 'laboratory', 'Laborator'),
    report(uuid(3), 'specialist', 'Pulmologji'),
    report(uuid(4), 'specialist', 'Kardiologji'),
    report(uuid(5), 'specialist', 'Neurologji'),
    report(uuid(6), 'specialist', 'Hixhame')
  ]));
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Validation passed\./);

  const invalid = runImporter(backup([
    report(uuid(7), 'laboratory', 'Kardiologji'),
    report(uuid(8), 'specialist', 'Laborator'),
    report(uuid(9), 'specialist', 'Dermatologji')
  ]));
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /laboratory reports must use specialty Laborator/);
  assert.match(invalid.stderr, /specialist reports must use Pulmologji, Kardiologji, Neurologji, or Hixhame/);
});

test('account validation requires exactly the five app email-to-role mappings', () => {
  const valid = runImporter(
    backup([report(uuid(2), 'laboratory', 'Laborator')]),
    {accountsPath: ACCOUNTS_EXAMPLE}
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /auth accounts: 5/);

  const example = JSON.parse(fs.readFileSync(ACCOUNTS_EXAMPLE, 'utf8'));
  const mismatched = structuredClone(example);
  mismatched.accounts.find(account => account.email === 'admin@bioeng.com').claims.role = 'Kardiologji';
  const mismatchResult = runImporter(
    backup([report(uuid(2), 'laboratory', 'Laborator')]),
    {accountsValue: mismatched}
  );
  assert.notEqual(mismatchResult.status, 0);
  assert.match(mismatchResult.stderr, /must equal Laborator for admin@bioeng\.com/);

  const incomplete = structuredClone(example);
  incomplete.accounts.pop();
  const incompleteResult = runImporter(
    backup([report(uuid(2), 'laboratory', 'Laborator')]),
    {accountsValue: incomplete}
  );
  assert.notEqual(incompleteResult.status, 0);
  assert.match(incompleteResult.stderr, /must contain exactly the 5 Bioeng app accounts/);
  assert.match(incompleteResult.stderr, /missing required account hixhama@bioeng\.com/);
});

function attachment(bytes, overrides = {}) {
  return {
    id: uuid(10),
    reportId: uuid(2),
    name: 'test.pdf',
    type: 'application/pdf',
    size: bytes.length,
    uploadedAt: '2026-08-08T10:00:00.000Z',
    data: `data:application/pdf;base64,${bytes.toString('base64')}`,
    ...overrides
  };
}

test('attachments are validated but never uploaded to Firebase', () => {
  assert.doesNotMatch(IMPORTER_SOURCE, /firebase-admin\/storage/, 'the Admin Storage module must not be loaded');
  assert.doesNotMatch(IMPORTER_SOURCE, /--bucket/, 'the bucket option must be gone');
  assert.doesNotMatch(IMPORTER_SOURCE, /getStorage|\.bucket\(|uploadAttachments/, 'no Storage call may remain');

  const bytes = Buffer.from('pdf');
  const dryRun = runImporter(backup(
    [report(uuid(2), 'laboratory', 'Laborator')],
    [attachment(bytes)]
  ));
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /attachments \(validated, not imported\): 1/);
  assert.match(dryRun.stderr, /1 attachment\(s\) are validated but not imported/);
  assert.match(dryRun.stdout, /Dry run only/);
});

test('a corrupted attachment still fails validation even though it is not imported', () => {
  const bytes = Buffer.from('pdf');

  const wrongSize = runImporter(backup(
    [report(uuid(2), 'laboratory', 'Laborator')],
    [attachment(bytes, {size: bytes.length + 5})]
  ));
  assert.notEqual(wrongSize.status, 0);
  assert.match(wrongSize.stderr, /attachments\[0\]\.size: does not match decoded attachment size/);

  const wrongType = runImporter(backup(
    [report(uuid(2), 'laboratory', 'Laborator')],
    [attachment(bytes, {type: 'application/x-msdownload', data: `data:application/x-msdownload;base64,${bytes.toString('base64')}`})]
  ));
  assert.notEqual(wrongType.status, 0);
  assert.match(wrongType.stderr, /attachments\[0\]\.data: unsupported attachment MIME type/);
});

test('importer validates the complete persisted app schema and UUID references', () => {
  const reportId = uuid(2);
  const complete = backup([report(reportId, 'laboratory', 'Laborator')]);
  complete.payments = [payment(reportId)];
  complete.audit = [audit(reportId)];

  const valid = runImporter(complete);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /payments: 1/);
  assert.match(valid.stdout, /audit: 1/);

  const incomplete = structuredClone(complete);
  delete incomplete.appointments[0].phone;
  delete incomplete.payments[0].note;
  delete incomplete.audit[0].revision;
  const incompleteResult = runImporter(incomplete);
  assert.notEqual(incompleteResult.status, 0);
  assert.match(incompleteResult.stderr, /appointments\[0\]\.phone: must be a string/);
  assert.match(incompleteResult.stderr, /payments\[0\]\.note: must be a string/);
  assert.match(incompleteResult.stderr, /audit\[0\]\.revision: must be a positive integer/);

  const invalidId = structuredClone(complete);
  invalidId.patients[0].id = 'patient-1';
  const invalidIdResult = runImporter(invalidId);
  assert.notEqual(invalidIdResult.status, 0);
  assert.match(invalidIdResult.stderr, /patients\[0\]\.id: invalid Firestore document ID/);
  assert.match(invalidIdResult.stderr, /contains missing patient references/);
});

test('importer rejects report tombstones because exports contain active records only', () => {
  const deleted = report(uuid(2), 'laboratory', 'Laborator');
  deleted._deleted = true;
  deleted.deletedAt = '2026-08-08T11:00:00.000Z';
  deleted.deletedBy = 'admin@bioeng.com';

  const result = runImporter(backup([deleted]));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active backup reports cannot be tombstones/);
  assert.match(result.stderr, /active backup reports cannot contain deletion metadata/);
});
