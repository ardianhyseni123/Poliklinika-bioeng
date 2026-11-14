#!/usr/bin/env node
// Fills the local Firebase emulators with sample users and records for development and
// end-to-end tests. Sample data only: no real patients. It refuses to run against anything
// but the emulators.
//
// Every seeded account uses the password below (emulator only).

import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const SEED_PASSWORD = 'bioeng-test-123';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must point at the emulators.');
  process.exit(1);
}

const app = initializeApp({ projectId: 'demo-bioeng' });
const auth = getAuth(app);
const db = getFirestore(app);
const NOW = new Date().toISOString();

const USERS = [
  { email: 'admin@bioeng.test', role: 'Administrator', name: 'Administratori', title: 'Administrator', active: true },
  { email: 'lab@bioeng.test', role: 'Laborator', name: 'Laboratori BIOENG', title: 'Laborator', active: true },
  { email: 'kardiolog@bioeng.test', role: 'Kardiologji', name: 'Dr. Test Kardio', title: 'Specialist i Kardiologjisë', active: true },
  { email: 'pulmolog@bioeng.test', role: 'Pulmologji', name: 'Dr. Test Pulmo', title: 'Specialist i Pulmologjisë', active: true },
  { email: 'neurolog@bioeng.test', role: 'Neurologji', name: 'Dr. Test Neuro', title: 'Specialist i Neurologjisë', active: true },
  { email: 'hixhama@bioeng.test', role: 'Hixhame', name: 'Njësia Hixhame (test)', title: 'Njësia e Hixhames', active: true },
  { email: 'joaktiv@bioeng.test', role: 'Kardiologji', name: 'Dr. Joaktiv', title: 'Specialist i Kardiologjisë', active: false }
];
// Sign in, but have no users document: they see the "no role" screen until the
// Administrator assigns one (i-ri is used by the end-to-end test of the admin page).
const WITHOUT_PROFILE = ['pa-rol@bioeng.test', 'i-ri@bioeng.test'];

async function ensureAccount(email, displayName) {
  try {
    return await auth.createUser({ email, password: SEED_PASSWORD, displayName });
  } catch (error) {
    if (error.code !== 'auth/email-already-exists') throw error;
    return auth.getUserByEmail(email);
  }
}

for (const user of USERS) {
  await ensureAccount(user.email, user.name);
  await db.doc(`users/${user.email}`).set({ ...user, updatedAt: NOW, updatedBy: 'admin@bioeng.test' });
}
for (const email of WITHOUT_PROFILE) await ensureAccount(email, 'Pa rol');

const patients = [
  ['Arta', 'Krasniqi', '1985-03-12', 'Femër', '044111222', 'Prishtinë'],
  ['Blerim', 'Gashi', '1972-11-02', 'Mashkull', '045333444', 'Ferizaj'],
  ['Drita', 'Berisha', '1990-07-21', 'Femër', '049555666', 'Pejë'],
  ['Fatmir', 'Hoxha', '1965-01-30', 'Mashkull', '044777888', 'Gjilan']
].map(([firstName, lastName, dob, gender, phone, address]) => ({
  id: randomUUID(), firstName, lastName, dob, gender, phone, address, archived: false, createdAt: NOW
}));
for (const patient of patients) await db.doc(`patients/${patient.id}`).set(patient);

function baseReport(patient, type, specialty, clinician, clinicianTitle, extra = {}) {
  return {
    id: randomUUID(), patientId: patient.id, type, specialty, reportAt: NOW.slice(0, 16),
    clinician, clinicianTitle, anamnesis: '', physicalExam: '', existingResults: '', diagnoses: [],
    customDiagnoses: '', requestedExams: [], therapy: '', notes: '', analyses: [], hixhame: null,
    createdAt: NOW, updatedAt: NOW, revision: 1, ...extra
  };
}

async function saveWithVersion(report, savedBy) {
  const versionId = randomUUID();
  const head = { ...report, lastVersionId: versionId };
  const batch = db.batch();
  batch.set(db.doc(`reports/${head.id}`), head);
  batch.set(db.doc(`reports/${head.id}/versions/${versionId}`), {
    id: versionId, reportId: head.id, patientId: head.patientId, type: head.type, specialty: head.specialty,
    kind: 'save', revision: head.revision, baseRevision: head.revision - 1, baseVersionId: '', resolves: [],
    savedAt: NOW, savedBy, report: head
  });
  await batch.commit();
}

const [arta, blerim, drita] = patients;
await saveWithVersion(baseReport(arta, 'laboratory', 'Laborator', 'Laboratori BIOENG', 'Laborator', {
  analyses: [
    { parameter: 'Glukoza esull', result: '7.2', unit: 'mmol/L', reference: '3.3-6.1', category: 'Biokimi', printGroup: 'BIOKIMIA' },
    { parameter: 'Kolesteroli Total', result: '5.1', unit: 'mmol/L', reference: '3.1-6.2', category: 'Biokimi', printGroup: 'BIOKIMIA' },
    { parameter: 'HGB Hemoglobina', result: '102', unit: 'g/L', reference: '115 - 165', category: 'Hematologji', printGroup: 'HEMATOLOGJIA' }
  ]
}), 'lab@bioeng.test');
await saveWithVersion(baseReport(blerim, 'specialist', 'Kardiologji', 'Dr. Test Kardio', 'Specialist i Kardiologjisë', {
  anamnesis: 'Dhimbje gjoksi gjatë lodhjes.', diagnoses: ['Hipertension arterial'], requestedExams: ['EKG'], therapy: 'Sipas udhëzimit.'
}), 'kardiolog@bioeng.test');
await saveWithVersion(baseReport(drita, 'specialist', 'Hixhame', 'Njësia Hixhame (test)', 'Njësia e Hixhames', {
  hixhame: { services: ['Hixhame'], cups: '13', cupPositions: ['Shpinë'], leeches: '', leechPositions: [] }
}), 'hixhama@bioeng.test');

console.log(`Seeded the emulators: ${USERS.length + WITHOUT_PROFILE.length} accounts (password: ${SEED_PASSWORD}), ${patients.length} patients, 3 reports.`);
