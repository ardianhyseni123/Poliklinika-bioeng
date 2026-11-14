// The live data the workspace sections share, scoped to the signed-in person's role.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import { can } from '../../auth/permissions';
import { isSpecialty } from '../../auth/roles';
import { useData } from '../../data/DataProvider';
import { watchAppointments } from '../../data/appointments';
import { saveCatalog, watchCatalog, watchCatalogHistory } from '../../data/catalog';
import type { Snapshot } from '../../data/context';
import { watchPatient, watchPatients } from '../../data/patients';
import { watchPayments } from '../../data/payments';
import { watchReports, watchVersions } from '../../data/reports';
import {
  isTombstone,
  type Appointment,
  type Catalog,
  type CatalogHistoryEntry,
  type Patient,
  type Payment,
  type Report,
  type ReportHead,
  type User,
  type Version
} from '../../data/schemas';
import { watchUsers } from '../../data/users';
import { isOldPatient } from '../../domain/assignment';
import { buildSeedCategories, countAnalyses } from '../../domain/catalog';
import { findConflict, type Conflict } from '../../domain/history';
import { useLive, type Live } from '../live';

export function useWorkspaceData() {
  const { ctx } = useData();
  const { db, actor } = ctx;
  const who = `${actor.email}|${actor.role}`;
  const lab = can(actor, 'payments.manage');
  const editsCatalog = can(actor, 'catalog.edit');

  const specialist = isSpecialty(actor.role);

  const assigned = useLive<Patient>(`${who}|patients`, (onData, onError) => watchPatients(db, actor, onData, onError));
  const reports = useLive<ReportHead>(`${who}|reports`, (onData, onError) => watchReports(db, actor, onData, onError));
  const appointments = useLive<Appointment>(lab ? `${who}|appointments` : null, (onData, onError) => watchAppointments(db, onData, onError));
  const payments = useLive<Payment>(lab ? `${who}|payments` : null, (onData, onError) => watchPayments(db, onData, onError));
  const catalogHistory = useLive<CatalogHistoryEntry>(editsCatalog ? `${who}|catalogHistory` : null, (onData, onError) => watchCatalogHistory(db, onData, onError));
  const users = useLive<User>(can(actor, 'users.manage') ? `${who}|users` : null, (onData, onError) => watchUsers(db, onData, onError));
  const catalog = useLive<Catalog | null>(editsCatalog ? `${who}|catalog` : null, (onData, onError) =>
    watchCatalog(db, (value, invalid, fromCache) => onData({
      items: [value],
      invalid: invalid ? [{ id: 'current', issues: invalid }] : [],
      fromCache,
      pendingIds: new Set()
    }), onError)
  );

  const activeReports = useMemo(() => reports.items.filter((report): report is Report => !isTombstone(report)), [reports.items]);

  // A specialist also sees the old patients (no assignment yet) they have a report for; their
  // reports query holds only their own specialty. Each is read by id: the rules allow no query.
  const oldIds = useMemo(() => {
    if (!specialist) return [];
    const known = new Set(assigned.items.map(patient => patient.id));
    return [...new Set(activeReports.map(report => report.patientId))].filter(id => !known.has(id)).sort();
  }, [specialist, assigned.items, activeReports]);
  const byId = usePatientsById(db, oldIds, who);
  const patients = useMemo<Live<Patient>>(() => {
    const old = oldIds.map(id => byId.get(id)).filter((patient): patient is Patient => Boolean(patient && isOldPatient(patient)));
    return old.length ? { ...assigned, items: [...assigned.items, ...old] } : assigned;
  }, [assigned, oldIds, byId]);
  const storedCatalog = catalog.items[0] ?? null;

  // The laboratory's first login stores the built-in list, once, as revision 1. Only when the
  // server itself says there is none: offline, "no list" may only mean "not downloaded yet".
  const seeding = useRef(false);
  const missingOnServer = editsCatalog && !catalog.loading && !catalog.fromCache && !storedCatalog && !catalog.invalid.length;
  useEffect(() => {
    if (!missingOnServer || seeding.current) return;
    seeding.current = true;
    const categories = buildSeedCategories();
    saveCatalog(ctx, categories, 0, [{
      target: 'Lista e analizave',
      field: 'Krijimi',
      from: '',
      to: `U ruajt lista fillestare me ${countAnalyses(categories)} analiza në ${categories.length} kategori.`
    }]).catch(error => {
      seeding.current = false;
      console.warn('The initial analysis list could not be stored yet.', error);
    });
  }, [missingOnServer, ctx]);

  // Until a list is stored, work from the built-in one.
  const fallbackCategories = useMemo(() => buildSeedCategories(), []);
  const categories = storedCatalog?.categories ?? fallbackCategories;

  return { patients, reports, activeReports, appointments, payments, catalog, storedCatalog, categories, catalogHistory, users };
}

export type WorkspaceData = ReturnType<typeof useWorkspaceData>;

interface PatientsStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Map<string, Patient | null>;
}

/** One listener per patient id; the snapshot maps id to the patient, or null when unreadable. */
function patientsStore(db: Firestore, ids: string[]): PatientsStore {
  let state = new Map<string, Patient | null>();
  return {
    subscribe: listener => {
      const stops = ids.map(id => watchPatient(db, id, patient => {
        state = new Map(state).set(id, patient);
        listener();
      }));
      return () => stops.forEach(stop => stop());
    },
    getSnapshot: () => state
  };
}

function usePatientsById(db: Firestore, ids: string[], scope: string): Map<string, Patient | null> {
  const key = `${scope}|${ids.join(',')}`;
  // `key` captures everything the store depends on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => patientsStore(db, ids), [key]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

type StartFor = (id: string, onData: (snapshot: Snapshot<Version>) => void, onError: (error: Error) => void) => Unsubscribe;

interface HistoriesStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Map<string, Version[]>;
}

/** One listener per report id; the snapshot maps report id to its versions. */
function historiesStore(ids: string[], start: StartFor): HistoriesStore {
  let state = new Map<string, Version[]>();
  return {
    subscribe: listener => {
      const stops = ids.map(id => start(id, snapshot => {
        state = new Map(state).set(id, snapshot.items);
        listener();
      }, error => console.warn('Could not read a report history.', error)));
      return () => stops.forEach(stop => stop());
    },
    getSnapshot: () => state
  };
}

function useVersionHistories(ids: string[], scope: string, start: StartFor): Map<string, Version[]> {
  const key = `${scope}|${ids.join(',')}`;
  // `key` captures everything the store depends on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => historiesStore(ids, start), [key]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Which of the given reports have concurrent edits to settle. One listener per report on screen. */
export function useConflicts(reports: Report[]): { conflicts: Map<string, Conflict<Version>>; histories: Map<string, Version[]> } {
  const { ctx } = useData();
  const { db, actor } = ctx;
  const ids = useMemo(() => reports.map(report => report.id).sort(), [reports]);
  const histories = useVersionHistories(ids, `${actor.email}|${actor.role}`, (id, onData, onError) => watchVersions(db, actor, id, onData, onError));
  const conflicts = useMemo(() => {
    const found = new Map<string, Conflict<Version>>();
    for (const report of reports) {
      const versions = histories.get(report.id);
      const conflict = versions ? findConflict(report, versions) : null;
      if (conflict) found.set(report.id, conflict);
    }
    return found;
  }, [reports, histories]);
  return { conflicts, histories };
}
