// The analysis list with its reference ranges. Unlike everything else, saving it needs a
// connection: one transaction checks that nobody saved a newer list meanwhile, then writes the
// new revision and its change-log entry together (the rules require both).

import { collection, doc, onSnapshot, runTransaction, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { validated, watchQuery, type DataContext, type Snapshot } from './context';
import { CatalogHistorySchema, CatalogSchema, type Catalog, type CatalogCategory, type CatalogHistoryEntry } from './schemas';

export const CATALOG_PATH = 'analysisCatalog/current';

export class CatalogConflictError extends Error {
  constructor() {
    super('The analysis list was changed on another device.');
    this.name = 'CatalogConflictError';
  }
}

/**
 * Laboratory only. Calls back with null while no list has been saved yet; `fromCache` says
 * whether that answer came from this device only (so "no list" may just mean "offline").
 */
export function watchCatalog(
  db: Firestore,
  onData: (catalog: Catalog | null, invalid: string | null, fromCache: boolean) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(doc(db, CATALOG_PATH), { includeMetadataChanges: true }, snapshot => {
    const fromCache = snapshot.metadata.fromCache;
    if (!snapshot.exists()) {
      onData(null, null, fromCache);
      return;
    }
    const result = CatalogSchema.safeParse(snapshot.data());
    onData(result.success ? result.data : null, result.success ? null : result.error.message, fromCache);
  }, onError);
}

export function watchCatalogHistory(db: Firestore, onData: (snapshot: Snapshot<CatalogHistoryEntry>) => void, onError: (error: Error) => void): Unsubscribe {
  return watchQuery(collection(db, 'catalogHistory'), data => CatalogHistorySchema.safeParse(data), onData, onError);
}

export interface CatalogChange {
  target: string;
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Saves `categories` as the revision after `expectedRevision` (0 when no list exists yet).
 * Rejects with CatalogConflictError when someone saved first, and with Firestore's
 * 'unavailable' error when offline.
 */
export async function saveCatalog(
  ctx: DataContext,
  categories: CatalogCategory[],
  expectedRevision: number,
  changes: CatalogChange[]
): Promise<Catalog> {
  const now = ctx.now();
  const catalog = validated('Lista e analizave', CatalogSchema.safeParse({
    id: 'current',
    revision: expectedRevision + 1,
    updatedAt: now,
    updatedBy: ctx.actor.email,
    categories
  }));
  const entry = validated('Historiku i listës', CatalogHistorySchema.safeParse({
    id: ctx.newId(),
    at: now,
    by: ctx.actor.email,
    revision: catalog.revision,
    changes: changes.slice(0, 500)
  }));
  const catalogRef = doc(ctx.db, CATALOG_PATH);
  await runTransaction(ctx.db, async transaction => {
    const stored = await transaction.get(catalogRef);
    const storedRevision = stored.exists() ? Number(stored.data().revision) : 0;
    if (storedRevision !== expectedRevision) throw new CatalogConflictError();
    transaction.set(catalogRef, catalog);
    transaction.set(doc(ctx.db, 'catalogHistory', entry.id), entry);
  });
  return catalog;
}
