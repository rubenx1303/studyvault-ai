import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Localiza ffmpeg: FFMPEG_PATH → data/tools/ffmpeg → PATH. */
export function ffmpegCandidates(configured: string | undefined, toolsDir: string): string[] {
  return [configured, `${toolsDir}/ffmpeg/bin/ffmpeg.exe`, ...wingetFfmpeg(), 'ffmpeg'].filter(
    (x): x is string => !!x,
  );
}

/** ffmpeg instalado con winget (el PATH del proceso no se actualiza hasta reiniciar la terminal). */
function wingetFfmpeg(): string[] {
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  try {
    return fs
      .readdirSync(base)
      .filter((d) => d.startsWith('Gyan.FFmpeg'))
      .flatMap((d) =>
        fs.readdirSync(path.join(base, d)).map((v) => path.join(base, d, v, 'bin', 'ffmpeg.exe')),
      );
  } catch {
    return [];
  }
}

export async function findFfmpeg(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (!fs.existsSync(c)) continue;
    }
    const ok = await new Promise<boolean>((resolve) =>
      execFile(c, ['-version'], { windowsHide: true, timeout: 10_000 }, (err) => resolve(!err)),
    );
    if (ok) return c;
  }
  return null;
}

/**
 * Extrae la pista de audio a WAV mono 16 kHz (formato que esperan los modelos ASR).
 * No re-codifica vídeo ni elimina protecciones: solo lee un fichero que ya tienes legítimamente.
 */
export function extractAudio(
  ffmpeg: string,
  input: string,
  output: string,
  onProgress?: (pct: number) => void,
  totalSec?: number | null,
): Promise<{ durationSec: number | null }> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      ffmpeg,
      ['-hide_banner', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output],
      {
        windowsHide: true,
      },
    );
    let duration = totalSec ?? null;
    let stderr = '';
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr = (stderr + s).slice(-4000);
      const dur = s.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (dur && !duration) duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
      const t = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (t && duration)
        onProgress?.(
          Math.min(99, ((Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])) / duration) * 100),
        );
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve({ durationSec: duration })
        : reject(new Error(`ffmpeg terminó con código ${code}: ${stderr.split('\n').slice(-3).join(' ')}`)),
    );
  });
}

export const isMediaFile = (filename: string) =>
  /\.(mp4|m4v|mkv|webm|mov|avi|mp3|m4a|wav|ogg|opus|flac|aac|wma)$/i.test(filename);
