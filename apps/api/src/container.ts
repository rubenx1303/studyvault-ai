import type { AppConfig } from './config';
import { createEmbeddingProvider } from './ai/embeddings';
import { createLlmProvider } from './ai/llm';
import { RagService } from './ai/rag';
import { Retriever } from './ai/retrieval';
import { StudyService } from './ai/study';
import { SqliteSearchIndex } from './ai/vector';
import { Db } from './db/database';
import { Repo } from './db/repo';
import { DemoAdapter } from './demo/demoAdapter';
import { Outbox } from './integrations/outbox';
import { RecordingService } from './lectures/recordingService';
import { DocumentProcessor } from './processing/processor';
import { ffmpegCandidates } from './transcription/media';
import { createTranscriptionProvider } from './transcription/providers';
import { SecretStore } from './security/secretStore';
import { createMoodleAdapter } from './sources/moodle/moodleAdapter';
import type { SourceAdapter } from './sources/types';
import { SyncService } from './sync/syncService';

/** Composición de dependencias: el único sitio donde se eligen implementaciones concretas (local vs Azure). */
export function createContainer(config: AppConfig) {
  const db = new Db(config.paths.db);
  const repo = new Repo(db);
  const secrets = new SecretStore(config.paths.secrets);
  const embeddings = createEmbeddingProvider(config);
  const llm = createLlmProvider(config);
  const index = new SqliteSearchIndex(db);
  const retriever = new Retriever(db, index, embeddings);
  const rag = new RagService(db, retriever, llm);
  const study = new StudyService(db, retriever, llm);
  const processor = new DocumentProcessor(db, config.paths.files, embeddings, index);
  const transcriber = createTranscriptionProvider(config);
  const adapters = new Map<string, SourceAdapter>();
  const recordings = new RecordingService(
    db,
    config.paths.files,
    transcriber,
    embeddings,
    index,
    llm,
    retriever,
    ffmpegCandidates(config.transcription.ffmpeg, config.paths.tools),
    (id) => adapters.get(id),
  );
  const outbox = new Outbox(db, config.integrations.outboxDir);
  const sync = new SyncService(db, config.paths.files, processor, recordings, outbox);

  // En modo demo NUNCA se instancia el adaptador real de Moodle.
  const register = (a: SourceAdapter) => {
    adapters.set(a.id, a);
    repo.upsertSource(a.id, a.kind, a.displayName, { baseUrl: a.baseUrl });
  };
  if (config.mode === 'demo') register(new DemoAdapter());
  else register(createMoodleAdapter(config.moodle, secrets));
  repo.upsertSource('uploads', 'upload', 'Subidas manuales');

  return {
    config,
    db,
    repo,
    secrets,
    embeddings,
    llm,
    index,
    retriever,
    rag,
    study,
    processor,
    sync,
    adapters,
    transcriber,
    recordings,
    outbox,
  };
}

export type Container = ReturnType<typeof createContainer>;
