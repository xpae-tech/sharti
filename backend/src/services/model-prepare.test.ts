import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/index.js';
import { parseProgressEvent, runModelPrepare } from './model-prepare.js';

describe('parseProgressEvent', () => {
  it('parses runtime download events', () => {
    expect(parseProgressEvent('{"event":"download","done":512,"total":1024}')).toEqual({
      done: 512,
      total: 1024,
    });
  });

  it('defaults missing done to zero', () => {
    expect(parseProgressEvent('{"event":"download","total":1024}')).toEqual({ done: 0, total: 1024 });
  });

  it('ignores unrelated or malformed lines', () => {
    expect(parseProgressEvent('Fetching 1 file(s), 0.93 GB')).toBeNull();
    expect(parseProgressEvent('{"event":"download","done":0,"total":0}')).toBeNull();
    expect(parseProgressEvent('{"event":"other","done":1,"total":2}')).toBeNull();
    expect(parseProgressEvent('{"event":')).toBeNull();
  });
});

describe('runModelPrepare', () => {
  it('fails fast when the runtime is not installed', async () => {
    const cfg = { splashRoot: null } as unknown as AppConfig;
    const result = await runModelPrepare(cfg, 'org/model').promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Splash runtime not found');
  });
});

// ── Integration with a fake runtime script ─────────────────────────────────

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function pythonAvailable(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!pythonAvailable())('runModelPrepare process integration', () => {
  it('forwards JSON progress and succeeds', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-prepare-'));
    const install = path.join(root, 'install');
    fs.mkdirSync(install, { recursive: true });
    fs.writeFileSync(
      path.join(install, 'models.py'),
      [
        'import json',
        'print(json.dumps({"event": "download", "done": 0, "total": 100}), flush=True)',
        'print("a warning", file=__import__("sys").stderr, flush=True)',
        'print(json.dumps({"event": "download", "done": 50, "total": 100}), flush=True)',
        'print(json.dumps({"event": "download", "done": 100, "total": 100}), flush=True)',
      ].join('\n'),
    );
    const cfg = {
      splashRoot: root,
      pythonBin: 'python3',
      modelsRoot: path.join(root, 'models'),
    } as unknown as AppConfig;

    let starts = 0;
    const progress: Array<[number, number]> = [];
    const result = await runModelPrepare(cfg, 'org/model', {}, {
      onStart: () => { starts++; },
      onProgress: (done, total) => { progress.push([done, total]); },
    }).promise;

    expect(result).toEqual({ ok: true, error: null });
    expect(starts).toBe(1);
    expect(progress).toEqual([[0, 100], [50, 100], [100, 100]]);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports the stderr tail when the runtime fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-prepare-'));
    const install = path.join(root, 'install');
    fs.mkdirSync(install, { recursive: true });
    fs.writeFileSync(
      path.join(install, 'models.py'),
      'import sys\nprint("boom: no space left", file=sys.stderr, flush=True)\nsys.exit(2)\n',
    );
    const cfg = {
      splashRoot: root,
      pythonBin: 'python3',
      modelsRoot: path.join(root, 'models'),
    } as unknown as AppConfig;

    const result = await runModelPrepare(cfg, 'org/model').promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom: no space left');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
