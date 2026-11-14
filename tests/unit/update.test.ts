import { expect, test } from 'vitest';
import { hasUnsavedWork, holdUnsavedWork, subscribeUnsavedWork } from '../../src/features/update/unsavedWork';
import { isOtherDeployment, readDeployedVersion, RUNNING_VERSION } from '../../src/features/update/version';

const answer = (status: number, body: string) => (() => Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

test('every build carries an id', () => {
  expect(typeof RUNNING_VERSION).toBe('string');
  expect(RUNNING_VERSION.length).toBeGreaterThan(0);
});

test('reads the deployed version from /version.json, uncached', async () => {
  let seen: { url: unknown; init: RequestInit | undefined } | null = null;
  const fetchFn = ((url: unknown, init?: RequestInit) => {
    seen = { url, init };
    return Promise.resolve(new Response(JSON.stringify({ version: 'build-2' }), { status: 200 }));
  }) as unknown as typeof fetch;
  expect(await readDeployedVersion(fetchFn)).toEqual({ kind: 'version', id: 'build-2' });
  expect(seen).toEqual({ url: '/version.json', init: { cache: 'no-store' } });
});

test('a missing version file counts as another deployment, anything unclear as unknown', async () => {
  expect(await readDeployedVersion(answer(404, 'Not Found'))).toEqual({ kind: 'missing' });
  expect(await readDeployedVersion(answer(500, 'oops'))).toEqual({ kind: 'unknown' });
  expect(await readDeployedVersion(answer(200, '<html>captive portal</html>'))).toEqual({ kind: 'unknown' });
  expect(await readDeployedVersion(answer(200, '{"version":""}'))).toEqual({ kind: 'unknown' });
  const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
  expect(await readDeployedVersion(offline)).toEqual({ kind: 'unknown' });
});

test('only a different id or a missing file means another deployment', () => {
  expect(isOtherDeployment('build-1', { kind: 'version', id: 'build-1' })).toBe(false);
  expect(isOtherDeployment('build-1', { kind: 'version', id: 'build-2' })).toBe(true);
  expect(isOtherDeployment('build-1', { kind: 'missing' })).toBe(true);
  expect(isOtherDeployment('build-1', { kind: 'unknown' })).toBe(false);
});

test('unsaved work is held until every holder releases it, and listeners hear each change', () => {
  let changes = 0;
  const unsubscribe = subscribeUnsavedWork(() => { changes += 1; });
  expect(hasUnsavedWork()).toBe(false);
  const releaseReport = holdUnsavedWork();
  const releasePayment = holdUnsavedWork();
  expect(hasUnsavedWork()).toBe(true);
  releaseReport();
  releaseReport();
  expect(hasUnsavedWork()).toBe(true);
  releasePayment();
  expect(hasUnsavedWork()).toBe(false);
  expect(changes).toBe(4);
  unsubscribe();
});
