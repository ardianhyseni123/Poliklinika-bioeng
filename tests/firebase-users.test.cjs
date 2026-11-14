const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const TOOL_PATH = path.join(ROOT, 'tools', 'firebase-import', 'users.mjs');
const SYNC_PATH = path.join(ROOT, 'docs', 'firebase-sync.js');
const RULES_V2_PATH = path.join(ROOT, 'firestore.v2.rules');
const ROLES_PATH = path.join(ROOT, 'src', 'auth', 'roles.ts');

const loadTool = () => import(pathToFileURL(TOOL_PATH).href);

test('the user tool knows the roles of both apps', async () => {
  const { ROLES, OLD_APP_ROLES } = await loadTool();
  const oldRoles = /const VALID_ROLES = \[([^\]]+)\]/.exec(fs.readFileSync(SYNC_PATH, 'utf8'))[1]
    .split(',').map(item => item.trim().replace(/^'|'$/g, ''));
  assert.deepEqual([...OLD_APP_ROLES].sort(), [...oldRoles].sort());
  const roles = fs.readFileSync(ROLES_PATH, 'utf8');
  const rules = fs.readFileSync(RULES_V2_PATH, 'utf8');
  for (const role of ROLES) {
    assert.match(roles, new RegExp(`'${role}'`));
    assert.match(rules, new RegExp(`'${role}'`));
  }
  assert.deepEqual(ROLES.filter(role => !OLD_APP_ROLES.includes(role)), ['Administrator', 'Gastroenterologji', 'Urologji']);
});

test('set requires a known role and a name, and normalizes the email', async () => {
  const { parseArgs, UsageError } = await loadTool();
  const options = parseArgs(['set', ' New.Doctor@Bioeng.com ', '--role', 'Kardiologji', '--name', 'Dr. Test']);
  assert.equal(options.email, 'new.doctor@bioeng.com');
  assert.equal(options.role, 'Kardiologji');
  assert.equal(options.name, 'Dr. Test');
  assert.equal(parseArgs(['set', 'a@b.com', '--role', 'Administrator', '--name', 'A']).role, 'Administrator');

  assert.throws(() => parseArgs(['set', 'a@b.com', '--role', 'Admin', '--name', 'X']), UsageError);
  assert.throws(() => parseArgs(['set', 'a@b.com', '--role', 'Laborator']), /--name is required/);
  assert.throws(() => parseArgs(['set', '--role', 'Laborator', '--name', 'X']), /email/);
  assert.throws(() => parseArgs(['remove', 'a@b.com', '--role', 'Laborator']), /only valid with set/);
  assert.throws(() => parseArgs(['list', 'extra']), /Unexpected argument/);
  assert.throws(() => parseArgs(['delete', 'a@b.com']), /Unknown command/);
  assert.throws(() => parseArgs([]), /A command is required/);
  assert.throws(() => parseArgs(['list', '--commit']), /only valid with migrate/);
  assert.equal(parseArgs(['list']).command, 'list');
  assert.equal(parseArgs(['migrate']).commit, false);
  assert.equal(parseArgs(['migrate', '--commit']).commit, true);
});

test('claims default the title, keep unrelated claims, and give an Administrator the Laborator claim', async () => {
  const { profileClaims, claimsWithoutProfile } = await loadTool();
  assert.deepEqual(
    profileClaims({ other: true, role: 'Laborator' }, { role: 'Neurologji', name: 'Dr. N', title: '' }),
    { other: true, role: 'Neurologji', name: 'Dr. N', title: 'Specialist i Neurologjisë' }
  );
  assert.deepEqual(
    profileClaims(null, { role: 'Hixhame', name: 'Njësia', title: 'Custom' }),
    { role: 'Hixhame', name: 'Njësia', title: 'Custom' }
  );
  assert.deepEqual(profileClaims(null, { role: 'Administrator', name: 'A', title: '' }), { role: 'Laborator', name: 'A', title: 'Administrator' });
  assert.deepEqual(claimsWithoutProfile({ role: 'Laborator', name: 'L', title: 'T', other: 1 }), { other: 1 });
});

test('profiles match the users documents the new rules accept', async () => {
  const { userDocument, profileFromClaims, UsageError } = await loadTool();
  assert.deepEqual(userDocument({ email: ' Dr.K@Bioeng.com ', role: 'Kardiologji', name: ' Dr. K ' }, 'now'), {
    email: 'dr.k@bioeng.com', role: 'Kardiologji', name: 'Dr. K', title: 'Specialist i Kardiologjisë', active: true, updatedAt: 'now', updatedBy: 'admin-tool'
  });
  assert.throws(() => userDocument({ email: 'x@y.z', role: 'Laborator', name: ' ' }, 'now'), UsageError);
  assert.throws(() => userDocument({ email: 'x@y.z', role: 'Boss', name: 'X' }, 'now'), UsageError);

  assert.deepEqual(
    profileFromClaims({ email: 'Lab@Bioeng.com', customClaims: { role: 'Laborator', name: 'Lab', title: 'Laborator' } }),
    { email: 'lab@bioeng.com', role: 'Laborator', name: 'Lab', title: 'Laborator', active: true }
  );
  assert.equal(profileFromClaims({ email: 'x@y.z', customClaims: {} }), null);
  assert.equal(profileFromClaims({ email: 'x@y.z', disabled: true, customClaims: { role: 'Hixhame', name: 'H' } }).active, false);
});

test('list reports access to each app with the same checks as its sign-in', async () => {
  const { appAccess, newAppAccess } = await loadTool();
  assert.equal(appAccess({ customClaims: { role: 'Laborator', name: 'L' } }), 'yes');
  assert.equal(appAccess({ customClaims: { role: 'Laborator' }, displayName: 'L' }), 'yes');
  assert.equal(appAccess({ customClaims: {} }), 'no (no role)');
  assert.equal(appAccess({ customClaims: { role: 'Administrator', name: 'A' } }), 'no (no role)');
  assert.equal(appAccess({ customClaims: { role: 'Urologji', name: 'Dr. U', title: 'Urolog' } }), 'no (new app only)');
  assert.equal(appAccess({ customClaims: { role: 'Laborator' } }), 'no (no name)');
  assert.equal(appAccess({ customClaims: { role: 'Kardiologji', name: 'Dr. K' } }), 'no (no title)');
  assert.equal(appAccess({ disabled: true, customClaims: { role: 'Laborator', name: 'L' } }), 'no (disabled)');

  assert.equal(newAppAccess({}, { role: 'Administrator', active: true }), 'yes');
  assert.equal(newAppAccess({}, undefined), 'no (no profile)');
  assert.equal(newAppAccess({}, { role: 'Laborator', active: false }), 'no (deactivated)');
  assert.equal(newAppAccess({ disabled: true }, { role: 'Laborator', active: true }), 'no (disabled)');
});
