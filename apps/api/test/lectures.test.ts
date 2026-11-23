import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../src/ai/embeddings';
import type { LlmProvider } from '../src/ai/llm';
import { Retriever } from '../src/ai/retrieval';
import { SqliteSearchIndex } from '../src/ai/vector';
import { Db } from '../src/db/database';
import { DemoAdapter } from '../src/demo/demoAdapter';
import { parseTs, quoteInTranscript } from '../src/lectures/analysis';
import { chunkTranscript, RecordingService } from '../src/lectures/recordingService';
import { ltiVideoPlatform, parseBbbRecordings } from '../src/sources/moodle/recordings';
import type { TranscriptionProvider } from '../src/transcription/types';
import { formatTimestamp, labelSpeakers } from '../src/transcription/types';

describe('análisis de videoclases', () => {
  it('solo acepta indicaciones de examen cuya cita literal existe en la transcripción', () => {
    const t = 'esto os lo digo claramente la diferencia entre dao y repository entra en el examen asi que';
    expect(quoteInTranscript('la diferencia entre DAO y Repository entra en el examen', t)).toBe(true);
    expect(quoteInTranscript('el patrón singleton entra en el examen', t)).toBe(false); // inventada
    expect(quoteInTranscript('examen', t)).toBe(false); // demasiado corta para ser una cita
  });

  it('interpreta marcas temporales', () => {
    expect(parseTs('00:10:30')).toBe(630);
    expect(parseTs('7:05')).toBe(425);
    expect(parseTs(12)).toBe(12);
    expect(parseTs('sin hora')).toBeNull();
    expect(formatTimestamp(3725)).toBe('01:02:05');
  });

  it('diarización: solo etiqueta «Profesor» al hablante claramente dominante, sin inventar identidades', () => {
    const dominant = labelSpeakers([
      { start: 0, end: 80, text: 'a', rawSpeaker: 1 },
      { start: 80, end: 90, text: 'b', rawSpeaker: 2 },
    ]);
    expect(dominant.map((s) => s.speaker)).toEqual(['Profesor', 'Hablante 2']);
    const balanced = labelSpeakers([
      { start: 0, end: 50, text: 'a', rawSpeaker: 1 },
      { start: 50, end: 100, text: 'b', rawSpeaker: 2 },
    ]);
    expect(balanced.map((s) => s.speaker)).toEqual(['Hablante 1', 'Hablante 2']);
  });

  it('trocea la transcripción conservando inicio y fin de cada fragmento', () => {
    const segs = Array.from({ length: 40 }, (_, i) => ({
      start: i * 30,
      end: i * 30 + 30,
      text: 'Explicación del patrón DAO y su interfaz. '.repeat(2),
    }));
    const chunks = chunkTranscript(segs);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[1]!.start).toBeGreaterThan(0);
    expect(chunks.at(-1)!.end).toBe(1200);
    expect(chunks[0]!.text).toMatch(/^\[00:00:00\]/);
  });
});

describe('detección en Moodle', () => {
  it('reconoce las videoconferencias (LTI) por su nombre', () => {
    expect(ltiVideoPlatform('Tutoría Grupal 1 - Programación')).toBe('videoconferencia');
    expect(ltiVideoPlatform('Videotutoría 2 — RA 2')).toBe('videoconferencia');
    expect(ltiVideoPlatform('Simulador de redes')).toBeNull();
  });

  it('extrae grabaciones de BigBlueButton de la respuesta de la API', () => {
    const rid = `${'a'.repeat(40)}-1700000000000`;
    const data = JSON.stringify([
      {
        recording: 'Clase 3',
        date: 1700000000000,
        duration: '45',
        playback: `<a href="https://bbb.example.com/playback/presentation/2.3/${rid}">Ver</a>`,
      },
    ]);
    const [r] = parseBbbRecordings(data);
    expect(r).toMatchObject({ recordId: rid, name: 'Clase 3', durationSec: 2700 });
    expect(r!.mediaCandidates[0]).toBe(`https://bbb.example.com/presentation/${rid}/video/webcams.mp4`);
  });
});

describe('sincronización incremental de videoclases', () => {
  it('registra nuevas, indexa con marcas temporales y no reprocesa las que no cambian', async () => {
    const db = new Db(':memory:');
    db.run(`INSERT INTO sources (id, kind, name) VALUES ('demo-campus', 'test', 'Demo')`);
    db.run(
      `INSERT INTO subjects (source_id, external_id, name) VALUES ('demo-campus', 'ad', 'Acceso a Datos')`,
    );
    const emb: EmbeddingProvider = {
      id: 'fake',
      model: 'fake',
      embed: async (t) => t.map(() => new Float32Array([1, 0, 0])),
    };
    const index = new SqliteSearchIndex(db);
    const noLlm = { id: 'none', model: null, available: false, chat: async () => '' } as LlmProvider;
    let transcribed = 0;
    const transcriber: TranscriptionProvider = {
      id: 'fake',
      model: null,
      check: async () => ({ ok: true, reason: null }),
      transcribe: async () => (
        transcribed++,
        { language: 'es', durationSec: 0, segments: [], engine: 'fake' }
      ),
    };
    const svc = new RecordingService(
      db,
      fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rec-')),
      transcriber,
      emb,
      index,
      noLlm,
      new Retriever(db, index, emb),
      [],
      () => undefined,
    );
    const recs = (await new DemoAdapter(1).inventory()).recordings!;
    const ids = { subject: () => 1, unit: () => null };
    const changes: string[] = [];

    const first = svc.upsertFromInventory('demo-campus', recs, ids, (_id, type) => changes.push(type));
    expect(first).toHaveLength(1);
    for (const id of first) await svc.process(id);
    const row = db.get<{ status: string; document_id: number }>('SELECT status, document_id FROM recordings');
    expect(row?.status).toBe('ready');
    const chunk = db.get<{ start_sec: number }>(
      'SELECT start_sec FROM chunks WHERE document_id = ? ORDER BY ord LIMIT 1',
      row!.document_id,
    );
    expect(chunk?.start_sec).toBe(5);
    expect(transcribed).toBe(0); // venía con subtítulos de la fuente: no hace falta transcribir

    const second = svc.upsertFromInventory('demo-campus', recs, ids, (_id, type) => changes.push(type));
    expect(second).toHaveLength(0); // sin cambios → no se reprocesa
    expect(changes).toEqual(['new']);
  });
});

describe('limpieza del análisis de modelos locales', () => {
  it('quita el bloque ```markdown y descarta el ruido de examExplicit', async () => {
    const { cleanMarkdown, isExamStatement } = await import('../src/lectures/analysis');
    expect(cleanMarkdown('```markdown\n# Resumen de la Clase\n\nSe vio **IoT**.\n```')).toBe(
      'Se vio **IoT**.',
    );
    expect(isExamStatement('qué entra según el profesor')).toBe(false);
    expect(isExamStatement('No se especifica qué entra en el examen')).toBe(false);
    expect(isExamStatement('Las características de los sistemas ciberfísicos son preguntables')).toBe(true);
  });
});
