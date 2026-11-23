import crypto from 'node:crypto';
import type { Citation, ExamResultItem, Flashcard, QuizQuestion, SearchScope } from '@studyvault/shared';
import type { Db } from '../db/database';
import { parseJsonLoose, type LlmProvider } from './llm';
import type { Retriever } from './retrieval';

export type StudyKind = 'summary' | 'concepts' | 'simple' | 'flashcards' | 'quiz' | 'open' | 'exercises';

interface ContextChunk {
  n: number;
  chunkId: number;
  documentId: number;
  title: string;
  filename: string;
  mime: string | null;
  page: number | null;
  subject: string | null;
  unit: string | null;
  text: string;
}

const BASE = `Eres un profesor de DAM que prepara material de estudio. Usa SOLO el contenido de los FRAGMENTOS
(materiales del estudiante). Si algo no aparece en ellos, no lo incluyas. Escribe en español.`;

const PROMPTS: Record<StudyKind, { prompt: string; json: boolean }> = {
  summary: {
    json: false,
    prompt: 'Haz un resumen estructurado en Markdown (encabezados ##, viñetas). Cita fragmentos como [n].',
  },
  concepts: {
    json: false,
    prompt:
      'Lista los conceptos más importantes en Markdown: **concepto** — definición breve y por qué importa. Cita [n].',
  },
  simple: {
    json: false,
    prompt: 'Explícalo de forma sencilla, como a alguien que empieza, con analogías y un ejemplo. Cita [n].',
  },
  flashcards: {
    json: true,
    prompt:
      'Genera 12 flashcards. JSON: {"cards":[{"front":"pregunta corta","back":"respuesta concisa","sourceN":[n]}]}',
  },
  quiz: {
    json: true,
    prompt:
      'Genera 8 preguntas tipo test de 4 opciones con una sola correcta. JSON: {"questions":[{"question":"","options":["","","",""],"answerIndex":0,"explanation":"por qué","topic":"tema corto","sourceN":[n]}]}',
  },
  open: {
    json: true,
    prompt:
      'Genera 5 preguntas abiertas de examen. JSON: {"questions":[{"question":"","expectedAnswer":"respuesta modelo","explanation":"claves que debe incluir","topic":"tema corto","sourceN":[n]}]}',
  },
  exercises: {
    json: false,
    prompt:
      'Propón 3 ejercicios prácticos graduados (fácil→difícil) basados en el temario, con enunciado y pistas (sin solución). Cita [n].',
  },
};

/** Modo estudio y modo examen: generación a partir de los materiales del ámbito seleccionado. */
export class StudyService {
  constructor(
    private readonly db: Db,
    private readonly retriever: Retriever,
    private readonly llm: LlmProvider,
  ) {}

  /** Selecciona fragmentos representativos del ámbito (repartidos por documento) hasta un presupuesto de caracteres. */
  contextFor(scope: SearchScope, budget = 14000): ContextChunk[] {
    const ids = this.retriever.scopeDocumentIds(scope);
    const docFilter = ids ? `AND d.id IN (${[...ids].join(',') || '0'})` : '';
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT c.id, c.document_id, c.text, c.page, d.title, d.filename, d.mime, s.name AS subject, u.name AS unit
       FROM chunks c JOIN documents d ON d.id = c.document_id
       LEFT JOIN subjects s ON s.id = d.subject_id LEFT JOIN units u ON u.id = d.unit_id
       WHERE d.removed = 0 ${docFilter} ORDER BY d.kind = 'theory' DESC, d.id, c.ord`,
    );
    if (rows.length === 0) return [];
    const total = rows.reduce((a, r) => a + String(r.text).length, 0);
    const step = Math.max(1, Math.ceil(total / budget));
    const out: ContextChunk[] = [];
    let used = 0;
    for (let i = 0; i < rows.length && used < budget; i += step) {
      const r = rows[i]!;
      const text = String(r.text);
      used += text.length;
      out.push({
        n: out.length + 1,
        chunkId: Number(r.id),
        documentId: Number(r.document_id),
        title: String(r.title),
        filename: String(r.filename),
        mime: r.mime == null ? null : String(r.mime),
        page: r.page == null ? null : Number(r.page),
        subject: r.subject == null ? null : String(r.subject),
        unit: r.unit == null ? null : String(r.unit),
        text,
      });
    }
    return out;
  }

  private citations(ctx: ContextChunk[]): Citation[] {
    return ctx.map((c) => ({
      n: c.n,
      chunkId: c.chunkId,
      documentId: c.documentId,
      documentTitle: c.title,
      filename: c.filename,
      mime: c.mime,
      subjectName: c.subject,
      unitName: c.unit,
      page: c.page,
      excerpt: c.text.slice(0, 280),
      score: 0,
    }));
  }

  private fragments(ctx: ContextChunk[]) {
    return ctx
      .map(
        (c) =>
          `[${c.n}] (${[c.filename, c.page ? `p. ${c.page}` : null].filter(Boolean).join(', ')})\n${c.text}`,
      )
      .join('\n\n');
  }

  async generate(kind: StudyKind, scope: SearchScope, refresh = false) {
    const key = `${kind}:${JSON.stringify(scope)}`;
    if (!refresh) {
      const cached = this.db.get<{ content_json: string }>(
        'SELECT content_json FROM study_cache WHERE key = ?',
        key,
      );
      if (cached) return JSON.parse(cached.content_json) as StudyResult;
    }
    const ctx = this.contextFor(scope);
    if (ctx.length === 0) throw new Error('No hay documentos procesados en este ámbito.');
    const spec = PROMPTS[kind];
    const raw = await this.llm.chat(
      [
        { role: 'system', content: BASE },
        { role: 'user', content: `${spec.prompt}\n\nFRAGMENTOS:\n${this.fragments(ctx)}` },
      ],
      { json: spec.json, maxTokens: 3000, temperature: 0.3 },
    );
    const result: StudyResult = { kind, citations: this.citations(ctx), createdAt: new Date().toISOString() };
    if (kind === 'flashcards') result.cards = parseJsonLoose<{ cards: Flashcard[] }>(raw).cards;
    else if (kind === 'quiz' || kind === 'open')
      result.questions = normalizeQuestions(parseJsonLoose<{ questions: RawQ[] }>(raw).questions, kind);
    else result.markdown = raw.trim();
    this.db.run(
      'INSERT OR REPLACE INTO study_cache (key, content_json) VALUES (?, ?)',
      key,
      JSON.stringify(result),
    );
    return result;
  }

  // ── Modo examen ──
  async createExam(subjectId: number, unitIds: number[], size = 10) {
    const scope: SearchScope = unitIds.length ? { unitIds } : { subjectId };
    const ctx = this.contextFor(scope, 18000);
    if (ctx.length === 0) throw new Error('No hay documentos procesados en las unidades elegidas.');
    const weak = this.db
      .all<{ topic: string }>(
        'SELECT topic FROM topic_stats WHERE subject_id = ? AND wrong > correct ORDER BY wrong DESC LIMIT 5',
        subjectId,
      )
      .map((r) => r.topic);
    const mcq = Math.round(size * 0.7);
    const raw = await this.llm.chat(
      [
        { role: 'system', content: BASE },
        {
          role: 'user',
          content: `Crea un simulacro de examen con ${mcq} preguntas tipo test (4 opciones) y ${size - mcq} preguntas abiertas cortas.
${weak.length ? `Incluye preguntas sobre estos temas débiles del alumno: ${weak.join(', ')}.` : ''}
JSON: {"questions":[{"type":"mcq","question":"","options":["","","",""],"answerIndex":0,"explanation":"","topic":"tema corto","sourceN":[n]},
{"type":"open","question":"","expectedAnswer":"","explanation":"","topic":"","sourceN":[n]}]}

FRAGMENTOS:\n${this.fragments(ctx)}`,
        },
      ],
      { json: true, maxTokens: 4000, temperature: 0.4 },
    );
    const questions = normalizeQuestions(parseJsonLoose<{ questions: RawQ[] }>(raw).questions);
    const { lastId } = this.db.run(
      'INSERT INTO exam_attempts (subject_id, unit_ids_json, questions_json) VALUES (?, ?, ?)',
      subjectId,
      JSON.stringify(unitIds),
      JSON.stringify({ questions, citations: this.citations(ctx) }),
    );
    return {
      id: lastId,
      questions: questions.map(({ answerIndex: _a, expectedAnswer: _e, explanation: _x, ...q }) => q),
      citations: this.citations(ctx),
    };
  }

  async gradeExam(attemptId: number, answers: Record<string, string | number>) {
    const row = this.db.get<{ subject_id: number; questions_json: string }>(
      'SELECT subject_id, questions_json FROM exam_attempts WHERE id = ?',
      attemptId,
    );
    if (!row) throw new Error('Intento no encontrado');
    const { questions, citations } = JSON.parse(row.questions_json) as {
      questions: QuizQuestion[];
      citations: Citation[];
    };
    const results: ExamResultItem[] = [];
    const open = questions.filter((q) => q.type === 'open');

    for (const q of questions.filter((x) => x.type === 'mcq')) {
      const ok = Number(answers[q.id]) === q.answerIndex;
      results.push({
        questionId: q.id,
        correct: ok,
        score: ok ? 1 : 0,
        feedback: q.explanation,
        topic: q.topic,
      });
    }
    if (open.length) {
      const raw = await this.llm.chat(
        [
          { role: 'system', content: 'Eres un profesor que corrige con criterio justo. Responde en JSON.' },
          {
            role: 'user',
            content: `Corrige estas respuestas abiertas (0 a 1). JSON: {"results":[{"id":"","score":0.0,"feedback":"qué falta o sobra"}]}\n\n${open
              .map(
                (q) =>
                  `ID ${q.id}\nPregunta: ${q.question}\nRespuesta modelo: ${q.expectedAnswer}\nRespuesta alumno: ${String(answers[q.id] ?? '(en blanco)')}`,
              )
              .join('\n\n')}`,
          },
        ],
        { json: true, maxTokens: 2000, temperature: 0 },
      );
      const graded = parseJsonLoose<{ results: { id: string; score: number; feedback: string }[] }>(
        raw,
      ).results;
      for (const q of open) {
        const g = graded.find((x) => x.id === q.id);
        const score = Math.max(0, Math.min(1, Number(g?.score ?? 0)));
        results.push({
          questionId: q.id,
          correct: score >= 0.6,
          score,
          feedback: g?.feedback ?? q.explanation,
          topic: q.topic,
        });
      }
    }

    const score = results.reduce((a, r) => a + r.score, 0) / Math.max(1, results.length);
    this.db.tx(() => {
      for (const r of results) {
        this.db.run(
          `INSERT INTO topic_stats (subject_id, topic, correct, wrong) VALUES (?, ?, ?, ?)
           ON CONFLICT(subject_id, topic) DO UPDATE SET correct = correct + excluded.correct, wrong = wrong + excluded.wrong, updated_at = datetime('now')`,
          row.subject_id,
          r.topic,
          r.correct ? 1 : 0,
          r.correct ? 0 : 1,
        );
      }
      this.db.run(
        `UPDATE exam_attempts SET answers_json = ?, results_json = ?, score = ?, finished_at = datetime('now') WHERE id = ?`,
        JSON.stringify(answers),
        JSON.stringify(results),
        score,
        attemptId,
      );
    });

    const weakTopics = [...new Set(results.filter((r) => !r.correct).map((r) => r.topic))];
    return { score, results, questions, citations, weakTopics };
  }
}

export interface StudyResult {
  kind: StudyKind;
  markdown?: string;
  cards?: Flashcard[];
  questions?: QuizQuestion[];
  citations: Citation[];
  createdAt: string;
}

type RawQ = Partial<QuizQuestion> & { question: string };

function normalizeQuestions(qs: RawQ[], forceType?: 'quiz' | 'open'): QuizQuestion[] {
  return (qs ?? []).map((q) => {
    const type =
      forceType === 'quiz'
        ? 'mcq'
        : forceType === 'open'
          ? 'open'
          : q.options?.length
            ? 'mcq'
            : (q.type ?? 'open');
    return {
      id: crypto.randomUUID().slice(0, 8),
      type,
      question: q.question,
      options: type === 'mcq' ? q.options : undefined,
      answerIndex: type === 'mcq' ? Number(q.answerIndex ?? 0) : undefined,
      expectedAnswer: q.expectedAnswer,
      explanation: q.explanation ?? '',
      topic: (q.topic ?? 'General').slice(0, 60),
      sourceN: q.sourceN,
    };
  });
}
