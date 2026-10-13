const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SYNC_PATH = path.join(ROOT, 'docs', 'firebase-sync.js');

function loadTestHooks() {
  const source = fs.readFileSync(SYNC_PATH, 'utf8');
  const window = {};
  const sandbox = {
    Blob,
    Date,
    console,
    window
  };
  window.window = window;
  vm.runInNewContext(source, sandbox, {filename: SYNC_PATH});
  const hooks = window.BioengFirebase?._test;
  assert.ok(hooks, 'firebase-sync.js must expose window.BioengFirebase._test');
  return hooks;
}

const {
  isFirebaseConfigured,
  classifyFirebaseError,
  sanitizeForFirestore
} = loadTestHooks();

test('Firebase configuration detection rejects absent, incomplete, and placeholder values', () => {
  const complete = {
    apiKey: 'api-key-123',
    authDomain: 'bioeng.example.firebaseapp.com',
    projectId: 'bioeng-example',
    appId: '1:123:web:abc'
  };

  assert.equal(isFirebaseConfigured(), false);
  assert.equal(isFirebaseConfigured(null), false);
  assert.equal(isFirebaseConfigured({}), false);

  for (const key of Object.keys(complete)) {
    assert.equal(
      isFirebaseConfigured({...complete, [key]: '   '}),
      false,
      `${key} must not be blank`
    );
    assert.equal(
      isFirebaseConfigured({...complete, [key]: 'REPLACE_WITH_VALUE'}),
      false,
      `${key} must not contain the shipped placeholder`
    );
    const incomplete = {...complete};
    delete incomplete[key];
    assert.equal(isFirebaseConfigured(incomplete), false, `${key} must be required`);
  }
});

test('Firebase configuration detection accepts a complete configuration without mutating it', () => {
  const config = {
    apiKey: 'api-key-123',
    authDomain: 'bioeng.example.firebaseapp.com',
    projectId: 'bioeng-example',
    appId: '1:123:web:abc'
  };
  const before = structuredClone(config);

  assert.equal(isFirebaseConfigured(config), true);
  assert.deepEqual(config, before);
});

test('attachments never reach Firebase, so no Storage entry point survives', () => {
  const source = fs.readFileSync(SYNC_PATH, 'utf8');
  assert.doesNotMatch(source, /firebase-storage|getStorage|storageApi|storageBucket/);

  const window = {};
  vm.runInNewContext(source, {Blob, Date, console, window}, {filename: SYNC_PATH});
  assert.equal(window.BioengFirebase.loadAttachments, undefined, 'loadAttachments must not be exported');
});

test('Firebase errors are classified into actionable fallback categories', () => {
  const cases = [
    [{code: 'firebase/resource-exhausted'}, 'quota'],
    [{code: 'quota-exceeded'}, 'quota'],
    [{code: 'unavailable'}, 'offline'],
    [{code: 'auth/network-request-failed'}, 'offline'],
    [{code: 'permission-denied'}, 'permission'],
    [{code: 'unauthenticated'}, 'permission'],
    [{code: 'auth/user-token-expired'}, 'permission'],
    [{code: 'auth/invalid-credential'}, 'authentication'],
    [{code: 'auth/user-disabled'}, 'authentication'],
    [{code: 'something-new'}, 'unknown'],
    [null, 'unknown']
  ];

  for (const [error, expected] of cases) {
    assert.equal(classifyFirebaseError(error), expected, String(error?.code));
  }
});

test('Firestore sanitization recursively removes unsupported blobs and preserves clinical data', () => {
  const createdAt = new Date('2026-08-08T10:57:16.291Z');
  const attachment = new Blob(['not for Firestore'], {type: 'text/plain'});
  const source = {
    id: 'record-1',
    createdAt,
    archived: false,
    optional: undefined,
    nested: {
      note: null,
      attachment,
      values: [1, undefined, attachment, 'result']
    }
  };

  const sanitized = sanitizeForFirestore(source);

  assert.deepEqual(JSON.parse(JSON.stringify(sanitized)), {
    id: 'record-1',
    createdAt: '2026-08-08T10:57:16.291Z',
    archived: false,
    optional: null,
    nested: {
      note: null,
      values: [1, null, 'result']
    }
  });
  assert.equal(source.createdAt, createdAt, 'the input object must not be mutated');
  assert.equal(source.nested.attachment, attachment, 'the input blob must remain untouched');
});

test('Firestore sanitization handles primitive root values deterministically', () => {
  assert.equal(sanitizeForFirestore(undefined), null);
  assert.equal(sanitizeForFirestore(null), null);
  assert.equal(sanitizeForFirestore('result'), 'result');
  assert.equal(sanitizeForFirestore(42), 42);
  assert.equal(sanitizeForFirestore(true), true);
});
