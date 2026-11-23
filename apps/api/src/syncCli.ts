// `npm run sync` → sincroniza la fuente Moodle en un proceso propio (no le afectan los reinicios del servidor de
// desarrollo) y espera a que terminen las videoclases en cola. Pensado también para programarlo (Programador de tareas).
//   --inventory   solo inventario, sin descargas
//   --digest      además, genera el resumen diario (HTML) en la carpeta de datos
//   --if-due      no hace nada si el resumen de hoy (a partir de las 21:00) ya se generó. Permite lanzarlo también
//                 al iniciar sesión o al despertar el PC: si estaba dormido a las 21:00, el resumen sale al volver.
process.removeAllListeners('warning');
const { config } = await import('./config');
if (process.argv.includes('--if-due')) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const now = new Date();
  const due = new Date(now);
  due.setHours(21, 0, 0, 0);
  if (now < due) due.setDate(due.getDate() - 1);
  let last = 0;
  try {
    const state = fs.readFileSync(path.join(config.paths.data, 'digest-state.json'), 'utf8');
    last = new Date((JSON.parse(state) as { lastSentAt: string }).lastSentAt).getTime();
  } catch {
    /* nunca generado */
  }
  if (last >= due.getTime()) {
    console.log(`Resumen ya generado (${new Date(last).toLocaleString('es-ES')}); nada que hacer.`);
    process.exit(0);
  }
}
const { createContainer } = await import('./container');

{
  const { restoreIfEmpty } = await import('./db/backup');
  const restored = restoreIfEmpty(config.paths.db, config.paths.backups);
  if (restored) console.log(`Base de datos vacía: restaurada la copia de seguridad ${restored}`);
}
const c = createContainer(config);
// Copia de seguridad antes de tocar nada (se conservan 7 días).
{
  const { backupDatabase } = await import('./db/backup');
  const saved = backupDatabase(c.db, config.paths.backups);
  if (saved) console.log(`Copia de seguridad: ${saved}`);
}
const sourceId = config.mode === 'demo' ? 'demo-campus' : 'moodle';
const adapter = c.adapters.get(sourceId);
if (!adapter) throw new Error(`Fuente ${sourceId} no disponible`);

// Ejecuciones que quedaron «en curso» por un reinicio: se marcan como interrumpidas.
c.db.run(
  `UPDATE sync_runs SET status = 'error', error = 'Interrumpida', finished_at = datetime('now') WHERE status = 'running'`,
);

const mode = process.argv.includes('--inventory') ? 'inventory' : 'sync';
const job = c.sync.start(adapter, { mode });
let printed = 0;
const flush = () => {
  for (const line of job.log.slice(printed)) console.log(line);
  printed = job.log.length;
};
while (c.sync.job?.status === 'running') {
  flush();
  await new Promise((r) => setTimeout(r, 1000));
}
flush();

let lastRec = 0;
while (c.recordings.current || c.recordings.pending.length) {
  for (const line of c.recordings.log.slice(lastRec)) console.log(`[videoclases] ${line}`);
  lastRec = c.recordings.log.length;
  await new Promise((r) => setTimeout(r, 2000));
}
for (const line of c.recordings.log.slice(lastRec)) console.log(`[videoclases] ${line}`);

console.log(`\nResultado: ${job.status} · ${JSON.stringify(job.stats)}`);

// --digest → resumen de lo ocurrido desde el último resumen, guardado como HTML en la carpeta de datos.
if (process.argv.includes('--digest')) {
  const { buildDigest } = await import('./integrations/digest');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const stateFile = path.join(config.paths.data, 'digest-state.json');
  let since = new Date(Date.now() - 86_400_000);
  try {
    since = new Date((JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { lastSentAt: string }).lastSentAt);
  } catch {
    /* primer resumen: últimas 24 h */
  }
  const now = new Date();
  const digest = buildDigest(c.db, {
    since,
    now,
    appUrl: `http://localhost:5173`,
    warning:
      job.status === 'error'
        ? `La sincronización de hoy falló (${job.log.at(-1) ?? 'error'}); el resumen puede estar incompleto.`
        : null,
  });
  const out = path.join(config.paths.data, 'ultimo-resumen.html');
  fs.writeFileSync(out, digest.html);
  fs.writeFileSync(stateFile, JSON.stringify({ lastSentAt: now.toISOString() }));
  console.log(`Resumen guardado en ${out}: ${digest.subject}`);
}
c.db.close();
process.exit(job.status === 'error' ? 1 : 0);
export {};
