import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../config';
import {
  labelSpeakers,
  TranscriptionUnavailableError,
  type TranscribeOptions,
  type Transcript,
  type TranscriptionProvider,
} from './types';

export function createTranscriptionProvider(cfg: AppConfig): TranscriptionProvider {
  const t = cfg.transcription;
  switch (t.provider) {
    case 'azure':
      return new AzureTranscriptionProvider(t.azureEndpoint, t.azureKey, t.azureLocale);
    case 'openai-compatible':
      return new OpenAICompatibleTranscriptionProvider(
        t.baseUrl ?? 'http://127.0.0.1:8000/v1',
        t.model ?? 'whisper-1',
        t.apiKey,
      );
    case 'none':
      return new NoTranscriptionProvider();
    default:
      return new LocalTranscriptionProvider(t.whisperBin, t.whisperModel, t.vadModel);
  }
}

class NoTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'none';
  readonly model = null;
  async check() {
    return { ok: false, reason: 'Transcripción desactivada (TRANSCRIPTION_PROVIDER=none).' };
  }
  async transcribe(): Promise<Transcript> {
    throw new TranscriptionUnavailableError('Transcripción desactivada.');
  }
}

/**
 * Motor local: whisper.cpp (binario oficial con CUDA) + modelo Whisper large-v3-turbo + VAD Silero.
 * El VAD descarta silencios antes de transcribir, que es donde Whisper tiende a "alucinar" texto.
 */
export class LocalTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'local-whisper.cpp';
  readonly model: string;

  constructor(
    private readonly bin: string,
    private readonly modelPath: string,
    private readonly vadModel: string,
  ) {
    this.model = path.basename(modelPath).replace(/^ggml-|\.bin$/g, '');
  }

  async check() {
    if (!fs.existsSync(this.bin))
      return {
        ok: false,
        reason: `No se encuentra whisper.cpp (${this.bin}). Ejecuta: npm run setup:transcription`,
      };
    if (!fs.existsSync(this.modelPath))
      return {
        ok: false,
        reason: `Falta el modelo (${path.basename(this.modelPath)}). Ejecuta: npm run setup:transcription`,
      };
    return { ok: true, reason: null };
  }

  async transcribe(wavPath: string, opts: TranscribeOptions = {}): Promise<Transcript> {
    const status = await this.check();
    if (!status.ok) throw new TranscriptionUnavailableError(status.reason!);
    const outBase = path.join(os.tmpdir(), `sv-whisper-${process.pid}-${Date.now()}`);
    const args = [
      '-m',
      this.modelPath,
      '-f',
      wavPath,
      '-l',
      opts.language ?? 'es',
      '-oj',
      '-of',
      outBase,
      '-pp',
      // Segmentos de ≤160 caracteres cortando por palabra: marcas temporales más finas para saltar al minuto exacto.
      '-ml',
      '160',
      '-sow',
      '-t',
      String(Math.max(2, Math.min(8, os.cpus().length - 2))),
    ];
    if (fs.existsSync(this.vadModel)) args.push('--vad', '-vm', this.vadModel);
    if (opts.prompt) args.push('--prompt', opts.prompt.slice(0, 600));

    await new Promise<void>((resolve, reject) => {
      // Caché JIT de CUDA grande: el binario no trae código nativo para Blackwell (sm_120) y el driver lo compila
      // la primera vez (~2 min); con la caché persistente las siguientes ejecuciones arrancan en segundos.
      const env = { ...process.env, CUDA_CACHE_MAXSIZE: process.env.CUDA_CACHE_MAXSIZE ?? '4294967296' };
      const p = spawn(this.bin, args, { windowsHide: true, cwd: path.dirname(this.bin), env });
      let tail = '';
      const onData = (d: Buffer) => {
        const s = d.toString();
        tail = (tail + s).slice(-3000);
        const m = s.match(/progress\s*=\s*(\d+)%/);
        if (m) opts.onProgress?.(Number(m[1]));
      };
      p.stdout.on('data', onData);
      p.stderr.on('data', onData);
      p.on('error', reject);
      p.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(`whisper.cpp terminó con código ${code}: ${tail.split('\n').slice(-4).join(' ')}`),
            ),
      );
    });

    try {
      const raw = JSON.parse(await fsp.readFile(`${outBase}.json`, 'utf8')) as {
        result?: { language?: string };
        transcription: { offsets: { from: number; to: number }; text: string }[];
      };
      const segments = raw.transcription
        .map((s) => ({
          start: s.offsets.from / 1000,
          end: s.offsets.to / 1000,
          text: s.text.trim(),
          speaker: null,
        }))
        .filter((s) => s.text && !/^\[.*\]$/.test(s.text)); // descarta marcas como [Música]
      return {
        language: raw.result?.language ?? opts.language ?? 'es',
        durationSec: segments.at(-1)?.end ?? null,
        segments,
        engine: `${this.id}:${this.model}`,
      };
    } finally {
      await fsp.rm(`${outBase}.json`, { force: true });
    }
  }
}

/**
 * Azure AI Speech — "fast transcription" (síncrona, con diarización). SERVICIO DE PAGO:
 * solo se activa si configuras TRANSCRIPTION_PROVIDER=azure con endpoint y clave (con autorización previa).
 */
export class AzureTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'azure-speech';
  readonly model = 'fast-transcription';

  constructor(
    private readonly endpoint: string | undefined,
    private readonly key: string | undefined,
    private readonly locale: string,
  ) {}

  async check() {
    return this.endpoint && this.key
      ? { ok: true, reason: null }
      : { ok: false, reason: 'Azure Speech no configurado (AZURE_SPEECH_ENDPOINT / AZURE_SPEECH_KEY).' };
  }

  async transcribe(wavPath: string, opts: TranscribeOptions = {}): Promise<Transcript> {
    const status = await this.check();
    if (!status.ok) throw new TranscriptionUnavailableError(status.reason!);
    const form = new FormData();
    form.append(
      'audio',
      new Blob([await fsp.readFile(wavPath)], { type: 'audio/wav' }),
      path.basename(wavPath),
    );
    form.append(
      'definition',
      JSON.stringify({ locales: [this.locale], diarization: { enabled: true, maxSpeakers: 6 } }),
    );
    opts.onProgress?.(10, 'Enviando audio a Azure AI Speech…');
    const res = await fetch(
      `${this.endpoint!.replace(/\/$/, '')}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': this.key! },
        body: form,
        signal: AbortSignal.timeout(30 * 60_000),
      },
    );
    if (!res.ok) throw new Error(`Azure Speech HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      durationMilliseconds?: number;
      phrases: { offsetMilliseconds: number; durationMilliseconds: number; text: string; speaker?: number }[];
    };
    const segments = labelSpeakers(
      data.phrases.map((p) => ({
        start: p.offsetMilliseconds / 1000,
        end: (p.offsetMilliseconds + p.durationMilliseconds) / 1000,
        text: p.text,
        rawSpeaker: p.speaker ?? null,
      })),
    );
    return {
      language: this.locale,
      durationSec: data.durationMilliseconds
        ? data.durationMilliseconds / 1000
        : (segments.at(-1)?.end ?? null),
      segments,
      engine: `${this.id}:${this.model}`,
    };
  }
}

/** Cualquier API compatible con OpenAI /audio/transcriptions (p. ej. un servidor faster-whisper local). */
export class OpenAICompatibleTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'openai-compatible';

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey?: string,
  ) {}

  async check() {
    return { ok: true, reason: null };
  }

  async transcribe(wavPath: string, opts: TranscribeOptions = {}): Promise<Transcript> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([await fsp.readFile(wavPath)], { type: 'audio/wav' }),
      path.basename(wavPath),
    );
    form.append('model', this.model);
    form.append('language', opts.language ?? 'es');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (opts.prompt) form.append('prompt', opts.prompt.slice(0, 600));
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(60 * 60_000),
    });
    if (!res.ok) throw new Error(`Transcripción HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      language?: string;
      duration?: number;
      segments?: { start: number; end: number; text: string }[];
    };
    const segments = (data.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      speaker: null,
    }));
    return {
      language: data.language ?? 'es',
      durationSec: data.duration ?? null,
      segments,
      engine: `${this.id}:${this.model}`,
    };
  }
}
