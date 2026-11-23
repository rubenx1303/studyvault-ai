import type { RecordingAnalysis, RecordingDetail, RecordingStatus, Timestamped } from '@studyvault/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  RefreshCw,
  Search,
  User,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { AskPanel } from '../components/AskPanel';
import { Markdown } from '../components/Markdown';
import {
  Badge,
  Button,
  Card,
  Empty,
  Input,
  PageHeader,
  Skeleton,
  Tabs,
  cn,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { dateTime, formatTs } from '../lib/format';

type Tab = 'summary' | 'topics' | 'transcript' | 'concepts' | 'tasks' | 'ask';

export const STATUS: Record<RecordingStatus, { label: string; tone: Tone }> = {
  detected: { label: 'Detectada', tone: 'neutral' },
  unavailable: { label: 'No procesable', tone: 'muted' },
  queued: { label: 'En cola', tone: 'accent' },
  downloading: { label: 'Descargando', tone: 'accent' },
  extracting: { label: 'Extrayendo audio', tone: 'accent' },
  transcribing: { label: 'Transcribiendo', tone: 'accent' },
  indexing: { label: 'Indexando', tone: 'accent' },
  analyzing: { label: 'Analizando', tone: 'accent' },
  ready: { label: 'Lista', tone: 'ok' },
  error: { label: 'Error', tone: 'danger' },
};
const BUSY = new Set<RecordingStatus>([
  'queued',
  'downloading',
  'extracting',
  'transcribing',
  'indexing',
  'analyzing',
]);

export function RecordingPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const t = params.get('t') != null ? Number(params.get('t')) : null;
  const [tab, setTab] = useState<Tab>(t != null ? 'transcript' : 'summary');
  const qc = useQueryClient();
  const { data: rec } = useQuery({
    queryKey: ['recording', id],
    queryFn: () => api.recording(id),
    refetchInterval: (q) => (q.state.data && BUSY.has(q.state.data.status) ? 2000 : false),
  });
  const queue = useQuery({
    queryKey: ['recording-queue'],
    queryFn: api.recordingQueue,
    enabled: !!rec && BUSY.has(rec.status),
    refetchInterval: 2000,
  });
  const reprocess = useMutation({
    mutationFn: (re: boolean) => api.processRecording(id, re),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recording', id] }),
  });
  const media = useRef<HTMLMediaElement>(null);

  const seek = (sec: number) => {
    setParams({ t: String(Math.floor(sec)) }, { replace: true });
    setTab('transcript');
    if (media.current) {
      media.current.currentTime = sec;
      void media.current.play().catch(() => {});
    }
  };

  if (!rec) return <Skeleton className="h-96" />;
  const a = rec.analysis;
  const status = STATUS[rec.status];
  const isAudio = (rec.mediaMime ?? '').startsWith('audio');

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link to={rec.subjectId ? `/subjects/${rec.subjectId}` : '/'} className="hover:underline">
            {rec.subjectName ?? 'Videoclases'} {rec.unitName ? `› ${rec.unitName}` : ''}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-violet-500/10 text-violet-500">
              <Video className="size-4" />
            </span>
            <span className="min-w-0">{rec.title}</span>
          </span>
        }
        actions={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            {rec.status !== 'unavailable' && (
              <Button
                size="sm"
                variant="ghost"
                loading={reprocess.isPending}
                onClick={() => reprocess.mutate(false)}
                icon={<RefreshCw className="size-3.5" />}
              >
                Reprocesar
              </Button>
            )}
          </>
        }
      />

      <div className="text-muted animate-in mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <Meta icon={<CalendarDays className="size-3.5" />}>{dateTime(rec.recordedAt)}</Meta>
        {rec.durationSec && <Meta icon={<Clock className="size-3.5" />}>{formatTs(rec.durationSec)}</Meta>}
        {rec.teacher && <Meta icon={<User className="size-3.5" />}>{rec.teacher}</Meta>}
        <Meta icon={<Video className="size-3.5" />}>{rec.platform}</Meta>
        {rec.transcriptEngine && <Meta icon={<FileText className="size-3.5" />}>{rec.transcriptEngine}</Meta>}
        {rec.url && (
          <a
            href={rec.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            Origen <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {(rec.statusDetail || BUSY.has(rec.status)) && (
        <div
          className={cn(
            'animate-in mb-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-sm',
            rec.status === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'surface-2',
          )}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            {BUSY.has(rec.status) && (
              <p>
                {status.label}
                {queue.data?.current?.id === rec.id && queue.data.current.pct != null
                  ? ` · ${Math.round(queue.data.current.pct)} %`
                  : '…'}
              </p>
            )}
            {rec.statusDetail && <p>{rec.statusDetail}</p>}
          </div>
        </div>
      )}

      {rec.hasMedia && (
        <Card className="animate-in mb-4 overflow-hidden">
          {isAudio ? (
            <audio
              ref={media}
              controls
              src={`/api/recordings/${rec.id}/media${t != null ? `#t=${t}` : ''}`}
              className="w-full"
            />
          ) : (
            <video
              ref={media as React.RefObject<HTMLVideoElement>}
              controls
              src={`/api/recordings/${rec.id}/media${t != null ? `#t=${t}` : ''}`}
              className="max-h-[50vh] w-full bg-black"
            />
          )}
        </Card>
      )}

      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'summary', label: 'Resumen' },
            { id: 'topics', label: 'Temas', count: a?.topics.length },
            { id: 'transcript', label: 'Transcripción', count: rec.segments.length || undefined },
            {
              id: 'concepts',
              label: 'Conceptos',
              count: a ? a.concepts.length + a.definitions.length : undefined,
            },
            {
              id: 'tasks',
              label: 'Tareas y avisos',
              count: a ? a.tasksMentioned.length + a.notices.length + a.examExplicit.length : undefined,
            },
            { id: 'ask', label: 'Preguntar a la IA' },
          ]}
        />
      </div>

      {tab === 'transcript' && <Transcript rec={rec} highlight={t} onSeek={seek} />}
      {tab === 'ask' &&
        (rec.documentId ? (
          <AskPanel
            className="h-[calc(100vh-16rem)] min-h-[520px]"
            scope={{ recordingId: rec.id }}
            scopeLabel={`Videoclase: ${rec.title}`}
            suggestions={[
              { label: '¿Qué se explicó?', question: '¿Qué se explicó en esta clase?' },
              {
                label: '¿Qué dijo sobre el examen?',
                question: '¿El profesor dijo explícitamente algo sobre el examen?',
              },
              { label: 'Tareas y fechas', question: '¿Qué tareas o fechas se mencionaron?' },
            ]}
          />
        ) : (
          <Card>
            <Empty title="Aún no hay transcripción indexada" />
          </Card>
        ))}
      {['summary', 'topics', 'concepts', 'tasks'].includes(tab) &&
        (a ? (
          <AnalysisView tab={tab} a={a} onSeek={seek} />
        ) : (
          <Card>
            <Empty
              icon={<FileText className="size-5" />}
              title={rec.segments.length ? 'Análisis pendiente' : 'Sin transcripción todavía'}
            >
              {rec.segments.length
                ? 'La transcripción ya es consultable. Para generar resumen, temas y conceptos configura un LLM.'
                : rec.status === 'unavailable'
                  ? 'Esta grabación no se puede procesar automáticamente (ver motivo arriba).'
                  : 'Se generará al terminar la transcripción.'}
            </Empty>
          </Card>
        ))}
    </div>
  );
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {children}
    </span>
  );
}

function TsButton({ t, onSeek }: { t?: number | null; onSeek: (s: number) => void }) {
  if (t == null) return null;
  return (
    <button
      onClick={() => onSeek(t)}
      className="shrink-0 rounded-md bg-violet-500/10 px-1.5 py-0.5 font-mono text-[0.7rem] text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-400"
      title="Ir a este momento"
    >
      {formatTs(t)}
    </button>
  );
}

function List({
  items,
  onSeek,
  empty,
}: {
  items: (Timestamped & { extra?: ReactNode })[];
  onSeek: (s: number) => void;
  empty: string;
}) {
  if (!items.length) return <p className="text-muted text-sm">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((x, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <TsButton t={x.t} onSeek={onSeek} />
          <div className="min-w-0">
            {x.text}
            {x.extra}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="animate-in p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </Card>
  );
}

function AnalysisView({
  tab,
  a,
  onSeek,
}: {
  tab: string;
  a: RecordingAnalysis;
  onSeek: (s: number) => void;
}) {
  const demo = a.generatedBy.startsWith('demo');
  const footer = (
    <p className="text-muted mt-2 text-xs">
      Generado por {demo ? 'análisis precalculado (contenido de demostración ficticio)' : a.generatedBy} ·
      basado solo en la transcripción
    </p>
  );
  if (tab === 'summary')
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="animate-in p-6 lg:col-span-2">
          <Markdown text={a.summary} />
          {footer}
        </Card>
        <div className="space-y-4">
          <Section title="Preguntas importantes">
            <List items={a.importantQuestions} onSeek={onSeek} empty="—" />
          </Section>
          <Section title="Material relacionado">
            {a.relatedMaterial.length === 0 && (
              <p className="text-muted text-sm">Sin documentos relacionados.</p>
            )}
            <ul className="space-y-1.5">
              {a.relatedMaterial.map((m) => (
                <li key={m.documentId}>
                  <Link
                    to={`/documents/${m.documentId}${m.page ? `?page=${m.page}` : ''}`}
                    className="text-sm hover:underline"
                  >
                    {m.filename}
                    {m.page ? <span className="text-muted"> · pág. {m.page}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    );
  if (tab === 'topics')
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Temas tratados">
          <List items={a.topics} onSeek={onSeek} empty="—" />
        </Section>
        <Section title="Ejemplos explicados">
          <List items={a.examples} onSeek={onSeek} empty="—" />
        </Section>
      </div>
    );
  if (tab === 'concepts')
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Conceptos importantes">
          <List
            items={a.concepts.map((c) => ({
              t: c.t,
              text: (<b>{c.term}</b>) as unknown as string,
              extra: <p className="text-muted">{c.explanation}</p>,
            }))}
            onSeek={onSeek}
            empty="—"
          />
        </Section>
        <Section title="Definiciones">
          <List
            items={a.definitions.map((d) => ({
              t: d.t,
              text: (<b>{d.term}</b>) as unknown as string,
              extra: <p className="text-muted">{d.definition}</p>,
            }))}
            onSeek={onSeek}
            empty="—"
          />
        </Section>
      </div>
    );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section
        title="Indicado explícitamente para el examen"
        icon={<GraduationCap className="size-4 text-red-500" />}
      >
        <p className="text-muted mb-3 text-xs">
          Solo frases en las que el profesor dice expresamente que algo entra en el examen, con su cita
          literal verificada en la transcripción. Que un tema se haya tratado en clase <b>no</b> significa que
          entre: eso está en «Temas».
        </p>
        <List
          items={a.examExplicit.map((e) => ({
            t: e.t,
            text: e.statement,
            extra: <p className="text-muted mt-0.5 italic">«{e.quote}»</p>,
          }))}
          onSeek={onSeek}
          empty="No hubo indicaciones explícitas sobre el examen."
        />
      </Section>
      <Section title="Tareas mencionadas">
        <List items={a.tasksMentioned} onSeek={onSeek} empty="—" />
      </Section>
      <Section title="Fechas mencionadas">
        <List
          items={a.datesMentioned.map((d) => ({
            t: d.t,
            text: d.date,
            extra: <p className="text-muted">{d.context}</p>,
          }))}
          onSeek={onSeek}
          empty="—"
        />
      </Section>
      <Section title="Avisos">
        <List items={a.notices} onSeek={onSeek} empty="—" />
      </Section>
    </div>
  );
}

/** Transcripción con buscador; cada línea salta a su marca temporal. */
function Transcript({
  rec,
  highlight,
  onSeek,
}: {
  rec: RecordingDetail;
  highlight: number | null;
  onSeek: (s: number) => void;
}) {
  const [q, setQ] = useState('');
  const target = useRef<HTMLLIElement>(null);
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const hits = useMemo(
    () => (q.trim().length > 1 ? rec.segments.filter((s) => norm(s.text).includes(norm(q.trim()))) : null),
    [q, rec.segments],
  );
  const active = highlight != null ? rec.segments.findLastIndex((s) => s.start <= highlight + 0.5) : -1;
  useEffect(() => {
    target.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [active]);

  if (!rec.segments.length)
    return (
      <Card>
        <Empty title="Sin transcripción todavía" />
      </Card>
    );
  const list = hits ?? rec.segments;
  return (
    <Card className="animate-in">
      <div className="border-b border-[var(--border)] p-3">
        <div className="relative">
          <Search className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar en la transcripción…"
            className="pl-9"
            aria-label="Buscar en la transcripción"
          />
        </div>
        {hits && (
          <p className="text-muted mt-2 text-xs">
            {hits.length} coincidencias · pulsa una para saltar a ese momento
          </p>
        )}
      </div>
      <ol className="max-h-[60vh] overflow-y-auto p-2">
        {list.map((s) => {
          const idx = rec.segments.indexOf(s);
          const on = idx === active;
          return (
            <li key={idx} ref={on ? target : undefined}>
              <button
                onClick={() => onSeek(s.start)}
                className={cn(
                  'flex w-full gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]',
                  on && 'bg-amber-400/15 ring-1 ring-amber-400/40',
                )}
              >
                <span className="text-muted w-16 shrink-0 font-mono text-xs leading-6">
                  {formatTs(s.start)}
                </span>
                <span className="min-w-0 leading-6">
                  {s.speaker && (
                    <b
                      className={
                        s.speaker === 'Profesor' ? 'text-accent-600 dark:text-accent-400' : 'text-muted'
                      }
                    >
                      {s.speaker}:{' '}
                    </b>
                  )}
                  <Highlighted text={s.text} q={hits ? q.trim() : ''} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Highlighted({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .indexOf(
      q
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase(),
    );
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-300/60 px-0.5 text-inherit dark:bg-amber-400/30">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}
