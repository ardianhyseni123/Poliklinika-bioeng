// Report version history as a tree. Each version names the version it was based on
// (baseVersionId) and may list branches it settled (resolves). A version nothing else builds
// on or settles is an open branch; more than one open branch on a live report means two
// devices edited it concurrently and someone must choose what the report should say.

export interface VersionNode {
  id: string;
  kind: 'save' | 'delete';
  baseVersionId: string;
  resolves: string[];
  revision: number;
  savedAt: string;
  savedBy: string;
}

export function openBranches<T extends VersionNode>(versions: T[]): T[] {
  const continued = new Set<string>();
  for (const version of versions) {
    if (version.baseVersionId) continued.add(version.baseVersionId);
    for (const id of version.resolves) continued.add(id);
  }
  return versions.filter(version => !continued.has(version.id));
}

export interface Conflict<T extends VersionNode> {
  /** The version the report currently shows. */
  current: T | undefined;
  /** Other open branches: edits the current version never saw. */
  others: T[];
}

/**
 * The conflict on a report, or null. A deleted report has none: deletion is final, and
 * edits it overtook remain readable in the history.
 */
export function findConflict<T extends VersionNode>(
  head: { lastVersionId?: string; _deleted?: boolean },
  versions: T[]
): Conflict<T> | null {
  if (head._deleted === true) return null;
  const open = openBranches(versions);
  if (open.length < 2) return null;
  const current = open.find(version => version.id === head.lastVersionId);
  const others = open
    .filter(version => version.id !== head.lastVersionId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return { current, others };
}
