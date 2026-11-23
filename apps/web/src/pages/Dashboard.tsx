import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BellDot,
  BookOpen,
  CheckSquare,
  FileText,
  GraduationCap,
  MessageSquareText,
  PlugZap,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DocRow, MessageRow, TaskRow } from '../components/rows';
import { SyncButton } from '../components/SyncButton';
import { Badge, Card, CardHeader, Dot, Empty, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { summarizeChanges } from './Changes';

export function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const hour = new Date().getHours();
  const greet = hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  const source = data?.sources[0];

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }

  const empty = data.counts.documents === 0 && data.subjects.length === 0;
  const summary = summarizeChanges(data.unseenChanges);

  return (
    <div className="space-y-6">
      <div className="animate-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted text-sm">
            {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greet}
            {source?.account ? `, ${source.account.split(' ')[0]}` : ''}
          </h1>
        </div>
        <div className="text-muted flex items-center gap-3 text-xs">
          {source?.lastSync && (
            <span>
              Última sincronización {relative(source.lastSync.finishedAt ?? source.lastSync.startedAt)}
              {source.lastSync.status === 'error' && (
                <Badge tone="danger" className="ml-1">
                  con errores
                </Badge>
              )}
            </span>
          )}
        </div>
      </div>

      {empty ? (
        <Card className="animate-in">
          <Empty
            icon={<PlugZap className="size-5" />}
            title="Conecta tu primera fuente"
            action={
              <Link
                to="/sources"
                className="bg-accent-600 hover:bg-accent-500 inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white"
              >
                Ir a Fuentes <ArrowRight className="size-4" />
              </Link>
            }
          >
            Inicia sesión en tu Moodle (tú introduces la contraseña en el navegador), revisa el inventario y
            sincroniza. Todo se guarda solo en este equipo.
          </Empty>
        </Card>
      ) : (
        <>
          {/* ¿Qué ha cambiado? */}
          <Link to="/changes" className="animate-in block">
            <Card className="from-accent-500/[0.07] group relative overflow-hidden bg-gradient-to-br to-violet-500/[0.04] p-5 transition-shadow hover:shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="bg-accent-600 grid size-10 place-items-center rounded-xl text-white shadow-lg shadow-accent-600/25">
                    <BellDot className="size-5" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold">¿Qué ha cambiado?</div>
                    <div className="text-muted text-sm">
                      {summary.length
                        ? 'Desde que revisaste las novedades por última vez'
                        : 'Estás al día. No hay novedades sin revisar.'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {summary.map((s) => (
                    <span key={s.label} className="surface rounded-xl px-3 py-1.5 text-sm">
                      <b className="tabular-nums">{s.count}</b> <span className="text-muted">{s.label}</span>
                    </span>
                  ))}
                  <ArrowRight className="text-muted size-5 self-center transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Card>
          </Link>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="animate-in lg:col-span-2" style={{ animationDelay: '40ms' }}>
              <CardHeader
                title="Próximas entregas"
                icon={<CheckSquare className="size-4" />}
                action={<SeeAll to="/tasks" />}
              />
              <div className="px-2 pb-3">
                {data.upcomingTasks.length ? (
                  data.upcomingTasks.map((t) => <TaskRow key={t.id} task={t} />)
                ) : (
                  <Empty title="Nada pendiente" />
                )}
              </div>
            </Card>

            <Card className="animate-in" style={{ animationDelay: '80ms' }}>
              <CardHeader title="Asignaturas" icon={<BookOpen className="size-4" />} />
              <div className="space-y-1 px-2 pb-3">
                {data.subjects.map((s) => (
                  <Link
                    key={s.id}
                    to={`/subjects/${s.id}`}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-[var(--surface-2)]"
                  >
                    <Dot color={s.color} className="size-2.5" />
                    <span className="flex-1 truncate text-sm">{s.name}</span>
                    <span className="text-muted text-xs tabular-nums">{s.documentCount} docs</span>
                    {!!s.pendingTaskCount && <Badge tone="accent">{s.pendingTaskCount}</Badge>}
                  </Link>
                ))}
              </div>
            </Card>

            <Card className="animate-in lg:col-span-2" style={{ animationDelay: '120ms' }}>
              <CardHeader
                title="Mensajes recientes del profesorado"
                icon={<MessageSquareText className="size-4" />}
                action={<SeeAll to="/messages" />}
              />
              <div className="divide-[var(--border)] divide-y px-2 pb-2">
                {data.recentMessages.length ? (
                  data.recentMessages.map((m) => <MessageRow key={m.id} msg={m} />)
                ) : (
                  <Empty title="Sin mensajes" />
                )}
              </div>
            </Card>

            <div className="space-y-4">
              <Card className="animate-in" style={{ animationDelay: '160ms' }}>
                <CardHeader
                  title="Progreso de estudio"
                  icon={<GraduationCap className="size-4" />}
                  action={<SeeAll to="/exam" label="Examen" />}
                />
                <div className="space-y-3 px-5 pb-5">
                  {data.studyProgress.length === 0 && (
                    <p className="text-muted text-sm">Haz un simulacro para detectar tus temas débiles.</p>
                  )}
                  {data.studyProgress.map((p) => {
                    const total = p.correct + p.wrong;
                    const pct = total ? Math.round((p.correct / total) * 100) : 0;
                    return (
                      <div key={`${p.subjectName}-${p.topic}`}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium">
                            {pct < 50 && <TrendingDown className="size-3 text-red-500" />}
                            {p.topic}
                          </span>
                          <span className="text-muted tabular-nums">{pct}%</span>
                        </div>
                        <div className="surface-2 h-1.5 overflow-hidden rounded-full">
                          <div
                            className={
                              pct < 50
                                ? 'h-full rounded-full bg-red-500'
                                : pct < 75
                                  ? 'h-full rounded-full bg-amber-500'
                                  : 'h-full rounded-full bg-emerald-500'
                            }
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="animate-in" style={{ animationDelay: '200ms' }}>
                <CardHeader
                  title="Últimas consultas"
                  icon={<Sparkles className="size-4" />}
                  action={<SeeAll to="/assistant" label="Preguntar" />}
                />
                <div className="px-5 pb-4">
                  {data.recentQueries.length === 0 && (
                    <p className="text-muted text-sm">Aún no has preguntado nada.</p>
                  )}
                  <ul className="space-y-2">
                    {data.recentQueries.map((q) => (
                      <li key={q.id} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate">{q.question}</span>
                        <span className="text-muted shrink-0 text-xs">{relative(q.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </div>

            <Card className="animate-in lg:col-span-2" style={{ animationDelay: '240ms' }}>
              <CardHeader
                title="Documentos nuevos"
                icon={<FileText className="size-4" />}
                action={<SeeAll to="/documents" />}
              />
              <div className="grid px-2 pb-3 sm:grid-cols-2">
                {data.newDocuments.map((d) => (
                  <DocRow key={d.id} doc={d} />
                ))}
              </div>
            </Card>

            <Card className="animate-in p-5" style={{ animationDelay: '280ms' }}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PlugZap className="text-muted size-4" /> Sincronización
              </div>
              <p className="text-muted mt-1 text-sm">
                {source?.name} · {source?.authenticated ? 'conectado' : 'sin sesión'} · solo lectura
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Stat label="Documentos" value={data.counts.documents} />
                <Stat label="Indexados" value={data.counts.processed} />
                <Stat label="Fragmentos RAG" value={data.counts.chunks} />
                <Stat label="Tareas pendientes" value={data.counts.tasksPending} />
              </dl>
              <div className="mt-4">
                <SyncButton />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="surface-2 rounded-xl px-3 py-2">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SeeAll({ to, label = 'Ver todo' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="text-muted inline-flex items-center gap-1 text-xs hover:text-[var(--text)]">
      {label} <ArrowRight className="size-3" />
    </Link>
  );
}
