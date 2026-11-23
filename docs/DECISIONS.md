# Decisiones arquitectónicas (ADR resumidos)

## ADR-001 · API oficial de Moodle en lugar de scraping

**Contexto.** Muchos centros usan Moodle con login SSO (p. ej. Office 365). El endpoint público `tool_mobile_get_public_config` indica si el servicio web móvil está habilitado (`enablemobilewebservice: 1`).
**Decisión.** Usar la API REST del servicio `moodle_mobile_app` con el flujo SSO de la app oficial (`admin/tool/mobile/launch.php` → `moodlemobile://token=`). Playwright solo abre el navegador para el login manual.
**Consecuencias.** Datos estructurados y estables (ids, `timemodified`, tamaños) → sincronización incremental fiable. Sin selectores CSS frágiles. **Riesgo:** si el centro no habilita el servicio móvil para los alumnos, Moodle responde `servicenotavailable` tras el login. En ese caso quedan la carpeta local y la subida manual, o habría que escribir otro adaptador detrás de la misma interfaz.

## ADR-002 · `SourceAdapter` como frontera

Las fuentes solo producen un **inventario** (metadatos) y **descargan** ficheros concretos. El `SyncService` compara, decide y persiste. Así `MoodleAdapter`, `LocalFolderAdapter`, `DemoAdapter` y futuros (OneDrive/SharePoint/GitHub/otros LMS) son intercambiables.

## ADR-003 · SQLite nativo (`node:sqlite`) + ficheros

Uso personal, un solo usuario. `node:sqlite` (Node 24) evita dependencias nativas que compilar e incluye **FTS5**. Esquema relacional con migraciones versionadas, portable a Azure SQL/PostgreSQL.

## ADR-004 · Embeddings locales

`Xenova/multilingual-e5-small` (ONNX, cuantizado q8) vía transformers.js: gratis, español, sin enviar documentos fuera. Interfaz `EmbeddingProvider` con alternativas OpenAI-compatible/Ollama/Azure.
**Calibración.** E5 comprime las similitudes (irrelevante ≈0,80–0,83; relevante ≥0,85). Por eso el umbral de fundamentación combina similitud ≥0,84 **o** coincidencia léxica, y el LLM tiene una segunda barrera en el prompt.

## ADR-005 · Recuperación híbrida con RRF

Semántica (conceptos) + BM25 (siglas/términos exactos como "DAO", "JDBC"), fusionadas con Reciprocal Rank Fusion (no requiere calibrar escalas). Búsqueda vectorial exacta en memoria: suficiente para el volumen de un curso. Interfaz `SearchIndex` sustituible por Azure AI Search.

## ADR-006 · Chunking que no cruza páginas

Cada fragmento conserva página/diapositiva/sección → citas precisas y salto directo (`#page=N`). Se limpian encabezados/pies repetidos antes de trocear.

## ADR-007 · LLM intercambiable y modo sin LLM

`LlmProvider` con `none` (RAG extractivo), Ollama, OpenAI-compatible, Azure OpenAI (endpoint v1) y Anthropic. El producto es útil sin coste; la generación (resúmenes, exámenes) se activa al configurar un proveedor.

## ADR-008 · Seguridad del token

Token cifrado con DPAPI (CurrentUser) invocando PowerShell con el secreto por stdin. Contexto de navegador efímero (no se guardan cookies). Lista blanca de funciones de lectura en el cliente.

## ADR-009 · Monolito modular

Un backend (módulos: sources, sync, processing, ai, db) y un frontend. Sin microservicios: mantenible por una persona. Las fronteras son interfaces, no procesos.

## ADR-010 · Modo demo aislado

`STUDYVAULT_MODE=demo` usa `data-demo/` y un `DemoAdapter` con contenido ficticio que recorre el pipeline real. En modo demo el adaptador real de Moodle **no se instancia**.

## ADR-011 · Videoclases como fuente RAG

**Contexto.** En Moodle las videoconferencias suelen ser actividades de plataformas externas (módulos de videoconferencia o actividades LTI). Sus grabaciones no son accesibles para el alumno desde la API de Moodle y a menudo están protegidas.
**Decisión.** No eludir ninguna protección ni capturar streams. El adaptador **detecta** las videoconferencias (estado «No procesable» con el motivo) y StudyVault procesa grabaciones cuando existe una vía legítima: vídeos subidos como recurso de Moodle (descarga con token), BigBlueButton (API oficial + medio público), subtítulos que ofrezca la fuente, o **subida manual** de un fichero que el alumno pudo descargar.
**Pipeline.** detectar → registrar → (descargar) → ffmpeg (WAV 16 kHz mono) → `TranscriptionProvider` → la transcripción se materializa como documento `lecture` con fragmentos con `start_sec` → mismo índice híbrido y citas con marca temporal → análisis map-reduce con LLM.
**Salvaguarda de examen.** «Entra en el examen» solo se acepta si el profesor lo dice explícitamente y la **cita literal se verifica** en la transcripción; lo demás es «contenido tratado».

## ADR-012 · Motor de transcripción local

**Opciones evaluadas (oct. 2026).** Whisper large-v3 / large-v3-turbo, NVIDIA Parakeet-TDT-0.6B-v3 y Canary-1B-v2, Voxtral Mini, omniASR. Los benchmarks no coinciden: Parakeet v3 rinde mejor en un conjunto de español leído, pero peor en uno amplio de lenguas ibéricas, donde Whisper large-v3 y omniASR lideran. Parakeet/Canary requieren Python + NeMo.
**Decisión.** **Whisper large-v3-turbo (q8_0) con whisper.cpp oficial + CUDA** y **VAD Silero** (reduce alucinaciones en silencios). Cabe en una GPU de 8 GB y no requiere Python. Interfaz `TranscriptionProvider` con `LocalTranscriptionProvider`, `AzureTranscriptionProvider` (Azure AI Speech, con diarización; **de pago, desactivado**) y un proveedor OpenAI-compatible (p. ej. servidor faster-whisper local).
**Diarización.** whisper.cpp no la ofrece de forma fiable en español: no se etiquetan hablantes. Con Azure, solo se marca «Profesor» al hablante dominante (≥60 %); el resto, «Hablante N».
**Nota:** los binarios oficiales de whisper.cpp se compilan con una versión concreta de CUDA; en GPU muy recientes dependen de la compilación JIT del driver.
