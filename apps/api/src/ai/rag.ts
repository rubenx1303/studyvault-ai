import type { AskResponse, Citation, SearchScope } from '@studyvault/shared';
import type { Db } from '../db/database';
import type { LlmProvider } from './llm';
import { formatTimestamp } from '../transcription/types';
import type { RetrievedChunk, Retriever } from './retrieval';

export const NOT_ENOUGH =
  'No he encontrado información suficiente en tus materiales para responder con seguridad.';

/** Calibrado para multilingual-e5-small: irrelevante ≈0,80–0,83; relevante ≥0,85. */
const MIN_SIMILARITY = 0.84;

const SYSTEM = `Eres el asistente académico de StudyVault para un estudiante de DAM (Desarrollo de Aplicaciones Multiplataforma).
Reglas estrictas:
1. Responde ÚNICAMENTE con la información de los FRAGMENTOS proporcionados (materiales del propio estudiante).
2. Cita cada afirmación con el número del fragmento entre corchetes, p. ej. [1] o [2][3].
3. Si los fragmentos no contienen la respuesta, responde exactamente: "${NOT_ENOUGH}"
4. No inventes datos, fechas, páginas ni documentos. Puedes reformular y explicar con claridad.
5. Si un fragmento es una transcripción de videoclase, atribúyelo al profesor ("en la clase del…, el profesor explicó…") y combínalo con los apuntes cuando proceda.
6. Responde en español, con formato Markdown breve (listas, **negritas**, bloques de código si procede).`;

export type AskMode = 'answer' | 'explain-task' | 'concepts' | 'where' | 'guide' | 'review';

const MODE_PROMPTS: Record<AskMode, string> = {
  answer: '',
  'explain-task':
    'Explica con claridad qué pide esta tarea: objetivo, entregables y criterios que se deduzcan.',
  concepts: 'Enumera los conceptos del temario necesarios para resolverlo y explica cada uno brevemente.',
  where: 'Indica en qué documentos y páginas del temario se explica lo necesario (usa las citas).',
  guide:
    'Guía paso a paso al estudiante SIN darle la solución completa: pistas, orden de trabajo y comprobaciones.',
  review:
    'Revisa la solución del estudiante comparándola con el temario: aciertos, errores, mejoras. Sé concreto.',
};

/** RAG: recuperar fragmentos relevantes → construir contexto numerado → generar respuesta citada. */
export class RagService {
  constructor(
    private readonly db: Db,
    private readonly retriever: Retriever,
    private readonly llm: LlmProvider,
  ) {}

  async ask(
    question: string,
    scope: SearchScope = {},
    opts: { mode?: AskMode; extra?: string } = {},
  ): Promise<AskResponse> {
    const t0 = Date.now();
    const mode = opts.mode ?? 'answer';
    const taskContext = scope.taskId ? this.taskContext(scope.taskId) : '';
    const retrievalQuery = [question, taskContext.slice(0, 600)].filter(Boolean).join('\n');
    const { chunks, method, candidates } = await this.retriever.retrieve(retrievalQuery, scope, 8);
    const retrieval = { candidates, method, ms: Date.now() - t0 };

    // Umbral de fundamentación: sin coincidencias razonables no llamamos al LLM (evita respuestas inventadas).
    const best = Math.max(0, ...chunks.map((c) => c.vectorScore ?? 0));
    const hasKeyword = chunks.some((c) => c.keywordHit);
    const grounded = chunks.length > 0 && (best >= MIN_SIMILARITY || hasKeyword || mode !== 'answer');
    if (!grounded) {
      return this.save(question, scope, {
        answer: NOT_ENOUGH,
        grounded: false,
        citations: [],
        provider: this.llm.id,
        retrieval,
      });
    }

    const citations: Citation[] = chunks.map(
      ({ text: _t, section: _s, vectorScore: _v, keywordHit: _k, ...c }) => c,
    );

    if (!this.llm.available) {
      // Modo extractivo: sin LLM mostramos los pasajes más relevantes, siempre con su fuente.
      const answer = [
        '_Modo extractivo (sin LLM configurado): estos son los fragmentos más relevantes de tus materiales._',
        '',
        ...chunks.slice(0, 4).map((c) => `> ${c.text.slice(0, 500).replace(/\n+/g, ' ')} [${c.n}]`),
      ].join('\n\n');
      return this.save(question, scope, {
        answer,
        grounded: true,
        citations,
        provider: 'extractive',
        retrieval,
      });
    }

    const context = chunks.map((c) => formatChunk(c)).join('\n\n');
    const user = [
      MODE_PROMPTS[mode],
      taskContext ? `TAREA SELECCIONADA:\n${taskContext}` : '',
      opts.extra ? `TEXTO DEL ESTUDIANTE:\n${opts.extra.slice(0, 6000)}` : '',
      `FRAGMENTOS:\n${context}`,
      `PREGUNTA: ${question}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const answer = (
      await this.llm.chat(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
        { maxTokens: 1500, temperature: 0.2 },
      )
    ).trim();
    const usedNs = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
    const isNotEnough = answer.startsWith(NOT_ENOUGH.slice(0, 40));
    return this.save(question, scope, {
      answer,
      grounded: !isNotEnough,
      // Mostramos primero las fuentes realmente citadas.
      citations: isNotEnough
        ? []
        : [...citations.filter((c) => usedNs.has(c.n)), ...citations.filter((c) => !usedNs.has(c.n))],
      provider: `${this.llm.id}:${this.llm.model}`,
      retrieval,
    });
  }

  private taskContext(taskId: number): string {
    const t = this.db.get<{ title: string; instructions_html: string | null }>(
      'SELECT title, instructions_html FROM tasks WHERE id = ?',
      taskId,
    );
    if (!t) return '';
    return `${t.title}\n${(t.instructions_html ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()}`;
  }

  private save(question: string, scope: SearchScope, res: AskResponse): AskResponse {
    this.db.run(
      'INSERT INTO queries (question, scope_json, answer, citations_json, grounded) VALUES (?, ?, ?, ?, ?)',
      question,
      JSON.stringify(scope),
      res.answer,
      JSON.stringify(res.citations),
      res.grounded ? 1 : 0,
    );
    return res;
  }
}

export function formatChunk(c: RetrievedChunk): string {
  if (c.recordingId) {
    const when = [
      c.recordedAt ? `Videoclase del ${c.recordedAt.slice(0, 10)}` : 'Videoclase',
      c.startSec != null ? `minuto ${formatTimestamp(c.startSec)}` : null,
    ];
    return `[${c.n}] (${[c.subjectName, c.documentTitle, ...when].filter(Boolean).join(' · ')} — transcripción de lo dicho en clase)
${c.text}`;
  }
  const where = [c.subjectName, c.unitName, c.filename, c.page ? `página ${c.page}` : null, c.section]
    .filter(Boolean)
    .join(' · ');
  return `[${c.n}] (${where})\n${c.text}`;
}
