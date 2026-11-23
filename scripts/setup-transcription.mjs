// `npm run setup:transcription` — instala el motor de transcripción LOCAL (gratuito) en data/ (fuera de Git):
//   • whisper.cpp oficial (GitHub ggml-org) con CUDA para GPU NVIDIA
//   • modelo Whisper large-v3-turbo cuantizado q8_0 (Hugging Face ggerganov/whisper.cpp)
//   • modelo VAD Silero (descarta silencios → menos "alucinaciones")
// ffmpeg se instala aparte con winget (ver mensaje final).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME =
  process.env.STUDYVAULT_HOME ??
  (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'StudyVault') : path.join(ROOT, 'data'));
const TOOLS = path.join(HOME, 'tools');
const MODELS = path.join(HOME, 'models', 'whisper');
const MODEL = process.env.WHISPER_MODEL ?? 'ggml-large-v3-turbo-q8_0.bin';
const VAD = 'ggml-silero-v5.1.2.bin';

async function download(url, dest) {
  if (fs.existsSync(dest)) return console.log(`✓ Ya existe ${dest}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log(`↓ ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    done += c.length;
    if (total && Date.now() - last > 1000) {
      last = Date.now();
      process.stdout.write(`\r  ${((done / total) * 100).toFixed(0)}% de ${(total / 1e6).toFixed(0)} MB   `);
    }
  });
  await pipeline(body, fs.createWriteStream(`${dest}.part`));
  fs.renameSync(`${dest}.part`, dest);
  process.stdout.write('\n');
}

async function whisperCpp() {
  const bin = path.join(TOOLS, 'whisper.cpp', 'whisper-cli.exe');
  if (fs.existsSync(bin)) return console.log('✓ whisper.cpp ya instalado');
  const releases = await (
    await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10')
  ).json();
  const asset = releases
    .flatMap((r) => r.assets ?? [])
    .find((a) => /whisper-(bin-win-cuda|cublas)-12\.\d+\.\d+.*x64\.zip$/.test(a.name));
  if (!asset) throw new Error('No se encontró un binario oficial de whisper.cpp con CUDA para Windows x64');
  const zip = path.join(TOOLS, asset.name);
  await download(asset.browser_download_url, zip);
  const out = path.join(TOOLS, 'whisper.cpp');
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`],
    { stdio: 'inherit' },
  );
  // El zip puede traer una subcarpeta (Release/): aplanamos para tener whisper-cli.exe en la raíz.
  const found = findFile(out, 'whisper-cli.exe');
  if (!found) throw new Error('whisper-cli.exe no está en el paquete');
  if (path.dirname(found) !== out)
    for (const f of fs.readdirSync(path.dirname(found)))
      fs.renameSync(path.join(path.dirname(found), f), path.join(out, f));
  fs.rmSync(zip);
  console.log(`✓ whisper.cpp ${asset.name}`);
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    }
  }
  return null;
}

await whisperCpp();
await download(
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}`,
  path.join(MODELS, MODEL),
);
await download(`https://huggingface.co/ggml-org/whisper-vad/resolve/main/${VAD}`, path.join(MODELS, VAD));

let ffmpeg = false;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  ffmpeg = true;
} catch {
  /* no instalado */
}
console.log(
  `\nListo. ${ffmpeg ? '✓ ffmpeg disponible' : '⚠ Falta ffmpeg: instálalo con  winget install Gyan.FFmpeg  (y reinicia la terminal)'}`,
);
console.log(
  'Prueba rápida de GPU: data/tools/whisper.cpp/whisper-cli.exe -m data/models/whisper/' +
    MODEL +
    ' -f <audio.wav> -l es',
);
