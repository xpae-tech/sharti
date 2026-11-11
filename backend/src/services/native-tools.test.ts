import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeToolsManager } from './native-tools.js';
import type { Prefs } from '../domain/types.js';

const prefs: Prefs = {
  selectedModel: null,
  theme: 'dark',
  efforts: {},
  options: {},
  tuning: {},
  connectionMode: 'auto',
  apiConnections: [],
  activeApiId: null,
  enabledMcpServers: [],
  disabledMcpServers: [],
  nativeToolsEnabled: true,
  disabledNativeTools: [],
  llmLogging: false,
};

let dir: string;
let manager: NativeToolsManager;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-native-'));
  manager = new NativeToolsManager(() => prefs);
  manager.init();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function payload(result: Awaited<ReturnType<NativeToolsManager['callTool']>>): any {
  expect(result.isError).toBe(false);
  return JSON.parse(result.content[0].text ?? '{}');
}

describe('NativeToolsManager state', () => {
  afterEach(() => {
    prefs.nativeToolsEnabled = true;
    prefs.disabledNativeTools = [];
  });

  it('reports the enabled flag and hides tools while disabled', () => {
    prefs.nativeToolsEnabled = false;
    expect(manager.getState()).toEqual({ tools: [], initialized: true, enabled: false });

    prefs.nativeToolsEnabled = true;
    const state = manager.getState();
    expect(state.enabled).toBe(true);
    expect(state.tools.map((t) => t.name)).toContain('run_command');
  });

  it('omits individually disabled tools but stays enabled', () => {
    prefs.disabledNativeTools = ['run_command'];
    const state = manager.getState();
    expect(state.enabled).toBe(true);
    expect(state.tools.map((t) => t.name)).not.toContain('run_command');
    expect(state.tools).toHaveLength(10);
  });
});

describe('NativeToolsManager (intentionally unsandboxed)', () => {
  it('reads and writes outside the project directory', async () => {
    const file = path.join(dir, 'outside.txt');
    fs.writeFileSync(file, 'outside');

    expect(payload(await manager.callTool('read_file', { file_path: file })).content).toBe('outside');
    expect(payload(await manager.callTool('write_file', { file_path: file, content: 'changed' })).success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('changed');
  });

  it('runs commands in any requested working directory', async () => {
    const result = payload(await manager.callTool('run_command', { command: 'pwd', cwd: dir }));
    expect(result.stdout.trim()).toBe(fs.realpathSync(dir));
  });
});
