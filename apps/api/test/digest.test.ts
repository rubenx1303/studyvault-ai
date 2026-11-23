import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/database';
import { buildDigest } from '../src/integrations/digest';

describe('resumen diario por correo', () => {
  it('incluye novedades y entregas próximas, sin el contenido privado', () => {
    const db = new Db(':memory:');
    db.run(`INSERT INTO sources (id, kind, name) VALUES ('s', 't', 'S')`);
    db.run(`INSERT INTO subjects (source_id, external_id, name) VALUES ('s', 'p', 'Programación')`);
    db.run(
      `INSERT INTO tasks (source_id, external_id, subject_id, title, due_at, url, instructions_html) VALUES ('s', 't1', 1, 'Prueba Abierta 1 UD02', '2026-11-02T22:59:00.000Z', 'https://campus/t1', '<p>enunciado privado</p>')`,
    );
    db.run(`INSERT INTO sync_runs (source_id, mode, status) VALUES ('s', 'sync', 'ok')`); // importación inicial
    const run = db.run(`INSERT INTO sync_runs (source_id, mode, status) VALUES ('s', 'sync', 'ok')`).lastId;
    db.run(
      `INSERT INTO changes (sync_run_id, entity_type, entity_id, change_type, summary, subject_id, created_at) VALUES (?, 'task', 1, 'new', 'Nueva tarea: Prueba Abierta 1 UD02', 1, '2026-10-30 10:00:00')`,
      run,
    );

    const d = buildDigest(db, {
      since: new Date('2026-10-30T08:00:00Z'),
      now: new Date('2026-10-30T19:00:00Z'),
    });
    expect(d.hasNews).toBe(true);
    expect(d.subject).toMatch(/^StudyVault · .* · 1 tareas$/);
    expect(d.html).toContain('Nueva tarea: Prueba Abierta 1 UD02');
    expect(d.html).toContain('Lo urgente (próximos 7 días)');
    expect(d.html).toContain('Entregas en las próximas 3 semanas');
    expect(d.html).toContain('https://campus/t1');
    expect(d.html).not.toContain('enunciado privado');

    const empty = buildDigest(db, {
      since: new Date('2026-10-31T08:00:00Z'),
      now: new Date('2026-10-31T19:00:00Z'),
    });
    expect(empty.hasNews).toBe(false);
    expect(empty.subject).toMatch(/sin novedades$/);
  });
});
