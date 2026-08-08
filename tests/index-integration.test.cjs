const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'docs');
const INDEX_PATH = path.join(SITE, 'index.html');
const SYNC_PATH = path.join(SITE, 'firebase-sync.js');
const CONFIG_PATH = path.join(SITE, 'firebase-config.js');
const RULES_PATH = path.join(ROOT, 'firestore.rules');
const IMPORTER_PATH = path.join(ROOT, 'tools', 'firebase-import', 'import.mjs');

const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
const syncSource = fs.readFileSync(SYNC_PATH, 'utf8');
const configSource = fs.readFileSync(CONFIG_PATH, 'utf8');
const rulesSource = fs.readFileSync(RULES_PATH, 'utf8');

function functionSection(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `expected function ${name} to exist`);
  const start = match.index;
  const afterDeclaration = source.slice(start + match[0].length);
  const next = /\n\s{2}(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(afterDeclaration);
  const end = next ? start + match[0].length + next.index : source.length;
  return source.slice(start, end);
}

function lastAssignmentLine(source, name) {
  const declaration = new RegExp(`(?:^|\\n)\\s{2}${name}\\s*=`, 'g');
  const matches = [...source.matchAll(declaration)];
  assert.ok(matches.length, `expected assignment to ${name}`);
  const start = matches.at(-1).index;
  const end = source.indexOf('\n', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}

function assertLaboratoryGuard(name) {
  const section = functionSection(indexSource, name);
  const guard = /currentUser\??\.role\s*!==\s*['"]Laborator['"]/.exec(section);
  assert.ok(guard, `${name} must reject non-Laborator users in JavaScript, not only through CSS`);
  assert.ok(
    section.indexOf('return', guard.index) > guard.index,
    `${name} must return early after its Laborator guard`
  );
}

function declaredFunctionNames(source) {
  return [...source.matchAll(/(?:^|\n)\s{2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
    .map(match => match[1]);
}

function clearsSensitiveSessionState(section) {
  const clearsPrintContent = /\$\(\s*['"]printContent['"]\s*\)\.replaceChildren\s*\(\s*\)/.test(section)
    || /\$\(\s*['"]printContent['"]\s*\)\.(?:innerHTML|textContent)\s*=\s*(['"])\1/.test(section);
  return /notificationRecipient\s*=\s*null/.test(section)
    && /notificationOverride\s*=\s*null/.test(section)
    && /printReportId\s*=\s*null/.test(section)
    && /\$\(\s*['"]printArea['"]\s*\)\.classList\.add\(\s*['"]hidden['"]\s*\)/.test(section)
    && clearsPrintContent;
}

test('the browser app loads config and sync modules before its inline application code', () => {
  const configScript = indexSource.indexOf('<script src="firebase-config.js"></script>');
  const syncScript = indexSource.indexOf('<script src="firebase-sync.js"></script>');
  const inlineScript = indexSource.indexOf('<script>', syncScript);

  assert.ok(configScript >= 0, 'firebase-config.js must be loaded by index.html');
  assert.ok(syncScript > configScript, 'firebase-sync.js must load after its configuration');
  assert.ok(inlineScript > syncScript, 'the application must run after the sync adapter is available');

  const inlineCode = [...indexSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .join('\n');
  assert.ok(inlineCode.trim(), 'index.html must contain its application script');
  assert.doesNotThrow(() => new vm.Script(inlineCode, {filename: INDEX_PATH}));
});

test('Firebase initialization cannot continue when in-memory auth persistence fails', () => {
  const init = functionSection(syncSource, 'init');
  const persistenceAt = init.indexOf('await authApi.setPersistence(auth, authApi.inMemoryPersistence)');
  const servicesAt = init.indexOf('services = {', persistenceAt);

  assert.ok(persistenceAt >= 0, 'Firebase Auth must explicitly use in-memory persistence');
  assert.ok(servicesAt > persistenceAt, 'services may only be exposed after persistence is configured');
  assert.match(
    init.slice(persistenceAt, servicesAt),
    /catch\s*\(error\)\s*\{\s*throw reportError\(\s*error\s*,\s*['"]auth-persistence['"]\s*\)/,
    'a persistence failure must be thrown before Firebase services become usable'
  );
  assert.match(init, /catch\s*\(error\)\s*\{\s*initializing\s*=\s*null\s*;\s*throw reportError\(\s*error\s*,\s*['"]initialize['"]\s*\)/);
});

test('cloud writes commit local data and their durable outbox entry atomically', () => {
  const put = functionSection(indexSource, 'put');
  const remove = functionSection(indexSource, 'remove');
  const persist = functionSection(indexSource, 'persistDataAndMutation');
  const atomicWrite = functionSection(indexSource, 'writeDataAndMutation');

  assert.match(
    atomicWrite,
    /db\.transaction\(\s*\[\s*store\s*,\s*['"]syncQueue['"]\s*\]\s*,\s*['"]readwrite['"]\s*\)/,
    'cloud data and its queue record must share one read/write transaction'
  );
  assert.match(atomicWrite, /dataStore\.(?:put|delete)\(/, 'the transaction must mutate the data store');
  assert.match(atomicWrite, /queueStore\.put\(\s*mutation\s*\)/, 'the same transaction must write the outbox record');
  assert.match(atomicWrite, /transaction\.oncomplete\s*=/, 'the atomic write must resolve only after commit');
  assert.match(atomicWrite, /transaction\.onabort\s*=/, 'an aborted atomic write must reject');

  assert.match(persist, /const mutation\s*=\s*createMutation\(/, 'the immutable queue record must be prepared before opening the transaction');
  assert.match(persist, /await writeDataAndMutation\([^;]+mutation\s*,\s*metadata\s*\)/, 'cloud persistence must use the atomic helper');
  assert.match(persist, /memorySyncQueue\.set\(\s*mutation\.id\s*,\s*mutation\s*\)/, 'quota fallback must retain the same queue record in memory');

  assert.match(put, /if\(cloudSync\)await persistDataAndMutation\(/);
  assert.match(remove, /if\(cloudSync\)await persistDataAndMutation\(/);
  assert.match(indexSource, /createObjectStore\(\s*['"]syncQueue['"]\s*,\s*\{\s*keyPath\s*:\s*['"]id['"]\s*\}\s*\)/);
  assert.match(indexSource, /DB_VERSION\s*=\s*6\b/);
});

test('local-only writes never create an outbox entry', () => {
  const put = functionSection(indexSource, 'put');
  const remove = functionSection(indexSource, 'remove');
  const localWrite = functionSection(indexSource, 'writeLocalOnly');
  const localDelete = functionSection(indexSource, 'deleteLocalOnly');

  assert.match(put, /const cloudSync\s*=\s*sync\s*&&\s*!LOCAL_ONLY_STORES\.includes\(store\)\s*&&\s*currentUser\?\.cloud\s*&&/);
  assert.match(put, /else await writeLocalOnly\(\s*store\s*,\s*value\s*\)/);
  assert.match(remove, /else await deleteLocalOnly\(\s*store\s*,\s*id\s*\)/);
  assert.doesNotMatch(localWrite, /syncQueue|enqueueMutation|createMutation/);
  assert.doesNotMatch(localDelete, /syncQueue|enqueueMutation|createMutation/);
  assert.doesNotMatch(put, /enqueueMutation/);
  assert.doesNotMatch(remove, /enqueueMutation/);
});

test('IndexedDB completion and quota fallback keep the session usable', () => {
  const idbWrite = functionSection(indexSource, 'idbWrite');
  assert.match(idbWrite, /transaction\.oncomplete\s*=/, 'writes must resolve only after the transaction commits');
  assert.match(idbWrite, /transaction\.onerror\s*=/, 'transaction errors must reject');
  assert.match(idbWrite, /transaction\.onabort\s*=/, 'transaction aborts, including quota aborts, must reject');

  const writeFallback = functionSection(indexSource, 'writeLocalOnly');
  const deleteFallback = functionSection(indexSource, 'deleteLocalOnly');
  assert.match(writeFallback, /memoryRecords/);
  assert.match(writeFallback, /handleLocalStorageError/);
  assert.match(deleteFallback, /memoryDeleted/);
  assert.match(deleteFallback, /handleLocalStorageError/);

  const localWarning = functionSection(indexSource, 'handleLocalStorageError');
  assert.match(localWarning, /sesion/i, 'local quota warning must explain the session-only fallback');
  assert.match(localWarning, /mund të humbin/i, 'local quota warning must not claim the data was persisted');
  assert.match(indexSource, /id=['"]syncNotice['"][^>]*role=['"]alert['"]/, 'persistence failures need a visible alert');
});

test('Firebase quota failures display a local-only warning and leave queued work pending', () => {
  const cloudWarning = functionSection(indexSource, 'handleCloudError');
  const flush = functionSection(indexSource, 'flushCloudQueue');
  const sync = functionSection(indexSource, 'syncFromFirebase');
  const syncRetry = functionSection(indexSource, 'scheduleCloudSyncRetry');

  assert.match(cloudWarning, /category\s*===\s*['"]quota['"]/);
  assert.match(cloudWarning, /Firebase/);
  assert.match(cloudWarning, /lokalisht|këtë pajisje/i);
  assert.match(flush, /applyMutation/);
  assert.match(flush, /handleCloudError/);
  const applyAt = flush.indexOf('await window.BioengFirebase.applyMutation');
  const completionAt = flush.indexOf('await completeMutation(mutation)', applyAt);
  assert.ok(applyAt >= 0, 'the queued mutation must be sent to Firebase');
  assert.ok(
    completionAt > applyAt,
    'a queued mutation must only be removed after Firebase accepts it'
  );

  const startup = functionSection(indexSource, 'finishStartup');
  assert.match(startup, /initializeFirebase\(\)/, 'Firebase initialization must run after local startup');
  assert.match(
    indexSource,
    /addEventListener\(\s*['"]online['"]\s*,\s*\(\)\s*=>\s*\{\s*if\(currentUser\?\.cloud\)\s*\{\s*clearCloudSyncRetry\(\)\s*;\s*syncFromFirebase\(\)\s*\}\s*else\s*scheduleCloudFlush\(\)\s*\}\s*\)/,
    'reconnecting a cloud session must restart the full pull/flush/listener workflow'
  );
  const pullAt = sync.indexOf('await window.BioengFirebase.pull(role)');
  const flushAt = sync.indexOf('await flushCloudQueue()', pullAt);
  const listenAt = sync.indexOf('await window.BioengFirebase.startRealtime', flushAt);
  assert.ok(
    pullAt >= 0 && flushAt > pullAt && listenAt > flushAt,
    'full recovery must pull, drain pending writes, and then reinstall realtime listeners'
  );
  assert.match(sync, /catch\(error\)\s*\{\s*if\(isActiveSession\(generation\)\)\s*\{[^}]*scheduleCloudSyncRetry\(generation\)/);
  assert.match(syncRetry, /cloudSyncRetryTimer\s*\|\|\s*!isActiveSession\(generation\)\s*\|\|\s*!currentUser\?\.cloud/);
  assert.match(syncRetry, /Math\.min\(\s*60000\s*,\s*1000\s*\*\s*\(2\s*\*\*\s*Math\.min\(\s*cloudSyncRetryAttempt\s*,\s*6\s*\)\)\s*\)/);
  assert.match(syncRetry, /if\(isActiveSession\(generation\)\)syncFromFirebase\(\)/);
});

test('outbox lineage masks failed predecessors and completion cannot delete a truly newer mutation', () => {
  const create = functionSection(indexSource, 'createMutation');
  const token = functionSection(indexSource, 'mutationToken');
  const lineage = functionSection(indexSource, 'mutationLineageTokens');
  const inherit = functionSection(indexSource, 'inheritMutationPredecessor');
  const atomicWrite = functionSection(indexSource, 'writeDataAndMutation');
  const persist = functionSection(indexSource, 'persistDataAndMutation');
  const queued = functionSection(indexSource, 'queuedMutations');
  const durableCompletion = functionSection(indexSource, 'deleteQueuedMutationIfCurrent');
  const complete = functionSection(indexSource, 'completeMutation');
  const flush = functionSection(indexSource, 'flushCloudQueue');
  const generation = /([A-Za-z_$][\w$]*)\s*:\s*crypto\.randomUUID\(\)/.exec(create);

  assert.ok(
    generation && /(?:mutation.*id|generation|token|version|nonce|receipt)/i.test(generation[1]),
    'each replacement outbox entry needs a unique generation token in addition to its stable record key'
  );
  const generationField = generation[1];
  const generationReference = new RegExp(`\\b${generationField}\\b`);

  assert.match(token, generationReference, 'the queue identity helper must include the unique generation token');
  assert.match(
    lineage,
    /new Set\(\s*\[\s*mutationToken\(\s*mutation\s*\)\s*,\s*\.\.\.\(mutation\?\.supersededTokens\s*\|\|\s*\[\]\)\s*\]/,
    'a mutation lineage must contain its own token and only explicitly captured predecessor tokens'
  );
  assert.match(inherit, /if\(\s*!prior\s*\|\|\s*prior\.id\s*!==\s*mutation\.id\s*\)return/);
  assert.match(
    inherit,
    /\[\.\.\.\(prior\.supersededTokens\s*\|\|\s*\[\]\),\s*mutationToken\(\s*prior\s*\)\]/,
    'same-key replacement must retain both its direct predecessor and earlier lineage'
  );
  assert.match(inherit, /mutation\.supersededTokens\s*=\s*\[\.\.\.new Set\([^;]+\.slice\(\s*-20\s*\)/);

  assert.match(atomicWrite, /existingMutationRequest\s*=\s*queueStore\.get\(\s*mutation\.id\s*\)/);
  const durableInheritance = atomicWrite.indexOf('inheritMutationPredecessor(mutation,existingMutationRequest.result)');
  const durableReplacement = atomicWrite.indexOf('queueStore.put(mutation)', durableInheritance);
  assert.ok(
    durableInheritance >= 0 && durableReplacement > durableInheritance,
    'the durable same-key predecessor must be captured before replacement is attempted'
  );
  assert.match(
    persist,
    /memoryPrior\s*=\s*memorySyncQueue\.get\(\s*mutation\.id\s*\)\s*;\s*inheritMutationPredecessor\(\s*mutation\s*,\s*memoryPrior\s*\)/,
    'a memory predecessor must be captured before the atomic transaction'
  );
  const failedMask = persist.indexOf('for(const item of mutation.supersededTokens||[])completedMemoryQueue.add(item)');
  const failedMemoryQueue = persist.indexOf('memorySyncQueue.set(mutation.id,mutation)', failedMask);
  assert.ok(
    failedMask >= 0 && failedMemoryQueue > failedMask,
    'after transaction failure, captured durable predecessor tokens must be masked before the memory replacement is exposed'
  );
  assert.match(
    queued,
    /stored\.filter\(item\s*=>\s*!isObsoleteMutation\(item\)\s*&&\s*!completedMemoryQueue\.has\(mutationToken\(item\)\)\)/,
    'masked durable predecessors must not reappear beside their memory replacement'
  );

  assert.match(
    durableCompletion,
    /store\.get\(\s*mutation\.id\s*\)/,
    'completion must re-read the current durable entry in its delete transaction'
  );
  assert.match(
    durableCompletion,
    /allowedTokens\s*=\s*new Set\(\s*mutationLineageTokens\(\s*mutation\s*\)\s*\)/,
    'durable completion must use the captured lineage as its compare-and-set allowlist'
  );
  assert.match(
    durableCompletion,
    /if\(allowedTokens\.has\(mutationToken\(request\.result\)\)\)\s*\{[^}]*store\.delete\(\s*mutation\.id\s*\)/,
    'the current or a captured predecessor may be deleted, while an unrelated newer token cannot match'
  );
  assert.match(complete, /tokens\s*=\s*mutationLineageTokens\(\s*mutation\s*\)/);
  const markLineage = complete.indexOf('for(const token of tokens)completedMemoryQueue.add(token)');
  const durableDelete = complete.indexOf('await deleteQueuedMutationIfCurrent(mutation)', markLineage);
  assert.ok(markLineage >= 0 && durableDelete > markLineage, 'all lineage tokens must stay masked during asynchronous durable completion');
  assert.match(complete, /deleteQueuedMutationIfCurrent\(\s*mutation\s*\)/);

  const completionCalls = [...flush.matchAll(/completeMutation\(([^)]*)\)/g)];
  assert.ok(completionCalls.length >= 2, 'every successful or obsolete queue branch must complete generation-safely');
  for (const call of completionCalls) {
    const argumentsSource = call[1];
    assert.ok(
      argumentsSource.trim() === 'mutation'
        || new RegExp(`mutation\\.${generationField}`).test(argumentsSource),
      `completion call must carry mutation.${generationField}: ${call[0]}`
    );
  }
});

test('attachments stay local and never enter the cloud outbox', () => {
  const create = functionSection(indexSource, 'createMutation');
  const durablePut = functionSection(indexSource, 'put');
  const durableRemove = functionSection(indexSource, 'remove');
  const queue = functionSection(indexSource, 'queuedMutations');
  const reportDependency = functionSection(indexSource, 'reportIdForMutation');
  const atomicWrite = functionSection(indexSource, 'writeDataAndMutation');
  const remoteMerge = functionSection(indexSource, 'applyRemoteIfNoPending');

  assert.match(indexSource, /const LOCAL_ONLY_STORES=\['attachments'\]/);
  for (const [name, section] of [['put', durablePut], ['remove', durableRemove]]) {
    assert.match(
      section,
      /cloudSync\s*=\s*sync\s*&&\s*!LOCAL_ONLY_STORES\.includes\(store\)/,
      `${name} must write local-only stores without queuing cloud work`
    );
  }
  assert.doesNotMatch(indexSource, /BioengFirebase[^\n]*loadAttachments/, 'no Storage read path may remain');
  assert.doesNotMatch(indexSource, /createMutation\([^)]*['"]attachments['"]/, 'attachments must never be queued');
  assert.match(
    create,
    /value\s*:\s*operation\s*===\s*['"]delete['"]\s*\?[^:]+:\s*structuredClone\(\s*value\s*\)/,
    'queued PUTs must own an immutable snapshot of the record'
  );
  assert.match(
    reportDependency,
    /mutation\.store\s*===\s*['"]audit['"]\)return String\(mutation\.reportId\s*\|\|\s*mutation\.value\?\.reportId/,
    'dependency resolution must consult the top-level report ID before the payload'
  );
  assert.match(
    queue,
    /for\(const item of stored\.filter\(isObsoleteMutation\)\)\{memorySyncQueue\.delete\(item\.id\);idbWrite\('syncQueue','delete',item\.id\)/,
    'attachment mutations queued by the Storage version must be dropped instead of blocking the outbox'
  );
  assert.match(
    functionSection(indexSource, 'isObsoleteMutation'),
    /LOCAL_ONLY_STORES\.includes\(item\?\.store\)\|\|item\?\.store==='attachmentFolders'/
  );
  const localWrite = atomicWrite.indexOf('dataStore.put(value)');
  const queueWrite = atomicWrite.indexOf('queueStore.put(mutation)', localWrite);
  assert.ok(
    localWrite >= 0 && queueWrite > localWrite,
    'the durable record and its outbox reference must share the atomic transaction'
  );
  assert.match(
    remoteMerge,
    /pending\s*=\s*request\.result\s*;\s*if\(pending\s*&&\s*!completedMemoryQueue\.has\(mutationToken\(pending\)\)\)return/,
    'remote merges must not replace a durable local record while its lightweight mutation is pending'
  );
});

test('report editor saves against the exact locally loaded revision and signature', () => {
  const blank = functionSection(indexSource, 'blankReport');
  const load = functionSection(indexSource, 'loadReport');
  const save = functionSection(indexSource, 'saveReport');
  const put = functionSection(indexSource, 'put');
  const persist = functionSection(indexSource, 'persistDataAndMutation');
  const atomicWrite = functionSection(indexSource, 'writeDataAndMutation');
  const conflict = functionSection(indexSource, 'localReportConflict');

  assert.match(blank, /editorBaseRevision\s*=\s*null/);
  assert.match(blank, /editorBaseSignature\s*=\s*null/);
  assert.match(load, /editorBaseRevision\s*=\s*Number\(\s*r\.revision\s*\)/);
  assert.match(load, /editorBaseSignature\s*=\s*stableMutationValue\(\s*r\s*\)/);
  assert.match(conflict, /code\s*:\s*['"]local\/report-conflict['"]/);
  assert.match(conflict, /category\s*:\s*['"]conflict['"]/);

  assert.match(
    save,
    /if\(editing\s*&&\s*\(\s*!old\s*\|\|\s*!Number\.isInteger\(editorBaseRevision\)\s*\|\|\s*typeof editorBaseSignature\s*!==\s*['"]string['"]\s*\|\|\s*Number\(old\.revision\)\s*!==\s*editorBaseRevision\s*\|\|\s*stableMutationValue\(old\)\s*!==\s*editorBaseSignature\s*\)\)\s*\{[^}]*return\}/,
    'a stale open form must be rejected before constructing a replacement report'
  );
  const staleCheck = save.indexOf('Number(old.revision)!==editorBaseRevision');
  const reportRead = save.indexOf('let r=readReport()', staleCheck);
  assert.ok(staleCheck >= 0 && reportRead > staleCheck, 'stale local data must be detected before the form is committed');
  assert.match(save, /baseRevision\s*=\s*editing\s*\?\s*editorBaseRevision\s*:\s*0/);
  assert.match(save, /r\.revision\s*=\s*baseRevision\s*\+\s*1/);
  assert.match(
    save,
    /put\(\s*['"]reports['"]\s*,\s*r\s*,\s*\{\s*expectedRevision\s*:\s*baseRevision\s*,\s*localBaseSignature\s*:\s*editing\s*\?\s*editorBaseSignature\s*:\s*undefined\s*\}\s*\)/,
    'the atomic write must receive the base captured when the editor was loaded'
  );
  assert.match(save, /catch\(error\)\s*\{\s*if\(error\?\.category\s*===\s*['"]conflict['"]\)\s*\{[^}]*return\}/);

  assert.match(put, /localBaseSignature\s*=\s*undefined/);
  assert.match(put, /persistDataAndMutation\([^;]+\{\s*expectedRevision\s*,\s*localBaseSignature\s*\}/);
  assert.match(
    persist,
    /stableMutationValue\(\s*memoryStore\.get\(recordId\)\s*\)\s*!==\s*metadata\.localBaseSignature\s*\)throw localReportConflict\(\)/,
    'the memory fallback must compare the loaded base immediately before replacement'
  );
  assert.match(atomicWrite, /needsBaseCheck\s*=\s*store\s*===\s*['"]reports['"]\s*&&\s*operation\s*===\s*['"]put['"][^,]+metadata\.localBaseSignature/);
  assert.match(atomicWrite, /existingDataRequest\s*=\s*dataStore\.get\(\s*recordId\s*\)/);
  assert.match(
    atomicWrite,
    /stableMutationValue\(existingDataRequest\.result\)\s*!==\s*metadata\.localBaseSignature\s*\)\s*\{\s*abortReason\s*=\s*localReportConflict\(\)\s*;\s*transaction\.abort\(\)/,
    'the durable record must be compared inside the same transaction that writes data and outbox'
  );
});

test('report queue coalescing retains its base revision and records superseded local targets', () => {
  const create = functionSection(indexSource, 'createMutation');
  const inherit = functionSection(indexSource, 'inheritReportMutation');
  const persist = functionSection(indexSource, 'persistDataAndMutation');
  const atomicWrite = functionSection(indexSource, 'writeDataAndMutation');

  assert.match(create, /store\s*===\s*['"]reports['"]\s*&&\s*Number\.isInteger\(\s*expectedRevision\s*\)/);
  assert.match(create, /Number\.isInteger\(\s*expectedRevision\s*\)\s*&&\s*expectedRevision\s*>=\s*0/);
  assert.match(create, /mutation\.expectedRevision\s*=\s*expectedRevision/);
  assert.match(create, /acceptedBaseSignatures\s*=\s*\[\s*\]/);
  assert.match(
    create,
    /mutation\.acceptedBaseSignatures\s*=\s*\[\.\.\.new Set\(\s*acceptedBaseSignatures\s*\)\]\.slice\(\s*-10\s*\)/,
    'persisted provenance must be deduplicated and bounded'
  );

  assert.match(
    inherit,
    /mutation\.store\s*!==\s*['"]reports['"]\s*\|\|\s*mutation\.operation\s*!==\s*['"]put['"]\s*\|\|\s*prior\?\.store\s*!==\s*['"]reports['"]\s*\|\|\s*prior\.operation\s*!==\s*['"]put['"]/,
    'only report PUTs may inherit revision provenance'
  );
  assert.match(
    inherit,
    /Number\.isInteger\(\s*prior\.expectedRevision\s*\)[^;]+mutation\.expectedRevision\s*=\s*prior\.expectedRevision/,
    'the first unsynchronized base revision must survive replacement'
  );
  assert.match(
    inherit,
    /\[\.\.\.\(prior\.acceptedBaseSignatures\s*\|\|\s*\[\]\),\s*stableMutationValue\(\s*prior\.value\s*\)\]/,
    'only earlier targets from this same queued mutation chain become accepted bases'
  );
  assert.match(
    inherit,
    /mutation\.acceptedBaseSignatures\s*=\s*\[\.\.\.new Set\(\s*signatures\s*\)\]\.slice\(\s*-10\s*\)/,
    'inherited target signatures must remain deduplicated and bounded'
  );
  assert.match(
    persist,
    /memoryPrior\s*=\s*memorySyncQueue\.get\(\s*mutation\.id\s*\)\s*;\s*inheritMutationPredecessor\(\s*mutation\s*,\s*memoryPrior\s*\)/,
    'an in-memory replacement must inherit its queued predecessor'
  );
  assert.match(atomicWrite, /queueStore\.get\(\s*mutation\.id\s*\)/);
  const durableInheritance = atomicWrite.indexOf('inheritMutationPredecessor(mutation,existingMutationRequest.result)');
  const durableReplacement = atomicWrite.indexOf('queueStore.put(mutation)', durableInheritance);
  assert.ok(
    durableInheritance >= 0 && durableReplacement > durableInheritance,
    'a durable predecessor must be inherited before its replacement is written'
  );
});

test('Firebase report transactions accept only the expected or recorded superseded base', () => {
  const conflict = functionSection(syncSource, 'revisionConflict');
  const writeReport = functionSection(syncSource, 'writeReport');
  const apply = functionSection(syncSource, 'applyMutation');

  assert.match(conflict, /code\s*=\s*['"]firebase\/revision-conflict['"]/);
  assert.match(conflict, /category\s*=\s*['"]conflict['"]/);
  assert.match(writeReport, /mutation\.expectedRevision/);
  assert.match(writeReport, /runTransaction\(\s*sdk\.db\s*,\s*async transaction\s*=>/);
  assert.match(writeReport, /await transaction\.get\(\s*documentRef\s*\)/);
  assert.match(
    writeReport,
    /!snapshot\.exists\(\)[^}]+expectedRevision\s*!==\s*0[^}]+revisionConflict/,
    'only a revision-zero mutation may create a report'
  );
  assert.match(
    writeReport,
    /stableSerialize\(\s*existing\s*\)\s*===\s*stableSerialize\(\s*target\s*\)[^;]+return/,
    'an exact retry must be idempotent'
  );
  assert.match(
    writeReport,
    /const acceptedBase\s*=\s*Array\.isArray\(\s*mutation\.acceptedBaseSignatures\s*\)\s*&&\s*mutation\.acceptedBaseSignatures\.includes\(\s*stableSerialize\(\s*existing\s*\)\s*\)/,
    'a superseded base is accepted only when its exact stable signature was recorded by the queue'
  );
  assert.match(
    writeReport,
    /existing\?\._deleted\s*===\s*true\s*\|\|\s*\(Number\(\s*existing\?\.revision\s*\)\s*!==\s*expectedRevision\s*&&\s*!acceptedBase\)[^}]+revisionConflict/,
    'tombstones and content matching neither permitted base must be rejected'
  );
  assert.match(
    writeReport,
    /!Number\.isInteger\(\s*Number\(\s*target\?\.revision\s*\)\s*\)\s*\|\|\s*Number\(\s*target\.revision\s*\)\s*<=\s*Number\(\s*existing\.revision\s*\)[^}]+revisionConflict/,
    'even an accepted superseded target must advance the currently stored revision'
  );
  assert.match(writeReport, /transaction\.set\(\s*documentRef\s*,\s*target\s*\)/);
  assert.match(
    apply,
    /store\s*===\s*['"]reports['"]\s*\)\s*await writeReport\(\s*documentRef\s*,\s*trustedValue\s*,\s*mutation\s*\)/,
    'report PUTs must route through the transactional writer'
  );
});

test('terminal queue failures are quarantined without blocking independent records', () => {
  const terminal = functionSection(indexSource, 'isTerminalMutationError');
  const durableBlock = functionSection(indexSource, 'blockQueuedMutationIfCurrent');
  const block = functionSection(indexSource, 'blockMutation');
  const flush = functionSection(indexSource, 'flushCloudQueue');

  assert.match(terminal, /category\s*===\s*['"]conflict['"]/);
  assert.match(terminal, /permission-denied/);
  assert.match(terminal, /revision-conflict/);
  assert.match(durableBlock, /store\.get\(\s*mutation\.id\s*\)/);
  assert.match(
    durableBlock,
    /mutationToken\(\s*request\.result\s*\)\s*===\s*token[^}]+store\.put\(\s*\{\.\.\.request\.result\s*,\s*\.\.\.blocked\}\s*\)/,
    'quarantine updates must use the same generation-token compare-and-set as completion'
  );
  assert.match(block, /blockedAt\s*:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(block, /blockedCode\s*:\s*mutationErrorCode\(\s*error\s*\)/);
  assert.match(
    flush,
    /if\(mutation\.blockedAt\)\s*\{\s*handleCloudError\(\s*\{\s*code\s*:\s*mutation\.blockedCode\s*\|\|\s*['"]firebase\/blocked-mutation['"]\s*,\s*category\s*:\s*mutation\.blockedCategory\s*\|\|\s*['"]permission['"]\s*\}\s*\)\s*;\s*continue\s*\}/,
    'a persisted quarantine must restore its conflict or permission notice before processing continues'
  );
  assert.match(
    flush,
    /if\(isTerminalMutationError\(\s*error\s*\)\)\s*\{[^}]*await blockMutation\(\s*mutation\s*,\s*error\s*\)[^}]*continue\}/,
    'a permanent failure must be retained and the loop must continue to later records'
  );
});

test('transient queue failures use bounded exponential retry backoff', () => {
  const retry = functionSection(indexSource, 'scheduleCloudRetry');
  const flush = functionSection(indexSource, 'flushCloudQueue');
  const clear = functionSection(indexSource, 'clearCloudRetry');

  assert.match(retry, /Math\.min\(\s*60000\s*,\s*1000\s*\*\s*\(2\s*\*\*\s*Math\.min\(\s*cloudRetryAttempt\s*,\s*6\s*\)\)\s*\)/);
  assert.match(retry, /cloudRetryAttempt\+\+/);
  assert.match(retry, /setTimeout\([^}]+flushCloudQueue\(\)/);
  assert.match(clear, /clearTimeout\(\s*cloudRetryTimer\s*\)/);
  assert.match(flush, /transientFailure\s*=\s*true\s*;\s*break/);
  assert.match(flush, /if\(transientFailure\)scheduleCloudRetry\(\)/);
  assert.match(flush, /cloudRetryAttempt\s*=\s*0/);
  assert.match(flush, /if\(!remaining\.length\)clearPersistenceNotice\(\)/);
});

test('report deletion commits the report, cached attachments, audit, and cloud work as one batch', () => {
  const batch = functionSection(indexSource, 'writeReportDeleteBatch');
  const deletion = functionSection(indexSource, 'persistReportDeletion');

  assert.match(
    batch,
    /storeNames\s*=\s*\[\s*['"]reports['"]\s*,\s*['"]attachments['"]\s*,\s*['"]audit['"]\s*,\s*\.\.\.\(mutations\.length\s*\?\s*\[\s*['"]syncQueue['"]\s*\]/,
    'all local deletion effects and the optional cloud queue must share one transaction'
  );
  assert.match(batch, /reportStore\.delete\(\s*report\.id\s*\)/);
  assert.match(batch, /for\s*\(const attachment of attachments\)attachmentStore\.delete\(\s*attachment\.id\s*\)/);
  assert.match(batch, /auditStore\.put\(\s*auditEntry\s*\)/);
  assert.match(batch, /for\s*\(const mutation of mutations\)queueStore\.put\(\s*mutation\s*\)/);
  assert.match(batch, /queueStore\.get\(\s*mutation\.id\s*\)/);
  assert.match(batch, /inheritMutationPredecessor\(\s*mutation\s*,\s*request\.result\s*\)/);
  assert.match(batch, /transaction\.oncomplete\s*=/);
  assert.match(batch, /transaction\.onabort\s*=/);

  assert.match(deletion, /cloudSync\s*\?\s*\[/, 'local-only deletion must use an empty mutation list');
  assert.match(
    deletion,
    /createMutation\(\s*['"]delete['"]\s*,\s*['"]reports['"]\s*,\s*report\.id\s*,\s*report\s*,\s*\{\s*expectedRevision\s*:\s*Number\(report\.revision\)\s*\}\s*\)/,
    'the report tombstone must carry the locally observed active revision'
  );
  assert.doesNotMatch(
    deletion,
    /createMutation\([^)]*['"]attachment/,
    'local attachments must be deleted locally, never queued for Firebase'
  );
  assert.match(deletion, /createMutation\(\s*['"]put['"]\s*,\s*['"]audit['"]/);
  assert.match(deletion, /for\(const mutation of mutations\)inheritMutationPredecessor\(\s*mutation\s*,\s*memorySyncQueue\.get\(mutation\.id\)\s*\)/);
  assert.match(deletion, /await writeReportDeleteBatch\(\s*report\s*,\s*attachments\s*,\s*auditEntry\s*,\s*mutations\s*\)/);
});

test('report tombstones use revision-aware Firebase transactions and matching rules', () => {
  const inheritDeletion = functionSection(indexSource, 'inheritReportDeletion');
  const tombstone = functionSection(syncSource, 'reportTombstone');
  const writeTombstone = functionSection(syncSource, 'writeReportTombstone');
  const apply = functionSection(syncSource, 'applyMutation');
  const tombstoneRule = functionSection(rulesSource, 'isValidReportTombstone');
  const activeRule = functionSection(rulesSource, 'isValidActiveReport');
  const reportsStart = rulesSource.indexOf('match /reports/{reportId}');
  const reportsEnd = rulesSource.indexOf('\n    match /', reportsStart + 1);
  const reportRules = rulesSource.slice(reportsStart, reportsEnd < 0 ? rulesSource.length : reportsEnd);

  assert.match(inheritDeletion, /mutation\.operation\s*!==\s*['"]delete['"]/);
  assert.match(inheritDeletion, /Number\.isInteger\(prior\.expectedRevision\)[^;]+mutation\.expectedRevision\s*=\s*prior\.expectedRevision/);
  assert.match(
    inheritDeletion,
    /prior\.operation\s*===\s*['"]put['"]\s*\?\s*stableMutationValue\(prior\.value\)\s*:\s*(['"])\1/,
    'deleting a locally superseded report must retain its accepted predecessor signature'
  );

  assert.match(tombstone, /baseRevision\s*[,}]/, 'the Firebase tombstone payload must declare its active base revision');
  assert.match(writeTombstone, /mutation\.expectedRevision/);
  assert.match(writeTombstone, /runTransaction\(\s*sdk\.db\s*,\s*async transaction\s*=>/);
  assert.match(writeTombstone, /await transaction\.get\(\s*documentRef\s*\)/);
  assert.match(
    writeTombstone,
    /!snapshot\.exists\(\)[^}]+expectedRevision\s*!==\s*0[^}]+revisionConflict[^}]+reportTombstone\(\s*value\s*,\s*mutation\.recordId\s*,\s*mutation\s*,\s*0\s*\)/,
    'creating a tombstone for an unsynchronized report is allowed only from base revision zero'
  );
  assert.match(writeTombstone, /acceptedBaseSignatures\.includes\(\s*stableSerialize\(existing\)\s*\)/);
  assert.match(
    writeTombstone,
    /existing\?\._deleted\s*===\s*true\s*\|\|\s*\(Number\(existing\.revision\)\s*!==\s*expectedRevision\s*&&\s*!acceptedBase\)[^}]+revisionConflict/,
    'a deletion must reject tombstones and active content matching neither permitted base'
  );
  assert.match(writeTombstone, /transaction\.set\(\s*documentRef\s*,\s*target\s*\)/);
  assert.match(
    apply,
    /store\s*===\s*['"]reports['"]\s*\)\s*\{\s*await writeReportTombstone\(\s*documentRef\s*,\s*value\s*,\s*mutation\s*\)/,
    'report DELETE mutations must route through the transaction'
  );

  assert.match(tombstoneRule, /['"]baseRevision['"]/);
  assert.match(tombstoneRule, /data\.baseRevision\s+is\s+int/);
  assert.match(tombstoneRule, /data\.baseRevision\s*>=\s*0/);
  assert.match(activeRule, /!\(\s*['"]baseRevision['"]\s+in\s+data\s*\)/);
  assert.match(
    reportRules,
    /isValidReportTombstone\(reportId,\s*request\.resource\.data\)\s*&&\s*request\.resource\.data\.baseRevision\s*==\s*0/,
    'rules must permit tombstone creation only for an unsynchronized revision-zero report'
  );
  assert.match(
    reportRules,
    /isValidReportTombstone\(reportId,\s*request\.resource\.data\)\s*&&\s*request\.resource\.data\.baseRevision\s*==\s*resource\.data\.revision/,
    'rules must bind an active-to-tombstone update to the currently stored active revision'
  );
});

test('logout and every opened account clear patient-specific print and notification state', () => {
  const resetHelpers = declaredFunctionNames(indexSource)
    .filter(name => clearsSensitiveSessionState(functionSection(indexSource, name)));

  assert.ok(resetHelpers.length > 0, 'a complete print/notification state reset must exist');
  for (const boundary of ['openSession', 'logout']) {
    const section = functionSection(indexSource, boundary);
    const resetsDirectly = clearsSensitiveSessionState(section);
    const callsResetHelper = resetHelpers.some(name => new RegExp(`\\b${name}\\s*\\(`).test(section));
    assert.ok(
      resetsDirectly || callsResetHelper,
      `${boundary} must hide and clear print output, recipient, override, and print report id`
    );
  }
});

test('role-sensitive local operations retain defense-in-depth guards', () => {
  for (const name of [
    'renderAppointments',
    'updateAppointmentStatus',
    'savePayment',
    'openFinance',
    'archivePatient',
    'saveAppointment',
    'exportBackup'
  ]) {
    assertLaboratoryGuard(name);
  }

  const access = functionSection(indexSource, 'canAccessReport');
  assert.match(access, /currentUser\.role\s*===\s*['"]Laborator['"]/);
  assert.match(access, /report\.type\s*===\s*['"]specialist['"]/);
  assert.match(access, /report\.specialty\s*===\s*currentUser\.role/);
  assert.match(functionSection(indexSource, 'renderReports'), /canAccessReport\(r\)/);
  assert.match(functionSection(indexSource, 'loadReport'), /canAccessReport\(r\)/);
  assert.match(functionSection(indexSource, 'deleteReport'), /canAccessReport\(report\)/);
  const printGuard = lastAssignmentLine(indexSource, 'showPrint');
  assert.match(printGuard, /showPrint\s*=\s*id\s*=>\s*runDataAction\(\s*async\s*\(\)\s*=>/);
  assert.match(printGuard, /report\s*=\s*await get\(\s*['"]reports['"]\s*,\s*id\s*\)/);
  assert.match(
    printGuard,
    /if\(\s*!canAccessReport\(\s*report\s*\)\s*\)\s*\{[^}]*return\}/,
    'the public print wrapper must reject inaccessible reports'
  );
  const printAccessCheck = printGuard.indexOf('canAccessReport(report)');
  const authorizedPrint = printGuard.indexOf('await showAuthorizedPrint(id)');
  assert.ok(printAccessCheck >= 0 && authorizedPrint > printAccessCheck, 'printing must occur only after the access check');
  assert.match(functionSection(indexSource, 'login'), /identity\.role\s*!==\s*expected\.role/);
});

test('Firestore rules bind specialist and payment identities to authenticated claims', () => {
  const login = functionSection(indexSource, 'login');
  const specialistIdentity = functionSection(rulesSource, 'specialistIdentityMatches');
  const canWriteReport = functionSection(rulesSource, 'canWriteReport');
  const validPayment = functionSection(rulesSource, 'validPayment');

  assert.match(specialistIdentity, /request\.auth\.token\.get\(\s*['"]name['"]\s*,\s*(['"])\1\s*\)/);
  assert.match(specialistIdentity, /request\.auth\.token\.get\(\s*['"]title['"]\s*,\s*(['"])\1\s*\)/);
  assert.match(
    specialistIdentity,
    /data\.clinician\s*==\s*request\.auth\.token\.get\(\s*['"]name['"]\s*,\s*(['"])\1\s*\)/,
    'a specialist cannot write a different clinician name than the authenticated claim'
  );
  assert.match(
    specialistIdentity,
    /data\.clinicianTitle\s*==\s*request\.auth\.token\.get\(\s*['"]title['"]\s*,\s*(['"])\1\s*\)/,
    'a specialist cannot write a different clinician title than the authenticated claim'
  );
  assert.match(
    canWriteReport,
    /isLab\(\)\s*\|\|\s*\(\s*specialistCanAccess\(data\)\s*&&\s*\(\s*data\.get\(\s*['"]_deleted['"]\s*,\s*false\s*\)\s*==\s*true\s*\|\|\s*specialistIdentityMatches\(data\)\s*\)/,
    'same-specialty tombstones must remain deletable without weakening identity checks for active reports'
  );

  assert.match(validPayment, /request\.auth\.token\.email\s+is\s+string/);
  assert.match(
    validPayment,
    /data\.recordedBy\s*==\s*request\.auth\.token\.email/,
    'payment attribution must be owned by the authenticated email'
  );

  assert.match(
    login,
    /identity\.email\s*!==\s*email\s*\|\|\s*identity\.role\s*!==\s*expected\.role\s*\|\|\s*identity\.name\s*!==\s*expected\.name\s*\|\|\s*identity\.title\s*!==\s*expected\.title/,
    'configured login must match every Firebase identity field to the exact built-in account profile'
  );
  const identityMismatch = login.indexOf('identity.email!==email');
  const forcedSignOut = login.indexOf('await window.BioengFirebase.signOut()', identityMismatch);
  const sessionOpen = login.indexOf('await openSession(', identityMismatch);
  assert.ok(
    identityMismatch >= 0 && forcedSignOut > identityMismatch && sessionOpen > forcedSignOut,
    'a mismatched Firebase identity must be signed out before any local session can open'
  );
});

test('Firebase queries preserve the five account-role scopes', () => {
  for (const role of ['Laborator', 'Pulmologji', 'Kardiologji', 'Neurologji', 'Hixhame']) {
    assert.match(syncSource, new RegExp(`['"]${role}['"]`));
  }

  const scopedCollection = functionSection(syncSource, 'scopedCollection');
  assert.match(scopedCollection, /where\(\s*['"]type['"]\s*,\s*['"]==['"]\s*,\s*['"]specialist['"]\s*\)/);
  assert.match(scopedCollection, /where\(\s*['"]specialty['"]\s*,\s*['"]==['"]\s*,\s*role\s*\)/);
  assert.match(functionSection(syncSource, 'storesForRole'), /\[\s*['"]patients['"]\s*,\s*['"]reports['"]\s*\]/);
});

test('the one-time JSON importer stays isolated from production browser code', () => {
  assert.ok(fs.existsSync(IMPORTER_PATH), 'the one-time importer should remain a separate tool');
  const productionSource = `${indexSource}\n${syncSource}\n${configSource}`;

  for (const forbidden of [
    /tools\/firebase-import/i,
    /firebase-admin/i,
    /service\s*account/i,
    /accounts\.example\.json/i,
    /import\.mjs/i
  ]) {
    assert.doesNotMatch(productionSource, forbidden);
  }

  assert.doesNotMatch(indexSource, /\b(?:importBackup|restoreBackup|importJsonBackup|firebaseImport)\b/i);
  assert.match(indexSource, /function\s+exportBackup\s*\(/, 'the existing export-only behavior must remain available');
});
