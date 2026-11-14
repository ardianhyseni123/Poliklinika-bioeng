// Live Firestore data for React. Each query becomes one shared store: any number of
// components can watch it, Firestore gets one listener, and the listener stops shortly after
// the last component stops watching.

import { useSyncExternalStore } from 'react';
import type { Unsubscribe } from 'firebase/firestore';
import type { Snapshot } from '../data/context';

export interface Live<T> extends Snapshot<T> {
  loading: boolean;
  error: Error | null;
}

type Start<T> = (onData: (snapshot: Snapshot<T>) => void, onError: (error: Error) => void) => Unsubscribe;

interface LiveStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Live<T>;
}

function emptyLive<T>(loading: boolean): Live<T> {
  return { items: [], invalid: [], fromCache: true, pendingIds: new Set(), loading, error: null };
}

const IDLE = emptyLive<never>(false);
const stores = new Map<string, LiveStore<unknown>>();

function liveStore<T>(key: string, start: Start<T>): LiveStore<T> {
  const existing = stores.get(key) as LiveStore<T> | undefined;
  if (existing) return existing;
  let state: Live<T> = emptyLive<T>(true);
  const listeners = new Set<() => void>();
  let stop: Unsubscribe | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => listeners.forEach(listener => listener());

  const store: LiveStore<T> = {
    subscribe: listener => {
      listeners.add(listener);
      if (stopTimer) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }
      stop ??= start(
        snapshot => {
          state = { ...snapshot, loading: false, error: null };
          notify();
        },
        error => {
          // Logout stops Firestore while listeners are still open; that is not a failure.
          if (/shutting down/i.test(error.message)) return;
          console.error(`Live data "${key}" failed.`, error);
          state = { ...state, loading: false, error };
          notify();
        }
      );
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        stopTimer = setTimeout(() => {
          stop?.();
          stop = null;
          stores.delete(key);
        }, 1000);
      };
    },
    getSnapshot: () => state
  };
  stores.set(key, store);
  return store;
}

const noSubscription = () => () => undefined;

/**
 * Watches a query. `key` names it (include who is asking, since role decides what a query
 * returns); null watches nothing.
 */
export function useLive<T>(key: string | null, start: Start<T>): Live<T> {
  const store = key ? liveStore(key, start) : null;
  return useSyncExternalStore<Live<T>>(
    store ? store.subscribe : noSubscription,
    store ? store.getSnapshot : () => IDLE
  );
}
