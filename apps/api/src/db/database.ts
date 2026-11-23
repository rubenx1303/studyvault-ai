import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { migrations } from './schema';

export type Row = Record<string, SQLInputValue>;

/** Envoltorio mínimo sobre node:sqlite (sin dependencias nativas que compilar). */
export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    // Diario clásico (DELETE), no WAL: el servidor, la sincronización diaria y scripts sueltos abren la misma base de
    // datos desde procesos distintos y a veces se cierran a la fuerza; con WAL los datos aún no volcados al fichero
    // principal llegaron a perderse (26/10). Con DELETE cada transacción queda escrita en studyvault.db al confirmar.
    this.raw.exec(
      'PRAGMA busy_timeout = 10000; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;',
    );
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT (datetime('now')))`,
    );
    const applied = new Set(
      this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version),
    );
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', m.version, m.name);
      });
    }
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export const json = {
  parse<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string' || value === '') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  },
};
