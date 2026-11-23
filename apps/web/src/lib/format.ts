const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** SQLite devuelve "YYYY-MM-DD HH:MM:SS" en UTC sin zona: lo normalizamos. */
export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const v = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relative(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'ahora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(value: string | null | undefined): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}

export function shortDate(value: string | null | undefined): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—';
}

export function dueInfo(value: string | null | undefined): {
  label: string;
  tone: 'danger' | 'warn' | 'ok' | 'muted';
} {
  const d = toDate(value);
  if (!d) return { label: 'Sin fecha', tone: 'muted' };
  const days = (d.getTime() - Date.now()) / 86400000;
  if (days < 0) return { label: `Venció ${relative(value)}`, tone: 'danger' };
  if (days < 2) return { label: `Vence ${relative(value)}`, tone: 'danger' };
  if (days < 7) return { label: `Vence ${relative(value)}`, tone: 'warn' };
  return { label: `Vence ${relative(value)}`, tone: 'ok' };
}

export function bytes(n: number | null | undefined): string {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export const KIND_LABEL: Record<string, string> = {
  theory: 'Teoría',
  exercise: 'Ejercicio',
  case: 'Caso práctico',
  task: 'Tarea',
  resource: 'Recurso',
  exam: 'Examen',
  lecture: 'Videoclase',
  other: 'Otro',
};

export const STATUS_LABEL = { pending: 'Pendiente', in_progress: 'En progreso', done: 'Terminada' } as const;

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatTs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
