import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from './database';

/**
 * Si la base de datos no existe o está vacía (sin tablas o sin datos) y hay una copia de seguridad con datos,
 * la restaura ANTES de abrirla. Devuelve la copia usada o null.
 */
export function restoreIfEmpty(dbFile: string, dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const hasData = (file: string) => {
    if (!fs.existsSync(file)) return false;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const n = db
        .prepare(
          "SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name IN ('tasks','documents')",
        )
        .get() as { n: number };
      if (n.n < 2) return false;
      const rows = db
        .prepare('SELECT (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM documents) n')
        .get() as { n: number };
      return rows.n > 0;
    } catch {
      return false;
    } finally {
      db?.close();
    }
  };
  if (hasData(dbFile)) return null;
  const backups = fs
    .readdirSync(dir)
    .filter((f) => /^studyvault-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .map((f) => path.join(dir, f));
  const good = backups.find(hasData);
  if (!good) return null;
  for (const ext of ['', '-wal', '-shm', '-journal']) fs.rmSync(dbFile + ext, { force: true });
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.copyFileSync(good, dbFile);
  return good;
}

/**
 * Copia de seguridad consistente de la base de datos (VACUUM INTO: SQLite escribe una copia compacta aunque haya
 * otras conexiones abiertas). Una por día; se conservan las `keep` más recientes. Todo local, nunca en Git.
 */
export function backupDatabase(db: Db, dir: string, keep = 7): string | null {
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
  const file = path.join(dir, `studyvault-${day}.db`);
  // Una base de datos casi vacía (p. ej. recién creada) no debe sustituir a una copia buena del mismo día.
  const tasks = db.get<{ n: number }>('SELECT COUNT(*) n FROM tasks')?.n ?? 0;
  const docs = db.get<{ n: number }>('SELECT COUNT(*) n FROM documents')?.n ?? 0;
  if (tasks + docs === 0) return null;
  if (fs.existsSync(file)) fs.rmSync(file);
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^studyvault-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
