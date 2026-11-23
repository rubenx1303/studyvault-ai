import type { ChangeItem } from '@studyvault/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellDot,
  CalendarClock,
  CheckCheck,
  FilePlus2,
  FilePen,
  FileX2,
  ListPlus,
  MessageSquarePlus,
  Video,
} from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Button, Card, Empty, PageHeader, cn } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';

export function summarizeChanges(changes: ChangeItem[]) {
  const count = (pred: (c: ChangeItem) => boolean) => changes.filter(pred).length;
  return [
    {
      label: 'documentos nuevos',
      count: count((c) => c.entityType === 'document' && c.changeType === 'new'),
    },
    {
      label: 'documentos modificados',
      count: count((c) => c.entityType === 'document' && c.changeType === 'modified'),
    },
    { label: 'mensajes', count: count((c) => c.entityType === 'message') },
    { label: 'videoclases', count: count((c) => c.entityType === 'recording' && c.changeType === 'new') },
    { label: 'tareas nuevas', count: count((c) => c.entityType === 'task' && c.changeType === 'new') },
    { label: 'fechas modificadas', count: count((c) => c.changeType === 'due_changed') },
  ].filter((s) => s.count > 0);
}

const META: Record<string, { icon: typeof BellDot; tone: string; label: string }> = {
  'document:new': { icon: FilePlus2, tone: 'text-emerald-500 bg-emerald-500/10', label: 'Documento nuevo' },
  'document:modified': { icon: FilePen, tone: 'text-sky-500 bg-sky-500/10', label: 'Documento modificado' },
  'document:removed': { icon: FileX2, tone: 'text-zinc-500 bg-zinc-500/10', label: 'Retirado del campus' },
  'message:new': {
    icon: MessageSquarePlus,
    tone: 'text-violet-500 bg-violet-500/10',
    label: 'Mensaje nuevo',
  },
  'message:modified': {
    icon: MessageSquarePlus,
    tone: 'text-violet-500 bg-violet-500/10',
    label: 'Mensaje editado',
  },
  'task:new': { icon: ListPlus, tone: 'text-accent-500 bg-accent-500/10', label: 'Tarea nueva' },
  'task:modified': { icon: ListPlus, tone: 'text-accent-500 bg-accent-500/10', label: 'Tarea modificada' },
  'recording:new': { icon: Video, tone: 'text-violet-500 bg-violet-500/10', label: 'Videoclase nueva' },
  'recording:modified': {
    icon: Video,
    tone: 'text-violet-500 bg-violet-500/10',
    label: 'Videoclase actualizada',
  },
  'task:due_changed': {
    icon: CalendarClock,
    tone: 'text-amber-500 bg-amber-500/10',
    label: 'Fecha de entrega modificada',
  },
};

const link = (c: ChangeItem) =>
  c.entityType === 'recording'
    ? `/recordings/${c.entityId}`
    : c.entityType === 'document'
      ? `/documents/${c.entityId}`
      : c.entityType === 'task'
        ? `/tasks/${c.entityId}`
        : '/messages';

export function ChangesPage() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['changes'], queryFn: () => api.changes(false) });
  const seen = useMutation({ mutationFn: api.markChangesSeen, onSuccess: () => qc.invalidateQueries() });
  const unseen = data.filter((c) => !c.seen);
  const summary = summarizeChanges(unseen);

  return (
    <div>
      <PageHeader
        title="¿Qué ha cambiado?"
        subtitle="Novedades detectadas por la sincronización incremental."
        actions={
          unseen.length > 0 && (
            <Button
              onClick={() => seen.mutate()}
              loading={seen.isPending}
              icon={<CheckCheck className="size-4" />}
            >
              Marcar como revisado
            </Button>
          )
        }
      />
      {summary.length > 0 && (
        <div className="animate-in mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {summary.map((s) => (
            <Card key={s.label} className="p-4">
              <div className="text-2xl font-semibold tabular-nums">{s.count}</div>
              <div className="text-muted text-xs">{s.label}</div>
            </Card>
          ))}
        </div>
      )}
      <Card className="animate-in">
        {data.length === 0 ? (
          <Empty icon={<BellDot className="size-5" />} title="Sin cambios registrados">
            Cada sincronización compara con la anterior y registra aquí lo nuevo.
          </Empty>
        ) : (
          <ul className="divide-[var(--border)] divide-y">
            {data.map((c) => {
              const m = META[`${c.entityType}:${c.changeType}`] ?? META['document:new']!;
              const Icon = m.icon;
              return (
                <li key={c.id}>
                  <Link
                    to={link(c)}
                    className={cn(
                      'flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--surface-2)]',
                      c.seen && 'opacity-60',
                    )}
                  >
                    <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', m.tone)}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.summary}</div>
                      <div className="text-muted text-xs">
                        {m.label}
                        {c.subjectName ? ` · ${c.subjectName}` : ''}
                      </div>
                    </div>
                    {!c.seen && <Badge tone="accent">Nuevo</Badge>}
                    <span className="text-muted hidden shrink-0 text-xs sm:block">
                      {dateTime(c.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
