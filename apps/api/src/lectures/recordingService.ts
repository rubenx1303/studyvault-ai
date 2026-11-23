import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RecordingAnalysis, RecordingStatus, TranscriptSegment } from '@studyvault/shared';
import type { EmbeddingProvider } from '../ai/embeddings';
import type { LlmProvider } from '../ai/llm';
import type { Retriever } from '../ai/retrieval';
import type { SearchIndex } from '../ai/vector';
import type { Db } from '../db/database';
import { safeName } from '../sources/classify';
import type { RemoteRecording, SourceAdapter } from '../sources/types';
import { extractAudio, findFfmpeg } from '../transcription/media';
import { formatTimestamp, type TranscriptionProvider } from '../transcription/types';
import { analyzeTranscript } from './analysis';

type Log = (msg: string) => void;
interface Row {
  id: number;
  source_id: string;
  external_id: string;
  subject_id: number | null;
  unit_id: number | null;
  title: string;
  recorded_at: string | null;
  duration_sec: number | null;
  teacher: string | null;
  platform: string;
  url: string | null;
  media_mode: string;
  media_ref: string | null;
  media_path: string | null;
  media_mime: string | null;
  status: RecordingStatus;
  transcript_json: string | null;
  transcript_engine: string | null;
  analysis_json: string | null;
  document_id: number | null;
}

/**
 * Pipeline de videoclases:
 *   detectar → registrar → (descargar) → extraer audio → transcribir → indexar (RAG) → analizar → lista.
 * Cola secuencial en segundo plano (la GPU procesa una clase cada vez). Nada se reprocesa si no cambia.
 */
export class RecordingService {
  private queue: number[] = [];
  private running = false;
  readonly log: string[] = [];
  current: { id: number; title: string; stage: string; pct: number | null } | null = null;

  constructor(
    private readonly db: Db,
    private readonly filesDir: string,
    private readonly transcriber: TranscriptionProvider,
    private readonly embeddings: EmbeddingProvider,
    private readonly index: SearchIndex,
    private readonly llm: LlmProvider,
    private readonly retriever: Retriever,
    private readonly ffmpegCandidates: string[],
    private readonly adapterFor: (sourceId: string) => SourceAdapter | undefined,
  ) {}

  private say(msg: string) {
    this.log.push(`${new Date().toLocaleTimeString('es-ES')} ${msg}`);
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }

  /**
   * Registra las grabaciones del inventario. Devuelve los ids nuevos/cambiados (a procesar).
   * Una grabación ya procesada con la misma versión remota NO se vuelve a procesar.
   */
  upsertFromInventory(
    sourceId: string,
    recs: RemoteRecording[],
    ids: { subject: (ext: string) => number | null; unit: (ext: string | null | undefined) => number | null },
    onChange: (
      recordingId: number,
      type: 'new' | 'modified',
      summary: string,
      subjectId: number | null,
    ) => void,
  ): number[] {
    const toProcess: number[] = [];
    for (const r of recs) {
      const subjectId = ids.subject(r.subjectExternalId);
      const unitId = ids.unit(r.unitExternalId);
      const existing = this.db.get<{
        id: number;
        remote_version: string | null;
        status: string;
        transcript_json: string | null;
      }>(
        'SELECT id, remote_version, status, transcript_json FROM recordings WHERE source_id = ? AND external_id = ?',
        sourceId,
        r.externalId,
      );
      const initialStatus: RecordingStatus = r.media === 'none' ? 'unavailable' : 'queued';
      const captions = r.media === 'captions' && r.captions?.length ? JSON.stringify(r.captions) : null;
      if (!existing) {
        const { lastId } = this.db.run(
          `INSERT INTO recordings (source_id, external_id, subject_id, unit_id, title, recorded_at, duration_sec, teacher, platform, url,
             remote_version, media_mode, media_ref, media_mime, status, status_detail, transcript_json, transcript_engine, analysis_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sourceId,
          r.externalId,
          subjectId,
          unitId,
          r.title,
          r.recordedAt,
          r.durationSec,
          r.teacher,
          r.platform,
          r.url,
          r.version,
          r.media,
          r.mediaRef ?? null,
          r.mediaMime ?? null,
          initialStatus,
          r.unavailableReason ?? null,
          captions,
          captions ? `fuente:${r.platform}` : null,
          r.demoAnalysis ? JSON.stringify(r.demoAnalysis) : null,
        );
        onChange(lastId, 'new', r.title, subjectId);
        if (r.media !== 'none') toProcess.push(lastId);
      } else {
        this.db.run(
          `UPDATE recordings SET subject_id = ?, unit_id = ?, title = ?, recorded_at = ?, duration_sec = COALESCE(?, duration_sec),
             teacher = ?, url = ?, removed = 0 WHERE id = ?`,
          subjectId,
          unitId,
          r.title,
          r.recordedAt,
          r.durationSec,
          r.teacher,
          r.url,
          existing.id,
        );
        if (existing.remote_version !== r.version) {
          this.db.run(
            `UPDATE recordings SET remote_version = ?, media_mode = ?, media_ref = ?, media_mime = ?, status = ?, status_detail = ?,
               transcript_json = ?, transcript_engine = ?, analysis_json = ? WHERE id = ?`,
            r.version,
            r.media,
            r.mediaRef ?? null,
            r.mediaMime ?? null,
            initialStatus,
            r.unavailableReason ?? null,
            captions,
            captions ? `fuente:${r.platform}` : null,
            r.demoAnalysis ? JSON.stringify(r.demoAnalysis) : null,
            existing.id,
          );
          onChange(existing.id, 'modified', r.title, subjectId);
          if (r.media !== 'none') toProcess.push(existing.id);
        } else if (existing.status === 'queued' || existing.status === 'error') {
          toProcess.push(existing.id); // reintento de algo que quedó a medias
        }
      }
    }
    return toProcess;
  }

  enqueue(ids: number[]) {
    for (const id of ids) if (!this.queue.includes(id)) this.queue.push(id);
    void this.drain();
  }

  get pending() {
    return [...this.queue];
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        await this.process(id).catch(() => {});
      }
    } finally {
      this.running = false;
      this.current = null;
    }
  }

  private setStatus(id: number, status: RecordingStatus, detail: string | null = null) {
    this.db.run('UPDATE recordings SET status = ?, status_detail = ? WHERE id = ?', status, detail, id);
    if (this.current?.id === id) this.current = { ...this.current, stage: status, pct: null };
  }

  async process(id: number, log: Log = () => {}): Promise<void> {
    const row = this.db.get<Row>('SELECT * FROM recordings WHERE id = ?', id);
    if (!row) return;
    this.current = { id, title: row.title, stage: 'queued', pct: null };
    const say = (m: string) => (this.say(`«${row.title}»: ${m}`), log(m));
    let wav: string | null = null;
    try {
      let segments: TranscriptSegment[] | null = row.transcript_json ? JSON.parse(row.transcript_json) : null;
      if (!segments)
        await this.transcribeMedia(
          row,
          say,
          (w) => (wav = w),
          (s) => (segments = s),
        );
      if (!segments?.length) throw new Error('La transcripción está vacía');

      // 4) Indexar como fuente RAG (documento "lecture" con fragmentos con marca temporal)
      this.setStatus(id, 'indexing');
      say('Indexando transcripción…');
      const documentId = await this.index_(row, segments);

      // 5) Análisis con IA (si hay LLM). En demo se usa el análisis precalculado y marcado como tal.
      let analysis: RecordingAnalysis | null = row.analysis_json ? JSON.parse(row.analysis_json) : null;
      if (this.llm.available && (!analysis || analysis.generatedBy.startsWith('demo'))) {
        this.setStatus(id, 'analyzing');
        const subject = row.subject_id
          ? (this.db.get<{ name: string }>('SELECT name FROM subjects WHERE id = ?', row.subject_id)?.name ??
            null)
          : null;
        // Si el LLM falla (p. ej. Ollama parado), la clase queda transcrita e indexada; se reanaliza con «Reprocesar».
        const a = await analyzeTranscript(this.llm, segments, { title: row.title, subject }, say).catch(
          (e: Error) => (say(`Análisis IA no disponible (${e.message}).`), null),
        );
        if (a)
          analysis = {
            ...a,
            relatedMaterial: [],
            generatedBy: `${this.llm.id}:${this.llm.model}`,
            generatedAt: new Date().toISOString(),
          };
      }
      if (analysis) {
        analysis.relatedMaterial = await this.related(row, analysis, documentId);
        this.db.run('UPDATE recordings SET analysis_json = ? WHERE id = ?', JSON.stringify(analysis), id);
      }

      this.db.run(
        `UPDATE recordings SET status = 'ready', status_detail = ?, processed_at = datetime('now') WHERE id = ?`,
        analysis
          ? null
          : this.llm.available
            ? 'Transcrita e indexada. El análisis IA falló: pulsa «Reprocesar» cuando la IA esté disponible.'
            : 'Transcrita e indexada. Análisis IA pendiente: configura un LLM.',
        id,
      );
      say('Lista.');
    } catch (err) {
      const msg = (err as Error).message;
      this.setStatus(id, 'error', msg.slice(0, 500));
      say(`Error: ${msg}`);
      throw err;
    } finally {
      if (wav) await fsp.rm(wav, { force: true });
      this.current = null;
    }
  }

  /** Crea/actualiza el documento de transcripción y sus fragmentos (sin cruzar ~1000 caracteres). */
  private async index_(row: Row, segments: TranscriptSegment[]): Promise<number> {
    const date = row.recorded_at ? row.recorded_at.slice(0, 10) : 'sin-fecha';
    const filename = `Videoclase_${date}_${safeName(row.title, 60)}.txt`;
    const rel = path.join(safeName(row.source_id), 'videoclases', `${row.id}-transcripcion.txt`);
    const text = segments
      .map((s) => `[${formatTimestamp(s.start)}]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text}`)
      .join('\n');
    await fsp.mkdir(path.dirname(path.join(this.filesDir, rel)), { recursive: true });
    await fsp.writeFile(path.join(this.filesDir, rel), text, 'utf8');

    let documentId = row.document_id;
    if (!documentId) {
      documentId = this.db.run(
        `INSERT INTO documents (source_id, external_id, subject_id, unit_id, title, filename, mime, kind, status, url, local_path, recording_id, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, 'text/plain', 'lecture', 'processed', ?, ?, ?, datetime('now'))
         ON CONFLICT(source_id, external_id) DO UPDATE SET title = excluded.title`,
        row.source_id,
        `recording:${row.external_id}`,
        row.subject_id,
        row.unit_id,
        `Videoclase · ${row.title}`,
        filename,
        row.url,
        rel,
        row.id,
      ).lastId;
      if (!documentId)
        documentId = this.db.get<{ id: number }>(
          'SELECT id FROM documents WHERE source_id = ? AND external_id = ?',
          row.source_id,
          `recording:${row.external_id}`,
        )!.id;
      this.db.run('UPDATE recordings SET document_id = ? WHERE id = ?', documentId, row.id);
    }

    const chunks = chunkTranscript(segments);
    let vectors: (Float32Array | null)[] = chunks.map(() => null);
    try {
      vectors = await this.embeddings.embed(
        chunks.map((c) => `${row.title}\n${c.text}`),
        'passage',
      );
    } catch {
      /* sin embeddings: queda la búsqueda léxica */
    }
    this.db.tx(() => {
      this.db.run('DELETE FROM chunks WHERE document_id = ?', documentId);
      chunks.forEach((c, i) => {
        const v = vectors[i] ?? null;
        this.db.run(
          `INSERT INTO chunks (document_id, ord, page, section, text, embedding, embedding_model, start_sec, end_sec) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
          documentId!,
          i,
          formatTimestamp(c.start),
          c.text,
          v ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null,
          v ? this.embeddings.model : null,
          c.start,
          c.end,
        );
      });
      this.db.run(
        `UPDATE documents SET status = 'processed', processed_at = datetime('now'), subject_id = ?, unit_id = ?, removed = 0, error = NULL WHERE id = ?`,
        row.subject_id,
        row.unit_id,
        documentId!,
      );
    });
    this.index.upsertDocumentChunks(documentId, []);
    return documentId;
  }

  /** Material relacionado: documentos de la asignatura que tratan los temas de la clase (búsqueda híbrida). */
  private async related(row: Row, analysis: RecordingAnalysis, lectureDocId: number) {
    const query = [...analysis.topics.map((t) => t.text), ...analysis.concepts.map((c) => c.term)]
      .slice(0, 12)
      .join(', ');
    if (!query) return [];
    const hits = await this.retriever.search(query, row.subject_id ? { subjectId: row.subject_id } : {}, 10);
    return hits
      .filter((h) => h.documentId !== lectureDocId && !h.filename.startsWith('Videoclase_'))
      .slice(0, 6)
      .map((h) => ({
        documentId: h.documentId,
        title: h.documentTitle,
        filename: h.filename,
        page: h.bestPage,
      }));
  }

  /** Descarga (si hace falta) el medio de una grabación, extrae el audio y lo transcribe con el motor configurado. */
  private async transcribeMedia(
    row: Row,
    say: (m: string) => void,
    setWav: (wav: string) => void,
    setResult: (segments: TranscriptSegment[], engine: string) => void,
  ) {
    const id = row.id;
    // 1) Medio local: subido manualmente o descargable desde la fuente autorizada
    let mediaPath = row.media_path ? path.join(this.filesDir, row.media_path) : null;
    if (!mediaPath || !fs.existsSync(mediaPath)) {
      if (row.media_mode !== 'download') throw new Error('No hay medio disponible para transcribir');
      const adapter = this.adapterFor(row.source_id);
      if (!adapter?.downloadRecording) throw new Error('La fuente no permite descargar esta grabación');
      this.setStatus(id, 'downloading');
      say('Descargando grabación…');
      const rel = path.join(
        safeName(row.source_id),
        'videoclases',
        `${id}-${safeName(row.title, 80)}${extFor(row.media_mime)}`,
      );
      mediaPath = path.join(this.filesDir, rel);
      await fsp.mkdir(path.dirname(mediaPath), { recursive: true });
      const remote = this.toRemote(row);
      const { mime } = await adapter.downloadRecording(remote, mediaPath, (m) => {
        const pct = Number(m.match(/(\d+)%/)?.[1]);
        if (this.current) this.current.pct = Number.isFinite(pct) ? pct : null;
      });
      this.db.run(
        'UPDATE recordings SET media_path = ?, media_mime = COALESCE(?, media_mime) WHERE id = ?',
        rel,
        mime,
        id,
      );
    }

    // 2) Audio WAV mono 16 kHz
    const ffmpeg = await findFfmpeg(this.ffmpegCandidates);
    if (!ffmpeg) throw new Error('ffmpeg no está instalado. Ejecuta: npm run setup:transcription');
    const ready = await this.transcriber.check();
    if (!ready.ok) throw new Error(ready.reason ?? 'Motor de transcripción no disponible');
    this.setStatus(id, 'extracting');
    say('Extrayendo audio…');
    const wav = path.join(os.tmpdir(), `sv-rec-${id}-${Date.now()}.wav`);
    setWav(wav);
    const { durationSec } = await extractAudio(
      ffmpeg,
      mediaPath,
      wav,
      (p) => this.current && (this.current.pct = Math.round(p)),
      row.duration_sec,
    );
    if (durationSec && !row.duration_sec)
      this.db.run('UPDATE recordings SET duration_sec = ? WHERE id = ?', durationSec, id);

    // 3) Transcripción con marcas temporales
    this.setStatus(id, 'transcribing');
    say(`Transcribiendo con ${this.transcriber.id} (${this.transcriber.model ?? ''})…`);
    const subject = row.subject_id
      ? this.db.get<{ name: string }>('SELECT name FROM subjects WHERE id = ?', row.subject_id)?.name
      : null;
    const t = await this.transcriber.transcribe(wav, {
      language: 'es',
      prompt: `Clase${subject ? ` de ${subject}` : ''}: ${row.title}.`,
      onProgress: (pct) => this.current && (this.current.pct = pct),
    });
    setResult(t.segments, t.engine);
    this.db.run(
      'UPDATE recordings SET transcript_json = ?, transcript_engine = ?, language = ? WHERE id = ?',
      JSON.stringify(t.segments),
      t.engine,
      t.language,
      id,
    );
    if (!row.duration_sec && t.durationSec)
      this.db.run('UPDATE recordings SET duration_sec = ? WHERE id = ?', t.durationSec, id);
  }

  private toRemote(row: Row): RemoteRecording {
    return {
      externalId: row.external_id,
      subjectExternalId: '',
      title: row.title,
      recordedAt: row.recorded_at,
      durationSec: row.duration_sec,
      teacher: row.teacher,
      platform: row.platform,
      url: row.url,
      version: '',
      media: 'download',
      mediaRef: row.media_ref,
      mediaMime: row.media_mime,
    };
  }
}

export function chunkTranscript(segments: TranscriptSegment[], size = 1000) {
  const out: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; lines: string[]; len: number } | null = null;
  for (const s of segments) {
    const line = `[${formatTimestamp(s.start)}]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text}`;
    if (cur && cur.len + line.length > size) {
      out.push({ start: cur.start, end: cur.end, text: cur.lines.join('\n') });
      cur = null;
    }
    cur ??= { start: s.start, end: s.end, lines: [], len: 0 };
    cur.lines.push(line);
    cur.len += line.length + 1;
    cur.end = s.end;
  }
  if (cur) out.push({ start: cur.start, end: cur.end, text: cur.lines.join('\n') });
  return out;
}

function extFor(mime: string | null): string {
  if (!mime) return '.mp4';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('m4a') || mime.includes('mp4a')) return '.m4a';
  return '.mp4';
}
