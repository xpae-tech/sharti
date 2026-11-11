import fs from 'node:fs';
import crypto from 'node:crypto';
import { createDefaultPrefs, type Prefs } from './types.js';
import { writeJsonAtomic } from '../infra/fs-atomic.js';

export class PreferenceStore {
  constructor(private readonly filePath: string) {}

  load(): Prefs {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return createDefaultPrefs();
      }
      const parsedObj = parsed as Record<string, unknown>;

      // Retired fields from older preference layouts. They have no consumer
      // in the current codebase; keep them from being written back forever.
      delete parsedObj.localModels;

      // Migration: convert legacy enabledMcpTools (["server:tool",...]) to
      // server-level enablement (["server",...]).
      if (!Array.isArray(parsedObj.enabledMcpServers) && Array.isArray(parsedObj.enabledMcpTools)) {
        const legacy = parsedObj.enabledMcpTools as string[];
        parsedObj.enabledMcpServers = [...new Set(legacy.map((tid) => tid.split(':')[0]))];
      }
      delete parsedObj.enabledMcpTools;

      const merged = { ...createDefaultPrefs(), ...parsedObj } as Prefs;
      // Unknown/corrupted theme values fall back to the default dark theme.
      merged.theme = parsedObj.theme === 'light' ? 'light' : 'dark';
      // Tuning is intentionally partial: unset fields fall back to defaults
      // via shared/tuning.ts (which may inherit server-level values).
      merged.tuning = parsedObj.tuning && typeof parsedObj.tuning === 'object' && !Array.isArray(parsedObj.tuning)
        ? (parsedObj.tuning as Prefs['tuning'])
        : {};
      return merged;
    } catch {
      return createDefaultPrefs();
    }
  }

  save(prefs: Prefs): void {
    writeJsonAtomic(this.filePath, prefs);
  }

  update(mutator: (prefs: Prefs) => void): Prefs {
    const prefs = this.load();
    mutator(prefs);
    this.save(prefs);
    return prefs;
  }
}

// ─── UUID Helper ────────────────────────────────────────────────────────────

export function uuid(): string {
  return crypto.randomUUID();
}
