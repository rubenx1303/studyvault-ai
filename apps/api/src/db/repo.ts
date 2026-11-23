import type {
  ChangeItem,
  DocumentItem,
  MessageItem,
  SourceStatus,
  Subject,
  SyncRun,
  TaskItem,
  TaskLocalStatus,
  Unit,
} from '@studyvault/shared';
import { json, type Db } from './database';

// Capa de acceso a datos: mapea filas SQL ↔ tipos de dominio. Ninguna otra capa escribe SQL de lectura de UI.

type R = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));

export const toSubject = (r: R): Subject => ({
  id: Number(r.id),
  sourceId: String(r.source_id),
  externalId: String(r.external_id),
  name: String(r.name),
  shortName: s(r.short_name),
  url: s(r.url),
  teachers: json.parse<string[]>(r.teachers_json, []),
  color: String(r.color),
  documentCount: r.document_count == null ? undefined : Number(r.document_count),
  taskCount: r.task_count == null ? undefined : Number(r.task_count),
  pendingTaskCount: r.pending_task_count == null ? undefined : Number(r.pending_task_count),
});

export const toUnit = (r: R): Unit => ({
  id: Number(r.id),
  subjectId: Number(r.subject_id),
  externalId: String(r.external_id),
  name: String(r.name),
  position: Number(r.position),
  url: s(r.url),
});

export const toDocument = (r: R): DocumentItem => ({
  id: Number(r.id),
  subjectId: n(r.subject_id),
  unitId: n(r.unit_id),
  subjectName: s(r.subject_name),
  unitName: s(r.unit_name),
  title: String(r.title),
  filename: String(r.filename),
  mime: s(r.mime),
  kind: String(r.kind) as DocumentItem['kind'],
  status: String(r.status) as DocumentItem['status'],
  url: s(r.url),
  size: n(r.size),
  pageCount: n(r.page_count),
  remoteModifiedAt: s(r.remote_modified_at),
  syncedAt: s(r.synced_at),
  contentHash: s(r.content_hash),
  error: s(r.error),
});

export const toMessage = (r: R): MessageItem => ({
  id: Number(r.id),
  subjectId: n(r.subject_id),
  subjectName: s(r.subject_name),
  kind: String(r.kind) as MessageItem['kind'],
  author: s(r.author),
  title: String(r.title),
  bodyHtml: String(r.body_html ?? ''),
  postedAt: s(r.posted_at),
  url: s(r.url),
  attachments: json.parse(r.attachments_json, []),
  readLocal: Boolean(r.read_local),
});

export const toSyncRun = (r: R): SyncRun => ({
  id: Number(r.id),
  sourceId: String(r.source_id),
  mode: String(r.mode) as SyncRun['mode'],
  startedAt: String(r.started_at),
  finishedAt: s(r.finished_at),
  status: String(r.status) as SyncRun['status'],
  stats: json.parse(r.stats_json, {} as SyncRun['stats']),
  error: s(r.error),
  log: json.parse<string[]>(r.log_json, []),
});

const DOC_SELECT = `
  SELECT d.*, s.name AS subject_name, u.name AS unit_name
  FROM documents d
  LEFT JOIN subjects s ON s.id = d.subject_id
  LEFT JOIN units u ON u.id = d.unit_id`;

const TASK_SELECT = `
  SELECT t.*, s.name AS subject_name, u.name AS unit_name
  FROM tasks t
  LEFT JOIN subjects s ON s.id = t.subject_id
  LEFT JOIN units u ON u.id = t.unit_id`;

export class Repo {
  constructor(readonly db: Db) {}

  // ── Asignaturas / unidades ──
  subjects(): Subject[] {
    return this.db
      .all(
        `SELECT s.*,
           (SELECT COUNT(*) FROM documents d WHERE d.subject_id = s.id AND d.removed = 0) AS document_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.subject_id = s.id) AS task_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.subject_id = s.id AND t.local_status != 'done') AS pending_task_count
         FROM subjects s WHERE s.hidden = 0 ORDER BY s.name`,
      )
      .map(toSubject);
  }

  subject(id: number): Subject | undefined {
    const r = this.db.get('SELECT * FROM subjects WHERE id = ?', id);
    return r ? toSubject(r) : undefined;
  }

  units(subjectId: number): Unit[] {
    return this.db
      .all('SELECT * FROM units WHERE subject_id = ? ORDER BY position, name', subjectId)
      .map(toUnit);
  }

  // ── Documentos ──
  documents(
    filter: { subjectId?: number; unitId?: number; kind?: string; q?: string; limit?: number } = {},
  ): DocumentItem[] {
    const where = ['d.removed = 0'];
    const params: (string | number)[] = [];
    if (filter.subjectId) {
      where.push('d.subject_id = ?');
      params.push(filter.subjectId);
    }
    if (filter.unitId) {
      where.push('d.unit_id = ?');
      params.push(filter.unitId);
    }
    if (filter.kind) {
      where.push('d.kind = ?');
      params.push(filter.kind);
    }
    if (filter.q) {
      where.push('(d.title LIKE ? OR d.filename LIKE ?)');
      params.push(`%${filter.q}%`, `%${filter.q}%`);
    }
    return this.db
      .all(
        `${DOC_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.name, u.position, d.title LIMIT ?`,
        ...params,
        filter.limit ?? 2000,
      )
      .map(toDocument);
  }

  document(id: number): (DocumentItem & { localPath: string | null; sourceId: string }) | undefined {
    const r = this.db.get(`${DOC_SELECT} WHERE d.id = ?`, id);
    return r ? { ...toDocument(r), localPath: s(r.local_path), sourceId: String(r.source_id) } : undefined;
  }

  recentDocuments(limit = 8): DocumentItem[] {
    return this.db
      .all(
        `${DOC_SELECT} WHERE d.removed = 0 AND d.synced_at IS NOT NULL ORDER BY d.synced_at DESC, d.id DESC LIMIT ?`,
        limit,
      )
      .map(toDocument);
  }

  // ── Tareas ──
  private taskDocs(taskId: number) {
    return this.db.all<{ id: number; title: string; filename: string; mime: string | null }>(
      `SELECT d.id, d.title, d.filename, d.mime FROM task_documents td JOIN documents d ON d.id = td.document_id WHERE td.task_id = ?`,
      taskId,
    );
  }

  private toTask(r: R): TaskItem {
    return {
      id: Number(r.id),
      subjectId: n(r.subject_id),
      unitId: n(r.unit_id),
      subjectName: s(r.subject_name),
      unitName: s(r.unit_name),
      title: String(r.title),
      instructionsHtml: s(r.instructions_html),
      openedAt: s(r.opened_at),
      dueAt: s(r.due_at),
      cutoffAt: s(r.cutoff_at),
      url: s(r.url),
      localStatus: String(r.local_status) as TaskLocalStatus,
      submission: (s(r.remote_submission) as TaskItem['submission']) ?? null,
      graded:
        r.remote_graded === null || r.remote_graded === undefined ? null : Number(r.remote_graded) === 1,
      documents: this.taskDocs(Number(r.id)),
      updatedAt: String(r.updated_at),
    };
  }

  tasks(filter: { subjectId?: number; status?: string } = {}): TaskItem[] {
    const where: string[] = ['1=1'];
    const params: (string | number)[] = [];
    if (filter.subjectId) {
      where.push('t.subject_id = ?');
      params.push(filter.subjectId);
    }
    if (filter.status) {
      where.push('t.local_status = ?');
      params.push(filter.status);
    }
    return this.db
      .all(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.due_at IS NULL, t.due_at`, ...params)
      .map((r) => this.toTask(r));
  }

  task(id: number): TaskItem | undefined {
    const r = this.db.get(`${TASK_SELECT} WHERE t.id = ?`, id);
    return r ? this.toTask(r) : undefined;
  }

  upcomingTasks(limit = 6): TaskItem[] {
    return this.db
      .all(
        // Todo lo no entregado, también lo vencido (primero, por fecha): si no, una entrega olvidada desaparece del panel.
        `${TASK_SELECT} WHERE t.local_status != 'done' AND COALESCE(t.remote_submission, '') != 'submitted'
         ORDER BY t.due_at IS NULL, t.due_at LIMIT ?`,
        limit,
      )
      .map((r) => this.toTask(r));
  }

  setTaskStatus(id: number, status: TaskLocalStatus): void {
    this.db.run(`UPDATE tasks SET local_status = ?, updated_at = datetime('now') WHERE id = ?`, status, id);
  }

  // ── Mensajes ──
  messages(filter: { subjectId?: number; limit?: number } = {}): MessageItem[] {
    const params: (string | number)[] = [];
    let where = '1=1';
    if (filter.subjectId) {
      where = 'm.subject_id = ?';
      params.push(filter.subjectId);
    }
    return this.db
      .all(
        `SELECT m.*, s.name AS subject_name FROM messages m LEFT JOIN subjects s ON s.id = m.subject_id
         WHERE ${where} ORDER BY m.posted_at DESC LIMIT ?`,
        ...params,
        filter.limit ?? 200,
      )
      .map(toMessage);
  }

  markMessageRead(id: number, read = true): void {
    this.db.run('UPDATE messages SET read_local = ? WHERE id = ?', read ? 1 : 0, id);
  }

  // ── Cambios / sincronizaciones ──
  changes(filter: { unseenOnly?: boolean; limit?: number } = {}): ChangeItem[] {
    return this.db
      .all(
        `SELECT c.*, s.name AS subject_name FROM changes c LEFT JOIN subjects s ON s.id = c.subject_id
         ${filter.unseenOnly ? 'WHERE c.seen = 0' : ''} ORDER BY c.id DESC LIMIT ?`,
        filter.limit ?? 200,
      )
      .map((r) => ({
        id: Number(r.id),
        syncRunId: Number(r.sync_run_id),
        entityType: String(r.entity_type) as ChangeItem['entityType'],
        entityId: Number(r.entity_id),
        changeType: String(r.change_type) as ChangeItem['changeType'],
        summary: String(r.summary),
        subjectName: s(r.subject_name),
        createdAt: String(r.created_at),
        seen: Boolean(r.seen),
      }));
  }

  markChangesSeen(): void {
    this.db.run('UPDATE changes SET seen = 1 WHERE seen = 0');
  }

  syncRuns(limit = 20): SyncRun[] {
    return this.db.all('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', limit).map(toSyncRun);
  }

  syncRun(id: number): SyncRun | undefined {
    const r = this.db.get('SELECT * FROM sync_runs WHERE id = ?', id);
    return r ? toSyncRun(r) : undefined;
  }

  lastSync(sourceId: string): SyncRun | null {
    const r = this.db.get(`SELECT * FROM sync_runs WHERE source_id = ? ORDER BY id DESC LIMIT 1`, sourceId);
    return r ? toSyncRun(r) : null;
  }

  sourceRow(
    id: string,
  ): { id: string; kind: string; name: string; account: string | null; config_json: string } | undefined {
    return this.db.get('SELECT * FROM sources WHERE id = ?', id);
  }

  upsertSource(id: string, kind: string, name: string, config: object = {}): void {
    this.db.run(
      `INSERT INTO sources (id, kind, name, config_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name`,
      id,
      kind,
      name,
      JSON.stringify(config),
    );
  }

  setSourceAccount(id: string, account: string | null): void {
    this.db.run('UPDATE sources SET account = ? WHERE id = ?', account, id);
  }

  sourceStatusBase(id: string): Omit<SourceStatus, 'authenticated' | 'baseUrl'> | undefined {
    const r = this.sourceRow(id);
    if (!r) return undefined;
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      account: r.account,
      lastSync: this.lastSync(id),
      readOnly: true,
    };
  }

  counts() {
    const c = (sql: string) => Number(this.db.get<{ c: number }>(sql)?.c ?? 0);
    return {
      documents: c('SELECT COUNT(*) c FROM documents WHERE removed = 0'),
      processed: c(`SELECT COUNT(*) c FROM documents WHERE status = 'processed' AND removed = 0`),
      chunks: c('SELECT COUNT(*) c FROM chunks'),
      tasksPending: c(`SELECT COUNT(*) c FROM tasks WHERE local_status != 'done'`),
    };
  }

  recentQueries(limit = 5) {
    return this.db.all<{ id: number; question: string; createdAt: string }>(
      'SELECT id, question, created_at AS createdAt FROM queries ORDER BY id DESC LIMIT ?',
      limit,
    );
  }

  studyProgress(limit = 8) {
    return this.db.all<{ topic: string; subjectName: string | null; correct: number; wrong: number }>(
      `SELECT ts.topic, s.name AS subjectName, ts.correct, ts.wrong FROM topic_stats ts
       LEFT JOIN subjects s ON s.id = ts.subject_id ORDER BY ts.wrong DESC, ts.updated_at DESC LIMIT ?`,
      limit,
    );
  }
}
