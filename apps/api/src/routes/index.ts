import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DashboardData, SearchScope, Settings, SourceStatus } from '@studyvault/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LlmUnavailableError } from '../ai/llm';
import type { Container } from '../container';
import { classifyDocument, mimeFromName, safeName } from '../sources/classify';
import { SourceAuthError } from '../sources/types';
import { registerRecordingRoutes } from './recordings';

const id = z.coerce.number().int().positive();
const ScopeSchema = z
  .object({
    subjectId: id.optional(),
    unitIds: z.array(id).optional(),
    documentId: id.optional(),
    taskId: id.optional(),
    recordingId: id.optional(),
  })
  .default({});

export async function registerRoutes(app: FastifyInstance, c: Container) {
  const { repo, config } = c;

  // Estado del login interactivo por fuente (el navegador corre en segundo plano).
  const loginJobs = new Map<string, { status: 'running' | 'ok' | 'error'; log: string[]; error?: string }>();

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError)
      return reply.status(400).send({ error: 'Petición no válida', details: err.issues });
    if (err instanceof SourceAuthError)
      return reply.status(401).send({ error: err.message, code: 'SOURCE_AUTH' });
    if (err instanceof LlmUnavailableError)
      return reply.status(409).send({ error: err.message, code: 'LLM_UNAVAILABLE' });
    req.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: (err as Error).message });
  });

  const sourceStatus = async (sourceId: string): Promise<SourceStatus | null> => {
    const adapter = c.adapters.get(sourceId);
    const base = repo.sourceStatusBase(sourceId);
    if (!adapter || !base) return null;
    return { ...base, authenticated: await adapter.isAuthenticated(), baseUrl: adapter.baseUrl };
  };
  const allSources = async () =>
    (await Promise.all([...c.adapters.keys()].map(sourceStatus))).filter((s): s is SourceStatus => !!s);

  app.get('/api/health', async () => ({ ok: true, mode: config.mode }));

  app.get('/api/settings', async (): Promise<Settings> => {
    const t = await c.transcriber.check();
    return {
      transcription: {
        provider: c.transcriber.id,
        model: c.transcriber.model,
        available: t.ok,
        reason: t.reason,
      },
      llmProvider: c.llm.id,
      llmModel: c.llm.model,
      llmConfigured: c.llm.available,
      embeddingsProvider: c.embeddings.id,
      embeddingsModel: c.embeddings.model,
      mode: config.mode,
    };
  });

  await registerRecordingRoutes(app, c);

  app.get('/api/dashboard', async (): Promise<DashboardData> => ({
    upcomingTasks: repo.upcomingTasks(8),
    recentMessages: repo.messages({ limit: 5 }),
    newDocuments: repo.recentDocuments(6),
    unseenChanges: repo.changes({ unseenOnly: true, limit: 50 }),
    subjects: repo.subjects(),
    sources: await allSources(),
    recentQueries: repo.recentQueries(5),
    studyProgress: repo.studyProgress(6),
    counts: repo.counts(),
  }));

  // ── Asignaturas ──
  app.get('/api/subjects', async () => repo.subjects());
  app.get('/api/subjects/:id', async (req, reply) => {
    const subjectId = id.parse((req.params as { id: string }).id);
    const subject = repo.subject(subjectId);
    if (!subject) return reply.status(404).send({ error: 'Asignatura no encontrada' });
    return {
      subject,
      units: repo.units(subjectId),
      documents: repo.documents({ subjectId }),
      tasks: repo.tasks({ subjectId }),
      messages: repo.messages({ subjectId, limit: 50 }),
    };
  });
  app.patch('/api/subjects/:id', async (req) => {
    const subjectId = id.parse((req.params as { id: string }).id);
    const body = z
      .object({
        hidden: z.boolean().optional(),
        color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
      })
      .parse(req.body);
    if (body.hidden !== undefined)
      c.db.run('UPDATE subjects SET hidden = ? WHERE id = ?', body.hidden ? 1 : 0, subjectId);
    if (body.color) c.db.run('UPDATE subjects SET color = ? WHERE id = ?', body.color, subjectId);
    return { ok: true };
  });

  // ── Documentos ──
  app.get('/api/documents', async (req) => {
    const q = z
      .object({
        subjectId: id.optional(),
        unitId: id.optional(),
        kind: z.string().optional(),
        q: z.string().optional(),
      })
      .parse(req.query);
    return repo.documents(q);
  });

  app.get('/api/documents/:id', async (req, reply) => {
    const doc = repo.document(id.parse((req.params as { id: string }).id));
    if (!doc) return reply.status(404).send({ error: 'Documento no encontrado' });
    const { localPath: _lp, ...pub } = doc;
    return pub;
  });

  app.get('/api/documents/:id/file', async (req, reply) => {
    const doc = repo.document(id.parse((req.params as { id: string }).id));
    if (!doc?.localPath) return reply.status(404).send({ error: 'Fichero no disponible localmente' });
    const full = path.resolve(config.paths.files, doc.localPath);
    if (!full.startsWith(path.resolve(config.paths.files)))
      return reply.status(400).send({ error: 'Ruta no válida' });
    const download = (req.query as { download?: string }).download === '1';
    reply.header('Content-Type', doc.mime ?? mimeFromName(doc.filename));
    reply.header(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    reply.header('Cache-Control', 'private, max-age=300');
    reply.header('X-Content-Type-Options', 'nosniff');
    // Los HTML del campus se sirven en sandbox para que no ejecuten scripts en el origen de StudyVault.
    if ((doc.mime ?? '').includes('html')) reply.header('Content-Security-Policy', 'sandbox');
    return reply.send(fs.createReadStream(full));
  });

  app.get('/api/documents/:id/text', async (req) => {
    const docId = id.parse((req.params as { id: string }).id);
    return c.db.all(
      'SELECT id, ord, page, section, text FROM chunks WHERE document_id = ? ORDER BY ord',
      docId,
    );
  });

  app.post('/api/documents/:id/reprocess', async (req) => {
    const docId = id.parse((req.params as { id: string }).id);
    return c.processor.process(docId);
  });

  /** Subida manual (p. ej. tu solución de un ejercicio) para preguntarle a la IA. */
  app.post('/api/documents/upload', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'Falta el fichero' });
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const subjectId = fields.subjectId?.value ? Number(fields.subjectId.value) : null;
    const unitId = fields.unitId?.value ? Number(fields.unitId.value) : null;
    const buffer = await file.toBuffer();
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const filename = safeName(file.filename, 150);
    const rel = path.join('uploads', `${hash.slice(0, 10)}-${filename}`);
    await fsp.mkdir(path.join(config.paths.files, 'uploads'), { recursive: true });
    await fsp.writeFile(path.join(config.paths.files, rel), buffer);
    const { lastId } = c.db.run(
      `INSERT INTO documents (source_id, external_id, subject_id, unit_id, title, filename, mime, kind, status, local_path, size, content_hash, synced_at)
       VALUES ('uploads', ?, ?, ?, ?, ?, ?, ?, 'downloaded', ?, ?, ?, datetime('now'))
       ON CONFLICT(source_id, external_id) DO UPDATE SET status = 'downloaded', removed = 0`,
      hash,
      subjectId,
      unitId,
      filename.replace(/\.[^.]+$/, ''),
      filename,
      mimeFromName(filename),
      classifyDocument(filename),
      rel,
      buffer.length,
      hash,
    );
    const docId =
      lastId ||
      c.db.get<{ id: number }>(
        `SELECT id FROM documents WHERE source_id = 'uploads' AND external_id = ?`,
        hash,
      )!.id;
    const r = await c.processor.process(docId).catch((e: Error) => ({ chunks: 0, error: e.message }));
    return { id: docId, ...r };
  });

  // ── Tareas ──
  app.get('/api/tasks', async (req) =>
    repo.tasks(z.object({ subjectId: id.optional(), status: z.string().optional() }).parse(req.query)),
  );
  app.get('/api/tasks/:id', async (req, reply) => {
    const t = repo.task(id.parse((req.params as { id: string }).id));
    return t ?? reply.status(404).send({ error: 'Tarea no encontrada' });
  });
  app.patch('/api/tasks/:id', async (req) => {
    const taskId = id.parse((req.params as { id: string }).id);
    const { localStatus } = z
      .object({ localStatus: z.enum(['pending', 'in_progress', 'done']) })
      .parse(req.body);
    repo.setTaskStatus(taskId, localStatus); // estado LOCAL: nunca se envía al campus
    return { ok: true };
  });

  // ── Mensajes y novedades ──
  app.get('/api/messages', async (req) =>
    repo.messages(z.object({ subjectId: id.optional() }).parse(req.query)),
  );
  app.patch('/api/messages/:id', async (req) => {
    const { read } = z.object({ read: z.boolean() }).parse(req.body);
    repo.markMessageRead(id.parse((req.params as { id: string }).id), read);
    return { ok: true };
  });
  app.get('/api/changes', async (req) =>
    repo.changes({ unseenOnly: (req.query as { unseen?: string }).unseen === '1' }),
  );
  app.post('/api/changes/seen', async () => (repo.markChangesSeen(), { ok: true }));

  // ── Fuentes, login y sincronización ──
  app.get('/api/sources', async () => allSources());

  app.post('/api/sources/:id/login', async (req, reply) => {
    const sourceId = (req.params as { id: string }).id;
    const adapter = c.adapters.get(sourceId);
    if (!adapter?.login) return reply.status(400).send({ error: 'Esta fuente no requiere login' });
    if (loginJobs.get(sourceId)?.status === 'running') return { status: 'running' };
    const job = {
      status: 'running' as 'running' | 'ok' | 'error',
      log: [] as string[],
      error: undefined as string | undefined,
    };
    loginJobs.set(sourceId, job);
    adapter
      .login((m) => job.log.push(m))
      .then(async () => {
        job.status = 'ok';
        repo.setSourceAccount(sourceId, await adapter.accountName());
      })
      .catch((e: Error) => {
        job.status = 'error';
        job.error = e.message;
      });
    return { status: 'running' };
  });
  app.get(
    '/api/sources/:id/login',
    async (req) => loginJobs.get((req.params as { id: string }).id) ?? { status: 'idle', log: [] },
  );
  app.post('/api/sources/:id/logout', async (req, reply) => {
    const sourceId = (req.params as { id: string }).id;
    const adapter = c.adapters.get(sourceId);
    if (!adapter?.logout) return reply.status(400).send({ error: 'Operación no soportada' });
    await adapter.logout();
    repo.setSourceAccount(sourceId, null);
    return { ok: true };
  });

  app.post('/api/sync', async (req, reply) => {
    const body = z
      .object({
        sourceId: z.string(),
        mode: z.enum(['inventory', 'sync']).default('sync'),
        maxFileMb: z.number().optional(),
      })
      .parse(req.body);
    const adapter = c.adapters.get(body.sourceId);
    if (!adapter) return reply.status(404).send({ error: 'Fuente desconocida' });
    if (!(await adapter.isAuthenticated()))
      return reply.status(401).send({ error: 'Inicia sesión primero', code: 'SOURCE_AUTH' });
    const job = c.sync.start(adapter, { mode: body.mode, maxFileMb: body.maxFileMb });
    return { runId: job.runId };
  });
  app.get('/api/sync/status', async () => c.sync.job ?? { status: 'idle' });
  app.get('/api/sync/runs', async () => repo.syncRuns(20));
  app.get('/api/sync/runs/:id', async (req, reply) => {
    const runId = id.parse((req.params as { id: string }).id);
    const run = repo.syncRun(runId);
    if (!run) return reply.status(404).send({ error: 'No encontrada' });
    const inv = c.db.get<{ inventory_json: string | null }>(
      'SELECT inventory_json FROM sync_runs WHERE id = ?',
      runId,
    );
    return { ...run, inventory: inv?.inventory_json ? JSON.parse(inv.inventory_json) : null };
  });
  app.post('/api/processing/run', async () => c.processor.processPending());

  // ── IA: RAG, búsqueda, estudio, exámenes ──
  app.post('/api/ask', async (req) => {
    const body = z
      .object({
        question: z.string().min(2).max(4000),
        scope: ScopeSchema,
        mode: z.enum(['answer', 'explain-task', 'concepts', 'where', 'guide', 'review']).optional(),
        extra: z.string().max(20000).optional(),
      })
      .parse(req.body);
    return c.rag.ask(body.question, body.scope as SearchScope, { mode: body.mode, extra: body.extra });
  });

  app.get('/api/search', async (req) => {
    const q = z
      .object({ q: z.string().min(1), subjectId: id.optional(), unitId: id.optional() })
      .parse(req.query);
    return c.retriever.search(q.q, { subjectId: q.subjectId, unitIds: q.unitId ? [q.unitId] : undefined });
  });

  app.post('/api/study', async (req) => {
    const body = z
      .object({
        kind: z.enum(['summary', 'concepts', 'simple', 'flashcards', 'quiz', 'open', 'exercises']),
        scope: ScopeSchema,
        refresh: z.boolean().optional(),
      })
      .parse(req.body);
    return c.study.generate(body.kind, body.scope as SearchScope, body.refresh);
  });

  app.post('/api/exams', async (req) => {
    const body = z
      .object({
        subjectId: id,
        unitIds: z.array(id).default([]),
        size: z.number().int().min(4).max(20).default(10),
      })
      .parse(req.body);
    return c.study.createExam(body.subjectId, body.unitIds, body.size);
  });
  app.post('/api/exams/:id/grade', async (req) => {
    const body = z
      .object({ answers: z.record(z.string(), z.union([z.string(), z.number()])) })
      .parse(req.body);
    return c.study.gradeExam(id.parse((req.params as { id: string }).id), body.answers);
  });
  app.get('/api/exams', async () =>
    c.db.all(
      `SELECT e.id, e.score, e.created_at AS createdAt, e.finished_at AS finishedAt, s.name AS subjectName
       FROM exam_attempts e LEFT JOIN subjects s ON s.id = e.subject_id ORDER BY e.id DESC LIMIT 20`,
    ),
  );

  /** Arquitectura REAL en ejecución (lo que muestra la página Arquitectura). */
  app.get('/api/architecture', async () => ({
    mode: config.mode,
    sources: (await allSources()).map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      authenticated: s.authenticated,
    })),
    storage: { db: 'SQLite (node:sqlite) + FTS5', files: 'Sistema de ficheros local (data/files)' },
    embeddings: { provider: c.embeddings.id, model: c.embeddings.model },
    index: { provider: 'sqlite-hybrid', detail: 'Vectores en SQLite + BM25 (FTS5) + RRF' },
    llm: { provider: c.llm.id, model: c.llm.model, available: c.llm.available },
    transcription: {
      provider: c.transcriber.id,
      model: c.transcriber.model,
      ...(await c.transcriber.check()),
    },
    counts: repo.counts(),
  }));
}
