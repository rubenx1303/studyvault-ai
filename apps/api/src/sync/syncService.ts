import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChangeType, EntityType, SyncStats } from '@studyvault/shared';
import type { Db } from '../db/database';
import type { Outbox } from '../integrations/outbox';
import type { RecordingService } from '../lectures/recordingService';
import type { DocumentProcessor } from '../processing/processor';
import { classifyDocument, safeName } from '../sources/classify';
import type { RemoteFile, SourceAdapter, SourceInventory } from '../sources/types';

const PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#84cc16',
];

export interface SyncOptions {
  mode: 'inventory' | 'sync';
  maxFileMb?: number;
  process?: boolean;
}

export interface SyncJob {
  runId: number;
  sourceId: string;
  mode: SyncOptions['mode'];
  status: 'running' | 'ok' | 'partial' | 'error';
  log: string[];
  stats: SyncStats;
}

const emptyStats = (): SyncStats => ({
  subjects: 0,
  documentsNew: 0,
  documentsModified: 0,
  documentsUnchanged: 0,
  messagesNew: 0,
  recordingsNew: 0,
  tasksNew: 0,
  tasksChanged: 0,
  errors: 0,
  processed: 0,
});

/**
 * Sincronización incremental:
 *   inventario remoto (solo metadatos) → comparar con BD por external_id + remote_version →
 *   descargar SOLO nuevos/modificados → hash de contenido → registrar cambios → procesar e indexar.
 */
export class SyncService {
  private current: SyncJob | null = null;

  constructor(
    private readonly db: Db,
    private readonly filesDir: string,
    private readonly processor: DocumentProcessor,
    private readonly recordings?: RecordingService,
    private readonly outbox?: Outbox,
  ) {}

  get job(): SyncJob | null {
    return this.current;
  }

  /** Lanza la sincronización en segundo plano y devuelve el id de ejecución. */
  start(adapter: SourceAdapter, opts: SyncOptions): SyncJob {
    if (this.current?.status === 'running') throw new Error('Ya hay una sincronización en curso');
    const { lastId } = this.db.run(
      'INSERT INTO sync_runs (source_id, mode) VALUES (?, ?)',
      adapter.id,
      opts.mode,
    );
    const job: SyncJob = {
      runId: lastId,
      sourceId: adapter.id,
      mode: opts.mode,
      status: 'running',
      log: [],
      stats: emptyStats(),
    };
    this.current = job;
    void this.run(adapter, opts, job);
    return job;
  }

  private log(job: SyncJob, msg: string) {
    job.log.push(`${new Date().toLocaleTimeString('es-ES')} ${msg}`);
    if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  }

  private async run(adapter: SourceAdapter, opts: SyncOptions, job: SyncJob) {
    let inventory: SourceInventory | null = null;
    try {
      this.log(
        job,
        `Inicio (${opts.mode === 'inventory' ? 'inventario sin descargas' : 'sincronización'}) — ${adapter.displayName}`,
      );
      inventory = await adapter.inventory((m) => this.log(job, m));
      job.stats.subjects = inventory.subjects.length;
      if (inventory.account)
        this.db.run('UPDATE sources SET account = ? WHERE id = ?', inventory.account, adapter.id);
      for (const w of inventory.warnings) this.log(job, `Aviso: ${w}`);

      if (opts.mode === 'sync') await this.apply(adapter, inventory, opts, job);
      job.status = job.stats.errors > 0 ? 'partial' : 'ok';
      if (opts.mode === 'sync' && this.outbox?.enabled) {
        // Avisos para automatizaciones externas (Power Automate). Un fallo aquí no invalida la sincronización.
        const n = await this.outbox
          .publishSyncRun(job.runId)
          .catch(
            (e: Error) => (
              this.log(job, `Aviso: no se pudo escribir la bandeja de avisos (${e.message})`),
              0
            ),
          );
        if (n) this.log(job, `${n} avisos enviados a la bandeja de Power Automate.`);
      }
      this.log(job, 'Finalizado.');
    } catch (err) {
      job.status = 'error';
      job.stats.errors++;
      this.log(job, `ERROR: ${(err as Error).message}`);
      this.db.run('UPDATE sync_runs SET error = ? WHERE id = ?', (err as Error).message, job.runId);
    } finally {
      this.db.run(
        `UPDATE sync_runs SET finished_at = datetime('now'), status = ?, stats_json = ?, log_json = ?, inventory_json = ? WHERE id = ?`,
        job.status,
        JSON.stringify(job.stats),
        JSON.stringify(job.log),
        inventory ? JSON.stringify(summarizeInventory(inventory)) : null,
        job.runId,
      );
    }
  }

  /**
   * Estado de la entrega leído del campus. Si el campus dice que la enviaste, la tarea se marca como hecha
   * en StudyVault (estado local; nunca se escribe nada en el campus). Avisa cuando una entrega pasa a calificada.
   */
  private applySubmission(
    job: SyncJob,
    taskId: number,
    t: { title: string; submission?: string | null; graded?: boolean | null },
    subjectId: number | null,
  ) {
    if (t.submission === undefined || t.submission === null) return;
    const prev = this.db.get<{ remote_graded: number | null; local_status: string }>(
      'SELECT remote_graded, local_status FROM tasks WHERE id = ?',
      taskId,
    );
    this.db.run(
      'UPDATE tasks SET remote_submission = ?, remote_graded = ? WHERE id = ?',
      t.submission,
      t.graded ? 1 : 0,
      taskId,
    );
    if (t.submission === 'submitted' && prev?.local_status !== 'done')
      this.db.run(
        `UPDATE tasks SET local_status = 'done', updated_at = datetime('now') WHERE id = ?`,
        taskId,
      );
    if (t.graded && prev?.remote_graded === 0)
      this.change(job, 'task', taskId, 'modified', `Calificada: ${t.title}`, subjectId);
  }

  private change(
    job: SyncJob,
    entityType: EntityType,
    entityId: number,
    changeType: ChangeType,
    summary: string,
    subjectId: number | null,
  ) {
    this.db.run(
      'INSERT INTO changes (sync_run_id, entity_type, entity_id, change_type, summary, subject_id) VALUES (?, ?, ?, ?, ?, ?)',
      job.runId,
      entityType,
      entityId,
      changeType,
      summary,
      subjectId,
    );
  }

  /** Aplica el inventario sobre la BD. Público para poder probarlo sin red. */
  async apply(adapter: SourceAdapter, inv: SourceInventory, opts: SyncOptions, job: SyncJob) {
    const src = adapter.id;
    const subjectIds = new Map<string, number>();
    const unitIds = new Map<string, number>();

    // ── Asignaturas y unidades ──
    this.db.tx(() => {
      inv.subjects.forEach((s, i) => {
        const existing = this.db.get<{ id: number }>(
          'SELECT id FROM subjects WHERE source_id = ? AND external_id = ?',
          src,
          s.externalId,
        );
        if (existing) {
          this.db.run(
            `UPDATE subjects SET name = ?, short_name = ?, url = ?, teachers_json = ?, updated_at = datetime('now') WHERE id = ?`,
            s.name,
            s.shortName ?? null,
            s.url ?? null,
            JSON.stringify(s.teachers),
            existing.id,
          );
          subjectIds.set(s.externalId, existing.id);
        } else {
          const { lastId } = this.db.run(
            'INSERT INTO subjects (source_id, external_id, name, short_name, url, teachers_json, color) VALUES (?, ?, ?, ?, ?, ?, ?)',
            src,
            s.externalId,
            s.name,
            s.shortName ?? null,
            s.url ?? null,
            JSON.stringify(s.teachers),
            PALETTE[i % PALETTE.length]!,
          );
          subjectIds.set(s.externalId, lastId);
        }
      });
      for (const u of inv.units) {
        const subjectId = subjectIds.get(u.subjectExternalId);
        if (!subjectId) continue;
        this.db.run(
          `INSERT INTO units (subject_id, external_id, name, position, url) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(subject_id, external_id) DO UPDATE SET name = excluded.name, position = excluded.position, url = excluded.url`,
          subjectId,
          u.externalId,
          u.name,
          u.position,
          u.url ?? null,
        );
        unitIds.set(
          u.externalId,
          this.db.get<{ id: number }>(
            'SELECT id FROM units WHERE subject_id = ? AND external_id = ?',
            subjectId,
            u.externalId,
          )!.id,
        );
      }
    });

    const hidden = new Set(
      this.db.all<{ id: number }>('SELECT id FROM subjects WHERE hidden = 1').map((r) => r.id),
    );

    // ── Documentos ──
    const maxBytes = (opts.maxFileMb ?? 50) * 1024 * 1024;
    const seen = new Set<string>();
    const docIdByExternal = new Map<string, number>();
    for (const f of inv.files) {
      seen.add(f.externalId);
      const subjectId = subjectIds.get(f.subjectExternalId) ?? null;
      const unitId = f.unitExternalId ? (unitIds.get(f.unitExternalId) ?? null) : null;
      const existing = this.db.get<{
        id: number;
        remote_version: string | null;
        content_hash: string | null;
        local_path: string | null;
        status: string;
        removed: number;
      }>(
        'SELECT id, remote_version, content_hash, local_path, status, removed FROM documents WHERE source_id = ? AND external_id = ?',
        src,
        f.externalId,
      );
      let docId = existing?.id;
      const isNew = !existing;
      const versionChanged = existing && existing.remote_version !== f.version;
      const needsDownload =
        isNew ||
        versionChanged ||
        !existing.local_path ||
        existing.status === 'error' ||
        existing.removed === 1;

      if (isNew) {
        docId = this.db.run(
          `INSERT INTO documents (source_id, external_id, subject_id, unit_id, title, filename, mime, kind, url, size, remote_modified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          src,
          f.externalId,
          subjectId,
          unitId,
          f.title,
          f.filename,
          f.mime ?? null,
          f.kindHint ?? classifyDocument(f.title, f.filename),
          f.url ?? null,
          f.size ?? null,
          f.modifiedAt ?? null,
        ).lastId;
      } else {
        this.db.run(
          'UPDATE documents SET subject_id = ?, unit_id = ?, title = ?, filename = ?, url = ?, removed = 0 WHERE id = ?',
          subjectId,
          unitId,
          f.title,
          f.filename,
          f.url ?? null,
          docId!,
        );
      }
      docIdByExternal.set(f.externalId, docId!);

      if (!needsDownload) {
        job.stats.documentsUnchanged++;
        continue;
      }
      if (subjectId && hidden.has(subjectId)) continue;
      if (f.size && f.size > maxBytes) {
        this.db.run(
          `UPDATE documents SET status = 'skipped', error = ? WHERE id = ?`,
          `Supera ${opts.maxFileMb ?? 50} MB`,
          docId!,
        );
        continue;
      }

      try {
        const buffer = await adapter.download(f);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        const localPath = await this.store(src, inv, f, buffer, existing?.local_path ?? null, docId!);
        const contentChanged = !existing || existing.content_hash !== hash;
        this.db.run(
          `UPDATE documents SET local_path = ?, content_hash = ?, size = ?, remote_version = ?, remote_modified_at = ?,
           synced_at = datetime('now'), status = CASE WHEN ? THEN 'downloaded' ELSE status END, error = NULL WHERE id = ?`,
          localPath,
          hash,
          buffer.length,
          f.version,
          f.modifiedAt ?? null,
          contentChanged ? 1 : 0,
          docId!,
        );
        if (isNew) {
          job.stats.documentsNew++;
          this.change(job, 'document', docId!, 'new', f.title, subjectId);
          this.log(job, `Nuevo: ${f.filename}`);
        } else if (contentChanged) {
          job.stats.documentsModified++;
          this.change(job, 'document', docId!, 'modified', f.title, subjectId);
          this.log(job, `Modificado: ${f.filename}`);
        } else job.stats.documentsUnchanged++;
      } catch (err) {
        job.stats.errors++;
        this.db.run(
          `UPDATE documents SET status = 'error', error = ? WHERE id = ?`,
          (err as Error).message.slice(0, 500),
          docId!,
        );
        this.log(job, `Error descargando ${f.filename}: ${(err as Error).message}`);
      }
    }

    // Documentos que ya no están en el origen: se marcan (no se borran: puede que los necesites para estudiar).
    for (const d of this.db.all<{
      id: number;
      external_id: string;
      title: string;
      subject_id: number | null;
    }>(
      // Las transcripciones de videoclases son documentos derivados: no están en la lista de ficheros de la fuente.
      'SELECT id, external_id, title, subject_id FROM documents WHERE source_id = ? AND removed = 0 AND recording_id IS NULL',
      src,
    )) {
      if (seen.has(d.external_id)) continue;
      this.db.run('UPDATE documents SET removed = 1 WHERE id = ?', d.id);
      this.change(job, 'document', d.id, 'removed', d.title, d.subject_id);
    }

    // ── Tareas ──
    for (const t of inv.tasks) {
      const subjectId = subjectIds.get(t.subjectExternalId) ?? null;
      const unitId = t.unitExternalId ? (unitIds.get(t.unitExternalId) ?? null) : null;
      const existing = this.db.get<{ id: number; remote_version: string | null; due_at: string | null }>(
        'SELECT id, remote_version, due_at FROM tasks WHERE source_id = ? AND external_id = ?',
        src,
        t.externalId,
      );
      let taskId: number;
      if (!existing) {
        taskId = this.db.run(
          `INSERT INTO tasks (source_id, external_id, subject_id, unit_id, title, instructions_html, opened_at, due_at, cutoff_at, url, remote_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          src,
          t.externalId,
          subjectId,
          unitId,
          t.title,
          t.instructionsHtml,
          t.openedAt,
          t.dueAt,
          t.cutoffAt,
          t.url,
          t.version,
        ).lastId;
        job.stats.tasksNew++;
        this.change(job, 'task', taskId, 'new', t.title, subjectId);
      } else {
        taskId = existing.id;
        if (existing.remote_version !== t.version) {
          this.db.run(
            `UPDATE tasks SET subject_id = ?, unit_id = ?, title = ?, instructions_html = ?, opened_at = ?, due_at = ?, cutoff_at = ?, url = ?,
             remote_version = ?, updated_at = datetime('now') WHERE id = ?`,
            subjectId,
            unitId,
            t.title,
            t.instructionsHtml,
            t.openedAt,
            t.dueAt,
            t.cutoffAt,
            t.url,
            t.version,
            taskId,
          );
          job.stats.tasksChanged++;
          const dueChanged = existing.due_at !== t.dueAt;
          this.change(
            job,
            'task',
            taskId,
            dueChanged ? 'due_changed' : 'modified',
            dueChanged
              ? `${t.title}: nueva fecha ${t.dueAt ? new Date(t.dueAt).toLocaleString('es-ES') : 'sin fecha'}`
              : t.title,
            subjectId,
          );
        }
      }
      this.applySubmission(job, taskId, t, subjectId);
      this.db.run('DELETE FROM task_documents WHERE task_id = ?', taskId);
      for (const fid of t.attachmentFileIds) {
        const docId = docIdByExternal.get(fid);
        if (docId)
          this.db.run(
            'INSERT OR IGNORE INTO task_documents (task_id, document_id) VALUES (?, ?)',
            taskId,
            docId,
          );
      }
    }

    // ── Mensajes / avisos ──
    for (const m of inv.messages) {
      const subjectId = m.subjectExternalId ? (subjectIds.get(m.subjectExternalId) ?? null) : null;
      const attachments = m.attachments.map((a) => ({
        name: a.name,
        url: a.url,
        documentId: a.fileExternalId ? (docIdByExternal.get(a.fileExternalId) ?? null) : null,
      }));
      const existing = this.db.get<{ id: number; remote_version: string | null }>(
        'SELECT id, remote_version FROM messages WHERE source_id = ? AND external_id = ?',
        src,
        m.externalId,
      );
      if (!existing) {
        const { lastId } = this.db.run(
          `INSERT INTO messages (source_id, external_id, subject_id, kind, author, title, body_html, posted_at, url, attachments_json, remote_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          src,
          m.externalId,
          subjectId,
          m.kind,
          m.author,
          m.title,
          m.bodyHtml,
          m.postedAt,
          m.url,
          JSON.stringify(attachments),
          m.version,
        );
        job.stats.messagesNew++;
        this.change(job, 'message', lastId, 'new', m.title, subjectId);
      } else if (existing.remote_version !== m.version) {
        this.db.run(
          'UPDATE messages SET title = ?, body_html = ?, attachments_json = ?, remote_version = ?, read_local = 0 WHERE id = ?',
          m.title,
          m.bodyHtml,
          JSON.stringify(attachments),
          m.version,
          existing.id,
        );
        this.change(job, 'message', existing.id, 'modified', m.title, subjectId);
      }
    }

    this.log(
      job,
      `Documentos: ${job.stats.documentsNew} nuevos, ${job.stats.documentsModified} modificados, ${job.stats.documentsUnchanged} sin cambios. ` +
        `Tareas: ${job.stats.tasksNew} nuevas, ${job.stats.tasksChanged} cambiadas. Avisos nuevos: ${job.stats.messagesNew}.`,
    );

    // ── Videoclases: se registran ahora y se procesan en segundo plano (transcribir lleva minutos) ──
    if (this.recordings && inv.recordings?.length) {
      const toProcess = this.recordings.upsertFromInventory(
        src,
        inv.recordings,
        { subject: (e) => subjectIds.get(e) ?? null, unit: (e) => (e ? (unitIds.get(e) ?? null) : null) },
        (recId, type, summary, subjectId) => {
          if (type === 'new') job.stats.recordingsNew = (job.stats.recordingsNew ?? 0) + 1;
          this.change(job, 'recording', recId, type, summary, subjectId);
        },
      );
      const unavailable = inv.recordings.filter((r) => r.media === 'none').length;
      this.log(
        job,
        `Videoclases: ${inv.recordings.length} detectadas, ${job.stats.recordingsNew} nuevas, ${toProcess.length} en cola de procesamiento${unavailable ? `, ${unavailable} no procesables automáticamente` : ''}.`,
      );
      if (opts.process !== false) this.recordings.enqueue(toProcess);
    }

    if (opts.process !== false) {
      this.log(job, 'Procesando e indexando documentos…');
      const r = await this.processor.processPending((m) => this.log(job, m));
      job.stats.processed = r.processed;
      job.stats.errors += r.errors;
    }
  }

  /** Guarda el fichero en data/files/<fuente>/<Asignatura>/<Unidad>/<fichero>. */
  private async store(
    src: string,
    inv: SourceInventory,
    f: RemoteFile,
    buffer: Buffer,
    previous: string | null,
    docId: number,
  ): Promise<string> {
    const subject = inv.subjects.find((s) => s.externalId === f.subjectExternalId)?.name ?? 'Sin asignatura';
    const unit =
      inv.units.find((u) => u.externalId === f.unitExternalId)?.name ??
      (f.taskExternalId ? 'Tareas' : 'General');
    let rel =
      previous ?? path.join(safeName(src), safeName(subject), safeName(unit), safeName(f.filename, 150));
    if (!previous) {
      const clash = this.db.get<{ id: number }>(
        'SELECT id FROM documents WHERE local_path = ? AND id != ?',
        rel,
        docId,
      );
      if (clash) rel = rel.replace(/(\.[^.\\/]+)?$/, ` (${docId})$1`);
    }
    const full = path.join(this.filesDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
    return rel;
  }
}

/** Resumen de inventario para revisión (sin cuerpos de mensaje completos). */
export function summarizeInventory(inv: SourceInventory) {
  return {
    account: inv.account,
    generatedAt: inv.generatedAt,
    platform: inv.platform,
    warnings: inv.warnings,
    subjects: inv.subjects.map((s) => ({
      ...s,
      units: inv.units
        .filter((u) => u.subjectExternalId === s.externalId)
        .sort((a, b) => a.position - b.position)
        .map((u) => ({
          name: u.name,
          files: inv.files
            .filter((f) => f.unitExternalId === u.externalId)
            .map((f) => ({ title: f.title, filename: f.filename, size: f.size, kind: f.kindHint })),
        })),
      tasks: inv.tasks
        .filter((t) => t.subjectExternalId === s.externalId)
        .map((t) => ({ title: t.title, dueAt: t.dueAt, attachments: t.attachmentFileIds.length })),
      messages: inv.messages
        .filter((m) => m.subjectExternalId === s.externalId)
        .map((m) => ({ title: m.title, author: m.author, postedAt: m.postedAt, kind: m.kind })),
      skipped: inv.skipped.filter((x) => x.subjectExternalId === s.externalId),
    })),
    totals: {
      subjects: inv.subjects.length,
      units: inv.units.length,
      files: inv.files.length,
      bytes: inv.files.reduce((a, f) => a + (f.size ?? 0), 0),
      tasks: inv.tasks.length,
      messages: inv.messages.length,
      skipped: inv.skipped.length,
    },
  };
}
