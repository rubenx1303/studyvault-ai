import type { Segment } from './extractors';

export interface Chunk {
  ord: number;
  page: number | null;
  section: string | null;
  text: string;
}

/**
 * Chunking por párrafos con solapamiento. Nunca cruza páginas: así cada fragmento se puede citar
 * con su página exacta. ~1000 caracteres ≈ 250 tokens: buen equilibrio entre precisión y contexto.
 */
export function chunkSegments(segments: Segment[], opts = { size: 1000, overlap: 150, min: 40 }): Chunk[] {
  const chunks: Chunk[] = [];
  for (const seg of segments) {
    const paragraphs = seg.text
      .split(/\n{2,}|\n(?=[•\-*\d]+[.)]?\s)/)
      .flatMap((p) => (p.length > opts.size ? splitLong(p, opts.size) : [p]))
      .map((p) => p.trim())
      .filter(Boolean);

    let current = '';
    const flush = () => {
      const text = current.trim();
      if (text.length >= opts.min)
        chunks.push({ ord: chunks.length, page: seg.page, section: seg.section, text });
      current = text.length > opts.overlap ? text.slice(-opts.overlap).replace(/^\S*\s/, '') : '';
    };
    for (const p of paragraphs) {
      if (current.length + p.length + 2 > opts.size && current.length > opts.overlap) flush();
      if (current.length + p.length + 2 > opts.size) current = ''; // el solapamiento no debe desbordar el tamaño
      current += (current ? '\n\n' : '') + p;
    }
    if (current.trim().length >= opts.min)
      chunks.push({ ord: chunks.length, page: seg.page, section: seg.section, text: current.trim() });
  }
  return chunks;
}

function splitLong(text: string, size: number): string[] {
  const sentences = text.split(/(?<=[.!?;:])\s+/);
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf.length + s.length > size && buf) {
      out.push(buf);
      buf = '';
    }
    if (s.length > size) {
      for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    } else buf += (buf ? ' ' : '') + s;
  }
  if (buf) out.push(buf);
  return out;
}
