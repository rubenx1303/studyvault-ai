import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/database';
import { Outbox } from '../src/integrations/outbox';

describe('bandeja de avisos para Power Automate', () => {
  it('escribe un JSON mínimo por novedad y no escribe nada si está desactivada', async () => {
    const db = new Db(':memory:');
    db.run(`INSERT INTO sources (id, kind, name) VALUES ('s', 't', 'S')`);
    db.run(`INSERT INTO subjects (source_id, external_id, name) VALUES ('s', 'p', 'Programación')`);
    db.run(
      `INSERT INTO tasks (source_id, external_id, subject_id, title, due_at, url, instructions_html) VALUES ('s', 't1', 1, 'Prueba Abierta 1 UD02', '2026-11-02T22:59:00.000Z', 'https://campus/t1', '<p>enunciado privado</p>')`,
    );
    db.run(`INSERT INTO sync_runs (source_id, mode, status) VALUES ('s', 'sync', 'ok')`); // importación inicial previa
    const run = db.run(`INSERT INTO sync_runs (source_id, mode) VALUES ('s', 'sync')`).lastId;
    db.run(
      `INSERT INTO changes (sync_run_id, entity_type, entity_id, change_type, summary, subject_id) VALUES (?, 'task', 1, 'new', 'Prueba Abierta 1 UD02', 1)`,
      run,
    );

    expect(await new Outbox(db, null).publishSyncRun(run)).toBe(0);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-outbox-'));
    expect(await new Outbox(db, dir).publishSyncRun(run)).toBe(1);
    const [file] = fs.readdirSync(dir);
    const e = JSON.parse(fs.readFileSync(path.join(dir, file!), 'utf8'));
    expect(e).toMatchObject({
      schema: 'studyvault.event.v1',
      type: 'task.new',
      subject: 'Programación',
      dueAt: '2026-11-02T22:59:00.000Z',
    });
    expect(e.summary).toMatch(/^Nueva tarea \(Programación\): Prueba Abierta 1 UD02 · entrega/);
    expect(JSON.stringify(e)).not.toContain('enunciado privado'); // minimización: nunca el contenido
  });
});

describe('bandeja: control de inundación', () => {
  it('no avisa en la primera importación y resume si hay muchas novedades', async () => {
    const db = new Db(':memory:');
    db.run(`INSERT INTO sources (id, kind, name) VALUES ('s', 't', 'S')`);
    const sent: string[] = [];
    const outbox = new Outbox(db, null, 30, async (_f, c) => void sent.push(c));
    const addRun = (n: number) => {
      const run = db.run(`INSERT INTO sync_runs (source_id, mode) VALUES ('s', 'sync')`).lastId;
      for (let i = 0; i < n; i++) {
        const doc = db.run(
          `INSERT INTO documents (source_id, external_id, title, filename) VALUES ('s', ?, ?, 'x.pdf')`,
          `d${run}-${i}`,
          `Doc ${i}`,
        ).lastId;
        db.run(
          `INSERT INTO changes (sync_run_id, entity_type, entity_id, change_type, summary) VALUES (?, 'document', ?, 'new', 'Doc')`,
          run,
          doc,
        );
      }
      return run;
    };
    const first = addRun(40);
    expect(await outbox.publishSyncRun(first)).toBe(0); // importación inicial: silencio
    db.run(`UPDATE sync_runs SET status = 'ok' WHERE id = ?`, first);
    expect(await outbox.publishSyncRun(addRun(25))).toBe(1); // 25 novedades → 1 resumen
    expect(JSON.parse(sent[0]!)).toMatchObject({ type: 'summary', title: '25 novedades en el campus' });
  });
});
