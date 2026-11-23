import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Almacén local de secretos (p. ej. el token de la API de Moodle).
 *
 * - En Windows cifra con DPAPI (ámbito CurrentUser): el fichero solo lo puede descifrar tu usuario de Windows
 *   en este equipo. Se invoca PowerShell pasando el secreto por stdin (nunca por argumentos ni logs).
 * - En otros SO guarda el fichero con permisos 0600 (aviso: sin cifrado).
 * - Los ficheros viven en data/secrets (excluido de Git) y se borran con remove().
 */
export class SecretStore {
  constructor(private readonly dir: string) {}

  private file(name: string) {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('Nombre de secreto inválido');
    return path.join(this.dir, `${name}.secret`);
  }

  async set(name: string, value: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const payload =
      process.platform === 'win32' ? `dpapi:${await dpapi('protect', value)}` : `plain:${value}`;
    await fs.writeFile(this.file(name), payload, { encoding: 'utf8', mode: 0o600 });
  }

  async get(name: string): Promise<string | null> {
    let payload: string;
    try {
      payload = (await fs.readFile(this.file(name), 'utf8')).trim();
    } catch {
      return null;
    }
    if (payload.startsWith('dpapi:')) return dpapi('unprotect', payload.slice(6));
    if (payload.startsWith('plain:')) return payload.slice(6);
    return null;
  }

  async has(name: string): Promise<boolean> {
    return fs.access(this.file(name)).then(
      () => true,
      () => false,
    );
  }

  async remove(name: string): Promise<void> {
    await fs.rm(this.file(name), { force: true });
  }
}

function dpapi(op: 'protect' | 'unprotect', input: string): Promise<string> {
  const script =
    op === 'protect'
      ? `Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))`
      : `Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($s); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))`;
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(new Error(`DPAPI ${op} falló`)) : resolve(stdout.trim())),
    );
    child.stdin?.end(input);
  });
}
