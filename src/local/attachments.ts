// Report attachments (PDF/PNG/JPEG) stay on the device that added them, as in the old app.
// They are kept per account, are never uploaded, and are not cleared at logout: this is the
// only copy, and only a backup export carries them elsewhere.

import { deleteKeys, getAll, getOne, openDatabase, putOne } from './idb';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export interface StoredAttachment {
  id: string;
  reportId: string;
  ownerEmail: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  blob: Blob;
}

export type AttachmentInfo = Omit<StoredAttachment, 'blob'>;

const DB_NAME = 'bioeng-attachments';
const STORE = 'attachments';

export class AttachmentProblem extends Error {
  constructor(readonly reason: 'type' | 'size') {
    super(reason === 'type' ? 'Only PDF, PNG and JPEG files can be attached.' : 'The file is larger than 10 MB.');
  }
}

export class AttachmentStore {
  private constructor(private readonly db: IDBDatabase, private readonly ownerEmail: string) {}

  static async open(ownerEmail: string): Promise<AttachmentStore> {
    const db = await openDatabase(DB_NAME, 1, database => {
      const store = database.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('reportId', 'reportId');
      store.createIndex('ownerEmail', 'ownerEmail');
    });
    return new AttachmentStore(db, ownerEmail.toLowerCase());
  }

  close(): void {
    this.db.close();
  }

  async add(reportId: string, file: { name: string; type: string; size: number } & Blob, uploadedAt = new Date().toISOString()): Promise<AttachmentInfo> {
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new AttachmentProblem('type');
    if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentProblem('size');
    const stored: StoredAttachment = {
      id: crypto.randomUUID(),
      reportId,
      ownerEmail: this.ownerEmail,
      name: file.name,
      type: file.type,
      size: file.size,
      uploadedAt,
      blob: file
    };
    await putOne(this.db, STORE, stored);
    const { blob: _blob, ...info } = stored;
    return info;
  }

  /** Used by the legacy rescue to bring over files saved by the old app, keeping their ids. */
  async importExisting(attachment: Omit<StoredAttachment, 'ownerEmail'>): Promise<boolean> {
    if (await getOne(this.db, STORE, attachment.id)) return false;
    await putOne(this.db, STORE, { ...attachment, ownerEmail: this.ownerEmail });
    return true;
  }

  async list(reportId: string): Promise<AttachmentInfo[]> {
    const all = await getAll<StoredAttachment>(this.db, STORE, 'reportId', reportId);
    return all
      .filter(item => item.ownerEmail === this.ownerEmail)
      .map(({ blob: _blob, ...info }) => info)
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  }

  async listAll(): Promise<StoredAttachment[]> {
    return getAll<StoredAttachment>(this.db, STORE, 'ownerEmail', this.ownerEmail);
  }

  async blob(id: string): Promise<Blob | null> {
    const item = await getOne<StoredAttachment>(this.db, STORE, id);
    return item && item.ownerEmail === this.ownerEmail ? item.blob : null;
  }

  async deleteForReport(reportId: string): Promise<void> {
    const items = await getAll<StoredAttachment>(this.db, STORE, 'reportId', reportId);
    await deleteKeys(this.db, STORE, items.filter(item => item.ownerEmail === this.ownerEmail).map(item => item.id));
  }
}
