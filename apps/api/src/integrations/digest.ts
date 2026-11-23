import type { RecordingAnalysis } from '@studyvault/shared';
import type { Db } from '../db/database';
import { isExamStatement } from '../lectures/analysis';

/**
 * Resumen diario de novedades por asignatura (HTML; `npm run daily` lo guarda en la carpeta de datos).
 *
 * Minimización: títulos, asignaturas, fechas, enlaces al campus y el análisis de cada videoclase.
 * Nunca el texto de documentos ni el cuerpo de los mensajes de los profesores.
 */
export interface Digest {
  subject: string;
  html: string;
  /** Hay algo que contar (si no, el correo se puede omitir). */
  hasNews: boolean;
}

interface Opts {
  since: Date;
  now?: Date;
  appUrl?: string;
  /** Aviso añadido al principio (p. ej. la sincronización falló). */
  warning?: string | null;
}

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (iso: string | null, withTime = true) => {
  if (!iso) return '';
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : `${iso.replace(' ', 'T')}Z`);
  return d.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};
const link = (text: string, url: string | null) =>
  url ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text);
const ul = (items: string[]) =>
  items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '';
/** Markdown mínimo del resumen del LLM (negritas, viñetas y títulos) a HTML seguro. */
const md = (s: string) =>
  s
    .replace(/```[a-z]*/gi, '') // algunos modelos envuelven el Markdown en un bloque de código
    .replace(/(^|\n)\s*#+\s*Resumen[^\n]*\n/i, '\n')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const html = esc(l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '')).replace(
        /\*\*(.+?)\*\*/g,
        '<b>$1</b>',
      );
      return /^[-*]\s/.test(l)
        ? `<li>${html}</li>`
        : /^#/.test(l)
          ? `<p><b>${html}</b></p>`
          : `<p>${html}</p>`;
    })
    .join('')
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);

const STYLE = `body{font-family:'Segoe UI',Arial,sans-serif;font-size:10.5pt;color:#111827;line-height:1.45}
h1{font-size:20pt;margin:0 0 2px;color:#4c1d95}.sub{color:#6b7280;margin-bottom:14px}
h2{font-size:13.5pt;margin:20px 0 6px;padding:6px 10px;background:#ede9fe;border-radius:6px;color:#3b0764;page-break-after:avoid}
h3{font-size:11pt;margin:10px 0 4px;color:#374151;page-break-after:avoid}ul{margin:2px 0 6px;padding-left:18px}li{margin:2px 0}
p{margin:3px 0}a{color:#6d28d9}table{border-collapse:collapse;width:100%;margin:6px 0 10px}
td,th{border:1px solid #e5e7eb;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f3f4f6}
.urg{color:#b91c1c;font-weight:600}.muted{color:#6b7280}.exam{color:#b91c1c}
.box{background:#fef3c7;border-radius:6px;padding:8px 12px;margin:8px 0}`;

export function buildDigest(db: Db, opts: Opts): Digest {
  const now = opts.now ?? new Date();
  const since = sqlTime(opts.since);
  const NONE = 'Otros';

  const changes = db.all<{
    entity_type: string;
    summary: string;
    subject: string | null;
    url: string | null;
  }>(
    `SELECT c.entity_type, c.summary, s.name subject, COALESCE(d.url, t.url, m.url, r.url) url
       FROM changes c
       LEFT JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN documents d ON c.entity_type = 'document' AND d.id = c.entity_id
       LEFT JOIN tasks t ON c.entity_type = 'task' AND t.id = c.entity_id
       LEFT JOIN messages m ON c.entity_type = 'message' AND m.id = c.entity_id
       LEFT JOIN recordings r ON c.entity_type = 'recording' AND r.id = c.entity_id
      WHERE c.created_at >= ? AND c.entity_type != 'recording'
        -- la primera importación de una fuente no son novedades
        AND EXISTS (SELECT 1 FROM sync_runs p WHERE p.mode = 'sync' AND p.status IN ('ok','partial')
                     AND p.id < c.sync_run_id)
      ORDER BY c.id`,
    since,
  );

  const recordings = db.all<{
    id: number;
    title: string;
    subject: string | null;
    recorded_at: string | null;
    analysis_json: string | null;
  }>(
    `SELECT r.id, r.title, s.name subject, r.recorded_at, r.analysis_json
       FROM recordings r LEFT JOIN subjects s ON s.id = r.subject_id
      WHERE r.status = 'ready' AND r.removed = 0 AND r.analysis_json IS NOT NULL AND r.processed_at >= ?
      ORDER BY r.recorded_at`,
    since,
  );

  const upcoming = db.all<{ title: string; subject: string | null; due_at: string; url: string | null }>(
    `SELECT t.title, s.name subject, t.due_at, t.url
       FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE t.due_at IS NOT NULL AND t.local_status != 'done' AND t.due_at >= ? AND t.due_at <= ?
      ORDER BY t.due_at`,
    now.toISOString(),
    new Date(now.getTime() + 21 * 86_400_000).toISOString(),
  );
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  // Vencidas y sin entregar según el campus: no deben desaparecer del resumen al pasar la fecha.
  const overdue = db.all<{ title: string; subject: string | null; due_at: string; url: string | null }>(
    `SELECT t.title, s.name subject, t.due_at, t.url
       FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE t.due_at IS NOT NULL AND t.due_at < ? AND t.local_status != 'done'
        AND COALESCE(t.remote_submission, '') != 'submitted'
      ORDER BY t.due_at`,
    now.toISOString(),
  );

  // Agrupar todo por asignatura.
  const bySubject = new Map<string, string[]>();
  const add = (subject: string | null, html: string) => {
    const k = subject ?? NONE;
    bySubject.set(k, [...(bySubject.get(k) ?? []), html]);
  };
  const changeList = (subject: string | null, type: string, title: string) => {
    const items = changes.filter((c) => (c.subject ?? null) === subject && c.entity_type === type);
    return items.length ? `<h3>${title}</h3>${ul(items.map((c) => link(c.summary, c.url)))}` : '';
  };
  const subjects = new Set([...changes.map((c) => c.subject), ...recordings.map((r) => r.subject)]);
  for (const s of subjects) {
    add(s, changeList(s, 'message', 'Avisos de profesores'));
    add(s, changeList(s, 'task', 'Tareas'));
    add(s, changeList(s, 'document', 'Documentos'));
  }
  for (const r of recordings) {
    let a: Partial<RecordingAnalysis> = {};
    try {
      a = r.analysis_json ? (JSON.parse(r.analysis_json) as RecordingAnalysis) : {};
    } catch {
      /* análisis ilegible: solo el título */
    }
    const url = opts.appUrl ? `${opts.appUrl}/recordings/${r.id}` : null;
    const texts = (xs: { text: string }[] | undefined, n = 6) =>
      (xs ?? []).slice(0, n).map((x) => esc(x.text));
    add(
      r.subject,
      [
        `<h3>Tutoría: ${link(r.title, url)} <span class="muted">· ${esc(fmt(r.recorded_at))}</span></h3>`,
        a.summary ? md(a.summary) : '<p class="muted">Transcrita; sin análisis de IA.</p>',
        a.notices?.length ? `<p><b>Avisos:</b></p>${ul(texts(a.notices))}` : '',
        a.datesMentioned?.length
          ? `<p><b>Fechas que se dijeron:</b></p>${ul(a.datesMentioned.slice(0, 6).map((d) => `${esc(d.date)}: ${esc(d.context)}`))}`
          : '',
        a.tasksMentioned?.length ? `<p><b>Tareas mencionadas:</b></p>${ul(texts(a.tasksMentioned))}` : '',
        (a.examExplicit ?? []).some((e) => isExamStatement(e.statement))
          ? `<p class="exam"><b>Dijo que entra en el examen:</b></p>${ul((a.examExplicit ?? []).filter((e) => isExamStatement(e.statement)).map((e) => `${esc(e.statement)} <span class="muted">(«${esc(e.quote)}»)</span>`))}`
          : '',
      ].join(''),
    );
  }
  const news = [...bySubject.values()].some((xs) => xs.some(Boolean));

  const sections = [...bySubject.entries()]
    .filter(([, xs]) => xs.some(Boolean))
    .sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b, 'es')))
    .map(([s, xs]) => `<h2>${esc(s)}</h2>${xs.join('')}`);

  const urgent = upcoming.filter((t) => t.due_at <= in7);
  const day = now.toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const count = (type: string) => changes.filter((c) => c.entity_type === type).length;
  const counts = [
    count('task') && `${count('task')} tareas`,
    count('message') && `${count('message')} avisos`,
    count('document') && `${count('document')} documentos`,
    recordings.length && `${recordings.length} videoclases`,
  ].filter(Boolean);
  const subject = `StudyVault · ${day}${counts.length ? ` · ${counts.join(', ')}` : ' · sin novedades'}`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(subject)}</title><style>${STYLE}</style></head><body>
<h1>Tu resumen del campus</h1>
<div class="sub">${esc(day)} · novedades desde ${esc(fmt(opts.since.toISOString()))}</div>
${opts.warning ? `<div class="box">${esc(opts.warning)}</div>` : ''}
${overdue.length ? `<div class="box" style="background:#fee2e2"><b>Vencidas y sin entregar:</b>${ul(overdue.map((t) => `<b>${esc(fmt(t.due_at))}</b>: ${link(t.title, t.url)} <span class="muted">· ${esc(t.subject ?? '')}</span>`))}</div>` : ''}
${urgent.length ? `<div class="box"><b>Lo urgente (próximos 7 días):</b>${ul(urgent.map((t) => `<b>${esc(fmt(t.due_at))}</b>: ${link(t.title, t.url)} <span class="muted">· ${esc(t.subject ?? '')}</span>`))}</div>` : ''}
${news ? '' : '<p>No hay novedades en el campus desde el último resumen.</p>'}
${sections.join('\n')}
${
  upcoming.length
    ? `<h2>Entregas en las próximas 3 semanas</h2><table><tr><th>Fecha</th><th>Asignatura</th><th>Tarea</th></tr>${upcoming
        .map(
          (t) =>
            `<tr><td${t.due_at <= in7 ? ' class="urg"' : ''}>${esc(fmt(t.due_at))}</td><td>${esc(t.subject ?? '')}</td><td>${link(t.title, t.url)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
}
<p class="muted" style="margin-top:18px;font-size:9pt">Generado con StudyVault a partir de tu campus (solo lectura) y de las transcripciones de tus videoclases.${opts.appUrl ? ` Ábrelo en tu PC: ${esc(opts.appUrl)}` : ''}</p>
</body></html>`;

  return { subject, html, hasNews: news };
}
