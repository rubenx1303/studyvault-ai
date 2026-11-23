import type { TaskItem } from '@studyvault/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare } from 'lucide-react';
import { useState } from 'react';
import { TaskRow } from '../components/rows';
import { Card, Empty, PageHeader, Select, Tabs } from '../components/ui';
import { api } from '../lib/api';

type View = 'pending' | 'done' | 'all';

/** Entregada en el campus o marcada como hecha en StudyVault. */
const isDone = (t: TaskItem) => t.submission === 'submitted' || t.localStatus === 'done';

/** Agrupa las pendientes: lo vencido sin entregar primero, después lo próximo y al final lo que no tiene fecha. */
function groupPending(tasks: TaskItem[]) {
  const now = Date.now();
  const pending = tasks.filter((t) => !isDone(t));
  return [
    {
      title: 'Vencidas sin entregar',
      hint: 'La fecha ya pasó y el campus no tiene tu entrega. Revisa si hay recuperación.',
      tasks: pending.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now),
    },
    {
      title: 'Próximas entregas',
      hint: null,
      tasks: pending.filter((t) => t.dueAt && new Date(t.dueAt).getTime() >= now),
    },
    {
      title: 'Sin fecha',
      hint: 'El campus no indica fecha de entrega.',
      tasks: pending.filter((t) => !t.dueAt),
    },
  ].filter((g) => g.tasks.length);
}

export function TasksPage() {
  const [view, setView] = useState<View>('pending');
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects });
  const { data = [] } = useQuery({ queryKey: ['tasks', subjectId], queryFn: () => api.tasks({ subjectId }) });
  const done = data.filter(isDone);
  const groups = groupPending(data);
  const pendingCount = groups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div>
      <PageHeader
        title="Tareas"
        subtitle="Entregas del campus con su estado real (entregada / calificada). StudyVault nunca modifica nada en el campus."
        actions={
          <Select
            value={subjectId ?? ''}
            onChange={(e) => setSubjectId(Number(e.target.value) || undefined)}
            aria-label="Filtrar por asignatura"
          >
            <option value="">Todas las asignaturas</option>
            {subjects.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        }
      />
      <div className="mb-4">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { id: 'pending', label: 'Pendientes', count: pendingCount },
            { id: 'done', label: 'Entregadas', count: done.length },
            { id: 'all', label: 'Todas', count: data.length },
          ]}
        />
      </div>

      {view === 'pending' &&
        (groups.length ? (
          groups.map((g) => (
            <Card key={g.title} className="animate-in mb-4 p-2">
              <div className="px-3 pt-2 pb-1">
                <div className="text-sm font-semibold">
                  {g.title} <span className="text-muted font-normal">· {g.tasks.length}</span>
                </div>
                {g.hint && <div className="text-muted text-xs">{g.hint}</div>}
              </div>
              {g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </Card>
          ))
        ) : (
          <Card className="animate-in p-2">
            <Empty icon={<CheckSquare className="size-5" />} title="Nada pendiente">
              No tienes tareas sin entregar.
            </Empty>
          </Card>
        ))}

      {view !== 'pending' && (
        <Card className="animate-in p-2">
          {(view === 'done' ? done : data).length ? (
            (view === 'done' ? done : data).map((t) => <TaskRow key={t.id} task={t} />)
          ) : (
            <Empty icon={<CheckSquare className="size-5" />} title="No hay tareas aquí" />
          )}
        </Card>
      )}
    </div>
  );
}
