import path from 'node:path';
import type { DocumentKind } from '@studyvault/shared';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Heurística de clasificación documental por nombre (suficiente para materiales de FP; ampliable con IA). */
export function classifyDocument(title: string, filename = ''): DocumentKind {
  const t = norm(`${title} ${filename}`);
  if (/\b(examen|simulacro|autoevaluacion)\b/.test(t)) return 'exam';
  if (/\b(tarea|entrega|task)\b/.test(t)) return 'task';
  if (/\b(caso|casos|supuesto|practica|practicas)\b/.test(t)) return 'case';
  if (/\b(ejercicio|ejercicios|actividad|actividades|ejerc)\b/.test(t)) return 'exercise';
  if (/\b(tema|unidad|ud ?\d+|teoria|apuntes|contenidos?|manual|guia)\b/.test(t)) return 'theory';
  return 'resource';
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.java': 'text/x-java',
  '.sql': 'text/x-sql',
  '.xml': 'application/xml',
  '.json': 'application/json',
};

export const mimeFromName = (filename: string) =>
  MIME[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';

/** Tipos de fichero que el pipeline sabe extraer como texto para RAG. */
export function isIndexable(filename: string): boolean {
  return [
    '.pdf',
    '.docx',
    '.doc',
    '.pptx',
    '.txt',
    '.md',
    '.html',
    '.htm',
    '.java',
    '.sql',
    '.xml',
    '.json',
  ].includes(path.extname(filename).toLowerCase());
}

/** Nombre de fichero/carpeta seguro para Windows. */
export function safeName(name: string, max = 120): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (cleaned || 'sin_nombre').slice(0, max);
}
