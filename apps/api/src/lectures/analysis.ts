import type { RecordingAnalysis, TranscriptSegment } from '@studyvault/shared';
import { parseJsonLoose, type LlmProvider } from '../ai/llm';
import { formatTimestamp } from '../transcription/types';

const SYSTEM = `Analizas la transcripción de una clase grabada de DAM para el estudio personal del alumno.
Reglas:
- Usa SOLO lo que se dice en la transcripción. No inventes contenido, fechas ni tareas.
- Indica la marca temporal aproximada "hh:mm:ss" de cada elemento (campo "t").
- PRIVACIDAD: no incluyas nombres ni datos personales de estudiantes; di "un estudiante".
- EXAMEN: en "examExplicit" incluye ÚNICAMENTE frases en las que el profesor dice EXPLÍCITAMENTE que algo entra, cae o se pregunta en el examen,
  copiando la frase literal en "quote". Haber explicado un tema NO significa que entre en el examen: eso va en "topics".
- Responde en español y SOLO con JSON válido.`;

const SCHEMA = `{"summary":"resumen de esta parte (3-6 frases)",
"topics":[{"text":"tema tratado","t":"hh:mm:ss"}],
"concepts":[{"term":"","explanation":"","t":"hh:mm:ss"}],
"definitions":[{"term":"","definition":"","t":"hh:mm:ss"}],
"examples":[{"text":"ejemplo explicado","t":"hh:mm:ss"}],
"tasksMentioned":[{"text":"tarea o entrega mencionada","t":"hh:mm:ss"}],
"datesMentioned":[{"date":"fecha tal como se dijo","context":"","t":"hh:mm:ss"}],
"notices":[{"text":"aviso o indicación organizativa","t":"hh:mm:ss"}],
"examExplicit":[{"statement":"qué entra según el profesor","quote":"frase literal","t":"hh:mm:ss"}],
"importantQuestions":[{"text":"pregunta relevante planteada en clase o que conviene saber responder","t":"hh:mm:ss"}]}`;

type Raw = Partial<Record<keyof RecordingAnalysis, unknown>> & { summary?: string };

/** Análisis map-reduce: la clase se divide en partes que caben en el contexto del modelo y luego se fusiona. */
export async function analyzeTranscript(
  llm: LlmProvider,
  segments: TranscriptSegment[],
  meta: { title: string; subject: string | null },
  onProgress?: (msg: string) => void,
): Promise<Omit<RecordingAnalysis, 'relatedMaterial' | 'generatedBy' | 'generatedAt'>> {
  const parts = splitTranscript(segments, 14000);
  const partials: Raw[] = [];
  for (const [i, part] of parts.entries()) {
    onProgress?.(`Analizando parte ${i + 1}/${parts.length}…`);
    const raw = await llm.chat(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Clase: ${meta.title}${meta.subject ? ` (${meta.subject})` : ''}. Parte ${i + 1} de ${parts.length}.\nDevuelve: ${SCHEMA}\n\nTRANSCRIPCIÓN:\n${part}`,
        },
      ],
      { json: true, maxTokens: 3000, temperature: 0.1 },
    );
    partials.push(parseJsonLoose<Raw>(raw));
  }

  let summary = partials.map((p) => p.summary ?? '').join('\n\n');
  if (partials.length > 1) {
    onProgress?.('Fusionando resúmenes…');
    summary = (
      await llm.chat(
        [
          {
            role: 'system',
            content:
              'Fusiona resúmenes parciales de una misma clase en un único resumen estructurado en Markdown (máx. 250 palabras). No añadas nada nuevo.',
          },
          {
            role: 'user',
            content: partials.map((p, i) => `Parte ${i + 1}: ${p.summary ?? ''}`).join('\n\n'),
          },
        ],
        { maxTokens: 900, temperature: 0.2 },
      )
    ).trim();
  }

  summary = cleanMarkdown(summary);
  const fullText = normalize(segments.map((s) => s.text).join(' '));
  const list = <T>(key: keyof RecordingAnalysis) =>
    dedupe(partials.flatMap((p) => (Array.isArray(p[key]) ? (p[key] as T[]) : [])));
  const withT = <T extends { t?: unknown }>(items: T[]) => items.map((x) => ({ ...x, t: parseTs(x.t) }));

  return {
    summary,
    topics: withT(list<{ text: string; t?: unknown }>('topics')),
    concepts: withT(list<{ term: string; explanation: string; t?: unknown }>('concepts')),
    definitions: withT(list<{ term: string; definition: string; t?: unknown }>('definitions')),
    examples: withT(list<{ text: string; t?: unknown }>('examples')),
    tasksMentioned: withT(list<{ text: string; t?: unknown }>('tasksMentioned')),
    datesMentioned: withT(list<{ date: string; context: string; t?: unknown }>('datesMentioned')),
    notices: withT(list<{ text: string; t?: unknown }>('notices')),
    // Salvaguarda: una indicación de examen solo se acepta si su cita literal aparece en la transcripción.
    examExplicit: withT(list<{ statement: string; quote: string; t?: unknown }>('examExplicit')).filter(
      (e) => isExamStatement(e.statement) && quoteInTranscript(e.quote, fullText),
    ),
    importantQuestions: withT(list<{ text: string; t?: unknown }>('importantQuestions')),
  };
}

export function splitTranscript(segments: TranscriptSegment[], maxChars: number): string[] {
  const parts: string[] = [];
  let buf = '';
  for (const s of segments) {
    const line = `[${formatTimestamp(s.start)}]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text}\n`;
    if (buf.length + line.length > maxChars && buf) {
      parts.push(buf);
      buf = '';
    }
    buf += line;
  }
  if (buf) parts.push(buf);
  return parts;
}

/** Descarta el eco de la plantilla y las «no indicaciones» que algunos modelos meten en examExplicit. */
export function isExamStatement(statement: string | undefined): boolean {
  const s = normalize(statement ?? '');
  return (
    s.length > 8 &&
    s !== 'que entra segun el profesor' &&
    !/\bno se (especifica|indica|dice|menciona)/.test(s)
  );
}

/** Quita el envoltorio ```markdown y el título genérico que añaden algunos modelos locales. */
export function cleanMarkdown(s: string): string {
  return s
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^\s*#+\s*Resumen[^\n]*\n/i, '')
    .trim();
}

export function parseTs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const m = v.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** La cita debe aparecer (normalizada) en la transcripción, admitiendo pequeñas diferencias al principio/final. */
export function quoteInTranscript(quote: string | undefined, normalizedTranscript: string): boolean {
  const q = normalize(quote ?? '');
  if (q.split(' ').length < 3) return false;
  if (normalizedTranscript.includes(q)) return true;
  const words = q.split(' ');
  const core = words.slice(1, -1).join(' ');
  return core.split(' ').length >= 3 && normalizedTranscript.includes(core);
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const o = x as Record<string, unknown>;
    const k = normalize(String(o.text ?? o.term ?? o.statement ?? o.date ?? JSON.stringify(x))).slice(0, 80);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
