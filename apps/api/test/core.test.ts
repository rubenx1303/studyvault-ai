import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../src/ai/embeddings';
import { SqliteSearchIndex } from '../src/ai/vector';
import { Db } from '../src/db/database';
import { DemoAdapter } from '../src/demo/demoAdapter';
import { chunkSegments } from '../src/processing/chunker';
import { extract, stripRepeatedLines } from '../src/processing/extractors';
import { DocumentProcessor } from '../src/processing/processor';
import { classifyDocument } from '../src/sources/classify';
import { parseLaunchToken } from '../src/sources/moodle/moodleAuth';
import { MoodleClient, flatten } from '../src/sources/moodle/moodleClient';
import type { RemoteFile, SourceAdapter, SourceInventory } from '../src/sources/types';
import { SyncService, type SyncJob } from '../src/sync/syncService';

describe('chunker', () => {
  it('no cruza páginas y conserva la página de origen', () => {
    const long = 'Frase de relleno sobre persistencia de datos. '.repeat(60);
    const chunks = chunkSegments([
      { page: 1, section: null, text: long },
      { page: 2, section: null, text: 'El patrón DAO separa negocio y acceso a datos en una interfaz.' },
    ]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.length <= 1100)).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ page: 2 });
  });
});

describe('extracción', () => {
  it('elimina encabezados y pies repetidos', () => {
    const pages = [1, 2, 3, 4].map((n) => ({
      page: n,
      section: null,
      text: `Manual de Java — Campus\nContenido único ${n} de la página\nPágina ${n}`,
    }));
    const out = stripRepeatedLines(pages);
    expect(out[0]!.text).toBe('Contenido único 1 de la página');
  });

  it('extrae PDF por páginas y DOCX por secciones (documentos demo)', async () => {
    const demo = new DemoAdapter(2);
    const pdf = await demo.download({ downloadRef: 'ad-ud1-tema' } as RemoteFile);
    const r = await extract(pdf, 'tema.pdf');
    expect(r.pageCount).toBe(4);
    expect(r.segments[1]!.text).toContain('patrón DAO');
    expect(r.segments[1]!.text).not.toContain('DEMO ficticia');
    const docx = await demo.download({ downloadRef: 'ad-ud1-caso' } as RemoteFile);
    const d = await extract(docx, 'caso.docx');
    expect(d.segments.map((s) => s.section)).toContain('Requisitos');
  }, 20_000); // genera y lee PDF reales: con la GPU ocupada puede pasar de los 5 s por defecto
});

describe('Moodle', () => {
  it('aplana arrays como espera la API REST', () => {
    expect(flatten({ courseids: [3, 7], options: { a: true } })).toEqual([
      ['courseids[0]', '3'],
      ['courseids[1]', '7'],
      ['options[a]', '1'],
    ]);
  });

  it('verifica la firma del token SSO y rechaza firmas falsas', () => {
    const base = 'https://campus.example.com';
    const sig = crypto.createHash('md5').update(`${base}123`).digest('hex');
    const ok = `moodlemobile://token=${Buffer.from(`${sig}:::abc:::priv`).toString('base64')}`;
    expect(parseLaunchToken(ok, base, '123')).toEqual({ token: 'abc', privateToken: 'priv' });
    expect(() => parseLaunchToken(ok, base, '999')).toThrow(/Firma/);
  });

  it('bloquea funciones que no son de lectura', async () => {
    const c = new MoodleClient('https://campus.example.com', 't');
    await expect(c.call('mod_assign_save_submission')).rejects.toThrow(/no permitida/);
  });
});

describe('clasificación', () => {
  it('clasifica por nombre', () => {
    expect(classifyDocument('Tarea 2 entrega', 't.docx')).toBe('task');
    expect(classifyDocument('Caso práctico 1')).toBe('case');
    expect(classifyDocument('Tema UD3 POO')).toBe('theory');
  });
});

describe('sincronización incremental', () => {
  const fakeEmb: EmbeddingProvider = {
    id: 'fake',
    model: 'fake',
    embed: async (t) => t.map(() => new Float32Array([1, 0, 0])),
  };

  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-'));
    const db = new Db(':memory:');
    db.run(`INSERT INTO sources (id, kind, name) VALUES ('fake', 'test', 'Fake')`);
    const processor = new DocumentProcessor(db, dir, fakeEmb, new SqliteSearchIndex(db));
    return { db, sync: new SyncService(db, dir, processor) };
  }

  const inventory = (version: string, due: string): SourceInventory => ({
    sourceId: 'fake',
    account: null,
    generatedAt: '',
    subjects: [{ externalId: 's1', name: 'Acceso a Datos', teachers: [] }],
    units: [{ externalId: 'u1', subjectExternalId: 's1', name: 'UD1', position: 1 }],
    files: [
      {
        externalId: 'f1',
        subjectExternalId: 's1',
        unitExternalId: 'u1',
        title: 'Tema',
        filename: 'tema.txt',
        downloadRef: 'x',
        version,
      },
    ],
    tasks: [
      {
        externalId: 't1',
        subjectExternalId: 's1',
        title: 'Tarea',
        instructionsHtml: null,
        openedAt: null,
        dueAt: due,
        cutoffAt: null,
        url: null,
        version: due,
        attachmentFileIds: [],
      },
    ],
    messages: [],
    skipped: [],
    warnings: [],
  });

  it('descarga solo lo nuevo/modificado y registra cambios', async () => {
    const { db, sync } = setup();
    let downloads = 0;
    let content = 'El patrón DAO encapsula el acceso a datos detrás de una interfaz.';
    const adapter = {
      id: 'fake',
      download: async () => (downloads++, Buffer.from(content)),
    } as unknown as SourceAdapter;
    const job = () =>
      ({
        runId: db.run(`INSERT INTO sync_runs (source_id, mode) VALUES ('fake','sync')`).lastId,
        log: [],
        stats: {
          documentsNew: 0,
          documentsModified: 0,
          documentsUnchanged: 0,
          tasksNew: 0,
          tasksChanged: 0,
          messagesNew: 0,
          errors: 0,
          processed: 0,
          subjects: 0,
        },
      }) as unknown as SyncJob;

    const j1 = job();
    await sync.apply(adapter, inventory('v1', '2026-11-01T00:00:00Z'), { mode: 'sync' }, j1);
    expect(j1.stats).toMatchObject({ documentsNew: 1, tasksNew: 1, processed: 1 });

    const j2 = job();
    await sync.apply(adapter, inventory('v1', '2026-11-01T00:00:00Z'), { mode: 'sync' }, j2);
    expect(downloads).toBe(1); // nada cambió → sin descargas
    expect(j2.stats.documentsUnchanged).toBe(1);

    content = 'Contenido actualizado del tema sobre DAO y repositorios.';
    const j3 = job();
    await sync.apply(adapter, inventory('v2', '2026-11-05T00:00:00Z'), { mode: 'sync' }, j3);
    expect(j3.stats).toMatchObject({ documentsModified: 1, tasksChanged: 1 });
    const types = db
      .all<{ change_type: string }>('SELECT change_type FROM changes WHERE sync_run_id = ?', j3.runId)
      .map((r) => r.change_type);
    expect(types).toEqual(expect.arrayContaining(['modified', 'due_changed']));

    // Regresión: la transcripción de una videoclase (documento derivado) no debe marcarse como retirada.
    db.run(
      "INSERT INTO documents (source_id, external_id, title, filename, recording_id) VALUES ('fake', 'recording:r1', 'Videoclase', 'v.txt', 1)",
    );
    await sync.apply(adapter, inventory('v2', '2026-11-05T00:00:00Z'), { mode: 'sync' }, job());
    expect(
      db.get<{ removed: number }>("SELECT removed FROM documents WHERE external_id = 'recording:r1'")
        ?.removed,
    ).toBe(0);
  });
});
