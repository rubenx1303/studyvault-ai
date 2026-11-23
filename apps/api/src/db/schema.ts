// Migraciones SQL versionadas. Cada entrada se aplica una sola vez (tabla schema_migrations).
// SQLite local ahora; el modelo es relacional y portable a Azure SQL / PostgreSQL si hiciera falta.

export const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial',
    sql: /* sql */ `
      CREATE TABLE sources (
        id TEXT PRIMARY KEY,               -- 'moodle', 'local:apuntes', ...
        kind TEXT NOT NULL,                -- 'moodle', 'local-folder', ...
        name TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        account TEXT,                      -- nombre visible de la cuenta (sin credenciales)
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE subjects (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        short_name TEXT,
        url TEXT,
        teachers_json TEXT NOT NULL DEFAULT '[]',
        color TEXT NOT NULL DEFAULT '#6366f1',
        hidden INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source_id, external_id)
      );

      CREATE TABLE units (
        id INTEGER PRIMARY KEY,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        url TEXT,
        UNIQUE (subject_id, external_id)
      );

      CREATE TABLE documents (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,         -- identificador estable en la fuente
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime TEXT,
        kind TEXT NOT NULL DEFAULT 'other',
        status TEXT NOT NULL DEFAULT 'pending',
        url TEXT,                          -- URL de origen (para verificar procedencia)
        remote_version TEXT,               -- huella remota (timemodified+size / etag) para sync incremental
        remote_modified_at TEXT,
        local_path TEXT,                   -- relativo a data/files
        size INTEGER,
        content_hash TEXT,                 -- sha256 del contenido descargado
        page_count INTEGER,
        synced_at TEXT,
        processed_at TEXT,
        error TEXT,
        removed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source_id, external_id)
      );
      CREATE INDEX idx_documents_subject ON documents(subject_id, unit_id);

      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        page INTEGER,                      -- página (PDF) o diapositiva (PPTX)
        section TEXT,
        text TEXT NOT NULL,
        embedding BLOB,                    -- Float32Array normalizado
        embedding_model TEXT
      );
      CREATE INDEX idx_chunks_document ON chunks(document_id);

      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;

      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        instructions_html TEXT,
        opened_at TEXT,
        due_at TEXT,
        cutoff_at TEXT,
        url TEXT,
        remote_version TEXT,
        local_status TEXT NOT NULL DEFAULT 'pending',   -- estado PROPIO de StudyVault, nunca se escribe en el campus
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source_id, external_id)
      );

      CREATE TABLE task_documents (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, document_id)
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        author TEXT,
        title TEXT NOT NULL,
        body_html TEXT NOT NULL DEFAULT '',
        posted_at TEXT,
        url TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        remote_version TEXT,
        read_local INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source_id, external_id)
      );

      CREATE TABLE sync_runs (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        stats_json TEXT NOT NULL DEFAULT '{}',
        log_json TEXT NOT NULL DEFAULT '[]',
        inventory_json TEXT,
        error TEXT
      );

      CREATE TABLE changes (
        id INTEGER PRIMARY KEY,
        sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        change_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        subject_id INTEGER,
        seen INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE queries (
        id INTEGER PRIMARY KEY,
        question TEXT NOT NULL,
        scope_json TEXT NOT NULL DEFAULT '{}',
        answer TEXT,
        citations_json TEXT NOT NULL DEFAULT '[]',
        grounded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE exam_attempts (
        id INTEGER PRIMARY KEY,
        subject_id INTEGER,
        unit_ids_json TEXT NOT NULL DEFAULT '[]',
        questions_json TEXT NOT NULL,
        answers_json TEXT,
        results_json TEXT,
        score REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );

      CREATE TABLE topic_stats (
        subject_id INTEGER,
        topic TEXT NOT NULL,
        correct INTEGER NOT NULL DEFAULT 0,
        wrong INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (subject_id, topic)
      );

      CREATE TABLE study_cache (
        key TEXT PRIMARY KEY,              -- tipo + ámbito (p. ej. 'summary:unit:12')
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    name: 'recordings',
    sql: /* sql */ `
      -- Videoclases. La transcripción se materializa además como un "documento" (kind = 'lecture')
      -- para que el RAG, la búsqueda y las citas reutilicen exactamente el mismo pipeline.
      CREATE TABLE recordings (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        recorded_at TEXT,
        duration_sec REAL,
        teacher TEXT,
        platform TEXT NOT NULL,
        url TEXT,
        remote_version TEXT,
        media_mode TEXT NOT NULL DEFAULT 'none',   -- download | captions | none | upload
        media_ref TEXT,
        media_path TEXT,                            -- relativo a data/files (solo local, nunca en Git)
        media_mime TEXT,
        status TEXT NOT NULL DEFAULT 'detected',
        status_detail TEXT,
        transcript_json TEXT,                       -- [{start,end,text,speaker?}]
        transcript_engine TEXT,
        language TEXT,
        analysis_json TEXT,
        document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
        removed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT,
        UNIQUE (source_id, external_id)
      );
      CREATE INDEX idx_recordings_subject ON recordings(subject_id);
      ALTER TABLE documents ADD COLUMN recording_id INTEGER;
      ALTER TABLE chunks ADD COLUMN start_sec REAL;
      ALTER TABLE chunks ADD COLUMN end_sec REAL;
    `,
  },
  {
    version: 3,
    name: 'task-submission',
    sql: /* sql */ `
      -- Estado de la entrega tal como lo muestra el campus al alumno (solo lectura): submitted | draft | none.
      ALTER TABLE tasks ADD COLUMN remote_submission TEXT;
      ALTER TABLE tasks ADD COLUMN remote_graded INTEGER;
    `,
  },
];
