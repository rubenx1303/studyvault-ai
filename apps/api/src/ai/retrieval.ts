import type { Citation, SearchHit, SearchScope } from '@studyvault/shared';
import type { Db } from '../db/database';
import type { EmbeddingProvider } from './embeddings';
import type { SearchIndex } from './vector';

export interface RetrievedChunk extends Citation {
  text: string;
  section: string | null;
  vectorScore: number | null;
  keywordHit: boolean;
}

/**
 * Recuperación híbrida:
 *   - semántica (embeddings, similitud coseno) → encuentra conceptos aunque no coincidan las palabras;
 *   - léxica (BM25/FTS5) → acierta siglas y términos exactos ("DAO", "JDBC");
 *   - fusión con Reciprocal Rank Fusion (RRF), robusta sin calibrar puntuaciones.
 * El ámbito (asignatura/unidad/documento/tarea) se traduce en un filtro de documentos ANTES de buscar.
 */
export class Retriever {
  constructor(
    private readonly db: Db,
    private readonly index: SearchIndex,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  scopeDocumentIds(scope: SearchScope = {}): Set<number> | undefined {
    if (scope.documentId) return new Set([scope.documentId]);
    if (scope.recordingId) {
      const r = this.db.get<{ document_id: number | null }>(
        'SELECT document_id FROM recordings WHERE id = ?',
        scope.recordingId,
      );
      return new Set(r?.document_id ? [r.document_id] : []);
    }
    if (scope.taskId) {
      const t = this.db.get<{ subject_id: number | null; unit_id: number | null }>(
        'SELECT subject_id, unit_id FROM tasks WHERE id = ?',
        scope.taskId,
      );
      // Una tarea busca en sus adjuntos + su unidad + (si no hay unidad) su asignatura.
      const ids = this.db.all<{ id: number }>(
        `SELECT document_id AS id FROM task_documents WHERE task_id = ?
         UNION SELECT id FROM documents WHERE removed = 0 AND (
           (? IS NOT NULL AND unit_id = ?) OR (? IS NOT NULL AND subject_id = ?))`,
        scope.taskId,
        t?.unit_id ?? null,
        t?.unit_id ?? null,
        t?.subject_id ?? null,
        t?.subject_id ?? null,
      );
      return new Set(ids.map((r) => r.id));
    }
    if (scope.unitIds?.length) {
      const ph = scope.unitIds.map(() => '?').join(',');
      return new Set(
        this.db
          .all<{ id: number }>(`SELECT id FROM documents WHERE unit_id IN (${ph})`, ...scope.unitIds)
          .map((r) => r.id),
      );
    }
    if (scope.subjectId) {
      return new Set(
        this.db
          .all<{ id: number }>('SELECT id FROM documents WHERE subject_id = ?', scope.subjectId)
          .map((r) => r.id),
      );
    }
    return undefined;
  }

  async retrieve(
    query: string,
    scope: SearchScope = {},
    k = 8,
  ): Promise<{ chunks: RetrievedChunk[]; method: string; candidates: number }> {
    const docIds = this.scopeDocumentIds(scope);
    if (docIds && docIds.size === 0) return { chunks: [], method: 'empty-scope', candidates: 0 };

    let vector: { chunkId: number; score: number }[] = [];
    let method = 'hybrid';
    try {
      const [q] = await this.embeddings.embed([query], 'query');
      vector = q ? this.index.vectorSearch(q, 40, docIds) : [];
    } catch {
      method = 'keyword-only'; // si el modelo de embeddings no está disponible, seguimos con BM25
    }
    const keyword = this.index.keywordSearch(query, 40, docIds);

    const RRF_K = 60;
    const fused = new Map<number, { rrf: number; vectorScore: number | null; keywordHit: boolean }>();
    vector.forEach((h, rank) =>
      fused.set(h.chunkId, { rrf: 1 / (RRF_K + rank + 1), vectorScore: h.score, keywordHit: false }),
    );
    keyword.forEach((h, rank) => {
      const cur = fused.get(h.chunkId) ?? { rrf: 0, vectorScore: null, keywordHit: false };
      cur.keywordHit = true;
      cur.rrf += 1 / (RRF_K + rank + 1);
      fused.set(h.chunkId, cur);
    });

    const top = [...fused.entries()].sort((a, b) => b[1].rrf - a[1].rrf).slice(0, k);
    const chunks = top
      .map(([chunkId, s], i) => {
        const r = this.db.get<Record<string, unknown>>(
          `SELECT c.id, c.text, c.page, c.section, c.start_sec, d.recording_id, rec.recorded_at, d.id AS document_id, d.title, d.filename, d.mime,
                  s.name AS subject_name, u.name AS unit_name
           FROM chunks c JOIN documents d ON d.id = c.document_id
           LEFT JOIN subjects s ON s.id = d.subject_id LEFT JOIN units u ON u.id = d.unit_id
           LEFT JOIN recordings rec ON rec.id = d.recording_id WHERE c.id = ?`,
          chunkId,
        );
        if (!r) return null;
        return {
          n: i + 1,
          chunkId,
          documentId: Number(r.document_id),
          documentTitle: String(r.title),
          filename: String(r.filename),
          mime: r.mime == null ? null : String(r.mime),
          subjectName: r.subject_name == null ? null : String(r.subject_name),
          unitName: r.unit_name == null ? null : String(r.unit_name),
          page: r.page == null ? null : Number(r.page),
          recordingId: r.recording_id == null ? null : Number(r.recording_id),
          startSec: r.start_sec == null ? null : Number(r.start_sec),
          recordedAt: r.recorded_at == null ? null : String(r.recorded_at),
          section: r.section == null ? null : String(r.section),
          text: String(r.text),
          excerpt: String(r.text).slice(0, 320),
          score: s.rrf,
          vectorScore: s.vectorScore,
          keywordHit: s.keywordHit,
        } satisfies RetrievedChunk;
      })
      .filter((c) => c !== null) as RetrievedChunk[];
    return { chunks, method, candidates: fused.size };
  }

  /** Búsqueda semántica agrupada por documento (pantalla de búsqueda). */
  async search(query: string, scope: SearchScope = {}, limit = 20): Promise<SearchHit[]> {
    const { chunks } = await this.retrieve(query, scope, 60);
    const byDoc = new Map<number, SearchHit>();
    for (const c of chunks) {
      if (!c.keywordHit && (c.vectorScore ?? 0) < 0.83) continue; // ruido semántico (ver calibración en rag.ts)
      const existing = byDoc.get(c.documentId);
      const matchType: SearchHit['matchType'] =
        c.vectorScore != null && c.keywordHit ? 'hybrid' : c.keywordHit ? 'keyword' : 'semantic';
      if (!existing) {
        byDoc.set(c.documentId, {
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          filename: c.filename,
          mime: c.mime,
          subjectName: c.subjectName,
          unitName: c.unitName,
          bestPage: c.page,
          excerpt: c.excerpt,
          score: c.score,
          matchType,
        });
      } else existing.score += c.score * 0.3; // varios fragmentos relevantes refuerzan el documento
    }
    return [...byDoc.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
