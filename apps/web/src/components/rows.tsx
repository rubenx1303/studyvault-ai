import type { DocumentItem, MessageItem, TaskItem, TaskLocalStatus } from '@studyvault/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Circle,
  CircleDot,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileType2,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { KIND_LABEL, STATUS_LABEL, dueInfo, relative, stripHtml } from '../lib/format';
import { Badge, cn } from './ui';

export function fileIcon(filename: string): LucideIcon {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pptx' || ext === 'ppt') return Presentation;
  if (ext === 'xlsx' || ext === 'csv') return FileSpreadsheet;
  if (ext === 'docx' || ext === 'doc') return FileType2;
  return FileText;
}

const EXT_TONE: Record<string, string> = {
  pdf: 'text-red-500 bg-red-500/10',
  docx: 'text-sky-500 bg-sky-500/10',
  pptx: 'text-orange-500 bg-orange-500/10',
  html: 'text-emerald-500 bg-emerald-500/10',
};

export function FileBadge({ filename }: { filename: string }) {
  const icon = createElement(fileIcon(filename), { className: 'size-4' });
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-xl',
        EXT_TONE[ext] ?? 'text-muted bg-[var(--surface-2)]',
      )}
    >
      {icon}
    </span>
  );
}

export function DocRow({ doc, showSubject = true }: { doc: DocumentItem; showSubject?: boolean }) {
  return (
    <Link
      to={`/documents/${doc.id}`}
      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
    >
      <FileBadge filename={doc.filename} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium group-hover:underline">{doc.title}</div>
        <div className="text-muted truncate text-xs">
          {[showSubject ? doc.subjectName : null, doc.unitName, doc.filename].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
        <Badge>{KIND_LABEL[doc.kind] ?? doc.kind}</Badge>
        {doc.status === 'error' && <Badge tone="danger">Error</Badge>}
        {doc.status === 'downloaded' && <Badge tone="warn">Sin indexar</Badge>}
      </div>
    </Link>
  );
}

const STATUS_ICON: Record<TaskLocalStatus, LucideIcon> = {
  pending: Circle,
  in_progress: CircleDot,
  done: Check,
};
const NEXT: Record<TaskLocalStatus, TaskLocalStatus> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
};

export function TaskStatusButton({ task }: { task: TaskItem }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (s: TaskLocalStatus) => api.setTaskStatus(task.id, s),
    onSuccess: () => qc.invalidateQueries(),
  });
  const Icon = STATUS_ICON[task.localStatus];
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        m.mutate(NEXT[task.localStatus]);
      }}
      title={`Estado local: ${STATUS_LABEL[task.localStatus]} (clic para cambiar; no modifica el campus)`}
      aria-label={`Estado: ${STATUS_LABEL[task.localStatus]}`}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full border transition-all',
        task.localStatus === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
        task.localStatus === 'in_progress' && 'border-accent-500 text-accent-500',
        task.localStatus === 'pending' && 'border-subtle text-transparent hover:text-[var(--muted)]',
      )}
    >
      <Icon className="size-3.5" strokeWidth={task.localStatus === 'done' ? 3 : 2} />
    </button>
  );
}

export function TaskRow({ task, showSubject = true }: { task: TaskItem; showSubject?: boolean }) {
  const due = dueInfo(task.dueAt);
  return (
    <Link
      to={`/tasks/${task.id}`}
      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
    >
      <TaskStatusButton task={task} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-sm font-medium group-hover:underline',
            task.localStatus === 'done' && 'text-muted line-through',
          )}
        >
          {task.title}
        </div>
        <div className="text-muted truncate text-xs">
          {[showSubject ? task.subjectName : null, task.unitName].filter(Boolean).join(' · ')}
        </div>
      </div>
      <SubmissionBadge task={task} />
      {task.localStatus !== 'done' && <Badge tone={due.tone}>{due.label}</Badge>}
    </Link>
  );
}

/** Estado de la entrega tal como lo muestra el campus (lo lee la sincronización; StudyVault no entrega nada). */
export function SubmissionBadge({ task }: { task: TaskItem }) {
  if (task.graded) return <Badge tone="ok">Calificada</Badge>;
  if (task.submission === 'submitted') return <Badge tone="ok">Entregada</Badge>;
  if (task.submission === 'draft') return <Badge tone="warn">Borrador sin enviar</Badge>;
  if (task.submission === 'none' && task.dueAt && new Date(task.dueAt) < new Date())
    return <Badge tone="danger">Sin entregar</Badge>;
  return null;
}

export function MessageRow({ msg, expanded = false }: { msg: MessageItem; expanded?: boolean }) {
  return (
    <div className="flex gap-3 rounded-xl px-3 py-3">
      <div className="bg-accent-500/10 text-accent-600 dark:text-accent-400 grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold">
        {(msg.author ?? '?')
          .split(' ')
          .slice(0, 2)
          .map((w) => w[0])
          .join('')}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-sm font-medium">{msg.title}</div>
          <span className="text-muted shrink-0 text-xs">{relative(msg.postedAt)}</span>
        </div>
        <div className="text-muted truncate text-xs">
          {[msg.subjectName, msg.author].filter(Boolean).join(' · ')}
        </div>
        {expanded ? (
          <div
            className="html-content mt-2 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitize(msg.bodyHtml) }}
          />
        ) : (
          <p className="text-muted mt-1 line-clamp-2 text-sm">{stripHtml(msg.bodyHtml)}</p>
        )}
        {expanded && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {msg.attachments.map((a) =>
              a.documentId ? (
                <Link
                  key={a.name}
                  to={`/documents/${a.documentId}`}
                  className="surface rounded-lg px-2 py-1 text-xs hover:underline"
                >
                  📎 {a.name}
                </Link>
              ) : (
                <span key={a.name} className="surface-2 rounded-lg px-2 py-1 text-xs">
                  📎 {a.name}
                </span>
              ),
            )}
            {msg.url && (
              <a
                href={msg.url}
                target="_blank"
                rel="noreferrer"
                className="text-muted inline-flex items-center gap-1 text-xs hover:underline"
              >
                Ver en el origen <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Sanitizado básico del HTML del campus: sin scripts, estilos, iframes ni manejadores on*. */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (
        attr.name.startsWith('on') ||
        attr.name === 'style' ||
        (attr.name === 'href' && /^\s*javascript:/i.test(attr.value))
      )
        el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer noopener');
    }
  });
  return doc.body.innerHTML;
}
