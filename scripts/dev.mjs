// Arranca API y frontend juntos. `npm run dev` (personal) o `npm run dev:demo` (datos ficticios).
import { spawn } from 'node:child_process';

const demo = process.argv.includes('--demo');
const env = { ...process.env, ...(demo ? { STUDYVAULT_MODE: 'demo' } : {}) };
const procs = [
  ['api', ['run', 'dev', '-w', '@studyvault/api']],
  ['web', ['run', 'dev', '-w', '@studyvault/web']],
].map(([name, args]) => {
  const p = spawn(`npm ${args.join(' ')}`, { env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = name === 'api' ? '\x1b[35m[api]\x1b[0m ' : '\x1b[36m[web]\x1b[0m ';
  for (const s of [p.stdout, p.stderr])
    s.on('data', (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, prefix)));
  p.on('exit', (code) => {
    console.log(`${prefix}terminado (${code})`);
    procs.forEach((x) => x.kill());
    process.exit(code ?? 0);
  });
  return p;
});
console.log(`StudyVault ${demo ? 'DEMO' : 'personal'} → http://127.0.0.1:5173`);
process.on('SIGINT', () => procs.forEach((p) => p.kill()));
