import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RecordingDetail, RecordingItem } from '@studyvault/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container';
import { json } from '../db/database';
import { safeName } from '../sources/classify';
import { isMediaFile } from '../transcription/media';

const id = z.coerce.number().int().positive();
type R = Record<string, unknown>;

const SELECT = `SELECT r.*, s.name AS subject_name, u.name AS unit_name FROM recordings r
  LEFT JOIN subjects s ON s.id = r.subject_id LEFT JOIN units u ON u.id = r.unit_id`;

function toItem(r: R): RecordingItem {
  const n = (v: unknown) => (v == null ? null : Number(v));
  const s = (v: unknown) => (v == null ? null : String(v));
  return {
    id: Number(r.id),
    subjectId: n(r.subject_id),
    unitId: n(r.unit_id),
    subjectName: s(r.subject_name),
    unitName: s(r.unit_name),
    title: String(r.title),
    recordedAt: s(r.recorded_at),
    durationSec: n(r.duration_sec),
    teacher: s(r.teacher),
    platform: String(r.platform),
    url: s(r.url),
    status: String(r.status) as RecordingItem['status'],
    statusDetail: s(r.status_detail),
    hasMedia: Boolean(r.media_path),
    mediaMime: s(r.media_mime),
    transcriptEngine: s(r.transcript_engine),
    documentId: n(r.document_id),
    processedAt: s(r.processed_at),
  };
}

export async function registerRecordingRoutes(app: FastifyInstance, c: Container) {
  const { db, config } = c;

  app.get('/api/recordings', async (req) => {
    const q = z.object({ subjectId: id.optional() }).parse(req.query);
    return db
      .all(
        `${SELECT} WHERE r.removed = 0 ${q.subjectId ? 'AND r.subject_id = ?' : ''} ORDER BY r.recorded_at DESC, r.id DESC`,
        ...(q.subjectId ? [q.subjectId] : []),
      )
      .map(toItem);
  });

  app.get('/api/recordings/queue', async () => ({
    current: c.recordings.current,
    pending: c.recordings.pending,
    log: c.recordings.log.slice(-40),
    transcription: {
      provider: c.transcriber.id,
      model: c.transcriber.model,
      ...(await c.transcriber.check()),
    },
  }));

  app.get('/api/recordings/:id', async (req, reply): Promise<RecordingDetail | undefined> => {
    const r = db.get(`${SELECT} WHERE r.id = ?`, id.parse((req.params as { id: string }).id));
    if (!r) return reply.status(404).send({ error: 'Videoclase no encontrada' });
    return {
      ...toItem(r),
      segments: json.parse(r.transcript_json, []),
      analysis: json.parse(r.analysis_json, null),
    };
  });

  /** Sirve el vídeo/audio local con soporte de Range (para saltar a un minuto concreto). */
  app.get('/api/recordings/:id/media', async (req, reply) => {
    const r = db.get<{ media_path: string | null; media_mime: string | null }>(
      'SELECT media_path, media_mime FROM recordings WHERE id = ?',
      id.parse((req.params as { id: string }).id),
    );
    if (!r?.media_path) return reply.status(404).send({ error: 'Sin medio local' });
    const full = path.resolve(config.paths.files, r.media_path);
    if (!full.startsWith(path.resolve(config.paths.files)) || !fs.existsSync(full))
      return reply.status(404).send({ error: 'Fichero no encontrado' });
    const size = (await fsp.stat(full)).size;
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', r.media_mime ?? 'video/mp4')
      .header('Cache-Control', 'private');
    if (!range) return reply.header('Content-Length', size).send(fs.createReadStream(full));
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : Math.min(start + 8 * 1024 * 1024, size - 1);
    return reply
      .status(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', end - start + 1)
      .send(fs.createReadStream(full, { start, end }));
  });

  app.post('/api/recordings/:id/process', async (req) => {
    const recId = id.parse((req.params as { id: string }).id);
    const { retranscribe } = z.object({ retranscribe: z.boolean().default(false) }).parse(req.body ?? {});
    // Reprocesar conserva la transcripción salvo que se pida explícitamente transcribir de nuevo.
    if (retranscribe)
      db.run(
        `UPDATE recordings SET transcript_json = NULL, transcript_engine = NULL WHERE id = ? AND media_mode != 'captions'`,
        recId,
      );
    db.run(
      `UPDATE recordings SET status = 'queued', status_detail = NULL WHERE id = ? AND status != 'unavailable'`,
      recId,
    );
    c.recordings.enqueue([recId]);
    return { ok: true };
  });

  /** Subida manual de una grabación que tienes permiso para descargar (p. ej. Teams/Stream con descarga permitida). */
  app.post('/api/recordings/upload', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: config.transcription.maxMb * 1024 * 1024 } });
    if (!file) return reply.status(400).send({ error: 'Falta el fichero' });
    if (!isMediaFile(file.filename))
      return reply.status(400).send({ error: 'Formato no soportado (usa mp4, webm, mp3, m4a, wav…)' });
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const subjectId = fields.subjectId?.value ? Number(fields.subjectId.value) : null;
    const title = (fields.title?.value || file.filename.replace(/\.[^.]+$/, '')).slice(0, 200);
    const recordedAt = fields.recordedAt?.value
      ? new Date(fields.recordedAt.value).toISOString()
      : new Date().toISOString();
    const ext = path.extname(file.filename).toLowerCase();
    const extId = `upload:${crypto.randomUUID()}`;
    const rel = path.join('uploads', 'videoclases', `${Date.now()}-${safeName(title, 80)}${ext}`);
    await fsp.mkdir(path.join(config.paths.files, path.dirname(rel)), { recursive: true });
    await fsp.writeFile(path.join(config.paths.files, rel), await file.toBuffer());
    const { lastId } = db.run(
      `INSERT INTO recordings (source_id, external_id, subject_id, title, recorded_at, platform, remote_version, media_mode, media_path, media_mime, status)
       VALUES ('uploads', ?, ?, ?, ?, 'subida-manual', 'v1', 'upload', ?, ?, 'queued')`,
      extId,
      subjectId,
      title,
      recordedAt,
      rel,
      file.mimetype,
    );
    c.recordings.enqueue([lastId]);
    return { id: lastId };
  });
}
