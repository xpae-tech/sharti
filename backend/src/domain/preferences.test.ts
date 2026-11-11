import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreferenceStore, uuid } from './preferences.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-prefs-'));
  file = path.join(dir, 'prefs.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PreferenceStore', () => {
  it('returns defaults when the file is missing', () => {
    const store = new PreferenceStore(file);
    const prefs = store.load();
    expect(prefs.theme).toBe('dark');
    expect(prefs.connectionMode).toBe('auto');
    expect(prefs.nativeToolsEnabled).toBe(true);
    expect(prefs.enabledMcpServers).toEqual([]);
    expect(prefs.disabledMcpServers).toEqual([]);
    expect(prefs.tuning).toEqual({});
    expect(prefs.llmLogging).toBe(false);
  });

  it('persists updates atomically', () => {
    const store = new PreferenceStore(file);
    store.update((p) => { p.selectedModel = 'org/model'; p.theme = 'light'; });
    expect(fs.existsSync(file)).toBe(true);
    expect(store.load().selectedModel).toBe('org/model');
    expect(store.load().theme).toBe('light');
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('falls back to the dark theme for unknown values', () => {
    fs.writeFileSync(file, JSON.stringify({ theme: 'sepia' }));
    expect(new PreferenceStore(file).load().theme).toBe('dark');
  });

  it('migrates legacy enabledMcpTools to server-level enablement', () => {
    fs.writeFileSync(file, JSON.stringify({ enabledMcpTools: ['a:one', 'a:two', 'b:one'] }));
    const prefs = new PreferenceStore(file).load();
    expect(prefs.enabledMcpServers.sort()).toEqual(['a', 'b']);
  });

  it('drops retired preference fields instead of persisting them forever', () => {
    fs.writeFileSync(file, JSON.stringify({
      localModels: ['/tmp/model'],
      enabledMcpTools: [],
      theme: 'dark',
    }));
    const prefs = new PreferenceStore(file).load() as unknown as Record<string, unknown>;
    expect(prefs).not.toHaveProperty('localModels');
    expect(prefs).not.toHaveProperty('enabledMcpTools');
  });

  it('generates UUIDs', () => {
    expect(uuid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
