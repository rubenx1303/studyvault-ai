// `npm run demo:seed` → reconstruye data-demo/ con contenido FICTICIO, pasando por el pipeline real.
import fs from 'node:fs';
import path from 'node:path';

process.env.STUDYVAULT_MODE = 'demo';
process.removeAllListeners('warning');
const { config } = await import('../config');
const { createContainer } = await import('../container');
const { DemoAdapter } = await import('./demoAdapter');

fs.rmSync(config.paths.data, { recursive: true, force: true });
fs.mkdirSync(config.paths.data, { recursive: true });

const c = createContainer(config);
const adapter = new DemoAdapter(1);
c.repo.upsertSource(adapter.id, adapter.kind, adapter.displayName, { baseUrl: adapter.baseUrl });

console.log('Sincronización inicial (stage 1) del campus DEMO…');
const job = c.sync.start(adapter, { mode: 'sync' });
while (c.sync.job?.status === 'running') await new Promise((r) => setTimeout(r, 300));
while (c.recordings.current || c.recordings.pending.length) await new Promise((r) => setTimeout(r, 300));
for (const line of [...job.log, ...c.recordings.log]) console.log('  ', line);

// Estado "vivido" para que el dashboard no esté vacío en la demo.
c.repo.markChangesSeen();
c.db.run(
  `UPDATE sync_runs SET started_at = datetime('now', '-2 days'), finished_at = datetime('now', '-2 days') WHERE id = ?`,
  job.runId,
);
const prog = c.db.get<{ id: number }>(`SELECT id FROM subjects WHERE external_id = 'prog'`);
const ad = c.db.get<{ id: number }>(`SELECT id FROM subjects WHERE external_id = 'ad'`);
for (const [subject, topic, ok, ko] of [
  [prog?.id, 'Herencia', 2, 4],
  [prog?.id, 'Polimorfismo', 3, 2],
  [ad?.id, 'Patrón DAO', 5, 1],
  [ad?.id, 'Transacciones JDBC', 1, 3],
] as const) {
  c.db.run(
    'INSERT OR REPLACE INTO topic_stats (subject_id, topic, correct, wrong) VALUES (?, ?, ?, ?)',
    subject ?? null,
    topic,
    ok,
    ko,
  );
}
c.db.run(`UPDATE tasks SET local_status = 'done' WHERE external_id = 't-ad-1'`);
c.db.run(`UPDATE tasks SET local_status = 'in_progress' WHERE external_id = 't-ad-2'`);
console.log(
  `\nListo: ${JSON.stringify(c.repo.counts())}. Datos en ${path.relative(config.root, config.paths.data)}/`,
);
c.db.close();
