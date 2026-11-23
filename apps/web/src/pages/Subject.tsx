import { useQuery } from '@tanstack/react-query';
import { BookOpen, ExternalLink, GraduationCap, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AskPanel } from '../components/AskPanel';
import { RecordingsList } from '../components/RecordingsList';
import { DocRow, MessageRow, TaskRow } from '../components/rows';
import { Card, Dot, Empty, PageHeader, Skeleton, Tabs } from '../components/ui';
import { api } from '../lib/api';

type Tab = 'units' | 'tasks' | 'messages' | 'recordings' | 'assistant';

export function SubjectPage() {
  const id = Number(useParams().id);
  const [tab, setTab] = useState<Tab>('units');
  const { data } = useQuery({ queryKey: ['subject', id], queryFn: () => api.subject(id) });
  if (!data) return <Skeleton className="h-96" />;
  const { subject, units, documents, tasks, messages } = data;
  const loose = documents.filter((d) => !d.unitId && d.kind !== 'lecture');

  return (
    <div>
      <PageHeader
        eyebrow="Asignatura"
        title={
          <span className="flex items-center gap-3">
            <Dot color={subject.color} className="size-3" />
            {subject.name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {subject.teachers.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" /> {subject.teachers.join(', ')}
              </span>
            )}
            {subject.url && (
              <a
                href={subject.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                Ver en el campus <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        }
        actions={
          <>
            <Link
              to={`/study?subject=${subject.id}`}
              className="surface inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium hover:bg-[var(--surface-2)]"
            >
              <BookOpen className="size-4" /> Modo estudio
            </Link>
            <Link
              to={`/exam?subject=${subject.id}`}
              className="surface inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium hover:bg-[var(--surface-2)]"
            >
              <GraduationCap className="size-4" /> Simulacro
            </Link>
          </>
        }
      />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'units', label: 'Unidades y documentos', count: documents.length },
            { id: 'tasks', label: 'Tareas', count: tasks.length },
            { id: 'messages', label: 'Mensajes', count: messages.length },
            { id: 'recordings', label: 'Videoclases' },
            { id: 'assistant', label: 'Preguntar a la IA' },
          ]}
        />
      </div>

      {tab === 'units' && (
        <div className="grid gap-4 md:grid-cols-2">
          {units.map((u) => {
            const docs = documents.filter((d) => d.unitId === u.id);
            const unitTasks = tasks.filter((t) => t.unitId === u.id);
            if (!docs.length && !unitTasks.length) return null;
            return (
              <Card key={u.id} className="animate-in">
                <div className="flex items-center justify-between px-5 pt-4 pb-2">
                  <h3 className="text-sm font-semibold">{u.name}</h3>
                  <Link
                    to={`/study?subject=${subject.id}&unit=${u.id}`}
                    className="text-muted text-xs hover:text-[var(--text)]"
                  >
                    Estudiar →
                  </Link>
                </div>
                <div className="px-2 pb-3">
                  {docs.map((d) => (
                    <DocRow key={d.id} doc={d} showSubject={false} />
                  ))}
                  {unitTasks.map((t) => (
                    <TaskRow key={t.id} task={t} showSubject={false} />
                  ))}
                </div>
              </Card>
            );
          })}
          {loose.length > 0 && (
            <Card className="animate-in">
              <div className="px-5 pt-4 pb-2 text-sm font-semibold">Otros documentos</div>
              <div className="px-2 pb-3">
                {loose.map((d) => (
                  <DocRow key={d.id} doc={d} showSubject={false} />
                ))}
              </div>
            </Card>
          )}
          {documents.length === 0 && (
            <Card className="md:col-span-2">
              <Empty title="Sin documentos todavía" />
            </Card>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <Card className="animate-in p-2">
          {tasks.length ? (
            tasks.map((t) => <TaskRow key={t.id} task={t} showSubject={false} />)
          ) : (
            <Empty title="Sin tareas" />
          )}
        </Card>
      )}

      {tab === 'recordings' && <RecordingsList subjectId={subject.id} />}

      {tab === 'messages' && (
        <Card className="animate-in divide-y divide-[var(--border)] px-2">
          {messages.length ? (
            messages.map((m) => <MessageRow key={m.id} msg={m} expanded />)
          ) : (
            <Empty title="Sin mensajes" />
          )}
        </Card>
      )}

      {tab === 'assistant' && (
        <AskPanel
          className="h-[calc(100vh-15rem)] min-h-[520px]"
          scope={{ subjectId: subject.id }}
          scopeLabel={subject.name}
          suggestions={[
            {
              label: '¿Qué entra en esta asignatura?',
              question: '¿Qué temas principales trata esta asignatura según mis materiales?',
            },
            { label: 'Conceptos más importantes', question: '¿Cuáles son los conceptos más importantes?' },
          ]}
        />
      )}
    </div>
  );
}
