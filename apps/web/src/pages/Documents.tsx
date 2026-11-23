import type { DocumentItem } from '@studyvault/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, FolderOpen, FolderTree } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DocRow } from '../components/rows';
import { Card, Empty, Input, PageHeader, Select, cn } from '../components/ui';
import { api } from '../lib/api';
import { KIND_LABEL } from '../lib/format';

export function DocumentsPage() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects });
  const { data = [], isLoading } = useQuery({
    queryKey: ['documents', subjectId, kind, q],
    queryFn: () => api.documents({ subjectId, kind, q }),
  });

  // Árbol DAM › Asignatura › Unidad › documentos
  const tree = useMemo(() => {
    const bySubject = new Map<string, Map<string, DocumentItem[]>>();
    for (const d of data) {
      const s = d.subjectName ?? 'Subidas manuales';
      const u = d.unitName ?? 'General';
      if (!bySubject.has(s)) bySubject.set(s, new Map());
      const units = bySubject.get(s)!;
      units.set(u, [...(units.get(u) ?? []), d]);
    }
    return [...bySubject.entries()];
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Documentos"
        subtitle={`${data.length} documentos organizados automáticamente por asignatura y unidad.`}
      />
      <div className="animate-in mb-4 flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Filtrar por título o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filtrar"
        />
        <Select
          value={subjectId ?? ''}
          onChange={(e) => setSubjectId(Number(e.target.value) || undefined)}
          aria-label="Asignatura"
        >
          <option value="">Todas las asignaturas</option>
          {subjects.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {!isLoading && data.length === 0 ? (
        <Card>
          <Empty icon={<FolderTree className="size-5" />} title="No hay documentos" />
        </Card>
      ) : (
        <div className="space-y-4">
          {tree.map(([subject, units]) => (
            <Card key={subject} className="animate-in p-2">
              <div className="px-3 pt-2 pb-1 text-sm font-semibold">
                <span className="text-muted font-normal">DAM › </span>
                {subject}
              </div>
              {[...units.entries()].map(([unit, docs]) => (
                <UnitFolder key={unit} name={unit} docs={docs} />
              ))}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UnitFolder({ name, docs }: { name: string; docs: DocumentItem[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:text-[var(--text)]"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {open ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
        <span className="font-medium">{name}</span>
        <span className="text-xs tabular-nums">{docs.length}</span>
      </button>
      {open && (
        <div className="ml-6 border-l border-[var(--border)] pl-2">
          {docs.map((d) => (
            <DocRow key={d.id} doc={d} showSubject={false} />
          ))}
        </div>
      )}
    </div>
  );
}
