import type { AppConfig } from '../../config';
import type { SecretStore } from '../../security/secretStore';
import { classifyDocument, mimeFromName } from '../classify';
import type {
  ProgressFn,
  RemoteFile,
  RemoteMessage,
  RemoteRecording,
  RemoteSubject,
  RemoteTask,
  RemoteUnit,
  SourceAdapter,
  SourceInventory,
} from '../types';
import { SourceAuthError } from '../types';
import { isMediaFile } from '../../transcription/media';
import { obtainTokenInteractive } from './moodleAuth';
import {
  downloadPublicMedia,
  ltiVideoPlatform,
  parseBbbRecordings,
  videoHost,
  VIDEO_MODULES,
} from './recordings';
import { MoodleClient, MoodleError } from './moodleClient';
import type * as M from './moodleTypes';

const iso = (ts?: number | null) => (ts ? new Date(ts * 1000).toISOString() : null);

export interface MoodleAdapterOptions {
  id: string;
  displayName: string;
  baseUrl: string;
  browserChannel: 'msedge' | 'chrome' | 'chromium';
  includePrivateMessages: boolean;
}

/**
 * Adaptador genérico para cualquier Moodle con el servicio web móvil habilitado.
 * Usa exclusivamente la API oficial (REST) en modo lectura; no hace scraping de HTML.
 */
export class MoodleAdapter implements SourceAdapter {
  readonly kind = 'moodle';
  readonly readOnly = true as const;
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  private client: MoodleClient | null = null;
  private siteInfo: M.SiteInfo | null = null;

  constructor(
    private readonly opts: MoodleAdapterOptions,
    private readonly secrets: SecretStore,
  ) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.baseUrl = opts.baseUrl;
  }

  private get secretName() {
    return `${this.id}-token`;
  }

  private async getClient(): Promise<MoodleClient> {
    if (this.client) return this.client;
    const token = await this.secrets.get(this.secretName);
    if (!token) throw new SourceAuthError();
    this.client = new MoodleClient(this.baseUrl, token);
    return this.client;
  }

  async isAuthenticated(): Promise<boolean> {
    return this.secrets.has(this.secretName);
  }

  async accountName(): Promise<string | null> {
    try {
      return (await this.site()).fullname;
    } catch {
      return null;
    }
  }

  private async site(): Promise<M.SiteInfo> {
    if (this.siteInfo) return this.siteInfo;
    this.siteInfo = await (await this.getClient()).call<M.SiteInfo>('core_webservice_get_site_info');
    return this.siteInfo;
  }

  async login(onProgress?: ProgressFn): Promise<void> {
    const { token } = await obtainTokenInteractive({
      baseUrl: this.baseUrl,
      channel: this.opts.browserChannel,
      onProgress,
    });
    // Validamos el token antes de guardarlo.
    const probe = new MoodleClient(this.baseUrl, token);
    const info = await probe.call<M.SiteInfo>('core_webservice_get_site_info');
    await this.secrets.set(this.secretName, token);
    this.client = probe;
    this.siteInfo = info;
    onProgress?.(`Conectado como ${info.fullname} (${info.sitename}, Moodle ${info.release}).`);
  }

  async logout(): Promise<void> {
    await this.secrets.remove(this.secretName);
    this.client = null;
    this.siteInfo = null;
  }

  /** Descarga en streaming: vídeos de Moodle con token, o medios de BBB en el host de reproducción indicado por Moodle. */
  async downloadRecording(
    rec: RemoteRecording,
    destPath: string,
    onProgress?: ProgressFn,
  ): Promise<{ mime: string | null }> {
    const client = await this.getClient();
    if (!rec.mediaRef) throw new Error('Grabación sin referencia de medio');
    if (rec.mediaRef.startsWith('[')) {
      const candidates = JSON.parse(rec.mediaRef) as string[];
      for (const url of candidates) {
        const r = await downloadPublicMedia(url, destPath, onProgress).catch((e: Error) => e);
        if (!(r instanceof Error)) return r;
      }
      throw new Error('El servidor de grabaciones no permite descargar el medio (puede estar protegido).');
    }
    return client.downloadToFile(rec.mediaRef, destPath, onProgress);
  }

  async download(file: RemoteFile): Promise<Buffer> {
    if (file.inlineContent !== undefined) return Buffer.from(file.inlineContent, 'utf8');
    return (await this.getClient()).download(file.downloadRef);
  }

  async inventory(onProgress: ProgressFn = () => {}): Promise<SourceInventory> {
    const client = await this.getClient();
    const site = await this.site();
    const available = new Set((site.functions ?? []).map((f) => f.name));
    const can = (fn: string) => available.size === 0 || available.has(fn);

    const inv: SourceInventory = {
      sourceId: this.id,
      account: site.fullname,
      generatedAt: new Date().toISOString(),
      platform: {
        sitename: site.sitename,
        release: site.release,
        version: site.version,
        functions: available.size,
      },
      subjects: [],
      units: [],
      files: [],
      tasks: [],
      messages: [],
      recordings: [],
      skipped: [],
      warnings: [],
    };

    onProgress('Obteniendo asignaturas matriculadas…');
    const courses = (
      await client.call<M.Course[]>('core_enrol_get_users_courses', { userid: site.userid })
    ).filter((c) => c.visible !== 0);
    const courseIds = courses.map((c) => c.id);

    // Profesorado: solo los "contactos del curso" públicos (nombre), sin más datos personales.
    const contacts = new Map<number, string[]>();
    if (courseIds.length && can('core_course_get_courses_by_field')) {
      try {
        const r = await client.call<{ courses: M.CourseDetail[] }>('core_course_get_courses_by_field', {
          field: 'ids',
          value: courseIds.join(','),
        });
        for (const c of r.courses)
          contacts.set(
            c.id,
            (c.contacts ?? []).map((x) => x.fullname),
          );
      } catch (e) {
        inv.warnings.push(`Profesorado no disponible: ${(e as Error).message}`);
      }
    }

    const cmToUnit = new Map<number, string>(); // cmid → unidad
    const bbb: {
      instance: number;
      cmid: number;
      course: number;
      unitId: string;
      name: string;
      url: string;
    }[] = [];
    for (const course of courses) {
      const subjectId = String(course.id);
      const subject: RemoteSubject = {
        externalId: subjectId,
        name: course.fullname,
        shortName: course.shortname,
        url: `${this.baseUrl}/course/view.php?id=${course.id}`,
        teachers: contacts.get(course.id) ?? [],
      };
      inv.subjects.push(subject);
      onProgress(`Analizando contenido de «${course.fullname}»…`);

      let sections: M.Section[];
      try {
        sections = await client.call<M.Section[]>('core_course_get_contents', { courseid: course.id });
      } catch (e) {
        inv.warnings.push(`No se pudo leer ${course.fullname}: ${(e as Error).message}`);
        continue;
      }

      for (const section of sections) {
        if (section.uservisible === false) continue;
        const unitId = `${course.id}:${section.id}`;
        const unitName =
          cleanName(section.name) || (section.section === 0 ? 'General' : `Sección ${section.section}`);
        if (section.modules.length === 0) continue;
        inv.units.push({
          externalId: unitId,
          subjectExternalId: subjectId,
          name: unitName,
          position: section.section,
          url: `${this.baseUrl}/course/section.php?id=${section.id}`,
        } satisfies RemoteUnit);

        for (const mod of section.modules) {
          cmToUnit.set(mod.id, unitId);
          if (mod.uservisible === false) continue;
          const modUrl = mod.url ?? `${this.baseUrl}/mod/${mod.modname}/view.php?id=${mod.id}`;
          switch (mod.modname) {
            case 'resource':
            case 'folder': {
              const files = (mod.contents ?? []).filter((c) => c.type === 'file');
              for (const f of files) {
                // Vídeos/audios subidos como recurso: son grabaciones descargables con tu sesión → videoclases
                if (isMediaFile(f.filename) || /^(video|audio)\//.test(f.mimetype ?? '')) {
                  inv.recordings!.push({
                    externalId: `media:${mod.id}:${f.filepath ?? '/'}${f.filename}`,
                    subjectExternalId: subjectId,
                    unitExternalId: unitId,
                    title: files.length === 1 ? cleanName(mod.name) : stripExt(f.filename),
                    recordedAt: iso(f.timemodified),
                    durationSec: null,
                    teacher: contacts.get(course.id)?.[0] ?? null,
                    platform: 'moodle-video',
                    url: modUrl,
                    version: `${f.timemodified ?? 0}:${f.filesize ?? 0}`,
                    media: 'download',
                    mediaRef: f.fileurl,
                    mediaMime: f.mimetype ?? null,
                  });
                  continue;
                }
                const title =
                  mod.modname === 'resource' && files.length === 1
                    ? cleanName(mod.name)
                    : stripExt(f.filename);
                inv.files.push({
                  externalId: `file:${mod.id}:${f.filepath ?? '/'}${f.filename}`,
                  subjectExternalId: subjectId,
                  unitExternalId: unitId,
                  title,
                  filename: f.filename,
                  mime: f.mimetype ?? mimeFromName(f.filename),
                  url: modUrl,
                  downloadRef: f.fileurl,
                  version: `${f.timemodified ?? 0}:${f.filesize ?? 0}`,
                  modifiedAt: iso(f.timemodified),
                  size: f.filesize ?? null,
                  kindHint: classifyDocument(title, f.filename),
                });
              }
              break;
            }
            case 'page': {
              const index = (mod.contents ?? []).find(
                (c) => c.type === 'file' && c.filename === 'index.html',
              );
              if (index) {
                inv.files.push({
                  externalId: `page:${mod.id}`,
                  subjectExternalId: subjectId,
                  unitExternalId: unitId,
                  title: cleanName(mod.name),
                  filename: `${cleanName(mod.name)}.html`,
                  mime: 'text/html',
                  url: modUrl,
                  downloadRef: index.fileurl,
                  version: `${index.timemodified ?? 0}:${index.filesize ?? 0}`,
                  modifiedAt: iso(index.timemodified),
                  size: index.filesize ?? null,
                  kindHint: classifyDocument(mod.name),
                });
              }
              break;
            }
            case 'assign':
            case 'forum':
              break; // se tratan abajo con sus APIs específicas
            case 'label':
              break;
            case 'bigbluebuttonbn':
              if (mod.instance)
                bbb.push({
                  instance: mod.instance,
                  cmid: mod.id,
                  course: course.id,
                  unitId,
                  name: cleanName(mod.name),
                  url: modUrl,
                });
              break;
            default: {
              const link = mod.contents?.[0]?.fileurl ?? '';
              const platform =
                VIDEO_MODULES[mod.modname] ??
                (mod.modname === 'url'
                  ? videoHost(link)
                  : mod.modname === 'lti'
                    ? ltiVideoPlatform(mod.name)
                    : null);
              if (platform) {
                // Videoconferencia detectada pero sin medio accesible por API: se registra con el motivo (no se fuerza nada).
                inv.recordings!.push({
                  externalId: `vc:${mod.id}`,
                  subjectExternalId: subjectId,
                  unitExternalId: unitId,
                  title: cleanName(mod.name),
                  recordedAt: null,
                  durationSec: null,
                  teacher: contacts.get(course.id)?.[0] ?? null,
                  platform,
                  url: mod.modname === 'url' && link ? link : modUrl,
                  version: 'v1',
                  media: 'none',
                  unavailableReason: `Grabación en ${platform}: StudyVault no descarga contenido de plataformas externas sin una vía autorizada. Puedes subir el fichero manualmente si tienes permiso de descarga.`,
                });
                break;
              }
              inv.skipped.push({
                subjectExternalId: subjectId,
                type: mod.modname,
                name: cleanName(mod.name),
                reason:
                  mod.modname === 'url'
                    ? `Enlace externo: ${mod.contents?.[0]?.fileurl ?? modUrl}`
                    : 'Tipo no importado',
              });
            }
          }
        }
      }
    }

    // ── Grabaciones de BigBlueButton (API oficial de solo lectura) ──
    if (bbb.length && can('mod_bigbluebuttonbn_get_recordings')) {
      onProgress('Buscando grabaciones de videoconferencias (BigBlueButton)…');
      for (const b of bbb) {
        try {
          const r = await client.call<{ tabledata?: { data?: string } }>(
            'mod_bigbluebuttonbn_get_recordings',
            { bigbluebuttonbnid: b.instance },
          );
          for (const rec of parseBbbRecordings(r.tabledata?.data)) {
            inv.recordings!.push({
              externalId: `bbb:${rec.recordId}`,
              subjectExternalId: String(b.course),
              unitExternalId: b.unitId,
              title: rec.name || b.name,
              recordedAt: rec.date,
              durationSec: rec.durationSec,
              teacher: contacts.get(b.course)?.[0] ?? null,
              platform: 'bigbluebutton',
              url: rec.playbackUrl ?? b.url,
              version: `${rec.recordId}:${rec.durationSec ?? 0}`,
              media: rec.mediaCandidates.length ? 'download' : 'none',
              mediaRef: rec.mediaCandidates.length ? JSON.stringify(rec.mediaCandidates) : null,
              unavailableReason: rec.mediaCandidates.length
                ? null
                : 'No se pudo localizar el fichero de la grabación desde la API.',
            });
          }
        } catch (e) {
          inv.warnings.push(`Grabaciones de «${b.name}» no disponibles: ${(e as Error).message}`);
        }
      }
    } else if (bbb.length) {
      inv.warnings.push(
        'Hay videoconferencias BigBlueButton pero la API de grabaciones no está habilitada para la app.',
      );
    }

    // ── Tareas (mod_assign) ──
    if (courseIds.length && can('mod_assign_get_assignments')) {
      onProgress('Obteniendo tareas y fechas de entrega…');
      try {
        const r = await client.call<{ courses: { id: number; assignments: M.Assignment[] }[] }>(
          'mod_assign_get_assignments',
          {
            courseids: courseIds,
          },
        );
        for (const c of r.courses) {
          for (const a of c.assignments) {
            const unitId = cmToUnit.get(a.cmid) ?? null;
            const attachmentIds: string[] = [];
            for (const f of a.introattachments ?? []) {
              const fid = `assignfile:${a.id}:${f.filename}`;
              attachmentIds.push(fid);
              inv.files.push({
                externalId: fid,
                subjectExternalId: String(c.id),
                unitExternalId: unitId,
                title: stripExt(f.filename),
                filename: f.filename,
                mime: f.mimetype ?? mimeFromName(f.filename),
                url: `${this.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
                downloadRef: f.fileurl,
                version: `${f.timemodified ?? 0}:${f.filesize ?? 0}`,
                modifiedAt: iso(f.timemodified),
                size: f.filesize ?? null,
                kindHint: 'task',
                taskExternalId: String(a.id),
              });
            }
            inv.tasks.push({
              externalId: String(a.id),
              subjectExternalId: String(c.id),
              unitExternalId: unitId,
              title: cleanName(a.name),
              instructionsHtml: a.intro ?? null,
              openedAt: iso(a.allowsubmissionsfromdate),
              dueAt: iso(a.duedate),
              cutoffAt: iso(a.cutoffdate),
              url: `${this.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
              version: `${a.timemodified ?? 0}:${a.duedate ?? 0}:${a.cutoffdate ?? 0}`,
              attachmentFileIds: attachmentIds,
            } satisfies RemoteTask);
          }
        }
      } catch (e) {
        inv.warnings.push(`Tareas no disponibles: ${(e as Error).message}`);
      }
    }

    // ── Avisos y foros: solo publicaciones del profesorado / foro de avisos ──
    if (courseIds.length && can('mod_forum_get_forums_by_courses')) {
      onProgress('Obteniendo avisos y comunicaciones del profesorado…');
      try {
        const forums = await client.call<M.Forum[]>('mod_forum_get_forums_by_courses', {
          courseids: courseIds,
        });
        for (const forum of forums) {
          const teachers = new Set(contacts.get(forum.course) ?? []);
          const isNews = forum.type === 'news';
          let discussions: M.Discussion[] = [];
          try {
            const r = await client.call<{ discussions: M.Discussion[] }>('mod_forum_get_forum_discussions', {
              forumid: forum.id,
              sortorder: 1, // más recientes primero
              page: 0,
              perpage: 50,
            });
            discussions = r.discussions;
          } catch (e) {
            if (!(e instanceof MoodleError)) throw e;
            inv.warnings.push(`Foro «${forum.name}» no accesible (${e.code})`);
            continue;
          }
          for (const d of discussions) {
            // Minimización de datos: en foros generales solo importamos lo publicado por el profesorado.
            if (!isNews && !teachers.has(d.userfullname)) continue;
            const attachments: RemoteMessage['attachments'] = [];
            for (const f of d.attachments ?? []) {
              const fid = `forumfile:${d.id}:${f.filename}`;
              attachments.push({
                name: f.filename,
                url: `${this.baseUrl}/mod/forum/discuss.php?d=${d.discussion}`,
                fileExternalId: fid,
              });
              inv.files.push({
                externalId: fid,
                subjectExternalId: String(forum.course),
                unitExternalId: null,
                title: stripExt(f.filename),
                filename: f.filename,
                mime: f.mimetype ?? mimeFromName(f.filename),
                url: `${this.baseUrl}/mod/forum/discuss.php?d=${d.discussion}`,
                downloadRef: f.fileurl,
                version: `${f.timemodified ?? 0}:${f.filesize ?? 0}`,
                modifiedAt: iso(f.timemodified),
                size: f.filesize ?? null,
                kindHint: classifyDocument(f.filename),
              });
            }
            inv.messages.push({
              externalId: `forum:${d.discussion}`,
              subjectExternalId: String(forum.course),
              kind: isNews ? 'announcement' : 'forum',
              author: d.userfullname ?? null,
              title: cleanName(d.subject || d.name),
              bodyHtml: d.message ?? '',
              postedAt: iso(d.created),
              url: `${this.baseUrl}/mod/forum/discuss.php?d=${d.discussion}`,
              version: String(d.modified ?? d.timemodified ?? d.created),
              attachments,
            });
          }
        }
      } catch (e) {
        inv.warnings.push(`Foros no disponibles: ${(e as Error).message}`);
      }
    }

    if (!this.opts.includePrivateMessages) {
      inv.warnings.push(
        'Mensajes privados desactivados por defecto (MOODLE_INCLUDE_PRIVATE_MESSAGES=false).',
      );
    }

    onProgress(
      `Inventario: ${inv.subjects.length} asignaturas, ${inv.files.length} ficheros, ${inv.tasks.length} tareas, ${inv.messages.length} avisos.`,
    );
    return inv;
  }
}

function cleanName(s: string | undefined | null): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripExt = (f: string) => f.replace(/\.[a-z0-9]{1,5}$/i, '');

/** Adaptador de la instancia Moodle configurada (MOODLE_BASE_URL). Id de fuente estable: «moodle». */
export function createMoodleAdapter(cfg: AppConfig['moodle'], secrets: SecretStore): MoodleAdapter {
  return new MoodleAdapter(
    {
      id: 'moodle',
      displayName: 'Campus Moodle',
      baseUrl: cfg.baseUrl,
      browserChannel: cfg.browserChannel,
      includePrivateMessages: cfg.includePrivateMessages,
    },
    secrets,
  );
}
