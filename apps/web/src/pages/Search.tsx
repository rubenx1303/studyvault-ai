import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { docLink } from '../components/Citations';
import { FileBadge } from '../components/rows';
import { Badge, Card, Empty, Input, PageHeader, Select, Skeleton } from '../components/ui';
import { api } from '../lib/api';

const MATCH_LABEL = {
  semantic: 'Concepto',
  keyword: 'Palabra exacta',
  hybrid: 'Concepto + palabra',
} as const;
const MATCH_TONE = { semantic: 'accent', keyword: 'neutral', hybrid: 'ok' } as const;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [subjectId, setSubjectId] = useState<number | undefined>();
  useEffect(() => setInput(q), [q]);
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects });
  const { data, isFetching } = useQuery({
    queryKey: ['search', q, subjectId],
    queryFn: () => api.search(q, subjectId),
    enabled: q.length > 0,
  });

  return (
    <div>
      <PageHeader
        title="Búsqueda semántica"
        subtitle="Encuentra documentos que tratan un concepto aunque no contengan la palabra exacta."
      />
      <form
        className="animate-in mb-6 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(input.trim() ? { q: input.trim() } : {});
        }}
      >
        <div className="relative min-w-64 flex-1">
          <SearchIcon className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            autoFocus
            className="h-11 pl-9 text-base"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="p. ej. DAO, separar negocio y datos, transacciones…"
            aria-label="Buscar"
          />
        </div>
        <Select
          className="h-11"
          value={subjectId ?? ''}
          onChange={(e) => setSubjectId(Number(e.target.value) || undefined)}
          aria-label="Asignatura"
        >
          <option value="">Todo DAM</option>
          {subjects.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </form>

      {isFetching && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {!isFetching && data && (
        <Card className="animate-in divide-y divide-[var(--border)]">
          {data.length === 0 && (
            <Empty icon={<SearchIcon className="size-5" />} title="Sin resultados relevantes" />
          )}
          {data.map((h) => (
            <Link
              key={h.documentId}
              to={docLink({ documentId: h.documentId, page: h.bestPage })}
              className="group flex gap-4 px-5 py-4 transition-colors hover:bg-[var(--surface-2)]"
            >
              <FileBadge filename={h.filename} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium group-hover:underline">{h.documentTitle}</span>
                  <Badge tone={MATCH_TONE[h.matchType]}>{MATCH_LABEL[h.matchType]}</Badge>
                  {h.bestPage && <span className="text-muted text-xs">pág. {h.bestPage}</span>}
                </div>
                <div className="text-muted text-xs">
                  {[h.subjectName, h.unitName, h.filename].filter(Boolean).join(' · ')}
                </div>
                <p className="text-muted mt-1.5 line-clamp-2 text-sm">{h.excerpt}</p>
              </div>
            </Link>
          ))}
        </Card>
      )}
      {!q && (
        <Card>
          <Empty icon={<SearchIcon className="size-5" />} title="Escribe un concepto">
            Combina búsqueda por significado (embeddings) y por palabras exactas (BM25).
          </Empty>
        </Card>
      )}
    </div>
  );
}
