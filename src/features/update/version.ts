// Which version of the app the site serves now, compared with the one this page runs.

/**
 * The build this page was loaded from. Empty when served without vite.config.ts's id (a dev
 * server started before the config changed): then there is nothing to compare, no check.
 */
export const RUNNING_VERSION: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

export type DeployedVersion =
  | { kind: 'version'; id: string }
  /** No /version.json: the site serves an app without one, such as the old app after a rollback. */
  | { kind: 'missing' }
  /** Offline, a server error or an unreadable answer: nothing is known, try again later. */
  | { kind: 'unknown' };

export async function readDeployedVersion(fetchFn: typeof fetch = fetch): Promise<DeployedVersion> {
  try {
    const response = await fetchFn('/version.json', { cache: 'no-store' });
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'unknown' };
    const body: unknown = await response.json();
    const id = typeof body === 'object' && body !== null ? (body as { version?: unknown }).version : undefined;
    return typeof id === 'string' && id ? { kind: 'version', id } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

/** Has another version been deployed since this page loaded? */
export function isOtherDeployment(running: string, deployed: DeployedVersion): boolean {
  return deployed.kind === 'missing' || (deployed.kind === 'version' && deployed.id !== running);
}
