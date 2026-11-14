import { useEffect, useSyncExternalStore } from 'react';

// Forms report here while they hold typed work that is not saved yet, and the app while
// changes still wait for the server. A new app version holds back its reload screen until
// nothing is left, so a reload never throws work away.

const holders = new Set<symbol>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Marks work as unsaved until the returned function is called. */
export function holdUnsavedWork(): () => void {
  const token = Symbol('unsaved work');
  holders.add(token);
  notify();
  return () => {
    if (holders.delete(token)) notify();
  };
}

export function hasUnsavedWork(): boolean {
  return holders.size > 0;
}

export function subscribeUnsavedWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call with whether this component currently holds unsaved work. */
export function useUnsavedWork(unsaved: boolean): void {
  useEffect(() => (unsaved ? holdUnsavedWork() : undefined), [unsaved]);
}

export function useHasUnsavedWork(): boolean {
  return useSyncExternalStore(subscribeUnsavedWork, hasUnsavedWork);
}
