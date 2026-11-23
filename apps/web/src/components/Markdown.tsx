import type { Citation } from '@studyvault/shared';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router';
import { formatTs } from '../lib/format';
import { docLink } from './Citations';

/** Markdown de la IA con las citas [n] convertidas en enlaces al documento/página. */
export function Markdown({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const navigate = useNavigate();
  const byN = new Map(citations.map((c) => [c.n, c]));
  const withLinks = text.replace(/\[(\d+)\](?!\()/g, (m, n: string) =>
    byN.has(Number(n)) ? `[${n}](#cite-${n})` : m,
  );
  return (
    <div className="prose-sv">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const n = href?.startsWith('#cite-') ? Number(href.slice(6)) : null;
            const c = n ? byN.get(n) : undefined;
            if (c) {
              return (
                <button
                  type="button"
                  title={`${c.filename}${c.page ? ` · página ${c.page}` : ''}${c.startSec != null && c.recordingId ? ` · ${formatTs(c.startSec)}` : ''}`}
                  onClick={() => navigate(docLink(c))}
                  className="bg-accent-500/12 text-accent-600 hover:bg-accent-500/20 dark:text-accent-400 mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded-md px-1 align-middle text-[0.68rem] font-semibold no-underline transition-colors"
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {withLinks}
      </ReactMarkdown>
    </div>
  );
}
