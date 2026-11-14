import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { can } from '../../auth/permissions';
import { useData } from '../../data/DataProvider';
import type { Report } from '../../data/schemas';
import type { GuidancePhase, GuidanceService } from '../../domain/specialties';
import { UsersCard } from '../admin/UsersCard';
import { AppointmentsCard } from '../appointments/AppointmentsCard';
import { BackupCard } from '../backup/BackupCard';
import { CatalogCard } from '../catalog/CatalogCard';
import { PatientsCard } from '../patients/PatientsCard';
import { PaymentsCard } from '../payments/PaymentsCard';
import { PrintArea } from '../print/PrintArea';
import { ReportEditor } from '../reports/ReportEditor';
import { ReportList } from '../reports/ReportList';
import { useWorkspaceData, type WorkspaceData } from './useWorkspaceData';

export type PrintTarget =
  | { kind: 'report'; reportId: string }
  | { kind: 'guidance'; patientId: string; service: GuidanceService; phase: GuidancePhase };

export interface EditorTarget {
  /** null for a new report. */
  report: Report | null;
  /** Conflicting branches this save will settle. */
  resolves: string[];
  /** Changes whenever a different report (or a fresh new one) is opened. */
  key: number;
}

interface Workspace {
  data: WorkspaceData;
  patientId: string;
  selectPatient: (id: string) => void;
  editor: EditorTarget;
  openReport: (report: Report | null, resolves?: string[]) => void;
  /** After a save: the form keeps its content, but the next save builds on `report`. */
  rebaseEditor: (report: Report) => void;
  print: PrintTarget | null;
  showPrint: (target: PrintTarget | null) => void;
  say: (message: string, error?: boolean) => void;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace must be used inside Workspace.');
  return workspace;
}

function WorkspaceProvider({ children }: { children: ReactNode }) {
  const data = useWorkspaceData();
  const [patientId, setPatientId] = useState('');
  const [editor, setEditor] = useState<EditorTarget>({ report: null, resolves: [], key: 0 });
  const [print, setPrint] = useState<PrintTarget | null>(null);
  const [status, setStatus] = useState<{ message: string; error: boolean }>({ message: '', error: false });

  const say = useCallback((message: string, error = false) => setStatus({ message, error }), []);
  const openReport = useCallback((report: Report | null, resolves: string[] = []) => {
    setPrint(null);
    setEditor(current => ({ report, resolves, key: current.key + 1 }));
    if (report) setTimeout(() => document.getElementById('editorCard')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }, []);
  const rebaseEditor = useCallback((report: Report) => {
    setEditor(current => ({ ...current, report, resolves: [] }));
  }, []);
  const selectPatient = useCallback((id: string) => {
    setPatientId(id);
    setPrint(null);
    setEditor(current => ({ report: null, resolves: [], key: current.key + 1 }));
  }, []);
  const showPrint = useCallback((target: PrintTarget | null) => {
    setPrint(target);
    if (target) setTimeout(() => document.getElementById('printArea')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }, []);

  const value = useMemo<Workspace>(
    () => ({ data, patientId, selectPatient, editor, openReport, rebaseEditor, print, showPrint, say }),
    [data, patientId, selectPatient, editor, openReport, rebaseEditor, print, showPrint, say]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <p className="status" role="status" data-testid="status" style={{ color: status.error ? '#9c0006' : '#075b28' }}>{status.message}</p>
      {children}
    </WorkspaceContext.Provider>
  );
}

/** The single working page, laid out as in the old app. */
export function Workspace() {
  const { ctx } = useData();
  const actor = ctx.actor;
  return (
    <WorkspaceProvider>
      <PatientsCard />
      {can(actor, 'payments.manage') && <PaymentsCard />}
      {can(actor, 'appointments.manage') && <AppointmentsCard />}
      <ReportEditor />
      <ReportList />
      {can(actor, 'catalog.edit') && <CatalogCard />}
      {can(actor, 'backup.export') && <BackupCard />}
      {can(actor, 'users.manage') && <UsersCard />}
      <PrintArea />
    </WorkspaceProvider>
  );
}
