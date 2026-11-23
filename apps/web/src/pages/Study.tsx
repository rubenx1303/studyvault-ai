import type { Flashcard, QuizQuestion, SearchScope } from '@studyvault/shared';
import { useMutation } from '@tanstack/react-query';
import {
  BookOpen,
  Brain,
  Check,
  Dumbbell,
  Layers,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  RefreshCw,
  ScrollText,
  Sparkles,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { AskPanel } from '../components/AskPanel';
import { Citations } from '../components/Citations';
import { LlmNotice } from '../components/LlmNotice';
import { Markdown } from '../components/Markdown';
import { ScopePicker } from '../components/ScopePicker';
import { Button, Card, Empty, ErrorBox, PageHeader, Skeleton, cn } from '../components/ui';
import { api, type StudyKind, type StudyResult } from '../lib/api';

const TOOLS: { id: StudyKind | 'ask'; label: string; icon: ReactNode; desc: string }[] = [
  {
    id: 'summary',
    label: 'Resumen',
    icon: <ScrollText className="size-4" />,
    desc: 'Estructurado y con citas',
  },
  {
    id: 'concepts',
    label: 'Conceptos clave',
    icon: <Lightbulb className="size-4" />,
    desc: 'Definiciones esenciales',
  },
  {
    id: 'simple',
    label: 'Explicación sencilla',
    icon: <Brain className="size-4" />,
    desc: 'Con analogías y ejemplo',
  },
  { id: 'flashcards', label: 'Flashcards', icon: <Layers className="size-4" />, desc: 'Repaso activo' },
  { id: 'quiz', label: 'Test', icon: <ListChecks className="size-4" />, desc: 'Preguntas de 4 opciones' },
  {
    id: 'open',
    label: 'Preguntas abiertas',
    icon: <MessageCircleQuestion className="size-4" />,
    desc: 'Tipo examen',
  },
  {
    id: 'exercises',
    label: 'Ejercicios',
    icon: <Dumbbell className="size-4" />,
    desc: 'Prácticos graduados',
  },
  { id: 'ask', label: 'Preguntar a la IA', icon: <Sparkles className="size-4" />, desc: 'Sobre este ámbito' },
];

export function StudyPage() {
  const [params] = useSearchParams();
  const initial: SearchScope = params.get('subject')
    ? {
        subjectId: Number(params.get('subject')),
        ...(params.get('unit') ? { unitIds: [Number(params.get('unit'))] } : {}),
      }
    : {};
  const [scope, setScope] = useState<SearchScope>(initial);
  const [label, setLabel] = useState('');
  const [tool, setTool] = useState<StudyKind | 'ask'>('summary');
  const gen = useMutation({
    mutationFn: (v: { kind: StudyKind; refresh?: boolean }) => api.study(v.kind, scope, v.refresh),
  });

  const run = (kind: StudyKind | 'ask', refresh = false) => {
    setTool(kind);
    if (kind !== 'ask' && scope.subjectId) gen.mutate({ kind, refresh });
  };

  return (
    <div>
      <PageHeader
        title="Modo estudio"
        subtitle="Material generado a partir de TUS documentos del ámbito seleccionado."
        actions={
          <ScopePicker
            allowAll={false}
            value={scope}
            onChange={(s, l) => {
              setScope(s);
              setLabel(l);
              gen.reset();
            }}
          />
        }
      />
      <LlmNotice />
      {!scope.subjectId ? (
        <Card>
          <Empty
            icon={<BookOpen className="size-5" />}
            title="Elige una asignatura (y opcionalmente una unidad)"
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Herramientas de estudio">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => run(t.id)}
                className={cn(
                  'flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                  tool === t.id
                    ? 'surface shadow-sm'
                    : 'text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
                )}
              >
                {t.icon}
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="text-muted hidden text-xs lg:block">{t.desc}</span>
                </span>
              </button>
            ))}
          </nav>
          <div className="min-w-0">
            {tool === 'ask' ? (
              <AskPanel
                key={JSON.stringify(scope)}
                className="h-[calc(100vh-14rem)] min-h-[520px]"
                scope={scope}
                scopeLabel={label || 'Ámbito seleccionado'}
              />
            ) : (
              <Card className="animate-in min-h-[420px] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold">{TOOLS.find((t) => t.id === tool)?.label}</h2>
                  {gen.data && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(tool, true)}
                      loading={gen.isPending}
                      icon={<RefreshCw className="size-3.5" />}
                    >
                      Regenerar
                    </Button>
                  )}
                </div>
                {gen.isIdle && (
                  <Empty
                    icon={<Sparkles className="size-5" />}
                    title="Listo para generar"
                    action={
                      <Button variant="primary" onClick={() => run(tool)}>
                        Generar
                      </Button>
                    }
                  >
                    Se seleccionan fragmentos representativos de tus documentos y se genera el material con
                    referencias.
                  </Empty>
                )}
                {gen.isPending && (
                  <div className="space-y-3">
                    <p className="text-muted text-sm">Leyendo tus materiales y preparando el contenido…</p>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-4" />
                    ))}
                  </div>
                )}
                {gen.error && <ErrorBox error={gen.error} />}
                {gen.data && !gen.isPending && <StudyOutput result={gen.data} />}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StudyOutput({ result }: { result: StudyResult }) {
  return (
    <div className="space-y-6">
      {result.markdown && <Markdown text={result.markdown} citations={result.citations} />}
      {result.cards && <Flashcards cards={result.cards} />}
      {result.questions && <Quiz questions={result.questions} />}
      <details className="text-sm">
        <summary className="text-muted cursor-pointer text-xs">
          Fragmentos usados ({result.citations.length})
        </summary>
        <div className="mt-3">
          <Citations citations={result.citations} compact />
        </div>
      </details>
    </div>
  );
}

function Flashcards({ cards }: { cards: Flashcard[] }) {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const card = cards[i];
  if (!card) return null;
  return (
    <div className="mx-auto max-w-xl">
      <button
        onClick={() => setFlip(!flip)}
        className={cn(
          'flex min-h-56 w-full flex-col items-center justify-center rounded-2xl border p-8 text-center transition-all duration-300',
          flip ? 'bg-accent-500/8 border-accent-400/40' : 'surface-2 border-[var(--border)]',
        )}
      >
        <span className="text-muted mb-3 text-xs font-medium tracking-wider uppercase">
          {flip ? 'Respuesta' : 'Pregunta'}
        </span>
        <span className="text-lg leading-relaxed">{flip ? card.back : card.front}</span>
        <span className="text-muted mt-4 text-xs">Pulsa para {flip ? 'ver la pregunta' : 'girar'}</span>
      </button>
      <div className="mt-4 flex items-center justify-between">
        <Button size="sm" disabled={i === 0} onClick={() => (setI(i - 1), setFlip(false))}>
          Anterior
        </Button>
        <span className="text-muted text-sm tabular-nums">
          {i + 1} / {cards.length}
        </span>
        <Button
          size="sm"
          variant="primary"
          disabled={i === cards.length - 1}
          onClick={() => (setI(i + 1), setFlip(false))}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}

export function Quiz({ questions }: { questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  return (
    <ol className="space-y-5">
      {questions.map((q, n) => (
        <li key={q.id} className="surface rounded-2xl p-5">
          <div className="mb-3 flex gap-2 text-sm font-medium">
            <span className="text-muted tabular-nums">{n + 1}.</span>
            {q.question}
          </div>
          {q.type === 'mcq' ? (
            <div className="grid gap-2">
              {q.options?.map((o, oi) => {
                const chosen = answers[q.id] === oi;
                const done = answers[q.id] !== undefined;
                const correct = oi === q.answerIndex;
                return (
                  <button
                    key={oi}
                    disabled={done}
                    onClick={() => setAnswers({ ...answers, [q.id]: oi })}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                      !done && 'border-[var(--border)] hover:bg-[var(--surface-2)]',
                      done && correct && 'border-emerald-500/50 bg-emerald-500/10',
                      done && chosen && !correct && 'border-red-500/50 bg-red-500/10',
                      done && !chosen && !correct && 'border-[var(--border)] opacity-60',
                    )}
                  >
                    {done && correct ? (
                      <Check className="size-4 text-emerald-500" />
                    ) : done && chosen ? (
                      <X className="size-4 text-red-500" />
                    ) : (
                      <span className="size-4" />
                    )}
                    {o}
                  </button>
                );
              })}
              {answers[q.id] !== undefined && <p className="text-muted mt-1 text-sm">{q.explanation}</p>}
            </div>
          ) : (
            <div>
              {reveal[q.id] ? (
                <div className="surface-2 rounded-xl p-3 text-sm">
                  <div className="font-medium">Respuesta modelo</div>
                  <p className="mt-1">{q.expectedAnswer}</p>
                  {q.explanation && <p className="text-muted mt-2">{q.explanation}</p>}
                </div>
              ) : (
                <Button size="sm" onClick={() => setReveal({ ...reveal, [q.id]: true })}>
                  Ver respuesta modelo
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
