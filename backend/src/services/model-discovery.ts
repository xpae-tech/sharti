import fs from 'node:fs';
import path from 'node:path';
import type { DiscoveredModel } from '../domain/types.js';

export function discoverInstalledModels(modelsRoot: string): DiscoveredModel[] {
  const found = new Map<string, DiscoveredModel>();

  if (!modelsRoot) return [];

  let owners: string[] = [];
  try { owners = fs.readdirSync(modelsRoot); } catch { return []; }

  for (const owner of owners) {
    if (owner.startsWith('.')) continue;
    const ownerPath = path.join(modelsRoot, owner);
    let links: string[] = [];
    try { links = fs.readdirSync(ownerPath); } catch { continue; }

    for (const link of links) {
      const mj = path.join(ownerPath, link, 'model.json');
      if (!fs.existsSync(mj)) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(mj, 'utf8'));
        const id = rec.model || `${owner}/${link}`;
        if (!found.has(id)) {
          const uniqueFiles = new Map<string, number>();
          for (const f of Object.values(rec.files ?? {}) as Array<{ path: string; bytes?: number }>) {
            uniqueFiles.set(f.path, f.bytes ?? 0);
          }
          let bytes = 0;
          for (const b of uniqueFiles.values()) bytes += b;
          found.set(id, { id, source: 'splash-installed', bytes, path: path.join(ownerPath, link) });
        }
      } catch { /* corrupt model.json */ }
    }
  }

  return Array.from(found.values());
}


