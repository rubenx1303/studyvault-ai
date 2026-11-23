import type { DocumentKind, MessageKind } from '@studyvault/shared';

/**
 * Contrato que cumple cualquier fuente documental (Moodle, carpeta local, OneDrive, SharePoint...).
 *
 * Una fuente solo DESCRIBE lo que hay (inventario de metadatos) y DESCARGA ficheros concretos.
 * No escribe nada en el origen: StudyVault es de solo lectura frente a sus fuentes.
 * El SyncService es quien compara, decide qué descargar y persiste; el adaptador no conoce la BD.
 */
export interface SourceAdapter {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
  readonly baseUrl: string | null;
  readonly readOnly: true;

  isAuthenticated(): Promise<boolean>;
  accountName(): Promise<string | null>;
  /** Login interactivo (el usuario introduce credenciales en el navegador; nunca pasan por StudyVault). */
  login?(onProgress?: ProgressFn): Promise<void>;
  /** Elimina la sesión/token local. */
  logout?(): Promise<void>;

  inventory(onProgress?: ProgressFn): Promise<SourceInventory>;
  download(file: RemoteFile): Promise<Buffer>;
  /** Descarga el medio de una grabación a disco (streaming). Solo si el origen lo permite legítimamente. */
  downloadRecording?(
    rec: RemoteRecording,
    destPath: string,
    onProgress?: ProgressFn,
  ): Promise<{ mime: string | null }>;
}

export type ProgressFn = (message: string) => void;

export interface RemoteSubject {
  externalId: string;
  name: string;
  shortName?: string | null;
  url?: string | null;
  teachers: string[];
}

export interface RemoteUnit {
  externalId: string;
  subjectExternalId: string;
  name: string;
  position: number;
  url?: string | null;
}

export interface RemoteFile {
  externalId: string; // estable entre sincronizaciones
  subjectExternalId: string;
  unitExternalId?: string | null;
  title: string;
  filename: string;
  mime?: string | null;
  url?: string | null; // URL visible del recurso en el origen (procedencia)
  downloadRef: string; // referencia opaca que solo entiende el adaptador
  version: string; // huella remota: si cambia, el fichero se considera modificado
  modifiedAt?: string | null;
  size?: number | null;
  kindHint?: DocumentKind;
  taskExternalId?: string | null;
  /** Contenido inline (p. ej. páginas HTML de Moodle) cuando no hay fichero que descargar. */
  inlineContent?: string;
}

export interface RemoteTask {
  externalId: string;
  subjectExternalId: string;
  unitExternalId?: string | null;
  title: string;
  instructionsHtml: string | null;
  openedAt: string | null;
  dueAt: string | null;
  cutoffAt: string | null;
  url: string | null;
  version: string;
  attachmentFileIds: string[];
  /** Estado de TU entrega según el campus (lectura): enviada, borrador o sin enviar. null si no se conoce. */
  submission?: 'submitted' | 'draft' | 'none' | null;
  graded?: boolean | null;
}

export interface RemoteMessage {
  externalId: string;
  subjectExternalId?: string | null;
  kind: MessageKind;
  author: string | null;
  title: string;
  bodyHtml: string;
  postedAt: string | null;
  url: string | null;
  version: string;
  attachments: { name: string; url: string | null; fileExternalId?: string | null }[];
}

/**
 * Grabación de una clase. `media` describe cómo obtenerla:
 *  - 'download': el adaptador puede descargar el fichero con la sesión autorizada;
 *  - 'captions': la fuente ya ofrece transcripción/subtítulos (no hace falta descargar audio);
 *  - 'none': detectada pero no procesable automáticamente (motivo en `unavailableReason`).
 */
export interface RemoteRecording {
  externalId: string;
  subjectExternalId: string;
  unitExternalId?: string | null;
  title: string;
  recordedAt: string | null;
  durationSec: number | null;
  teacher: string | null;
  platform: string; // 'moodle-video', 'bigbluebutton', 'teams', 'youtube', 'demo'...
  url: string | null; // origen visible para el usuario
  version: string; // si cambia → reprocesar
  media: 'download' | 'captions' | 'none';
  mediaRef?: string | null; // opaco para el adaptador
  mediaMime?: string | null;
  captions?: { start: number; end: number; text: string; speaker?: string | null }[];
  unavailableReason?: string | null;
  /** Solo modo demo: análisis precalculado y marcado como tal. */
  demoAnalysis?: unknown;
}

export interface SourceInventory {
  sourceId: string;
  account: string | null;
  generatedAt: string;
  platform?: Record<string, unknown>;
  subjects: RemoteSubject[];
  units: RemoteUnit[];
  files: RemoteFile[];
  tasks: RemoteTask[];
  messages: RemoteMessage[];
  /** Videoconferencias / clases grabadas detectadas (opcional: no todas las fuentes las tienen). */
  recordings?: RemoteRecording[];
  /** Elementos detectados que no se importan (cuestionarios, enlaces externos, etc.) para transparencia. */
  skipped: { subjectExternalId: string; type: string; name: string; reason: string }[];
  warnings: string[];
}

export class SourceAuthError extends Error {
  constructor(message = 'La fuente requiere iniciar sesión') {
    super(message);
    this.name = 'SourceAuthError';
  }
}
