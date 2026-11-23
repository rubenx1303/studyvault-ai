import type { AskResponse, SearchScope } from '@studyvault/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowUp, Info, ShieldAlert, Sparkles } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { api, type AskMode } from '../lib/api';
import { Citations } from './Citations';
import { Markdown } from './Markdown';
import { Badge, Card, ErrorBox, cn } from './ui';

interface Turn {
  question: string;
  label?: string;
  res?: AskResponse;
  error?: unknown;
}

/**
 * Asistente RAG integrable en cualquier pantalla (asignatura, tarea, documento).
 * El ámbito limita la recuperación; las sugerencias lanzan modos específicos.
 */
export function AskPanel({
  scope,
  scopeLabel,
  suggestions = [],
  placeholder = 'Pregunta sobre tus materiales…',
  extraInput,
  header,
  className,
}: {
  scope: SearchScope;
  scopeLabel?: string;
  suggestions?: { label: string; question: string; mode?: AskMode; needsExtra?: boolean }[];
  placeholder?: string;
  extraInput?: string;
  header?: ReactNode;
  className?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (v: { question: string; mode?: AskMode; extra?: string }) =>
      api.ask(v.question, scope, v.mode, v.extra),
  });

  const send = async (question: string, mode?: AskMode, label?: string, extra?: string) => {
    if (!question.trim() || ask.isPending) return;
    setQ('');
    const idx = turns.length;
    setTurns((t) => [...t, { question, label }]);
    setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    try {
      const res = await ask.mutateAsync({ question, mode, extra });
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, res } : x)));
    } catch (error) {
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, error } : x)));
    }
    setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  };

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <div className="border-subtle flex items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="from-accent-400 grid size-7 place-items-center rounded-lg bg-gradient-to-br to-violet-600 text-white">
            <Sparkles className="size-3.5" />
          </span>
          <div>
            <div className="text-sm font-semibold">Asistente</div>
            <div className="text-muted text-xs">
              Responde solo con tus materiales · {scopeLabel ?? 'Todo DAM'}
            </div>
          </div>
        </div>
        {header}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {turns.length === 0 && (
          <div className="text-muted flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Recupera los fragmentos relevantes de tus documentos, genera la respuesta y muestra las fuentes
              con su página. Si no hay base suficiente, te lo dirá.
            </p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="animate-in space-y-3">
            <div className="flex justify-end">
              <div className="bg-accent-600 max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white">
                {t.label ?? t.question}
              </div>
            </div>
            {!t.res && !t.error && (
              <div className="space-y-2">
                <div className="text-muted flex items-center gap-2 text-xs">
                  <span className="relative flex size-2">
                    <span className="bg-accent-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                    <span className="bg-accent-500 relative inline-flex size-2 rounded-full" />
                  </span>
                  Buscando en tus materiales y redactando…
                </div>
                <div className="skeleton h-3 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
              </div>
            )}
            {t.error ? <ErrorBox error={t.error} /> : null}
            {t.res && (
              <div className="space-y-4">
                {!t.res.grounded && (
                  <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="size-4" /> Sin base suficiente en tus materiales: no se ha
                    generado una respuesta inventada.
                  </div>
                )}
                <Markdown text={t.res.answer} citations={t.res.citations} />
                <Citations citations={t.res.citations.slice(0, 6)} />
                <div className="text-muted flex flex-wrap gap-1.5 text-[0.68rem]">
                  <Badge>{t.res.provider}</Badge>
                  <Badge>recuperación {t.res.retrieval.method}</Badge>
                  <Badge>{t.res.retrieval.candidates} candidatos</Badge>
                  <Badge>{t.res.retrieval.ms} ms</Badge>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="border-subtle border-t p-3">
        {suggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                disabled={ask.isPending || (s.needsExtra && !extraInput)}
                onClick={() => send(s.question, s.mode, s.label, s.needsExtra ? extraInput : undefined)}
                className="surface text-muted rounded-full px-3 py-1 text-xs transition-colors hover:text-[var(--text)] disabled:opacity-40"
                title={s.needsExtra && !extraInput ? 'Sube primero tu solución' : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(q);
          }}
          className="surface-2 flex items-end gap-2 rounded-2xl p-1.5 pl-4"
        >
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(q);
              }
            }}
            rows={1}
            placeholder={placeholder}
            aria-label="Pregunta"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-[var(--muted)]"
          />
          <button
            type="submit"
            disabled={!q.trim() || ask.isPending}
            aria-label="Enviar"
            className="bg-accent-600 hover:bg-accent-500 grid size-9 shrink-0 place-items-center rounded-xl text-white transition-colors disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
      </div>
    </Card>
  );
}
