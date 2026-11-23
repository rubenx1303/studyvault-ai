import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Info, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { AskPanel } from '../components/AskPanel';
import { FileBadge } from '../components/rows';
import { Badge, Button, Card, PageHeader, Skeleton, cn } from '../components/ui';
import { api, fileUrl } from '../lib/api';
import { KIND_LABEL, bytes, dateTime } from '../lib/format';

/**
 * Visor: los PDF se abren con el visor nativo del navegador en la página citada (#page=N).
 * DOCX/PPTX/HTML se muestran como texto extraído por secciones/diapositivas, resaltando el fragmento citado.
 */
export function DocumentViewer() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const page = Number(params.get('page')) || null;
  const chunk = Number(params.get('chunk')) || null;
  const [showAi, setShowAi] = useState(false);
  const { data: doc } = useQuery({ queryKey: ['document', id], queryFn: () => api.document(id) });
  const isPdf = doc?.filename.toLowerCase().endsWith('.pdf');
  const text = useQuery({
    queryKey: ['document-text', id],
    queryFn: () => api.documentText(id),
    enabled: !!doc && !isPdf,
  });

  if (!doc) return <Skeleton className="h-[80vh]" />;

  return (
    <div>
      <PageHeader
        eyebrow={
          <span>
            {doc.subjectId ? (
              <Link to={`/subjects/${doc.subjectId}`} className="hover:underline">
                {doc.subjectName}
              </Link>
            ) : (
              'Documentos'
            )}
            {doc.unitName && ` › ${doc.unitName}`}
          </span>
        }
        title={
          <span className="flex items-center gap-3">
            <FileBadge filename={doc.filename} />
            <span className="min-w-0 truncate">{doc.title}</span>
          </span>
        }
        actions={
          <>
            <Button
              variant={showAi ? 'primary' : 'secondary'}
              onClick={() => setShowAi(!showAi)}
              icon={<Sparkles className="size-4" />}
            >
              Preguntar sobre este documento
            </Button>
            <a
              href={`/api/documents/${doc.id}/file?download=1`}
              className="surface inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium hover:bg-[var(--surface-2)]"
            >
              <Download className="size-4" /> Descargar
            </a>
          </>
        }
      />

      <div className="animate-in mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge>{KIND_LABEL[doc.kind]}</Badge>
        <Badge>{doc.filename}</Badge>
        {doc.pageCount && <Badge>{doc.pageCount} págs.</Badge>}
        <Badge>{bytes(doc.size)}</Badge>
        <span className="text-muted">Sincronizado {dateTime(doc.syncedAt)}</span>
        {doc.contentHash && (
          <span className="text-muted font-mono" title="SHA-256 del contenido (detección de cambios)">
            #{doc.contentHash.slice(0, 10)}
          </span>
        )}
        {doc.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted inline-flex items-center gap-1 hover:underline"
          >
            Origen <ExternalLink className="size-3" />
          </a>
        )}
        {doc.error && <Badge tone="warn">{doc.error}</Badge>}
      </div>

      <div className={cn('grid gap-4', showAi && 'lg:grid-cols-5')}>
        <Card className={cn('animate-in overflow-hidden', showAi && 'lg:col-span-3')}>
          {isPdf ? (
            <iframe
              key={`${id}-${page}`}
              title={doc.title}
              src={fileUrl(doc.id, page)}
              className="h-[calc(100vh-14rem)] min-h-[560px] w-full bg-white"
            />
          ) : (
            <TextView
              chunks={text.data ?? []}
              page={page}
              chunk={chunk}
              loading={text.isLoading}
              isHtml={(doc.mime ?? '').includes('html')}
            />
          )}
        </Card>
        {showAi && (
          <AskPanel
            className="h-[calc(100vh-14rem)] min-h-[560px] lg:col-span-2"
            scope={{ documentId: doc.id }}
            scopeLabel={doc.filename}
            suggestions={[
              { label: 'Resúmelo', question: 'Haz un resumen de este documento.' },
              { label: 'Conceptos clave', question: '¿Cuáles son los conceptos clave de este documento?' },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function TextView({
  chunks,
  page,
  chunk,
  loading,
  isHtml,
}: {
  chunks: { id: number; page: number | null; section: string | null; text: string }[];
  page: number | null;
  chunk: number | null;
  loading: boolean;
  isHtml: boolean;
}) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    target.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [chunks.length, chunk, page]);

  if (loading)
    return (
      <div className="space-y-3 p-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4" />
        ))}
      </div>
    );
  if (!chunks.length)
    return <p className="text-muted p-6 text-sm">Este documento no tiene texto indexado.</p>;

  const headers = chunks.map((c) =>
    c.page ? `Diapositiva / página ${c.page}${c.section ? ` · ${c.section}` : ''}` : (c.section ?? ''),
  );
  return (
    <div className="max-h-[calc(100vh-14rem)] min-h-[560px] overflow-y-auto px-6 py-6 sm:px-10">
      <div className="text-muted mb-5 flex items-center gap-2 text-xs">
        <Info className="size-3.5" /> Vista de texto extraído
        {isHtml ? '' : ' (los DOCX/PPTX no tienen paginación fija; se muestran por secciones/diapositivas)'}.
      </div>
      <div className="mx-auto max-w-3xl space-y-4">
        {chunks.map((c, i) => {
          const header = headers[i];
          const showHeader = header && header !== headers.slice(0, i).findLast(Boolean);
          const hit = c.id === chunk || (!chunk && page !== null && c.page === page);
          return (
            <div key={c.id} ref={hit ? target : undefined}>
              {showHeader && <h3 className="mt-6 mb-2 text-sm font-semibold">{header}</h3>}
              <p
                className={cn(
                  'rounded-lg text-[0.94rem] leading-relaxed whitespace-pre-line transition-colors',
                  hit && 'bg-amber-400/15 -mx-3 px-3 py-2 ring-1 ring-amber-400/40',
                )}
              >
                {c.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
