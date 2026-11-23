import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Paperclip, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AskPanel } from '../components/AskPanel';
import { DocRow, TaskStatusButton, sanitize } from '../components/rows';
import { Badge, Card, CardHeader, PageHeader, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { STATUS_LABEL, dateTime, dueInfo } from '../lib/format';

export function TaskPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const { data: task } = useQuery({ queryKey: ['task', id], queryFn: () => api.task(id) });
  const [solution, setSolution] = useState<{ name: string; text: string } | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const text = /\.(txt|md|java|sql|xml|json|js|ts|py|kt|cs)$/i.test(file.name) ? await file.text() : '';
      const r = await api.upload(file, task?.subjectId ?? undefined);
      // Si es un binario (PDF/DOCX), usamos el texto extraído por el pipeline.
      const extracted = text || (await api.documentText(r.id)).map((c) => c.text).join('\n\n');
      return { name: file.name, text: extracted };
    },
    onSuccess: (s) => {
      setSolution(s);
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  if (!task) return <Skeleton className="h-96" />;
  const due = dueInfo(task.dueAt);

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link to={task.subjectId ? `/subjects/${task.subjectId}` : '/tasks'} className="hover:underline">
            {task.subjectName ?? 'Tareas'} {task.unitName ? `› ${task.unitName}` : ''}
          </Link>
        }
        title={task.title}
        actions={
          <div className="flex items-center gap-2">
            <TaskStatusButton task={task} />
            <span className="text-sm">{STATUS_LABEL[task.localStatus]}</span>
            <Badge>estado local</Badge>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card className="animate-in p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={due.tone}>
                <CalendarClock className="size-3" /> {due.label}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted text-xs">Fecha límite</dt>
                <dd>{dateTime(task.dueAt)}</dd>
              </div>
              <div>
                <dt className="text-muted text-xs">Publicada</dt>
                <dd>{dateTime(task.openedAt)}</dd>
              </div>
              {task.cutoffAt && (
                <div>
                  <dt className="text-muted text-xs">Fecha de corte</dt>
                  <dd>{dateTime(task.cutoffAt)}</dd>
                </div>
              )}
            </dl>
            {task.instructionsHtml && (
              <>
                <div className="text-muted mt-5 mb-2 text-xs font-semibold tracking-wider uppercase">
                  Instrucciones
                </div>
                <div
                  className="html-content text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: sanitize(task.instructionsHtml) }}
                />
              </>
            )}
            {task.url && (
              <a
                href={task.url}
                target="_blank"
                rel="noreferrer"
                className="text-muted mt-4 inline-flex items-center gap-1 text-xs hover:underline"
              >
                Ver en el campus (origen) <ExternalLink className="size-3" />
              </a>
            )}
          </Card>

          <Card className="animate-in">
            <CardHeader title="Archivos asociados" icon={<Paperclip className="size-4" />} />
            <div className="px-2 pb-3">
              {task.documents.length === 0 && <p className="text-muted px-3 text-sm">Sin adjuntos.</p>}
              {task.documents.map((d) => (
                <DocRow
                  key={d.id}
                  doc={{
                    ...d,
                    subjectId: null,
                    unitId: null,
                    kind: 'task',
                    status: 'processed',
                    url: null,
                    size: null,
                    pageCount: null,
                    remoteModifiedAt: null,
                    syncedAt: null,
                    contentHash: null,
                    error: null,
                  }}
                  showSubject={false}
                />
              ))}
            </div>
          </Card>

          <Card className="animate-in p-5">
            <div className="text-sm font-semibold">Revisar mi solución</div>
            <p className="text-muted mt-1 text-xs">
              Sube tu código o documento. Se guarda solo en local y la IA lo compara con el temario.
            </p>
            <label className="surface-2 mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-5 text-sm transition-colors hover:border-[var(--color-accent-400)]">
              <Upload className="text-muted size-4" />
              {upload.isPending ? 'Procesando…' : solution ? solution.name : 'Elegir archivo'}
              <input
                type="file"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
              />
            </label>
          </Card>
        </div>

        <AskPanel
          className="h-[calc(100vh-11rem)] min-h-[520px] lg:col-span-3"
          scope={{ taskId: task.id }}
          scopeLabel={`Tarea: ${task.title}`}
          extraInput={solution?.text}
          placeholder="Pregunta sobre esta tarea…"
          suggestions={[
            { label: 'Explícame qué pide', question: 'Explícame qué pide esta tarea.', mode: 'explain-task' },
            {
              label: '¿Qué conceptos necesito?',
              question: '¿Qué conceptos necesito para resolver esta tarea?',
              mode: 'concepts',
            },
            {
              label: '¿Dónde está en el temario?',
              question: '¿Dónde está explicado en el temario lo necesario para esta tarea?',
              mode: 'where',
            },
            {
              label: 'Guíame paso a paso',
              question: 'Guíame paso a paso para resolver esta tarea sin darme la solución.',
              mode: 'guide',
            },
            {
              label: 'Revisa mi solución',
              question: 'Revisa mi solución a esta tarea.',
              mode: 'review',
              needsExtra: true,
            },
          ]}
        />
      </div>
    </div>
  );
}
