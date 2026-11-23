import type { QuizQuestion } from '@studyvault/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GraduationCap, RotateCcw, TrendingDown, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Citations } from '../components/Citations';
import { LlmNotice } from '../components/LlmNotice';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  ErrorBox,
  PageHeader,
  Select,
  Skeleton,
  cn,
} from '../components/ui';
import { api } from '../lib/api';
import { relative } from '../lib/format';

export function ExamPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [subjectId, setSubjectId] = useState<number | undefined>(Number(params.get('subject')) || undefined);
  const [unitIds, setUnitIds] = useState<number[]>([]);
  const [size, setSize] = useState(10);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects });
  const detail = useQuery({
    queryKey: ['subject', subjectId],
    queryFn: () => api.subject(subjectId!),
    enabled: !!subjectId,
  });
  const history = useQuery({ queryKey: ['exams'], queryFn: api.exams });

  const create = useMutation({
    mutationFn: () => api.createExam(subjectId!, unitIds, size),
    onSuccess: () => setAnswers({}),
  });
  const grade = useMutation({
    mutationFn: () => api.gradeExam(create.data!.id, answers),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exams'] }),
  });

  const reset = () => {
    create.reset();
    grade.reset();
    setAnswers({});
  };

  return (
    <div>
      <PageHeader
        title="Modo examen"
        subtitle="Simulacros generados con tus unidades, corrección explicada y detección de temas débiles. No afecta al campus."
      />
      <LlmNotice />

      {!create.data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="animate-in p-5 lg:col-span-2">
            <div className="space-y-4">
              <div>
                <label className="text-muted mb-1.5 block text-xs font-medium">Asignatura</label>
                <Select
                  value={subjectId ?? ''}
                  onChange={(e) => (setSubjectId(Number(e.target.value) || undefined), setUnitIds([]))}
                  className="w-full"
                >
                  <option value="">Elige asignatura…</option>
                  {subjects.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              {detail.data && (
                <div>
                  <label className="text-muted mb-1.5 block text-xs font-medium">
                    Unidades (ninguna = todas)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {detail.data.units.map((u) => {
                      const on = unitIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() =>
                            setUnitIds(on ? unitIds.filter((x) => x !== u.id) : [...unitIds, u.id])
                          }
                          aria-pressed={on}
                          className={cn(
                            'rounded-xl border px-3 py-1.5 text-sm transition-colors',
                            on
                              ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
                              : 'border-[var(--border)] hover:bg-[var(--surface-2)]',
                          )}
                        >
                          {u.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <label className="text-muted mb-1.5 block text-xs font-medium">Número de preguntas</label>
                <Select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                  {[6, 10, 15, 20].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </div>
              <Button
                variant="primary"
                disabled={!subjectId}
                loading={create.isPending}
                onClick={() => create.mutate()}
                icon={<GraduationCap className="size-4" />}
              >
                Generar simulacro
              </Button>
              {create.isPending && (
                <p className="text-muted text-sm">
                  Generando preguntas a partir de tus materiales (puede tardar un poco)…
                </p>
              )}
              <ErrorBox error={create.error} />
            </div>
          </Card>
          <Card className="animate-in">
            <CardHeader title="Historial" />
            <ul className="space-y-1 px-5 pb-4 text-sm">
              {history.data?.length === 0 && <li className="text-muted">Aún no hay intentos.</li>}
              {history.data?.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{h.subjectName}</span>
                  <span className="text-muted flex shrink-0 items-center gap-2 text-xs">
                    {h.score != null ? (
                      <Badge tone={h.score >= 0.5 ? 'ok' : 'danger'}>
                        {Math.round(h.score * 10 * 10) / 10}/10
                      </Badge>
                    ) : (
                      <Badge>sin terminar</Badge>
                    )}
                    {relative(h.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {create.data && !grade.data && (
        <div className="space-y-4">
          {create.data.questions.map((q, n) => (
            <ExamQuestion
              key={q.id}
              q={q}
              n={n}
              value={answers[q.id]}
              onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
            />
          ))}
          <div className="flex items-center gap-3">
            <Button variant="primary" loading={grade.isPending} onClick={() => grade.mutate()}>
              Entregar y corregir
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancelar
            </Button>
            <span className="text-muted text-sm">
              {Object.keys(answers).length}/{create.data.questions.length} respondidas
            </span>
          </div>
          <ErrorBox error={grade.error} />
        </div>
      )}

      {grade.data && (
        <div className="space-y-4">
          <Card className="animate-in flex flex-wrap items-center gap-6 p-6">
            <div
              className={cn(
                'grid size-24 place-items-center rounded-full text-3xl font-semibold tabular-nums',
                grade.data.score >= 0.5 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600',
              )}
            >
              {(grade.data.score * 10).toFixed(1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">
                {grade.data.score >= 0.8
                  ? '¡Muy bien!'
                  : grade.data.score >= 0.5
                    ? 'Aprobado, con margen de mejora'
                    : 'Hay que repasar'}
              </div>
              {grade.data.weakTopics.length > 0 ? (
                <div className="mt-2">
                  <div className="text-muted flex items-center gap-1.5 text-sm">
                    <TrendingDown className="size-4 text-red-500" /> Recomendado repasar:
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {grade.data.weakTopics.map((t) => (
                      <Badge key={t} tone="danger">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-muted text-sm">Sin temas débiles en este intento.</p>
              )}
            </div>
            <Button onClick={reset} icon={<RotateCcw className="size-4" />}>
              Nuevo simulacro
            </Button>
          </Card>
          {grade.data.questions.map((q, n) => {
            const r = grade.data!.results.find((x) => x.questionId === q.id);
            return (
              <Card key={q.id} className="animate-in p-5">
                <div className="flex gap-3">
                  {r?.correct ? (
                    <Check className="size-5 shrink-0 text-emerald-500" />
                  ) : (
                    <X className="size-5 shrink-0 text-red-500" />
                  )}
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <div className="font-medium">
                      {n + 1}. {q.question}
                    </div>
                    {q.type === 'mcq' ? (
                      <p>
                        Tu respuesta: <b>{q.options?.[Number(answers[q.id])] ?? '(en blanco)'}</b>
                        {!r?.correct && (
                          <>
                            {' '}
                            · Correcta:{' '}
                            <b className="text-emerald-600 dark:text-emerald-400">
                              {q.options?.[q.answerIndex ?? 0]}
                            </b>
                          </>
                        )}
                      </p>
                    ) : (
                      <p className="text-muted">Tu respuesta: {String(answers[q.id] ?? '(en blanco)')}</p>
                    )}
                    <p className="text-muted">{r?.feedback}</p>
                    <Badge>{q.topic}</Badge>
                  </div>
                </div>
              </Card>
            );
          })}
          <Card className="p-5">
            <Citations citations={grade.data.citations.slice(0, 8)} compact />
          </Card>
        </div>
      )}

      {create.isPending && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}
      {!subjectId && !create.data && history.data?.length === 0 && (
        <Card className="mt-4">
          <Empty title="Elige asignatura y unidades para empezar" />
        </Card>
      )}
    </div>
  );
}

function ExamQuestion({
  q,
  n,
  value,
  onChange,
}: {
  q: QuizQuestion;
  n: number;
  value: string | number | undefined;
  onChange: (v: string | number) => void;
}) {
  return (
    <Card className="animate-in p-5">
      <div className="mb-3 text-sm font-medium">
        {n + 1}. {q.question}
      </div>
      {q.type === 'mcq' ? (
        <div className="grid gap-2">
          {q.options?.map((o, i) => (
            <label
              key={i}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors',
                value === i
                  ? 'border-accent-500 bg-accent-500/8'
                  : 'border-[var(--border)] hover:bg-[var(--surface-2)]',
              )}
            >
              <input
                type="radio"
                name={q.id}
                checked={value === i}
                onChange={() => onChange(i)}
                className="accent-[var(--color-accent-600)]"
              />
              {o}
            </label>
          ))}
        </div>
      ) : (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="surface w-full rounded-xl p-3 text-sm"
          placeholder="Escribe tu respuesta…"
          aria-label={`Respuesta a la pregunta ${n + 1}`}
        />
      )}
    </Card>
  );
}
