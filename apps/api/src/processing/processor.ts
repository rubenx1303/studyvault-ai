import fs from 'node:fs/promises';
import path from 'node:path';
import type { EmbeddingProvider } from '../ai/embeddings';
import type { SearchIndex } from '../ai/vector';
import type { Db } from '../db/database';
import { isIndexable } from '../sources/classify';
import { chunkSegments } from './chunker';
import { extract } from './extractors';

type Log = (msg: string) => void;

/** Pipeline documental: fichero → extracción → chunking → embeddings → índice. */
export class DocumentProcessor {
  constructor(
    private readonly db: Db,
    private readonly filesDir: string,
    private readonly embeddings: EmbeddingProvider,
    private readonly index: SearchIndex,
  ) {}

  async process(documentId: number, log: Log = () => {}): Promise<{ chunks: number }> {
    const doc = this.db.get<{ id: number; filename: string; local_path: string | null }>(
      'SELECT id, filename, local_path FROM documents WHERE id = ?',
      documentId,
    );
    if (!doc?.local_path) throw new Error('Documento sin fichero local');
    if (!isIndexable(doc.filename)) {
      this.db.run(
        `UPDATE documents SET status = 'skipped', error = 'Formato no indexable' WHERE id = ?`,
        documentId,
      );
      return { chunks: 0 };
    }

    try {
      const buffer = await fs.readFile(path.join(this.filesDir, doc.local_path));
      const { segments, pageCount } = await extract(buffer, doc.filename);
      const chunks = chunkSegments(segments);
      if (chunks.length === 0) {
        this.db.run(
          `UPDATE documents SET status = 'processed', page_count = ?, processed_at = datetime('now'),
           error = 'Sin texto extraíble (¿PDF escaneado? Requiere OCR)' WHERE id = ?`,
          pageCount,
          documentId,
        );
        return { chunks: 0 };
      }

      let vectors: (Float32Array | null)[] = chunks.map(() => null);
      let embedError: string | null = null;
      try {
        vectors = await this.embeddings.embed(
          chunks.map((c) => (c.section ? `${c.section}\n${c.text}` : c.text)),
          'passage',
        );
      } catch (err) {
        embedError = `Embeddings no disponibles: ${(err as Error).message}`;
        log(embedError);
      }

      const ids: { id: number; embedding: Float32Array | null }[] = [];
      this.db.tx(() => {
        this.db.run('DELETE FROM chunks WHERE document_id = ?', documentId);
        chunks.forEach((c, i) => {
          const v = vectors[i] ?? null;
          const { lastId } = this.db.run(
            'INSERT INTO chunks (document_id, ord, page, section, text, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?)',
            documentId,
            c.ord,
            c.page,
            c.section,
            c.text,
            v ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null,
            v ? this.embeddings.model : null,
          );
          ids.push({ id: lastId, embedding: v });
        });
        this.db.run(
          `UPDATE documents SET status = 'processed', page_count = ?, processed_at = datetime('now'), error = ? WHERE id = ?`,
          pageCount,
          embedError,
          documentId,
        );
      });
      this.index.upsertDocumentChunks(documentId, ids);
      return { chunks: chunks.length };
    } catch (err) {
      this.db.run(
        `UPDATE documents SET status = 'error', error = ? WHERE id = ?`,
        (err as Error).message.slice(0, 500),
        documentId,
      );
      throw err;
    }
  }

  /** Procesa documentos descargados pendientes y re-embebe los que se quedaron sin vectores. */
  async processPending(log: Log = () => {}): Promise<{ processed: number; errors: number }> {
    const pending = this.db.all<{ id: number; title: string }>(
      `SELECT id, title FROM documents WHERE removed = 0 AND local_path IS NOT NULL AND (
         status = 'downloaded' OR (status = 'processed' AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = documents.id AND c.embedding IS NULL))
       ) ORDER BY id`,
    );
    let processed = 0;
    let errors = 0;
    for (const [i, d] of pending.entries()) {
      try {
        const { chunks } = await this.process(d.id, log);
        processed++;
        log(`Procesado (${i + 1}/${pending.length}) «${d.title}»: ${chunks} fragmentos`);
      } catch (err) {
        errors++;
        log(`Error procesando «${d.title}»: ${(err as Error).message}`);
      }
    }
    return { processed, errors };
  }
}
