// The write journal: a safety net under Firestore's offline queue.
//
// With the offline cache, a write applies locally at once and its promise only settles when
// the server answers. If the server refuses it, the SDK quietly rolls it back; and if the page
// was reloaded in between, nobody is listening any more. So every important write is first
// recorded here, on this device, with a copy of its content:
// - the write is confirmed by the server  -> the entry is removed;
// - the write is refused while we wait     -> the entry is marked failed (content kept);
// - the page was reloaded before an answer -> after the next sync, verify() asks the server
//   whether the document arrived, and marks the entry failed if it did not.
// Failed entries stay until a person has seen them, so no clinical content is lost silently.

import { doc, getDocFromServer, waitForPendingWrites, type Firestore } from 'firebase/firestore';
import { deleteKeys, getAll, openDatabase, putOne } from '../local/idb';

export type JournalCheck =
  | { path: string; expect: 'exists' }
  | { path: string; expect: 'field'; field: string; value: string | number | boolean };

export interface JournalEntry {
  id: string;
  email: string;
  /** Short description shown to the user, e.g. "Raport: Arta Krasniqi". */
  label: string;
  check: JournalCheck;
  /** The data that was written, so it can be recovered if the write failed. */
  content: unknown;
  createdAt: string;
  state: 'pending' | 'failed';
  error?: string;
}

export type TrackInput = Pick<JournalEntry, 'id' | 'label' | 'check' | 'content'>;

export interface WriteTracker {
  track(input: TrackInput, commit: Promise<void>): void;
}

/** For callers (and tests) that do not need the journal. */
export const untracked: WriteTracker = {
  track(_input, commit) {
    commit.catch(error => console.error('A write failed.', error));
  }
};

const DB_NAME = 'bioeng-journal';
const STORE = 'entries';

export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === 'string') return code;
    if (typeof message === 'string') return message;
  }
  return typeof error === 'string' ? error : 'unknown';
}

export class Journal implements WriteTracker {
  private readonly entries = new Map<string, JournalEntry>();
  private readonly listeners = new Set<() => void>();
  /** Writes whose promise this page still holds; verify() leaves them to their promise. */
  private readonly live = new Set<string>();
  private work: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(private readonly db: IDBDatabase, readonly email: string) {}

  static async open(email: string): Promise<Journal> {
    const db = await openDatabase(DB_NAME, 1, database => {
      database.createObjectStore(STORE, { keyPath: 'id' }).createIndex('email', 'email');
    });
    const journal = new Journal(db, email);
    for (const entry of await getAll<JournalEntry>(db, STORE, 'email', email)) journal.entries.set(entry.id, entry);
    return journal;
  }

  /**
   * Storage operations already queued still finish (a write confirmed just before the page
   * closes the journal is removed from storage); later ones are skipped and settled by
   * verify() on the next load.
   */
  close(): void {
    this.closed = true;
    void this.work.then(() => this.db.close());
  }

  track(input: TrackInput, commit: Promise<void>): void {
    const entry: JournalEntry = { ...input, email: this.email, createdAt: new Date().toISOString(), state: 'pending' };
    this.entries.set(entry.id, entry);
    this.live.add(entry.id);
    void this.serial(() => putOne(this.db, STORE, entry));
    this.notify();
    void commit.then(
      () => this.confirm(entry.id),
      error => this.fail(entry.id, errorCode(error))
    ).finally(() => this.live.delete(entry.id));
  }

  private cachedSnapshot: { pending: JournalEntry[]; failed: JournalEntry[] } | null = null;

  /** A stable view for React: the same object until something changes. */
  snapshot(): { pending: JournalEntry[]; failed: JournalEntry[] } {
    this.cachedSnapshot ??= { pending: this.pending(), failed: this.failed() };
    return this.cachedSnapshot;
  }

  pending(): JournalEntry[] {
    return [...this.entries.values()].filter(entry => entry.state === 'pending');
  }

  failed(): JournalEntry[] {
    return [...this.entries.values()].filter(entry => entry.state === 'failed');
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Records content that could not be written at all, so a person can recover it. */
  recordFailure(input: TrackInput, error: string): void {
    const entry: JournalEntry = { ...input, email: this.email, createdAt: new Date().toISOString(), state: 'failed', error };
    this.entries.set(entry.id, entry);
    void this.serial(() => putOne(this.db, STORE, entry));
    this.notify();
  }

  /** The user has seen a failed write and saved its content elsewhere. */
  dismiss(id: string): Promise<void> {
    return this.confirm(id);
  }

  /** Resolves when every journal write so far has reached IndexedDB. */
  flushed(): Promise<void> {
    return this.work.then(() => undefined);
  }

  /**
   * After the offline queue has reached the server, checks entries left over from an
   * earlier page load. Waits as long as the device is offline.
   */
  async verify(firestore: Firestore): Promise<void> {
    await waitForPendingWrites(firestore);
    for (const entry of this.pending()) {
      if (this.live.has(entry.id)) continue;
      try {
        const snapshot = await getDocFromServer(doc(firestore, entry.check.path));
        const arrived = snapshot.exists()
          && (entry.check.expect === 'exists' || snapshot.get(entry.check.field) === entry.check.value);
        if (arrived) await this.confirm(entry.id);
        else await this.fail(entry.id, 'not-on-server');
      } catch (error) {
        // Offline again, or no longer allowed to read it: try again next time.
        console.warn('Could not verify a journal entry.', errorCode(error));
      }
    }
  }

  private confirm(id: string): Promise<void> {
    this.entries.delete(id);
    const stored = this.serial(() => deleteKeys(this.db, STORE, [id]));
    this.notify();
    return stored;
  }

  private fail(id: string, error: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve();
    const failed: JournalEntry = { ...entry, state: 'failed', error };
    this.entries.set(id, failed);
    const stored = this.serial(() => putOne(this.db, STORE, failed));
    this.notify();
    return stored;
  }

  // IndexedDB operations run one after another, so a quick confirmation cannot overtake
  // the write that recorded the entry. They are queued before listeners hear of a change,
  // so a listener that closes the journal still lets them finish.
  private serial(operation: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.resolve();
    const next = this.work.then(operation, operation);
    this.work = next.catch(error => console.error('Write journal storage failed.', error));
    return next;
  }

  private notify(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }
}
