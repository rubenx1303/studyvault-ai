# Plan de migración a Azure (no ejecutado)

> **Estado:** solo plan. **No se ha creado ningún recurso.** Antes de crear cualquier recurso con coste se pedirá autorización explícita indicando servicio, propósito, nivel gratuito, coste estimado y alternativa.
> Precios orientativos (región West Europe, 2026) — **verificar siempre en la [calculadora de precios](https://azure.microsoft.com/pricing/calculator/)** antes de autorizar.

## Principio

Migración **progresiva** por interfaces: cada pieza local se sustituye por su servicio gestionado sin rehacer la app.

| Pieza              | Interfaz                | Servicio Azure                                           | Nivel gratuito                                              | Coste aprox. uso personal      | Alternativa gratis             |
| ------------------ | ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------ | ------------------------------ |
| Frontend           | build estático          | **Static Web Apps**                                      | Free (100 GB/mes)                                           | 0 €                            | local                          |
| API                | Fastify (contenedor)    | **Container Apps** (consumo, escala a 0)                 | concesión mensual gratuita de vCPU-s/GiB-s y 2 M peticiones | 0–5 €/mes                      | local                          |
| Ingesta programada | `SyncService`           | **Container Apps Job** o **Functions** (timer)           | Functions: 1 M ejecuciones/mes                              | ~0 €                           | botón manual                   |
| Ficheros           | sistema de ficheros     | **Blob Storage** (LRS, Hot/Cool)                         | 5 GB 12 meses (cuenta nueva)                                | céntimos/GB/mes                | local                          |
| BD                 | SQLite                  | Azure SQL serverless / PostgreSQL Flexible               | Azure SQL: oferta gratuita limitada                         | 0–15 €/mes                     | SQLite en volumen              |
| OCR                | extractores             | **AI Document Intelligence**                             | F0: 500 páginas/mes                                         | 0 € con F0                     | pdf.js (sin OCR)               |
| Transcripción      | `TranscriptionProvider` | **Azure AI Speech** (fast transcription, diarización)    | F0: 5 h/mes de audio                                        | ≈1 €/hora de audio (verificar) | whisper.cpp local (GPU)        |
| Embeddings         | `EmbeddingProvider`     | **Azure OpenAI** `text-embedding-3-small` (Foundry)      | —                                                           | céntimos para un curso entero  | e5 local                       |
| Índice             | `SearchIndex`           | **Azure AI Search**                                      | Free (50 MB, 3 índices)                                     | **Basic ≈ 70 €/mes** ⚠         | SQLite + FTS5                  |
| LLM                | `LlmProvider`           | **Azure OpenAI** (gpt-*-mini) en AI Foundry              | —                                                           | pocos €/mes con uso de estudio | Ollama local / modo extractivo |
| Secretos           | `SecretStore`           | **Key Vault** + **Managed Identity**                     | —                                                           | céntimos                       | DPAPI                          |
| Identidad          | —                       | **Microsoft Entra ID** (Easy Auth en SWA/Container Apps) | Free                                                        | 0 €                            | localhost                      |
| Observabilidad     | logger pino             | **Application Insights / Azure Monitor**                 | 5 GB/mes de ingesta                                         | 0 €                            | logs locales                   |

⚠ **Azure AI Search Basic** es el único coste fijo relevante. Para la demo basta el nivel **Free** (el índice de un curso cabe en 50 MB si se limita el número de vectores) o mantener el índice local.

## Arquitectura objetivo (mínimo coste)

```
Entra ID ─► Static Web Apps (React) ─► Container Apps (API, escala a 0, Managed Identity)
                                          ├─► Blob Storage (documentos)
                                          ├─► Azure AI Search Free (índice híbrido)
                                          ├─► Azure OpenAI (embeddings + chat) en AI Foundry
                                          └─► Key Vault (secretos)   · App Insights (telemetría)
Container Apps Job (cron) ─► SyncService (MoodleAdapter) ─► Blob + Search
```

## Consideraciones

- **Privacidad:** los materiales del curso son de uso personal; en Azure irían en un Blob **privado**, sin acceso público, con Entra ID delante. Para una demostración pública: desplegar solo el **modo demo**.
- **Token de Moodle en la nube:** guardarlo en Key Vault y leerlo con Managed Identity. El login seguiría siendo manual desde local (el job en la nube no puede hacer MFA).
- **Infraestructura como código:** Bicep en `infra/` cuando se apruebe el despliegue.

## En pocas palabras

"Desarrollé todo en local con alternativas gratuitas y diseñé cada componente detrás de una interfaz. Cuando quiero escalar, sustituyo SQLite+FTS por Azure AI Search, el modelo local por Azure OpenAI en Foundry, el disco por Blob Storage, y despliego la API en Container Apps con Managed Identity y Key Vault, protegido por Entra ID. Lo hago pieza a pieza y con control de costes: el único coste fijo relevante sería AI Search Basic, por eso para la demo uso el nivel Free."
