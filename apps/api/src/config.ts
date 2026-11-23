import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const EnvSchema = z.object({
  STUDYVAULT_MODE: z.enum(['personal', 'demo']).default('personal'),
  API_PORT: z.coerce.number().int().default(4317),
  HOST: z.string().default('127.0.0.1'),
  STUDYVAULT_HOME: z.string().optional(),
  DATA_DIR: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),

  MOODLE_BASE_URL: z.string().url().default('https://moodle.example.edu'),
  MOODLE_BROWSER_CHANNEL: z.enum(['msedge', 'chrome', 'chromium']).default('msedge'),
  MOODLE_INCLUDE_PRIVATE_MESSAGES: z.stringbool().default(false),

  EMBEDDINGS_PROVIDER: z.enum(['local', 'openai-compatible', 'ollama']).default('local'),
  EMBEDDINGS_MODEL: z.string().default('Xenova/multilingual-e5-small'),
  EMBEDDINGS_BASE_URL: z.string().optional(),
  EMBEDDINGS_API_KEY: z.string().optional(),

  LLM_PROVIDER: z.enum(['none', 'ollama', 'openai-compatible', 'azure-openai', 'anthropic']).default('none'),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),

  // Transcripción de videoclases: local (whisper.cpp, gratis) | openai-compatible | azure (de pago) | none
  TRANSCRIPTION_PROVIDER: z.enum(['local', 'openai-compatible', 'azure', 'none']).default('local'),
  WHISPER_CPP_BIN: z.string().optional(),
  WHISPER_MODEL: z.string().default('ggml-large-v3-turbo-q8_0.bin'),
  WHISPER_VAD_MODEL: z.string().default('ggml-silero-v5.1.2.bin'),
  FFMPEG_PATH: z.string().optional(),
  TRANSCRIPTION_BASE_URL: z.string().optional(),
  TRANSCRIPTION_MODEL: z.string().optional(),
  TRANSCRIPTION_API_KEY: z.string().optional(),
  AZURE_SPEECH_ENDPOINT: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_LOCALE: z.string().default('es-ES'),
  /** Tamaño máximo de una grabación a descargar (MB). */
  RECORDING_MAX_MB: z.coerce.number().default(4000),

  /** Carpeta (sincronizada con OneDrive) donde se dejan los avisos para Power Automate. "off" lo desactiva. */
  POWER_AUTOMATE_OUTBOX: z.string().optional(),
});

const env = EnvSchema.parse(process.env);
const isDemo = env.STUDYVAULT_MODE === 'demo' || process.argv.includes('--demo');
/**
 * Los datos (documentos, BD, token cifrado, modelos) viven FUERA del repositorio y de OneDrive:
 * %LOCALAPPDATA%StudyVault en Windows. Así no se suben a la nube por la sincronización del Escritorio.
 */
const HOME = path.resolve(
  env.STUDYVAULT_HOME ??
    (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'StudyVault') : path.join(ROOT, 'data')),
);
const dataDir = path.resolve(HOME, env.DATA_DIR ?? (isDemo ? 'data-demo' : 'data'));

export const config = {
  root: ROOT,
  mode: (isDemo ? 'demo' : 'personal') as 'personal' | 'demo',
  port: env.API_PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,
  paths: {
    data: dataDir,
    db: path.join(dataDir, 'studyvault.db'),
    files: path.join(dataDir, 'files'),
    secrets: path.join(dataDir, 'secrets'),
    // Copias de seguridad separadas por modo: una copia del demo nunca debe restaurarse sobre la base personal.
    backups: path.join(HOME, isDemo ? 'backups-demo' : 'backups'),
    home: HOME,
    models: path.join(HOME, 'models'), // los modelos se comparten entre modo personal y demo
    tools: path.join(HOME, 'tools'), // binarios locales (whisper.cpp, ffmpeg)
    webDist: path.join(ROOT, 'apps', 'web', 'dist'),
  },
  moodle: {
    baseUrl: env.MOODLE_BASE_URL.replace(/\/+$/, ''),
    browserChannel: env.MOODLE_BROWSER_CHANNEL,
    includePrivateMessages: env.MOODLE_INCLUDE_PRIVATE_MESSAGES,
  },
  embeddings: {
    provider: env.EMBEDDINGS_PROVIDER,
    model: env.EMBEDDINGS_MODEL,
    baseUrl: env.EMBEDDINGS_BASE_URL,
    apiKey: env.EMBEDDINGS_API_KEY,
  },
  llm: {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    azureApiVersion: env.AZURE_OPENAI_API_VERSION,
  },
  transcription: {
    provider: env.TRANSCRIPTION_PROVIDER,
    whisperBin: env.WHISPER_CPP_BIN ?? path.join(HOME, 'tools', 'whisper.cpp', 'whisper-cli.exe'),
    whisperModel: path.resolve(HOME, 'models', 'whisper', env.WHISPER_MODEL),
    vadModel: path.resolve(HOME, 'models', 'whisper', env.WHISPER_VAD_MODEL),
    ffmpeg: env.FFMPEG_PATH,
    baseUrl: env.TRANSCRIPTION_BASE_URL,
    model: env.TRANSCRIPTION_MODEL,
    apiKey: env.TRANSCRIPTION_API_KEY,
    azureEndpoint: env.AZURE_SPEECH_ENDPOINT,
    azureKey: env.AZURE_SPEECH_KEY,
    azureLocale: env.AZURE_SPEECH_LOCALE,
    maxMb: env.RECORDING_MAX_MB,
  },
  integrations: {
    // Por defecto, en modo personal: <OneDrive para la Empresa>\StudyVault\Avisos; si esa cuenta no está
    // sincronizada en el PC, el OneDrive personal. Solo metadatos de las novedades.
    // En modo demo no se escribe nada salvo que se configure explícitamente.
    outboxDir:
      env.POWER_AUTOMATE_OUTBOX === 'off'
        ? null
        : (env.POWER_AUTOMATE_OUTBOX ??
          (!isDemo && (process.env.OneDriveCommercial || process.env.OneDrive)
            ? path.join((process.env.OneDriveCommercial || process.env.OneDrive)!, 'StudyVault', 'Avisos')
            : null)),
  },
};

export type AppConfig = typeof config;
