import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ProgressFn } from '../types';

/** Módulos de Moodle que representan videoconferencias en plataformas externas. */
export const VIDEO_MODULES: Record<string, string> = {
  zoom: 'zoom',
  msteams: 'teams',
  teams: 'teams',
  webexactivity: 'webex',
  collaborate: 'collaborate',
  googlemeet: 'google-meet',
  jitsi: 'jitsi',
  onlinemeeting: 'teams',
};

/** Enlaces (mod_url) a grabaciones alojadas fuera del campus. */
export function videoHost(url: string): string | null {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/vimeo\.com/i.test(url)) return 'vimeo';
  if (/stream\.microsoft|sharepoint\.com\/.*(stream|\.mp4)|teams\.microsoft/i.test(url)) return 'teams';
  if (/zoom\.us\/rec/i.test(url)) return 'zoom';
  if (/\/playback\/presentation\//i.test(url)) return 'bigbluebutton';
  return null;
}

/**
 * Actividades LTI cuyo nombre indica una sala de videoconferencia («Videotutoría…», «Tutoría grupal…»,
 * «Clase en directo…»). La plataforma concreta no se conoce desde la API, así que se marca de forma genérica.
 */
export function ltiVideoPlatform(name: string): string | null {
  return /videotutor|tutor[ií]a|clase en directo|sesi[oó]n|webinar|directo/i.test(name)
    ? 'videoconferencia'
    : null;
}

export interface BbbRecording {
  recordId: string;
  name: string;
  date: string | null;
  durationSec: number | null;
  playbackUrl: string | null;
  mediaCandidates: string[];
}

/**
 * La respuesta de mod_bigbluebuttonbn_get_recordings trae las filas como JSON en un string,
 * con el reproductor en HTML. Extraemos el enlace de reproducción y, a partir de él,
 * las URLs del vídeo que el propio reproductor web de BBB carga (webcams.mp4/webm).
 */
export function parseBbbRecordings(data: string | undefined): BbbRecording[] {
  if (!data) return [];
  let rows: Record<string, unknown>[];
  try {
    rows = JSON.parse(data) as Record<string, unknown>[];
  } catch {
    return [];
  }
  const out: BbbRecording[] = [];
  for (const row of rows) {
    const html = Object.values(row)
      .filter((v) => typeof v === 'string')
      .join(' ');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decodeHtml(m[1]!));
    const nested = hrefs.flatMap((h) => {
      try {
        const inner = new URL(h).searchParams.get('href');
        return inner ? [inner] : [];
      } catch {
        return [];
      }
    });
    const playback =
      [...nested, ...hrefs].find((h) => /\/playback\/presentation\/|\/presentation\//.test(h)) ?? null;
    const recordId =
      playback?.match(/(?:meetingId=|presentation\/(?:2\.\d\/)?)([0-9a-f]{40}-\d{13})/i)?.[1] ??
      String(row.recordingid ?? row.recordid ?? '').trim();
    if (!recordId) continue;
    const host = playback ? new URL(playback).origin : null;
    const dateRaw = row.date ?? row.starttime;
    const date =
      typeof dateRaw === 'number' ? new Date(dateRaw > 1e12 ? dateRaw : dateRaw * 1000).toISOString() : null;
    const dur = Number(String(row.duration ?? '').match(/\d+/)?.[0]);
    out.push({
      recordId,
      name: stripTags(String(row.recording ?? row.name ?? '')),
      date,
      durationSec: Number.isFinite(dur) ? dur * 60 : null,
      playbackUrl: playback,
      mediaCandidates: host
        ? [
            `${host}/presentation/${recordId}/video/webcams.mp4`,
            `${host}/presentation/${recordId}/video/webcams.webm`,
          ]
        : [],
    });
  }
  return out;
}

/**
 * Descarga un medio público de reproducción (sin cookies ni credenciales). Si el servidor exige
 * autenticación o lo bloquea (401/403/404), se rinde: no se intenta eludir ninguna protección.
 */
export async function downloadPublicMedia(
  url: string,
  dest: string,
  onProgress?: ProgressFn,
): Promise<{ mime: string | null }> {
  if (!/^https:\/\//.test(url)) throw new Error('Solo se aceptan URLs https');
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6 * 3600_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const mime = res.headers.get('content-type');
  if (mime && !/^(video|audio)\/|octet-stream/.test(mime)) throw new Error(`Tipo inesperado: ${mime}`);
  await streamToFile(res, dest, onProgress);
  return { mime };
}

export async function streamToFile(res: Response, dest: string, onProgress?: ProgressFn) {
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  let lastPct = -1;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    done += chunk.length;
    const pct = total ? Math.floor((done / total) * 100) : -1;
    if (pct !== lastPct && pct >= 0) {
      lastPct = pct;
      onProgress?.(`Descargando ${pct}%`);
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const decodeHtml = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
