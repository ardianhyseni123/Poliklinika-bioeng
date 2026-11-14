import { onSnapshot, type DocumentData, type Firestore, type Query, type Unsubscribe } from 'firebase/firestore';
import type { ZodSafeParseResult } from 'zod';
import type { Role } from '../auth/roles';
import type { WriteTracker } from './journal';

/** The signed-in person a write is made as. */
export interface Actor {
  uid: string;
  email: string;
  role: Role;
  name: string;
  title: string;
}

export interface DataContext {
  db: Firestore;
  actor: Actor;
  tracker: WriteTracker;
  now(): string;
  newId(): string;
}

export function createContext(db: Firestore, actor: Actor, tracker: WriteTracker): DataContext {
  return {
    db,
    actor: { ...actor, email: actor.email.toLowerCase() },
    tracker,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID()
  };
}

/** Thrown before anything is sent when a record does not match its schema. */
export class ValidationError extends Error {
  constructor(readonly what: string, readonly issues: string[]) {
    super(`${what} is not valid: ${issues.join('; ')}`);
    this.name = 'ValidationError';
  }
}

export function validated<T>(what: string, result: ZodSafeParseResult<T>): T {
  if (result.success) return result.data;
  throw new ValidationError(what, result.error.issues.map(issue => `${issue.path.join('.') || '(record)'}: ${issue.message}`));
}

/** What a written-but-unconfirmed record looks like to callers. */
export interface Written<T> {
  record: T;
  /** Settles when the server answers; never needed for the screen to update. */
  done: Promise<void>;
}

export interface Snapshot<T> {
  items: T[];
  /** Documents that do not match the expected shape; shown as a warning, never dropped silently. */
  invalid: Array<{ id: string; issues: string }>;
  /** True while the data comes from this device's copy only. */
  fromCache: boolean;
  /** Ids of documents with local changes not yet confirmed by the server. */
  pendingIds: Set<string>;
}

export function watchQuery<T>(
  query: Query<DocumentData>,
  parse: (data: DocumentData, id: string) => ZodSafeParseResult<T>,
  onData: (snapshot: Snapshot<T>) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(query, { includeMetadataChanges: true }, snapshot => {
    const items: T[] = [];
    const invalid: Snapshot<T>['invalid'] = [];
    const pendingIds = new Set<string>();
    for (const document of snapshot.docs) {
      const result = parse(document.data(), document.id);
      if (result.success) items.push(result.data);
      else invalid.push({ id: document.id, issues: result.error.issues.map(issue => issue.message).join('; ') });
      if (document.metadata.hasPendingWrites) pendingIds.add(document.id);
    }
    onData({ items, invalid, fromCache: snapshot.metadata.fromCache, pendingIds });
  }, onError);
}
