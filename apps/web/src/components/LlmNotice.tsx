import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api';

/** Aviso cuando no hay LLM configurado: la búsqueda y el RAG extractivo funcionan, la generación no. */
export function LlmNotice() {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: Infinity });
  if (!data || data.llmConfigured) return null;
  return (
    <div className="animate-in mb-4 flex items-start gap-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
      <Cpu className="mt-0.5 size-4 shrink-0" />
      <p>
        No hay un modelo de lenguaje configurado (<code>LLM_PROVIDER=none</code>). La búsqueda y el asistente
        en modo extractivo funcionan; para generar resúmenes, flashcards y exámenes configura un proveedor en{' '}
        <code>.env</code> (Ollama local, Azure OpenAI/Foundry u otro).{' '}
        <Link to="/architecture" className="underline">
          Ver arquitectura
        </Link>
      </p>
    </div>
  );
}
