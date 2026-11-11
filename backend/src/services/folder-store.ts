import fs from 'node:fs';
import path from 'node:path';
import type { Folder } from '../domain/types.js';
import { sanitizeId } from '../../../shared/ids.js';
import { writeJsonAtomic } from '../infra/fs-atomic.js';

/**
 * FS-backed folder store.
 * Layout:
 *   data/folders/<uuid>/<uuid>.json   — folder record
 */
export class FolderStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list(): Folder[] {
    const folders: Folder[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const f = this.get(ent.name);
      if (f) folders.push(f);
    }
    return folders.sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Folder | null {
    try {
      const raw = fs.readFileSync(this.jsonFor(id), 'utf8');
      return JSON.parse(raw) as Folder;
    } catch {
      return null;
    }
  }

  create(id: string, name: string): Folder {
    const now = Date.now();
    const folder: Folder = { id, name, createdAt: now, updatedAt: now };
    fs.mkdirSync(this.dirFor(id), { recursive: true });
    this.persist(folder);
    return folder;
  }

  patchName(id: string, name: string): Folder | null {
    const prev = this.get(id);
    if (!prev) return null;
    prev.name = name;
    prev.updatedAt = Date.now();
    this.persist(prev);
    return prev;
  }

  delete(id: string): boolean {
    const folderDir = this.dirFor(id);
    if (!fs.existsSync(folderDir)) return false;
    fs.rmSync(folderDir, { recursive: true, force: true });
    return true;
  }

  revealPath(id: string): string | null {
    const p = this.jsonFor(id);
    return fs.existsSync(p) ? p : null;
  }

  private dirFor(id: string): string {
    return path.join(this.dir, sanitizeId(id));
  }

  private jsonFor(id: string): string {
    return path.join(this.dirFor(id), `${sanitizeId(id)}.json`);
  }

  private persist(folder: Folder): void {
    writeJsonAtomic(this.jsonFor(folder.id), folder);
  }
}
