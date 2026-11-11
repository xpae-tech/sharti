import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import type { AppConfig } from '../config/index.js';
import type { ServeOptions } from '../domain/types.js';
import { DOWNLOAD } from '../config/index.js';

export interface PrepareCallbacks {
  /** First JSON download event with a positive total. */
  onStart?: () => void;
  /** Exact bytes from the runtime's JSON progress protocol. */
  onProgress?: (done: number, total: number) => void;
}

export interface PrepareResult {
  ok: boolean;
  error: string | null;
}

export interface ModelPrepareHandle {
  promise: Promise<PrepareResult>;
  cancel: () => void;
}

/**
 * Runs the runtime's own `models.py prepare --json-progress`.
 *
 * Splash's `serve` performs the same preparation internally, but without the
 * JSON flag: its Hugging Face progress is then only a file-count tqdm bar,
 * which gives no byte progress, speed or ETA (especially under Xet, where a
 * single multi-GB file reports 0/1 until it is complete). Preparing first
 * gives the UI the runtime's exact `{"event":"download","done":N,"total":M}`
 * stream; the subsequent `serve` preparation is then a cache hit.
 */
export function runModelPrepare(
  cfg: AppConfig,
  model: string,
  options: ServeOptions = {},
  callbacks: PrepareCallbacks = {},
): ModelPrepareHandle {
  const splashRoot = cfg.splashRoot;
  if (!splashRoot) {
    return { promise: Promise.resolve({ ok: false, error: 'Splash runtime not found' }), cancel: () => {} };
  }

  purgeDsStore(cfg.modelsRoot);

  const args = [
    cfg.pythonBin,
    '-I', '-B', '-u',
    path.join(splashRoot, 'install', 'models.py'),
    '--models', cfg.modelsRoot,
    '--model', model,
  ];
  if (options.draftModel) args.push('--draft-model', options.draftModel);
  if (options.languageOnly) args.push('--language-only');
  args.push('prepare', '--json-progress');

  const env: Record<string, string | undefined> = { ...process.env, PYTHONNOUSERSITE: '1' };
  delete env.SPLASH_API_KEY;
  delete env.SPLASH_RUNTIME;

  const child = spawn(args[0], args.slice(1), {
    cwd: splashRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let settled = false;
  let cancelled = false;
  let started = false;
  let stdoutBuffer = '';
  const stderrTail: string[] = [];

  const promise = new Promise<PrepareResult>((resolve) => {
    const settle = (result: PrepareResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let idx: number;
      while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        const progress = parseProgressEvent(line);
        if (!progress) continue;
        if (!started) {
          started = true;
          callbacks.onStart?.();
        }
        callbacks.onProgress?.(progress.done, progress.total);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      for (const raw of chunk.toString().split(/[\r\n]/)) {
        const line = raw.trim();
        if (!line) continue;
        stderrTail.push(line);
        if (stderrTail.length > 50) stderrTail.shift();
      }
    });

    child.on('error', (error) => settle({ ok: false, error: error.message }));
    child.on('exit', (code) => {
      if (code === 0) {
        settle({ ok: true, error: null });
      } else {
        const detail = stderrTail.slice(-6).join('\n');
        settle({
          ok: false,
          error: cancelled
            ? 'Preparation cancelled.'
            : (detail || `Preparation failed (exit ${code ?? 'signal'}).`),
        });
      }
    });
  });

  return {
    promise,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      try { child.kill('SIGINT'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, DOWNLOAD.prepareKillGraceMs);
    },
  };
}

/** Parses one JSON progress line emitted by the runtime. */
export function parseProgressEvent(line: string): { done: number; total: number } | null {
  if (!line.startsWith('{')) return null;
  try {
    const event = JSON.parse(line) as { event?: string; done?: number; total?: number };
    if (event.event !== 'download' || typeof event.total !== 'number' || !(event.total > 0)) {
      return null;
    }
    return { done: typeof event.done === 'number' ? event.done : 0, total: event.total };
  } catch {
    return null;
  }
}

/** Recursively remove .DS_Store files under root (best-effort, silent on errors). */
function purgeDsStore(root: string): void {
  if (!root) return;
  try {
    execFileSync('find', [root, '-name', '.DS_Store', '-type', 'f', '-delete'], {
      stdio: 'ignore',
      timeout: 5_000,
    });
  } catch { /* directory may not exist or be unreadable — safe to ignore */ }
}
