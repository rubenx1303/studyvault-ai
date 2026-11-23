// Tipos compartidos entre API y frontend (contrato de la API REST de StudyVault).

export type DocumentKind =
  'theory' | 'exercise' | 'case' | 'task' | 'resource' | 'exam' | 'lecture' | 'other';
export type DocumentStatus = 'pending' | 'downloaded' | 'processed' | 'skipped' | 'error';
export type TaskLocalStatus = 'pending' | 'in_progress' | 'done';
export type MessageKind = 'announcement' | 'forum' | 'notification';
export type ChangeType = 'new' | 'modified' | 'removed' | 'due_changed';
export type EntityType = 'document' | 'task' | 'message' | 'subject' | 'recording';

export interface Subject {
  id: number;
  sourceId: string;
  externalId: string;
  name: string;
  shortName: string | null;
  url: string | null;
  teachers: string[];
  color: string;
  documentCount?: number;
  taskCount?: number;
  pendingTaskCount?: number;
}

export interface Unit {
  id: number;
  subjectId: number;
  externalId: string;
  name: string;
  position: number;
  url: string | null;
}

export interface DocumentItem {
  id: number;
  subjectId: number | null;
  unitId: number | null;
  subjectName?: string | null;
  unitName?: string | null;
  title: string;
  filename: string;
  mime: string | null;
  kind: DocumentKind;
  status: DocumentStatus;
  url: string | null;
  size: number | null;
  pageCount: number | null;
  remoteModifiedAt: string | null;
  syncedAt: string | null;
  contentHash: string | null;
  error: string | null;
}

export interface TaskItem {
  id: number;
  subjectId: number | null;
  unitId: number | null;
  subjectName?: string | null;
  unitName?: string | null;
  title: string;
  instructionsHtml: string | null;
  openedAt: string | null;
  dueAt: string | null;
  cutoffAt: string | null;
  url: string | null;
  localStatus: TaskLocalStatus;
  /** Estado de tu entrega según el campus (solo lectura). */
  submission?: 'submitted' | 'draft' | 'none' | null;
  graded?: boolean | null;
  documents: Pick<DocumentItem, 'id' | 'title' | 'filename' | 'mime'>[];
  updatedAt: string;
}

export interface MessageItem {
  id: number;
  subjectId: number | null;
  subjectName?: string | null;
  kind: MessageKind;
  author: string | null;
  title: string;
  bodyHtml: string;
  postedAt: string | null;
  url: string | null;
  attachments: { name: string; url: string | null; documentId?: number | null }[];
  readLocal: boolean;
}

export interface ChangeItem {
  id: number;
  syncRunId: number;
  entityType: EntityType;
  entityId: number;
  changeType: ChangeType;
  summary: string;
  subjectName?: string | null;
  createdAt: string;
  seen: boolean;
}

export interface SyncRun {
  id: number;
  sourceId: string;
  mode: 'inventory' | 'sync';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'partial' | 'error';
  stats: SyncStats;
  error: string | null;
  log: string[];
}

export interface SyncStats {
  subjects: number;
  documentsNew: number;
  documentsModified: number;
  documentsUnchanged: number;
  messagesNew: number;
  recordingsNew?: number;
  tasksNew: number;
  tasksChanged: number;
  errors: number;
  processed: number;
}

export interface SourceStatus {
  id: string;
  kind: string;
  name: string;
  authenticated: boolean;
  account: string | null;
  baseUrl: string | null;
  lastSync: SyncRun | null;
  readOnly: true;
}

export interface Citation {
  n: number;
  chunkId: number;
  documentId: number;
  documentTitle: string;
  filename: string;
  mime: string | null;
  subjectName: string | null;
  unitName: string | null;
  page: number | null;
  excerpt: string;
  score: number;
  /** Si el fragmento procede de una videoclase: id de la grabación y segundo de inicio. */
  recordingId?: number | null;
  startSec?: number | null;
  recordedAt?: string | null;
}

export interface SearchScope {
  subjectId?: number;
  unitIds?: number[];
  documentId?: number;
  taskId?: number;
  recordingId?: number;
}

export interface AskResponse {
  answer: string;
  grounded: boolean;
  citations: Citation[];
  provider: string;
  retrieval: { candidates: number; method: string; ms: number };
}

export interface SearchHit {
  documentId: number;
  documentTitle: string;
  filename: string;
  mime: string | null;
  subjectName: string | null;
  unitName: string | null;
  bestPage: number | null;
  excerpt: string;
  score: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

export interface Flashcard {
  front: string;
  back: string;
  sourceN?: number[];
}

export interface QuizQuestion {
  id: string;
  type: 'mcq' | 'open';
  question: string;
  options?: string[];
  answerIndex?: number;
  expectedAnswer?: string;
  explanation: string;
  topic: string;
  sourceN?: number[];
}

export interface ExamResultItem {
  questionId: string;
  correct: boolean;
  score: number;
  feedback: string;
  topic: string;
}

export interface Settings {
  llmProvider: string;
  llmModel: string | null;
  llmConfigured: boolean;
  embeddingsProvider: string;
  embeddingsModel: string;
  transcription: { provider: string; model: string | null; available: boolean; reason: string | null };
  mode: 'personal' | 'demo';
}

export interface DashboardData {
  upcomingTasks: TaskItem[];
  recentMessages: MessageItem[];
  newDocuments: DocumentItem[];
  unseenChanges: ChangeItem[];
  subjects: Subject[];
  sources: SourceStatus[];
  recentQueries: { id: number; question: string; createdAt: string }[];
  studyProgress: { topic: string; subjectName: string | null; correct: number; wrong: number }[];
  counts: { documents: number; processed: number; chunks: number; tasksPending: number };
}

// ── Videoclases ──
export type RecordingStatus =
  | 'detected' // encontrada en la fuente
  | 'unavailable' // existe pero no se puede procesar legítimamente (p. ej. sin descarga permitida)
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'indexing'
  | 'analyzing'
  | 'ready'
  | 'error';

export type SpeakerRole = 'Profesor' | 'Estudiante' | 'Otro';

export interface TranscriptSegment {
  start: number; // segundos
  end: number;
  text: string;
  /** Solo si el motor ofrece diarización fiable; nunca se inventan identidades. */
  speaker?: SpeakerRole | string | null;
}

export interface Timestamped {
  text: string;
  t?: number | null; // segundo aproximado
}

export interface RecordingAnalysis {
  summary: string;
  topics: Timestamped[];
  concepts: { term: string; explanation: string; t?: number | null }[];
  definitions: { term: string; definition: string; t?: number | null }[];
  examples: Timestamped[];
  tasksMentioned: Timestamped[];
  datesMentioned: { date: string; context: string; t?: number | null }[];
  notices: Timestamped[];
  /** SOLO lo que el profesor indicó EXPLÍCITAMENTE que entra en el examen, con cita literal. */
  examExplicit: { statement: string; quote: string; t?: number | null }[];
  importantQuestions: Timestamped[];
  relatedMaterial: { documentId: number; title: string; filename: string; page: number | null }[];
  generatedBy: string;
  generatedAt: string;
}

export interface RecordingItem {
  id: number;
  subjectId: number | null;
  unitId: number | null;
  subjectName?: string | null;
  unitName?: string | null;
  title: string;
  recordedAt: string | null;
  durationSec: number | null;
  teacher: string | null;
  platform: string;
  url: string | null;
  status: RecordingStatus;
  statusDetail: string | null;
  hasMedia: boolean;
  mediaMime: string | null;
  transcriptEngine: string | null;
  documentId: number | null;
  processedAt: string | null;
}

export interface RecordingDetail extends RecordingItem {
  segments: TranscriptSegment[];
  analysis: RecordingAnalysis | null;
}
