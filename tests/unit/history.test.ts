import { describe, expect, test } from 'vitest';
import { findConflict, openBranches, type VersionNode } from '../../src/domain/history';

let clock = 0;
function v(id: string, baseVersionId: string, extra: Partial<VersionNode> = {}): VersionNode {
  clock += 1;
  return { id, baseVersionId, resolves: [], kind: 'save', revision: 1, savedAt: `2026-11-14T10:00:${String(clock).padStart(2, '0')}Z`, savedBy: 'x', ...extra };
}

describe('report history', () => {
  test('a straight line of edits has one open branch and no conflict', () => {
    const versions = [v('a', ''), v('b', 'a'), v('c', 'b')];
    expect(openBranches(versions).map(x => x.id)).toEqual(['c']);
    expect(findConflict({ lastVersionId: 'c' }, versions)).toBeNull();
  });

  test('two devices editing the same version is a conflict', () => {
    const versions = [v('a', ''), v('b', 'a'), v('offline', 'a')];
    const conflict = findConflict({ lastVersionId: 'offline' }, versions);
    expect(conflict?.current?.id).toBe('offline');
    expect(conflict?.others.map(x => x.id)).toEqual(['b']);
  });

  test('a later save that never saw the offline edit does not hide it', () => {
    // B saves twice online (b1, b2) while A, offline since version a, saves once.
    const versions = [v('a', ''), v('b1', 'a'), v('b2', 'b1'), v('a2', 'a')];
    const conflict = findConflict({ lastVersionId: 'a2' }, versions);
    expect(conflict?.others.map(x => x.id)).toEqual(['b2']);
  });

  test('a save that resolves the other branch ends the conflict', () => {
    const versions = [v('a', ''), v('b', 'a'), v('c', 'a'), v('merged', 'c', { resolves: ['b'] })];
    expect(findConflict({ lastVersionId: 'merged' }, versions)).toBeNull();
  });

  test('a deleted report shows no conflict', () => {
    const versions = [v('a', ''), v('b', 'a'), v('gone', 'a', { kind: 'delete' })];
    expect(findConflict({ lastVersionId: 'gone', _deleted: true }, versions)).toBeNull();
  });

  test('reports from the old app have no versions and no conflict', () => {
    expect(findConflict({}, [])).toBeNull();
  });
});
