# StudyVault AI

Aplicación local para centralizar el material de un curso online: sincroniza de forma incremental los documentos, tareas, avisos y grabaciones de un campus Moodle, extrae y fragmenta su texto, lo indexa para búsqueda híbrida y responde preguntas con citas a los documentos originales (RAG).

Se ejecuta en el propio equipo. Los documentos descargados, la base de datos, el token cifrado y los modelos se guardan fuera del repositorio (`%LOCALAPPDATA%\StudyVault` por defecto en Windows). StudyVault es de **solo lectura** frente al campus: nunca envía entregas ni modifica nada en el origen.

## Probar en 2 minutos: modo demo

El modo demo usa un campus **ficticio** (asignaturas, documentos, tareas, avisos y una videoclase con transcripción) que recorre el pipeline real. No se conecta a ningún campus ni necesita credenciales.

```bash
npm ci
cp .env.example .env    # trae STUDYVAULT_MODE=demo
npm run demo:seed       # genera los datos ficticios (la primera vez descarga el modelo de embeddings, ~130 MB)
npm run dev:demo        # API en http://127.0.0.1:4317 y web en http://127.0.0.1:5173
```

Abre <http://127.0.0.1:5173>. Los datos de demo se guardan en `<carpeta de datos>/data-demo`, separados de los personales.

## Arquitectura

```
Campus Moodle ──► SourceAdapter ──► SyncService ──► ficheros + SQLite ──► DocumentProcessor ──► chunks + embeddings
 (API REST)                         (inventario → diff → descarga                (extracción, limpieza,            │
                                     → hash SHA-256 → cambios)                    fragmentación por página)        ▼
                                                                                                         Retriever híbrido
Grabaciones ──► RecordingService (ffmpeg → transcripción → documento)                                    (coseno + BM25, RRF)
                                                                                                                │
Novedades ──► outbox JSON ──► carpeta OneDrive ──► flujo de Power Automate (avisos)                    RAG con citas
```

Monorepo con npm workspaces:

- `apps/api`: API con Fastify y TypeScript. Módulos `sources`, `sync`, `processing`, `ai`, `lectures`, `transcription`, `integrations` y `db`.
- `apps/web`: interfaz con React, Vite, TanStack Query y Tailwind CSS.
- `packages/shared`: tipos compartidos entre API y web.

## Pipeline de datos

1. **Ingesta**: cada fuente implementa `SourceAdapter` (inventario y descarga). La app registra el adaptador de Moodle (modo personal) o el de demo (modo demo); además se pueden subir documentos y grabaciones a mano.
2. **Sincronización incremental**: compara el inventario remoto con el local, descarga solo lo nuevo o modificado, calcula el hash SHA-256 y registra cada ejecución y cada cambio.
3. **Extracción**: PDF (pdf.js), DOCX (mammoth), DOC (word-extractor), PPTX (JSZip) y HTML; elimina cabeceras y pies repetidos.
4. **Fragmentación e indexación**: fragmentos por página o sección, embeddings locales (`multilingual-e5-small` con transformers.js) guardados en SQLite e índice FTS5 para BM25.
5. **Recuperación**: búsqueda semántica y léxica fusionadas con Reciprocal Rank Fusion, filtrada por asignatura, unidad, documento o tarea antes de buscar.
6. **Respuesta**: sin LLM devuelve una respuesta extractiva con citas; con un proveedor configurado genera la respuesta a partir de los fragmentos recuperados.

## Modelo de datos

SQLite mediante `node:sqlite`, con migraciones versionadas y copias de seguridad diarias con `VACUUM INTO`. Tablas: `sources`, `subjects`, `units`, `documents`, `chunks`, `chunks_fts` (FTS5), `tasks`, `task_documents`, `messages`, `recordings`, `sync_runs`, `changes`, `queries`, `exam_attempts`, `topic_stats` y `study_cache`.

## Estado

### Implementado

- **Fuente Moodle** (`MoodleAdapter`): API REST oficial del servicio web móvil (`moodle_mobile_app`) con lista blanca de funciones de lectura. El login lo haces tú en una ventana del navegador (Playwright con Edge o Chrome instalados, contexto efímero); StudyVault solo guarda el token.
- **Modo demo** (`DemoAdapter`) con contenido 100 % ficticio.
- **Subida manual** de documentos y de grabaciones (vídeo o audio).
- Panel con tareas pendientes, vencidas y entregadas, avisos y novedades de cada sincronización.
- Visor de documentos, búsqueda semántica y asistente de preguntas con citas.
- Modo estudio y modo examen con corrección y estadísticas por tema.
- **Transcripción de grabaciones** con whisper.cpp en local (o un proveedor compatible) y análisis de cada sesión con LLM. Funciona con ficheros subidos a mano, vídeos alojados en Moodle (descarga con el token) y grabaciones de BigBlueButton cuyo medio sea público.
- Avisos de novedades para Power Automate (patrón outbox, ver `docs/POWER_AUTOMATE.md`).
- Resumen diario en HTML (`npm run daily`) guardado en la carpeta de datos.
- Copias de seguridad diarias de la base de datos (se conservan 7).

### Limitaciones y pendiente

- La fuente Moodle **requiere que el sitio tenga habilitado el servicio web móvil para alumnos**. Si Moodle responde `servicenotavailable`, no hay sincronización automática: quedan el modo demo y la subida manual.
- Las videoconferencias en plataformas externas (Teams, Zoom, Webex, actividades LTI…) se **detectan** y se marcan como «No procesable» con el motivo. StudyVault no descarga grabaciones protegidas; si tienes permiso de descarga, súbela a mano.
- `LocalFolderAdapter` (carpeta `<raíz>/<Asignatura>/<Unidad>/<fichero>`) está implementado pero todavía no se puede activar desde la configuración ni la interfaz.
- Sin OCR: los PDF escaneados no aportan texto.
- El script `npm run setup:transcription` y los valores por defecto del motor local están pensados para Windows (`whisper-cli.exe`, ffmpeg con winget).
- En sistemas que no son Windows, el token se guarda sin cifrar (permisos 0600) dentro de la carpeta de datos.
- `docs/AZURE.md` es solo un plan: no hay nada desplegado.

## Proveedores configurables

| Componente    | Opciones                                                                        |
| ------------- | ------------------------------------------------------------------------------- |
| Embeddings    | `local` (transformers.js), `openai-compatible`, `ollama`                        |
| LLM           | `none` (extractivo), `ollama`, `openai-compatible`, `azure-openai`, `anthropic` |
| Transcripción | `local` (whisper.cpp), `openai-compatible`, `azure`, `none`                     |

Todas las claves están en `.env.example`. Deja comentadas las que no uses: una clave vacía (`CLAVE=`) no cuenta como «sin definir».

## Uso con tu propio Moodle

Requisitos: Node.js 24 o superior (usa `node:sqlite`) y Edge o Chrome instalados para el login.

1. En `.env`, pon `STUDYVAULT_MODE=personal` y `MOODLE_BASE_URL=https://moodle.example.edu` con la URL de tu campus. Opcional: `MOODLE_BROWSER_CHANNEL=chrome` (por defecto `msedge`).
2. Inicia sesión: `npm run moodle:login` (o desde la web, en **Fuentes y sincronización → Iniciar sesión en el navegador**). Se abre el navegador, entras con tu usuario (SSO/MFA incluidos) y StudyVault recibe un token de solo lectura. `npm run moodle:login -- --logout` lo borra.
3. Arranca la app con `npm run dev` y sincroniza desde la web, o por línea de comandos con `npm run sync` (`-- --inventory` para ver solo el inventario).
4. Transcripción local (opcional): `npm run setup:transcription` y `TRANSCRIPTION_PROVIDER=local`.

Otros scripts: `npm run build` (compila la web), `npm start` (API), `npm run daily` (sincroniza y genera el resumen) y `scripts/abrir-studyvault.cmd` (Windows: arranca el servidor si no está en marcha y abre el navegador).

## Calidad

```bash
npm run typecheck
npm run lint
npm test              # Vitest: 19 pruebas en 4 ficheros
```

Las pruebas cubren extracción y fragmentación, sincronización incremental, recuperación, cliente Moodle (firma del token y lista blanca), outbox, resumen diario y procesamiento de grabaciones, con embeddings simulados y sin acceso a red.

## Privacidad

- No se almacenan usuario ni contraseña del campus: el inicio de sesión se hace a mano en el navegador y StudyVault solo guarda el token de la API.
- En Windows, los secretos locales se cifran con DPAPI (ámbito del usuario).
- Los avisos de Power Automate solo llevan metadatos (tipo, título, asignatura, fecha y enlace), nunca el contenido de los documentos ni de los mensajes.
- `.gitignore` excluye datos, bases de datos, secretos y cualquier documento académico (`*.pdf`, `*.docx`, `*.pptx`…).

## Documentación

- `docs/DECISIONS.md`: decisiones de arquitectura.
- `docs/POWER_AUTOMATE.md`: configuración del flujo de avisos.
- `docs/AZURE.md`: plan de despliegue en Azure (no desplegado).

## Licencia

[MIT](LICENSE) © 2026 Rubén Darío Bermúdez Camargo.

Las dependencias conservan sus propias licencias. JSZip, usado para leer ficheros PPTX, tiene licencia dual MIT o GPL-3.0; aquí se usa bajo MIT.
