import net from 'node:net';
import fs from 'node:fs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config';
import { createContainer } from './container';
import { backupDatabase, restoreIfEmpty } from './db/backup';
import { registerRoutes } from './routes';

process.removeAllListeners('warning'); // silencia el ExperimentalWarning de node:sqlite

// Una sola instancia: si el puerto ya está ocupado, StudyVault ya está en marcha y esta copia se va SIN abrir la
// base de datos (varias copias arrancando a la vez sobre la misma base de datos acabaron perdiendo los datos).
const portInUse = await new Promise<boolean>((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(true));
  probe.once('listening', () => probe.close(() => resolve(false)));
  probe.listen(config.port, config.host);
});
if (portInUse) {
  console.log(`StudyVault ya está en marcha en el puerto ${config.port}; esta copia no se inicia.`);
  process.exit(0);
}

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport: process.stdout.isTTY
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
    // Nunca registrar tokens: Moodle los admite en query string (pluginfile) y cabeceras de proveedores LLM.
    redact: ['req.headers.authorization', 'req.headers["api-key"]', 'req.headers["x-api-key"]'],
  },
  bodyLimit: 25 * 1024 * 1024,
});

const restored = restoreIfEmpty(config.paths.db, config.paths.backups);
if (restored) console.log(`Base de datos vacía: restaurada la copia de seguridad ${restored}`);
const container = createContainer(config);
try {
  backupDatabase(container.db, config.paths.backups);
} catch (err) {
  app.log.warn({ err }, 'No se pudo hacer la copia de seguridad de la base de datos');
}

// Solo escucha en localhost y solo acepta el frontend local (la app es personal; no se expone a la red).
await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/] });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
await registerRoutes(app, container);

if (fs.existsSync(config.paths.webDist)) {
  await app.register(fastifyStatic, { root: config.paths.webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/')
      ? reply.status(404).send({ error: 'No encontrado' })
      : reply.sendFile('index.html'),
  );
}

const shutdown = async () => {
  await app.close();
  container.db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `StudyVault API en http://${config.host}:${config.port} — modo ${config.mode.toUpperCase()} — datos en ${config.paths.data}`,
);
