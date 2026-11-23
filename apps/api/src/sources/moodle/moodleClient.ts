import { SourceAuthError } from '../types';
import { streamToFile } from './recordings';

/**
 * Cliente mínimo de la API REST oficial de Moodle (Web Services, servicio "moodle_mobile_app").
 * Es la misma API que usa la app móvil oficial de Moodle. Solo se llaman funciones de LECTURA (get_*).
 */
export class MoodleClient {
  /** Lista blanca: cualquier función no incluida aquí se rechaza (mínimo privilegio en el lado cliente). */
  static readonly ALLOWED = new Set([
    'core_webservice_get_site_info',
    'core_enrol_get_users_courses',
    'core_course_get_contents',
    'core_course_get_courses_by_field',
    'mod_assign_get_assignments',
    'mod_forum_get_forums_by_courses',
    'mod_forum_get_forum_discussions',
    'mod_page_get_pages_by_courses',
    'mod_folder_get_folders_by_courses',
    'mod_bigbluebuttonbn_get_bigbluebuttonbns_by_courses',
    'mod_bigbluebuttonbn_get_recordings',
    'mod_resource_get_resources_by_courses',
    'core_calendar_get_action_events_by_timesort',
    'core_message_get_conversations',
    'core_message_get_conversation_messages',
  ]);

  private lastCall = 0;

  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly minIntervalMs = 150, // cortesía con el servidor del campus
  ) {}

  async call<T>(wsfunction: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!MoodleClient.ALLOWED.has(wsfunction)) throw new Error(`Función Moodle no permitida: ${wsfunction}`);
    const wait = this.lastCall + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();

    const body = new URLSearchParams({ wstoken: this.token, wsfunction, moodlewsrestformat: 'json' });
    for (const [k, v] of flatten(params)) body.append(k, v);

    const res = await fetch(`${this.baseUrl}/webservice/rest/server.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Moodle HTTP ${res.status} en ${wsfunction}`);
    const data = (await res.json()) as T & { exception?: string; errorcode?: string; message?: string };
    if (data && typeof data === 'object' && 'exception' in data && data.exception) {
      if (
        ['invalidtoken', 'accessexception'].includes(String(data.errorcode)) &&
        wsfunction === 'core_webservice_get_site_info'
      )
        throw new SourceAuthError('El token de Moodle no es válido o ha caducado. Vuelve a iniciar sesión.');
      if (data.errorcode === 'invalidtoken')
        throw new SourceAuthError('Token de Moodle inválido o caducado.');
      throw new MoodleError(wsfunction, String(data.errorcode), String(data.message ?? data.exception));
    }
    return data;
  }

  /** Descarga grande (vídeos) directamente a disco, en streaming. */
  async downloadToFile(
    fileUrl: string,
    dest: string,
    onProgress?: (m: string) => void,
  ): Promise<{ mime: string | null }> {
    const res = await fetch(this.tokenUrl(fileUrl), { signal: AbortSignal.timeout(6 * 3600_000) });
    if (!res.ok || !res.body) throw new Error(`Descarga fallida (HTTP ${res.status})`);
    const mime = res.headers.get('content-type');
    if (mime?.includes('application/json')) throw new Error('Moodle rechazó la descarga');
    await streamToFile(res, dest, onProgress);
    return { mime };
  }

  private tokenUrl(fileUrl: string): URL {
    const url = new URL(fileUrl.replace('/pluginfile.php/', '/webservice/pluginfile.php/'));
    if (url.origin !== new URL(this.baseUrl).origin)
      throw new Error('Descarga fuera del dominio del campus bloqueada');
    url.searchParams.set('token', this.token);
    return url;
  }

  /** Descarga un fichero de pluginfile.php añadiendo el token (no se registra la URL con token). */
  async download(fileUrl: string): Promise<Buffer> {
    const url = new URL(fileUrl.replace('/pluginfile.php/', '/webservice/pluginfile.php/'));
    if (url.origin !== new URL(this.baseUrl).origin)
      throw new Error('Descarga fuera del dominio del campus bloqueada');
    url.searchParams.set('token', this.token);
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Descarga fallida (HTTP ${res.status})`);
    const type = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (type.includes('application/json') && buf.length < 2000 && buf.toString().includes('"errorcode"'))
      throw new Error(`Moodle rechazó la descarga: ${buf.toString().slice(0, 200)}`);
    return buf;
  }
}

export class MoodleError extends Error {
  constructor(
    readonly fn: string,
    readonly code: string,
    message: string,
  ) {
    super(`${fn}: ${code} — ${message}`);
    this.name = 'MoodleError';
  }
}

/** Convierte {courseids:[1,2]} en courseids[0]=1&courseids[1]=2 (formato que espera Moodle). */
export function flatten(obj: unknown, prefix = ''): [string, string][] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object') return [[prefix, typeof obj === 'boolean' ? (obj ? '1' : '0') : String(obj)]];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...flatten(v, prefix ? `${prefix}[${k}]` : k));
  }
  return out;
}
