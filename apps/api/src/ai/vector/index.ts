import type { Db } from '../../db/database';

/**
 * Índice de búsqueda. Interfaz pensada para poder sustituir la implementación local (SQLite)
 * por Azure AI Search sin tocar el RAG: mismas operaciones (upsert/delete/vectorSearch/keywordSearch).
 */
export interface SearchIndex {
  upsertDocumentChunks(documentId: number, chunks: { id: number; embedding: Float32Array | null }[]): void;
  deleteDocument(documentId: number): void;
  vectorSearch(
    query: Float32Array,
    k: number,
    documentIds?: Set<number>,
  ): { chunkId: number; score: number }[];
  keywordSearch(query: string, k: number, documentIds?: Set<number>): { chunkId: number; score: number }[];
}

/** Implementación local: vectores en SQLite (BLOB) + búsqueda exacta en memoria + FTS5 (BM25) para palabras clave. */
export class SqliteSearchIndex implements SearchIndex {
  private cache: { ids: Int32Array; docs: Int32Array; vectors: Float32Array; dims: number } | null = null;

  constructor(private readonly db: Db) {}

  upsertDocumentChunks(): void {
    this.cache = null; // los embeddings ya se escriben en la tabla chunks; solo invalidamos la caché
  }

  deleteDocument(): void {
    this.cache = null;
  }

  private load() {
    if (this.cache) return this.cache;
    const rows = this.db.all<{ id: number; document_id: number; embedding: Uint8Array }>(
      `SELECT c.id, c.document_id, c.embedding FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.embedding IS NOT NULL AND d.removed = 0`,
    );
    const dims = rows[0] ? rows[0].embedding.byteLength / 4 : 0;
    const ids = new Int32Array(rows.length);
    const docs = new Int32Array(rows.length);
    const vectors = new Float32Array(rows.length * dims);
    rows.forEach((r, i) => {
      ids[i] = r.id;
      docs[i] = r.document_id;
      const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      if (v.length === dims) vectors.set(v, i * dims);
    });
    this.cache = { ids, docs, vectors, dims };
    return this.cache;
  }

  vectorSearch(query: Float32Array, k: number, documentIds?: Set<number>) {
    const { ids, docs, vectors, dims } = this.load();
    if (dims === 0 || query.length !== dims) return [];
    const scored: { chunkId: number; score: number }[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (documentIds && !documentIds.has(docs[i]!)) continue;
      let dot = 0;
      const off = i * dims;
      for (let j = 0; j < dims; j++) dot += vectors[off + j]! * query[j]!;
      scored.push({ chunkId: ids[i]!, score: dot });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  keywordSearch(query: string, k: number, documentIds?: Set<number>) {
    const terms = query
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu);
    if (!terms?.length) return [];
    const fts = [...new Set(terms)]
      .filter((t) => !STOP.has(t))
      .map((t) => `"${t}"*`)
      .join(' OR ');
    if (!fts) return [];
    const rows = this.db.all<{ id: number; document_id: number; rank: number }>(
      `SELECT c.id, c.document_id, bm25(chunks_fts) AS rank FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.id = c.document_id
       WHERE chunks_fts MATCH ? AND d.removed = 0 ORDER BY rank LIMIT ?`,
      fts,
      documentIds ? k * 10 : k,
    );
    return rows
      .filter((r) => !documentIds || documentIds.has(r.document_id))
      .slice(0, k)
      .map((r) => ({ chunkId: r.id, score: -r.rank }));
  }
}

const STOP = new Set(
  'de la el en los las un una y o que es por para con del al se lo como mas su sus le ya pero sobre este esta son ser qué cual cuál cómo donde dónde explica explicame dime the of and'.split(
    ' ',
  ),
);
