import type {
  AskResponse,
  ChangeItem,
  DashboardData,
  DocumentItem,
  MessageItem,
  SearchHit,
  SearchScope,
  Settings,
  SourceStatus,
  Subject,
  SyncRun,
  TaskItem,
  TaskLocalStatus,
  Unit,
} from '@studyvault/shared';
import type {
  Citation,
  ExamResultItem,
  Flashcard,
  QuizQuestion,
  RecordingDetail,
  RecordingItem,
} from '@studyvault/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json', ...init.headers }
        : init?.headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(body.error ?? `Error ${res.status}`, res.status, body.code);
  }
  return res.json() as Promise<T>;
}

const post = <T>(url: string, body?: unknown) =>
  request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(url: string, body: unknown) =>
  request<T>(url, { method: 'PATCH', body: JSON.stringify(body) });

export type StudyKind = 'summary' | 'concepts' | 'simple' | 'flashcards' | 'quiz' | 'open' | 'exercises';
export interface StudyResult {
  kind: StudyKind;
  markdown?: string;
  cards?: Flashcard[];
  questions?: QuizQuestion[];
  citations: Citation[];
  createdAt: string;
}
export type AskMode = 'answer' | 'explain-task' | 'concepts' | 'where' | 'guide' | 'review';
export interface SyncJob {
  runId: number;
  status: 'idle' | 'running' | 'ok' | 'partial' | 'error';
  mode?: 'inventory' | 'sync';
  log?: string[];
  stats?: SyncRun['stats'];
}

export const api = {
  settings: () => request<Settings>('/api/settings'),
  dashboard: () => request<DashboardData>('/api/dashboard'),
  subjects: () => request<Subject[]>('/api/subjects'),
  subject: (id: number) =>
    request<{
      subject: Subject;
      units: Unit[];
      documents: DocumentItem[];
      tasks: TaskItem[];
      messages: MessageItem[];
    }>(`/api/subjects/${id}`),
  updateSubject: (id: number, body: { hidden?: boolean }) => patch(`/api/subjects/${id}`, body),
  documents: (q: Record<string, string | number | undefined> = {}) =>
    request<DocumentItem[]>(`/api/documents?${qs(q)}`),
  document: (id: number) => request<DocumentItem>(`/api/documents/${id}`),
  documentText: (id: number) =>
    request<{ id: number; ord: number; page: number | null; section: string | null; text: string }[]>(
      `/api/documents/${id}/text`,
    ),
  upload: (file: File, subjectId?: number) => {
    const fd = new FormData();
    if (subjectId) fd.append('subjectId', String(subjectId));
    fd.append('file', file);
    return request<{ id: number; chunks: number }>('/api/documents/upload', { method: 'POST', body: fd });
  },
  tasks: (q: Record<string, string | number | undefined> = {}) => request<TaskItem[]>(`/api/tasks?${qs(q)}`),
  task: (id: number) => request<TaskItem>(`/api/tasks/${id}`),
  setTaskStatus: (id: number, localStatus: TaskLocalStatus) => patch(`/api/tasks/${id}`, { localStatus }),
  messages: (q: Record<string, string | number | undefined> = {}) =>
    request<MessageItem[]>(`/api/messages?${qs(q)}`),
  markMessage: (id: number, read: boolean) => patch(`/api/messages/${id}`, { read }),
  changes: (unseen = false) => request<ChangeItem[]>(`/api/changes${unseen ? '?unseen=1' : ''}`),
  markChangesSeen: () => post('/api/changes/seen'),
  sources: () => request<SourceStatus[]>('/api/sources'),
  login: (id: string) => post<{ status: string }>(`/api/sources/${id}/login`),
  loginStatus: (id: string) =>
    request<{ status: 'idle' | 'running' | 'ok' | 'error'; log: string[]; error?: string }>(
      `/api/sources/${id}/login`,
    ),
  logout: (id: string) => post(`/api/sources/${id}/logout`),
  startSync: (sourceId: string, mode: 'inventory' | 'sync') =>
    post<{ runId: number }>('/api/sync', { sourceId, mode }),
  syncStatus: () => request<SyncJob>('/api/sync/status'),
  syncRuns: () => request<SyncRun[]>('/api/sync/runs'),
  syncRun: (id: number) => request<SyncRun & { inventory: Inventory | null }>(`/api/sync/runs/${id}`),
  ask: (question: string, scope: SearchScope, mode?: AskMode, extra?: string) =>
    post<AskResponse>('/api/ask', { question, scope, mode, extra }),
  search: (q: string, subjectId?: number) => request<SearchHit[]>(`/api/search?${qs({ q, subjectId })}`),
  study: (kind: StudyKind, scope: SearchScope, refresh = false) =>
    post<StudyResult>('/api/study', { kind, scope, refresh }),
  createExam: (subjectId: number, unitIds: number[], size: number) =>
    post<{ id: number; questions: QuizQuestion[]; citations: Citation[] }>('/api/exams', {
      subjectId,
      unitIds,
      size,
    }),
  gradeExam: (id: number, answers: Record<string, string | number>) =>
    post<{
      score: number;
      results: ExamResultItem[];
      questions: QuizQuestion[];
      citations: Citation[];
      weakTopics: string[];
    }>(`/api/exams/${id}/grade`, { answers }),
  recordings: (subjectId?: number) => request<RecordingItem[]>(`/api/recordings?${qs({ subjectId })}`),
  recording: (id: number) => request<RecordingDetail>(`/api/recordings/${id}`),
  recordingQueue: () =>
    request<{
      current: { id: number; title: string; stage: string; pct: number | null } | null;
      pending: number[];
      log: string[];
      transcription: { provider: string; model: string | null; ok: boolean; reason: string | null };
    }>('/api/recordings/queue'),
  processRecording: (id: number, retranscribe = false) =>
    post(`/api/recordings/${id}/process`, { retranscribe }),
  uploadRecording: (file: File, subjectId: number, title: string, recordedAt: string) => {
    const fd = new FormData();
    fd.append('subjectId', String(subjectId));
    fd.append('title', title);
    fd.append('recordedAt', recordedAt);
    fd.append('file', file);
    return request<{ id: number }>('/api/recordings/upload', { method: 'POST', body: fd });
  },
  exams: () =>
    request<
      {
        id: number;
        score: number | null;
        createdAt: string;
        finishedAt: string | null;
        subjectName: string | null;
      }[]
    >('/api/exams'),
  architecture: () => request<Architecture>('/api/architecture'),
};

export interface Architecture {
  mode: 'personal' | 'demo';
  sources: { id: string; kind: string; name: string; authenticated: boolean }[];
  storage: { db: string; files: string };
  embeddings: { provider: string; model: string };
  index: { provider: string; detail: string };
  llm: { provider: string; model: string | null; available: boolean };
  transcription: { provider: string; model: string | null; ok: boolean; reason: string | null };
  counts: { documents: number; processed: number; chunks: number; tasksPending: number };
}

export interface Inventory {
  account: string | null;
  generatedAt: string;
  platform?: Record<string, unknown>;
  warnings: string[];
  totals: {
    subjects: number;
    units: number;
    files: number;
    bytes: number;
    tasks: number;
    messages: number;
    skipped: number;
  };
  subjects: {
    externalId: string;
    name: string;
    teachers: string[];
    units: {
      name: string;
      files: { title: string; filename: string; size: number | null; kind?: string }[];
    }[];
    tasks: { title: string; dueAt: string | null; attachments: number }[];
    messages: { title: string; author: string | null; postedAt: string | null; kind: string }[];
    skipped: { type: string; name: string; reason: string }[];
  }[];
}

function qs(q: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export const fileUrl = (id: number, page?: number | null) =>
  `/api/documents/${id}/file${page ? `#page=${page}` : ''}`;
