import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Profile } from '../auth/roles';
import { db } from '../firebase/init';
import { AttachmentStore } from '../local/attachments';
import { createContext as createDataContext, type DataContext } from './context';
import { Journal, type JournalEntry } from './journal';
import { rescueLegacyChanges, type MarkerStore, type RescueSummary } from './legacyRescue';

export interface DataApi {
  ctx: DataContext;
  journal: Journal;
  attachments: AttachmentStore;
  rescue: RescueSummary | null;
}

const DataContextReact = createContext<DataApi | null>(null);

const markers: MarkerStore = {
  getItem: key => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key, value) => {
    try { window.localStorage.setItem(key, value); } catch { /* storage unavailable: the rescue simply runs again */ }
  }
};

/** Opens this person's device stores, re-checks unconfirmed writes, and rescues old-app changes. */
export function DataProvider({ uid, profile, children }: { uid: string; profile: Profile; children: ReactNode }) {
  const [api, setApi] = useState<DataApi | null>(null);
  const { email, role, name, title } = profile;

  useEffect(() => {
    let cancelled = false;
    let journal: Journal | null = null;
    let attachments: AttachmentStore | null = null;

    void (async () => {
      journal = await Journal.open(email);
      attachments = await AttachmentStore.open(email);
      if (cancelled) return;
      const ctx = createDataContext(db, { uid, email, role, name, title }, journal);
      setApi({ ctx, journal, attachments, rescue: null });

      // Writes from an earlier page load: checked once the queue has reached the server.
      journal.verify(db).catch(error => console.warn('Could not verify earlier writes.', error));

      const openJournal = journal;
      const rescue = await rescueLegacyChanges({
        ctx,
        uid,
        attachments,
        recordFailure: (input, error) => openJournal.recordFailure(input, error),
        markers
      });
      if (!cancelled) setApi(current => (current ? { ...current, rescue } : current));
    })().catch(error => console.error('Could not open the local stores.', error));

    return () => {
      cancelled = true;
      journal?.close();
      attachments?.close();
    };
  }, [uid, email, role, name, title]);

  if (!api) return null;
  return <DataContextReact.Provider value={api}>{children}</DataContextReact.Provider>;
}

export function useData(): DataApi {
  const api = useContext(DataContextReact);
  if (!api) throw new Error('useData must be used inside DataProvider.');
  return api;
}

export function useOptionalData(): DataApi | null {
  return useContext(DataContextReact);
}

const EMPTY: { pending: JournalEntry[]; failed: JournalEntry[] } = { pending: [], failed: [] };

/** Writes not yet confirmed by the server, and writes it refused. */
export function useJournalState(journal: Journal | undefined): { pending: JournalEntry[]; failed: JournalEntry[] } {
  return useSyncExternalStore(
    listener => journal?.subscribe(listener) ?? (() => undefined),
    () => (journal ? journal.snapshot() : EMPTY)
  );
}
