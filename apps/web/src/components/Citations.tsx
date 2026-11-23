import type { Citation } from '@studyvault/shared';
import { FileText, Video } from 'lucide-react';
import { formatTs, shortDate } from '../lib/format';
import { Link } from 'react-router';
import { cn } from './ui';

export function docLink(c: {
  documentId: number;
  page?: number | null;
  chunkId?: number;
  recordingId?: number | null;
  startSec?: number | null;
}) {
  if (c.recordingId)
    return `/recordings/${c.recordingId}${c.startSec != null ? `?t=${Math.floor(c.startSec)}` : ''}`;
  const q = new URLSearchParams();
  if (c.page) q.set('page', String(c.page));
  if (c.chunkId) q.set('chunk', String(c.chunkId));
  const s = q.toString();
  return `/documents/${c.documentId}${s ? `?${s}` : ''}`;
}

/** Lista de FUENTES: cada una abre el documento (y la página) del que procede. */
export function Citations({ citations, compact }: { citations: Citation[]; compact?: boolean }) {
  if (!citations.length) return null;
  return (
    <div>
      <div className="text-muted mb-2 text-[0.7rem] font-semibold tracking-wider uppercase">Fuentes</div>
      <ol className={cn('grid gap-2', !compact && 'sm:grid-cols-2')}>
        {citations.map((c) => (
          <li key={`${c.n}-${c.chunkId}`}>
            <Link
              to={docLink(c)}
              className="group surface flex gap-3 rounded-xl p-3 transition-colors hover:border-[var(--color-accent-400)]"
            >
              <span className="bg-accent-500/12 text-accent-600 dark:text-accent-400 grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold">
                {c.n}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {c.recordingId ? (
                    <Video className="size-3.5 shrink-0 text-violet-500" />
                  ) : (
                    <FileText className="text-muted size-3.5 shrink-0" />
                  )}
                  <span className="truncate group-hover:underline">{c.filename}</span>
                  {c.page && <span className="text-muted shrink-0 text-xs">· pág. {c.page}</span>}
                  {c.recordingId && c.startSec != null && (
                    <span className="shrink-0 rounded bg-violet-500/10 px-1 font-mono text-xs text-violet-600 dark:text-violet-400">
                      {formatTs(c.startSec)}
                    </span>
                  )}
                </div>
                <div className="text-muted truncate text-xs">
                  {[
                    c.subjectName,
                    c.recordingId
                      ? c.recordedAt
                        ? `Videoclase ${shortDate(c.recordedAt)}`
                        : 'Videoclase'
                      : c.unitName,
                  ]
                    .filter(Boolean)
                    .join(' › ')}
                </div>
                {!compact && (
                  <p className="text-muted mt-1 line-clamp-2 text-xs leading-relaxed">{c.excerpt}</p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
