import path from 'node:path';
import JSZip from 'jszip';
import mammoth from 'mammoth';

/** Texto extraído con su posición de origen (página/diapositiva y sección) para poder citar. */
export interface Segment {
  page: number | null;
  section: string | null;
  text: string;
}

export interface Extracted {
  segments: Segment[];
  pageCount: number | null;
}

export async function extract(buffer: Buffer, filename: string): Promise<Extracted> {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.pdf':
      return extractPdf(buffer);
    case '.docx':
      return extractDocx(buffer);
    case '.doc':
      return extractDoc(buffer);
    case '.pptx':
      return extractPptx(buffer);
    case '.html':
    case '.htm':
      return { segments: htmlToSegments(buffer.toString('utf8')), pageCount: null };
    default:
      return { segments: [{ page: null, section: null, text: buffer.toString('utf8') }], pageCount: null };
  }
}

/** Word 97-2003 (.doc): formato binario antiguo; se extrae el texto plano por párrafos. */
async function extractDoc(buffer: Buffer): Promise<Extracted> {
  const { default: WordExtractor } = await import('word-extractor');
  const doc = await new WordExtractor().extract(buffer);
  const text = doc.getBody().replace(/\r/g, '\n');
  return { segments: [{ page: null, section: null, text }], pageCount: null };
}

async function extractPdf(buffer: Buffer): Promise<Extracted> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const segments: Segment[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      segments.push({ page: p, section: null, text: tidy(text) });
      page.cleanup();
    }
    return { segments: stripRepeatedLines(segments), pageCount: doc.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Elimina encabezados y pies de página: líneas (con los números normalizados) que se repiten
 * al principio o al final de la mayoría de las páginas. Si no, ensucian cada fragmento del RAG.
 */
export function stripRepeatedLines(segments: Segment[]): Segment[] {
  if (segments.length < 3) return segments;
  const key = (l: string) => l.trim().toLowerCase().replace(/\d+/g, '#');
  const counts = new Map<string, number>();
  const depth = (n: number) => (n >= 6 ? 2 : 1); // páginas cortas: solo primera y última línea
  const edges = (text: string) => {
    const lines = text.split('\n').filter((l) => l.trim());
    return [...lines.slice(0, depth(lines.length)), ...lines.slice(-depth(lines.length))];
  };
  for (const s of segments)
    for (const k of new Set(edges(s.text).map(key))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const repeated = new Set(
    [...counts].filter(([k, c]) => k.length > 0 && c >= Math.max(3, segments.length * 0.6)).map(([k]) => k),
  );
  if (repeated.size === 0) return segments;
  return segments.map((s) => {
    const lines = s.text.split('\n');
    const edgeIdx = new Set(
      lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.trim())
        .flatMap(({ i }, n, arr) =>
          n < depth(arr.length) || n >= arr.length - depth(arr.length) ? [i] : [],
        ),
    );
    return {
      ...s,
      text: lines
        .filter((l, i) => !(edgeIdx.has(i) && repeated.has(key(l))))
        .join('\n')
        .trim(),
    };
  });
}

async function extractDocx(buffer: Buffer): Promise<Extracted> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return { segments: htmlToSegments(html), pageCount: null };
}

async function extractPptx(buffer: Buffer): Promise<Extracted> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map((f) => ({ f, n: Number(f.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter((x) => x.n)
    .sort((a, b) => a.n - b.n);
  const segments: Segment[] = [];
  for (const { f, n } of slides) {
    const xml = await zip.file(f)!.async('string');
    const paragraphs = xml
      .split(/<\/a:p>/)
      .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''));
    const text = decodeEntities(paragraphs.filter(Boolean).join('\n'));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile
      ? decodeEntities(
          [...(await notesFile.async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' '),
        )
      : '';
    const title = text.split('\n')[0]?.slice(0, 120) ?? null;
    segments.push({ page: n, section: title, text: tidy(notes ? `${text}\n\nNotas: ${notes}` : text) });
  }
  return { segments, pageCount: slides.length };
}

/** Divide HTML en segmentos por encabezados (h1–h3), conservando el título de sección. */
export function htmlToSegments(html: string): Segment[] {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const parts = body.split(/(?=<h[1-3][^>]*>)/i);
  const segments: Segment[] = [];
  for (const part of parts) {
    const heading = part.match(/^<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
    const text = tidy(
      decodeEntities(
        part
          .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<li[^>]*>/gi, '• ')
          .replace(/<[^>]+>/g, ' '),
      ),
    );
    if (text)
      segments.push({
        page: null,
        section: heading ? tidy(decodeEntities(heading.replace(/<[^>]+>/g, ''))) : null,
        text,
      });
  }
  return segments;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function tidy(s: string): string {
  return s
    .replaceAll(String.fromCharCode(0), '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
