import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyDocument, mimeFromName } from '../classify';
import type { RemoteFile, RemoteUnit, SourceAdapter, SourceInventory } from '../types';

/**
 * Fuente "carpeta local": <raíz>/<Asignatura>/<Unidad>/<fichero>.
 * Demuestra que el núcleo no depende de Moodle: cualquier fuente que produzca un inventario sirve.
 */
export class LocalFolderAdapter implements SourceAdapter {
  readonly kind = 'local-folder';
  readonly readOnly = true as const;
  readonly baseUrl = null;

  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly root: string,
  ) {}

  async isAuthenticated() {
    return true;
  }

  async accountName() {
    return null;
  }

  async download(file: RemoteFile): Promise<Buffer> {
    const full = path.resolve(this.root, file.downloadRef);
    if (!full.startsWith(path.resolve(this.root))) throw new Error('Ruta fuera de la carpeta de origen');
    return fs.readFile(full);
  }

  async inventory(): Promise<SourceInventory> {
    const inv: SourceInventory = {
      sourceId: this.id,
      account: null,
      generatedAt: new Date().toISOString(),
      subjects: [],
      units: [],
      files: [],
      tasks: [],
      messages: [],
      skipped: [],
      warnings: [],
    };
    const subjects = await dirs(this.root);
    for (const subject of subjects) {
      inv.subjects.push({ externalId: subject, name: subject, teachers: [] });
      const unitDirs = await dirs(path.join(this.root, subject));
      const groups: [string | null, string][] = [
        [null, subject],
        ...unitDirs.map((u) => [u, path.join(subject, u)] as [string, string]),
      ];
      for (const [unit, rel] of groups) {
        if (unit) {
          inv.units.push({
            externalId: `${subject}/${unit}`,
            subjectExternalId: subject,
            name: unit,
            position: Number(unit.match(/\d+/)?.[0] ?? 0),
          } satisfies RemoteUnit);
        }
        for (const entry of await fs.readdir(path.join(this.root, rel), { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const relFile = path.join(rel, entry.name);
          const st = await fs.stat(path.join(this.root, relFile));
          inv.files.push({
            externalId: relFile.replace(/\\/g, '/'),
            subjectExternalId: subject,
            unitExternalId: unit ? `${subject}/${unit}` : null,
            title: entry.name.replace(/\.[^.]+$/, ''),
            filename: entry.name,
            mime: mimeFromName(entry.name),
            url: null,
            downloadRef: relFile,
            version: `${Math.floor(st.mtimeMs)}:${st.size}`,
            modifiedAt: st.mtime.toISOString(),
            size: st.size,
            kindHint: classifyDocument(entry.name),
          });
        }
      }
    }
    return inv;
  }
}

async function dirs(p: string): Promise<string[]> {
  try {
    return (await fs.readdir(p, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
