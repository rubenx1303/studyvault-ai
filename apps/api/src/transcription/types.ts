import type { TranscriptSegment } from '@studyvault/shared';

export interface Transcript {
  language: string;
  durationSec: number | null;
  segments: TranscriptSegment[];
  engine: string; // proveedor:modelo, para trazabilidad
}

export interface TranscribeOptions {
  language?: string; // 'es' por defecto
  /** Vocabulario del dominio (asignatura, términos técnicos) para mejorar la precisión. */
  prompt?: string;
  onProgress?: (pct: number, message?: string) => void;
}

/**
 * Motor de transcripción intercambiable.
 *   LocalTranscriptionProvider  → whisper.cpp en tu GPU (gratis, offline)
 *   AzureTranscriptionProvider  → Azure AI Speech (de pago, solo con autorización explícita)
 *   OpenAICompatibleTranscriptionProvider → cualquier servidor /audio/transcriptions (local o remoto)
 */
export interface TranscriptionProvider {
  readonly id: string;
  readonly model: string | null;
  /** Comprueba si el motor está listo (binarios, modelo, credenciales) sin transcribir nada. */
  check(): Promise<{ ok: boolean; reason: string | null }>;
  /** Recibe un WAV mono 16 kHz y devuelve segmentos con marcas temporales. */
  transcribe(wavPath: string, opts?: TranscribeOptions): Promise<Transcript>;
}

export class TranscriptionUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TranscriptionUnavailableError';
  }
}

/**
 * Diarización: solo se etiqueta "Profesor" al hablante claramente dominante (≥60 % del tiempo).
 * El resto queda como "Hablante N": no se inventan identidades ni roles.
 */
export function labelSpeakers(
  segments: (TranscriptSegment & { rawSpeaker?: string | number | null })[],
): TranscriptSegment[] {
  const time = new Map<string, number>();
  for (const s of segments) {
    if (s.rawSpeaker == null) continue;
    const k = String(s.rawSpeaker);
    time.set(k, (time.get(k) ?? 0) + (s.end - s.start));
  }
  const total = [...time.values()].reduce((a, b) => a + b, 0);
  const [dominant, dominantTime] = [...time.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const names = new Map([...time.keys()].map((k, i) => [k, `Hablante ${i + 1}`]));
  return segments.map(({ rawSpeaker, ...s }) => ({
    ...s,
    speaker:
      rawSpeaker == null
        ? null
        : String(rawSpeaker) === dominant && total > 0 && dominantTime / total >= 0.6
          ? 'Profesor'
          : names.get(String(rawSpeaker))!,
  }));
}

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
