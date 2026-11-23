import fs from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/database';
import { safeName } from '../sources/classify';

/**
 * Bandeja de salida para automatizaciones externas (Power Automate).
 *
 * Por cada novedad de una sincronización escribe un JSON pequeño en una carpeta sincronizada con OneDrive.
 * Un flujo de Power Automate con el disparador «Cuando se crea un archivo» (conector estándar OneDrive) lo lee
 * y actúa: notificación al móvil, evento en el calendario de Outlook, tarea en Microsoft To Do…
 *
 * Minimización: solo título, asignatura, tipo, fecha y enlace al origen. Nunca documentos ni cuerpos de mensajes.
 * Desacoplado: StudyVault no conoce Power Automate; cualquier otra herramienta puede vigilar la misma carpeta.
 */
export interface OutboxEvent {
  schema: 'studyvault.event.v1';
  id: string;
  type:
    | 'task.new'
    | 'task.due_changed'
    | 'document.new'
    | 'document.modified'
    | 'message.new'
    | 'recording.new'
    | 'summary';
  title: string;
  subject: string | null;
  dueAt: string | null; // ISO, solo tareas
  url: string | null; // origen en el campus
  createdAt: string;
  summary: string; // una línea legible para la notificación
}

const LABEL: Record<OutboxEvent['type'], string> = {
  'task.new': 'Nueva tarea',
  'task.due_changed': 'Fecha de entrega cambiada',
  'document.new': 'Nuevo documento',
  'document.modified': 'Documento actualizado',
  'message.new': 'Nuevo aviso',
  'recording.new': 'Nueva videoclase',
  summary: 'Resumen de novedades',
};

/** Destino remoto opcional (p. ej. subir el JSON a un almacenamiento en la nube). */
export type OutboxUploader = (filename: string, content: string) => Promise<void>;

/** Más novedades que esto en una sola sincronización → un único aviso resumen (no inundar el móvil). */
const MAX_EVENTS_PER_RUN = 10;

export class Outbox {
  constructor(
    private readonly db: Db,
    private readonly dir: string | null,
    private readonly retentionDays = 30,
    private uploader: OutboxUploader | null = null,
  ) {}

  get enabled() {
    return Boolean(this.dir || this.uploader);
  }

  setUploader(uploader: OutboxUploader | null) {
    this.uploader = uploader;
  }

  /** Convierte los cambios de una sincronización en eventos y los publica (uno por fichero). */
  async publishSyncRun(runId: number): Promise<number> {
    if (!this.enabled) return 0;
    // La primera importación de una fuente no son «novedades»: no se avisa de los ~100 elementos iniciales.
    const previous = this.db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM sync_runs WHERE mode = 'sync' AND status IN ('ok','partial') AND id < ?
         AND source_id = (SELECT source_id FROM sync_runs WHERE id = ?)`,
      runId,
      runId,
    );
    if (!previous?.n) return 0;
    const rows = this.db.all<{
      id: number;
      entity_type: string;
      entity_id: number;
      change_type: string;
      summary: string;
      subject: string | null;
      created_at: string;
    }>(
      `SELECT c.id, c.entity_type, c.entity_id, c.change_type, c.summary, s.name AS subject, c.created_at
       FROM changes c LEFT JOIN subjects s ON s.id = c.subject_id WHERE c.sync_run_id = ?`,
      runId,
    );
    let events = rows.map((r) => this.toEvent(r)).filter((e): e is OutboxEvent => e !== null);
    if (!events.length) return 0;
    if (events.length > MAX_EVENTS_PER_RUN) events = [this.summaryEvent(runId, events)];

    for (const e of events) {
      // El nombre del fichero ES el texto de la notificación (el flujo usa «Nombre de archivo»): legible y único.
      const filename = `${safeName(e.summary, 170)} [${e.id}].json`;
      const content = JSON.stringify(e, null, 2);
      if (this.dir) {
        await fs.mkdir(this.dir, { recursive: true });
        // Escritura atómica: primero .tmp y luego renombrar, para que el flujo nunca lea un fichero a medias.
        const file = path.join(this.dir, filename);
        await fs.writeFile(`${file}.tmp`, content, 'utf8');
        await fs.rename(`${file}.tmp`, file);
      }
      if (this.uploader) await this.uploader(filename, content);
    }
    await this.prune();
    return events.length;
  }

  private summaryEvent(runId: number, events: OutboxEvent[]): OutboxEvent {
    const count = (p: string) => events.filter((e) => e.type.startsWith(p)).length;
    const parts = [
      [count('task'), 'tareas'],
      [count('document'), 'documentos'],
      [count('message'), 'avisos'],
      [count('recording'), 'videoclases'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, l]) => `${n} ${l}`);
    const due = events.filter((e) => e.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0];
    return {
      schema: 'studyvault.event.v1',
      id: `run-${runId}`,
      type: 'summary',
      title: `${events.length} novedades en el campus`,
      subject: null,
      dueAt: due?.dueAt ?? null,
      url: null,
      createdAt: new Date().toISOString(),
      summary:
        `StudyVault: ${parts.join(', ')} nuevas o cambiadas${due ? `. Próxima entrega: ${due.title}` : ''}`.slice(
          0,
          240,
        ),
    };
  }

  private toEvent(r: {
    id: number;
    entity_type: string;
    entity_id: number;
    change_type: string;
    summary: string;
    subject: string | null;
    created_at: string;
  }): OutboxEvent | null {
    const type = `${r.entity_type}.${r.change_type}` as OutboxEvent['type'];
    if (!(type in LABEL)) return null;
    const lookup = (table: 'tasks' | 'documents' | 'messages' | 'recordings') =>
      this.db.get<{ title: string; url: string | null; due_at?: string | null }>(
        `SELECT title, url${table === 'tasks' ? ', due_at' : ''} FROM ${table} WHERE id = ?`,
        r.entity_id,
      );
    const entity = lookup(`${r.entity_type}s` as 'tasks' | 'documents' | 'messages' | 'recordings');
    const title = entity?.title ?? r.summary;
    const dueAt = entity?.due_at ?? null;
    const when = dueAt
      ? ` · entrega ${new Date(dueAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
      : '';
    return {
      schema: 'studyvault.event.v1',
      id: `chg-${r.id}`,
      type,
      title,
      subject: r.subject,
      dueAt,
      url: entity?.url ?? null,
      createdAt: new Date(`${r.created_at.replace(' ', 'T')}Z`).toISOString(),
      summary: `${LABEL[type]}${r.subject ? ` (${r.subject})` : ''}: ${title}${when}`.slice(0, 240),
    };
  }

  /** Borra eventos antiguos para que la carpeta no crezca indefinidamente. */
  private async prune() {
    if (!this.dir) return;
    const limit = Date.now() - this.retentionDays * 86_400_000;
    for (const f of await fs.readdir(this.dir).catch(() => [] as string[])) {
      if (!f.endsWith('.json')) continue;
      const st = await fs.stat(path.join(this.dir, f)).catch(() => null);
      if (st && st.mtimeMs < limit) await fs.rm(path.join(this.dir, f), { force: true });
    }
  }
}
