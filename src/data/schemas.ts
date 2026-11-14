// Document shapes, mirroring firestore.v2.rules. The app validates every write against these
// before sending it, so the server only refuses a write for a real reason (and the write
// journal catches that case). Reads use loose objects: records written by the old app may
// carry extra fields, which are kept when a record is saved again.

import { z } from 'zod';
import { ROLES, SPECIALTIES } from '../auth/roles';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_PATTERN, 'not a UUID');
const int = (min: number) => z.number().int().min(min);

// ---- Users -------------------------------------------------------------------------------

export const UserSchema = z
  .strictObject({
    email: z.string().min(3),
    role: z.enum(ROLES),
    name: z.string().min(1).max(200),
    title: z.string().max(200),
    active: z.boolean(),
    updatedAt: z.string(),
    updatedBy: z.string()
  })
  .refine(user => user.email === user.email.toLowerCase(), { message: 'email must be lowercase', path: ['email'] })
  .refine(user => user.role === 'Administrator' || user.role === 'Laborator' || user.title.length > 0, {
    message: 'a specialist needs a title',
    path: ['title']
  });
export type User = z.infer<typeof UserSchema>;

// ---- Patients ----------------------------------------------------------------------------

export const PatientSchema = z.looseObject({
  id: uuid,
  firstName: z.string(),
  lastName: z.string(),
  dob: z.string(),
  gender: z.string(),
  phone: z.string(),
  address: z.string(),
  archived: z.boolean(),
  createdAt: z.string(),
  archivedAt: z.string().optional()
});
export type Patient = z.infer<typeof PatientSchema>;

// ---- Reports -----------------------------------------------------------------------------

export const AnalysisItemSchema = z.looseObject({
  parameter: z.string(),
  result: z.string(),
  unit: z.string(),
  reference: z.string(),
  category: z.string().optional(),
  printGroup: z.string().optional()
});
export type AnalysisItem = z.infer<typeof AnalysisItemSchema>;

export const HixhameSchema = z.looseObject({
  services: z.array(z.string()).optional(),
  cups: z.string().optional(),
  cupPositions: z.array(z.string()).optional(),
  leeches: z.string().optional(),
  leechPositions: z.array(z.string()).optional()
});
export type Hixhame = z.infer<typeof HixhameSchema>;

const REPORT_TYPES = ['laboratory', 'specialist'] as const;
const REPORT_SPECIALTIES = ['Laborator', ...SPECIALTIES] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportSpecialty = (typeof REPORT_SPECIALTIES)[number];

export function validReportTag(type: string, specialty: string): boolean {
  return type === 'laboratory'
    ? specialty === 'Laborator'
    : type === 'specialist' && (SPECIALTIES as readonly string[]).includes(specialty);
}

const tagMessage = { message: 'type and specialty do not match', path: ['specialty'] };

export const ReportSchema = z
  .looseObject({
    id: uuid,
    patientId: uuid,
    type: z.enum(REPORT_TYPES),
    specialty: z.enum(REPORT_SPECIALTIES),
    reportAt: z.string(),
    clinician: z.string(),
    clinicianTitle: z.string(),
    anamnesis: z.string(),
    physicalExam: z.string(),
    existingResults: z.string(),
    diagnoses: z.array(z.string()),
    customDiagnoses: z.string(),
    requestedExams: z.array(z.string()),
    therapy: z.string(),
    notes: z.string(),
    analyses: z.array(AnalysisItemSchema),
    hixhame: HixhameSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: int(1),
    lastVersionId: uuid.optional(),
    _deleted: z.literal(false).optional()
  })
  .refine(report => !('deletedAt' in report) && !('deletedBy' in report) && !('baseRevision' in report), {
    message: 'an active report cannot carry deletion fields'
  })
  .refine(report => validReportTag(report.type, report.specialty), tagMessage);
export type Report = z.infer<typeof ReportSchema>;

export const TombstoneSchema = z
  .strictObject({
    id: uuid,
    patientId: uuid,
    type: z.enum(REPORT_TYPES),
    specialty: z.enum(REPORT_SPECIALTIES),
    _deleted: z.literal(true),
    // The old app sometimes stored a Firestore timestamp here.
    deletedAt: z.union([z.string(), z.custom<object>(value => typeof value === 'object' && value !== null)]),
    deletedBy: z.string(),
    baseRevision: int(0),
    lastVersionId: uuid.optional()
  })
  .refine(tombstone => validReportTag(tombstone.type, tombstone.specialty), tagMessage);
export type Tombstone = z.infer<typeof TombstoneSchema>;

export type ReportHead = Report | Tombstone;

export function isTombstone(head: ReportHead): head is Tombstone {
  return head._deleted === true;
}

export function parseReportHead(data: unknown): z.ZodSafeParseResult<ReportHead> {
  const deleted = typeof data === 'object' && data !== null && (data as { _deleted?: unknown })._deleted === true;
  return deleted ? TombstoneSchema.safeParse(data) : ReportSchema.safeParse(data);
}

export const VersionSchema = z
  .strictObject({
    id: uuid,
    reportId: uuid,
    patientId: uuid,
    type: z.enum(REPORT_TYPES),
    specialty: z.enum(REPORT_SPECIALTIES),
    kind: z.enum(['save', 'delete']),
    revision: int(1),
    baseRevision: int(0),
    baseVersionId: z.union([z.literal(''), uuid]),
    resolves: z.array(uuid).max(50),
    savedAt: z.string(),
    savedBy: z.string(),
    report: z.union([TombstoneSchema, ReportSchema])
  })
  .refine(version => version.baseVersionId !== version.id, { message: 'a version cannot be its own base' })
  .refine(version => version.report.id === version.reportId && version.report.patientId === version.patientId, {
    message: 'snapshot belongs to another report'
  })
  .refine(version => version.report.type === version.type && version.report.specialty === version.specialty, tagMessage)
  .refine(version => (version.kind === 'delete') === isTombstone(version.report), { message: 'kind does not match the snapshot' })
  .refine(version => version.kind === 'delete' || (version.report as Report).revision === version.revision, {
    message: 'revision does not match the snapshot'
  });
export type Version = z.infer<typeof VersionSchema>;

// ---- Audit, appointments, payments -------------------------------------------------------

export const AUDIT_ACTIONS = ['REPORT_CREATED', 'REPORT_UPDATED', 'REPORT_DELETED'] as const;

export const AuditSchema = z.looseObject({
  id: uuid,
  action: z.enum(AUDIT_ACTIONS),
  reportId: uuid,
  patientId: uuid,
  at: z.string(),
  revision: int(1),
  // Old records may lack the actor fields.
  actorUid: z.string().optional(),
  actorEmail: z.string().optional(),
  actorRole: z.string().optional(),
  reportType: z.string().optional(),
  specialty: z.string().optional()
});
export type AuditEntry = z.infer<typeof AuditSchema>;

export const APPOINTMENT_STATUSES = ['Caktuar', 'Përfunduar', 'Anuluar', "S'u paraqit"] as const;

export const AppointmentSchema = z.looseObject({
  id: uuid,
  patientId: uuid,
  patientName: z.string(),
  appointmentAt: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  specialty: z.enum(REPORT_SPECIALTIES),
  clinician: z.string(),
  phone: z.string(),
  note: z.string(),
  createdAt: z.string(),
  expired: z.boolean().optional(),
  expiredAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const PaymentSchema = z.looseObject({
  id: uuid,
  patientId: uuid,
  patientName: z.string(),
  amount: z.number().finite().min(0),
  status: z.enum(['PAID', 'UNPAID']),
  paymentDate: z.string(),
  note: z.string(),
  recordedAt: z.string(),
  recordedBy: z.string(),
  // Imported payments may have no report; new ones always name one.
  reportId: z.union([z.literal(''), uuid]).nullable().optional(),
  reportLabel: z.string().optional(),
  reportTotal: z.number().finite().nullable().optional()
});
export type Payment = z.infer<typeof PaymentSchema>;

// ---- Analysis catalog --------------------------------------------------------------------

export const CatalogAnalysisSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  reference: z.string(),
  active: z.boolean()
});

export const CatalogCategorySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  printGroup: z.string(),
  bulkAdd: z.boolean(),
  active: z.boolean(),
  analyses: z.array(CatalogAnalysisSchema)
});

export const CatalogSchema = z.strictObject({
  id: z.literal('current'),
  revision: int(1),
  updatedAt: z.string(),
  updatedBy: z.string(),
  categories: z.array(CatalogCategorySchema).max(300)
});
export type Catalog = z.infer<typeof CatalogSchema>;
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

export const CatalogChangeSchema = z.looseObject({
  target: z.string(),
  field: z.string(),
  from: z.unknown(),
  to: z.unknown()
});

export const CatalogHistorySchema = z.strictObject({
  id: uuid,
  at: z.string(),
  by: z.string(),
  revision: int(1),
  changes: z.array(CatalogChangeSchema).max(1000)
});
export type CatalogHistoryEntry = z.infer<typeof CatalogHistorySchema>;
