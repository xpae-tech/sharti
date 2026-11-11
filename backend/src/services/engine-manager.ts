import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, HTTP_TIMEOUTS, type AppConfig } from '../config/index.js';
import type {
  EnginePhase, ServingState, EngineState, MarkLook,
  ReasoningInfo, ServeOptions,
} from '../domain/types.js';
import { displayName } from '../domain/catalog.js';
import { buildServeArgs } from '../domain/serve-args.js';
import { parseModelCapabilities } from '../../../shared/reasoning.js';
import { DEFAULT_ENGINE_PORT } from '../../../shared/app-defaults.js';
import { runModelPrepare } from './model-prepare.js';

// ─── Internal Mutable State ─────────────────────────────────────────────────

interface InternalState {
  process: ChildProcess | null;
  model: string | null;
  port: number;
  phase: EnginePhase;
  step: string;
  serving: ServingState;
  since: number | null;
  stepSince: number | null;
  context: number | null;
  acceptsImages: boolean;
  reasoning: ReasoningInfo | null;
  startTime: number | null;
  stderrTail: string[];
  failMessage: string | null;
  next: string | null;
  memBytes: number | null;
  healthBadStreak: number;
}

// Narrow contract the engine uses to mirror inline fetches onto the download
// channel. Structurally satisfied by DownloadManager; kept unexported so the
// dependency direction stays one-way (engine knows a sink, not the manager).
interface InlineDownloadSink {
  setInline(model: string | null): void;
  setInlineProgress(done: number, total: number): void;
}

// ─── Public Class ───────────────────────────────────────────────────────────

export class EngineManager {
  private state: InternalState;
  private listeners: Array<(state: EngineState) => void> = [];
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private catalogRef: Parameters<typeof displayName>[1];
  private sink: InlineDownloadSink | null = null;
  /** A model requested while another process was still running. */
  private pending: { model: string; options: ServeOptions } | null = null;
  private probing = false;
  /** API key the current serve process requires for status/model probes. */
  private apiKey: string | null = null;
  /** True from the start of preparation until it succeeds, fails or is cancelled. */
  private prepareActive = false;
  /** Cancels the pre-serve preparation process, when one is running. */
  private prepareCancel: (() => void) | null = null;
  /** Invalidates callbacks from a cancelled preparation. */
  private prepareToken = 0;
  /** Cached device-check result; bootstrap and start should not spawn it twice. */
  private deviceCheckCache: { at: number; error: string | null } | null = null;
  private deviceCheckPromise: Promise<string | null> | null = null;
  // True once the runtime announces it is pulling missing files during `serve`.
  private inlineFetchSeen = false;
  // Dedupe guard so we only poke the sink when the inline state actually changes.
  private lastInline: string | null = null;
  // Track inline download progress extracted from stdout.
  private inlineTotalBytes: number | null = null;
  private inlineDoneBytes: number | null = null;

  constructor(
    private readonly cfg: AppConfig,
    catalog: Parameters<typeof displayName>[1],
    sink?: InlineDownloadSink,
  ) {
    this.catalogRef = catalog;
    this.sink = sink ?? null;
    this.state = {
      process: null,
      model: null,
      port: DEFAULT_ENGINE_PORT,
      phase: 'stopped',
      step: 'Loading',
      serving: 'running',
      since: null,
      stepSince: null,
      context: null,
      acceptsImages: true,
      reasoning: null,
      startTime: null,
      stderrTail: [],
      failMessage: null,
      next: null,
      memBytes: null,
      healthBadStreak: 0,
    };
  }

  // ── Event Subscription ────────────────────────────────────────────────────

  onStateChange(cb: (state: EngineState) => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    this.propagateInline();
    const snapshot = this.buildSnapshot();
    for (const cb of this.listeners) {
      try { cb(snapshot); } catch { /* listener error */ }
    }
  }

  /** Push the current inline-fetch state onto the shared download channel. */
  private propagateInline(): void {
    const active =
      this.inlineFetchSeen && this.state.phase === 'starting' && this.state.model
        ? this.state.model
        : null;
    if (active !== this.lastInline) {
      this.lastInline = active;
      this.sink?.setInline(active);
    }
  }

  // ── Snapshot Builder ──────────────────────────────────────────────────────

  getState(): EngineState {
    return this.buildSnapshot();
  }

  private buildSnapshot(): EngineState {
    const name = this.state.model ? displayName(this.state.model, this.catalogRef) : '';
    let status: string;
    switch (this.state.phase) {
      case 'stopped': status = 'No model running'; break;
      case 'starting': status = `${name} · ${this.state.step}…`; break;
      case 'stopping': status = this.state.next ? `Switching to ${displayName(this.state.next!, this.catalogRef)}…` : `Stopping ${name}…`; break;
      case 'ready': status = `${name} · ${servingWord(this.state.serving)}`; break;
      case 'failed': status = `${name} ran into a problem`; break;
      default: status = '';
    }
    return {
      phase: this.state.phase,
      step: this.state.step,
      serving: this.state.serving,
      model: this.state.model,
      modelDisplayName: name,
      next: this.state.next,
      since: this.state.since,
      stepSince: this.state.stepSince,
      port: this.state.port,
      context: this.state.context,
      acceptsImages: this.state.acceptsImages,
      reasoning: this.state.reasoning,
      memBytes: this.state.memBytes,
      failMessage: this.state.failMessage,
      status,
      markLook: markLook(this.state.phase, this.state.serving),
      apiAddress: `http://127.0.0.1:${this.state.port}/v1`,
      uptimeSec: this.state.startTime ? Math.round((Date.now() - this.state.startTime) / 1000) : null,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(model: string, options: ServeOptions = {}): { ok: boolean; pid?: number; error?: string } {
    if (!this.cfg.splashRoot) {
      return { ok: false, error: 'Splash runtime not found' };
    }
    // A process is already running (or a switch is queued): stop it first and
    // start the requested model as soon as the old process exits.
    if (this.state.process || this.pending || this.prepareActive) {
      this.pending = { model, options };
      this.state.next = model;
      this.state.phase = 'stopping';
      this.state.since = Date.now();
      this.stopProbing();
      const p = this.state.process;
      this.state.process = null;
      if (p) {
        try { p.kill('SIGINT'); } catch { /* ignore */ }
        setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } }, ENGINE.stopGraceMs);
      }
      // Cancel an in-flight preparation; its completion handler starts the
      // queued model (see beginPrepare).
      this.prepareCancel?.();
      this.emit();
      return { ok: true };
    }
    return this.beginPrepare(model, options);
  }

  /**
   * Prepares missing runtime files with the JSON progress protocol, then
   * spawns `serve`. Models that are already complete pay only the runtime's
   * normal prepare check, and no download card is shown.
   */
  private beginPrepare(model: string, options: ServeOptions): { ok: boolean; pid?: number; error?: string } {
    if (!this.cfg.splashRoot) return { ok: false, error: 'Splash runtime not found' };
    const token = ++this.prepareToken;
    this.apiKey = options.apiKey?.trim() || this.cfg.splashApiKey || null;
    const needsPrepare = this.shouldPrepare(model, options);

    this.state.model = model;
    this.state.next = null;
    this.state.phase = 'starting';
    this.state.step = needsPrepare ? 'Preparing' : 'Loading';
    this.state.serving = 'running';
    this.state.since = Date.now();
    this.state.stepSince = Date.now();
    this.state.startTime = Date.now();
    this.state.failMessage = null;
    this.state.healthBadStreak = 0;
    this.state.memBytes = null;
    this.state.acceptsImages = !options.languageOnly;
    this.state.reasoning = null;
    this.inlineFetchSeen = false;
    this.lastInline = null;
    this.inlineTotalBytes = null;
    this.inlineDoneBytes = null;
    this.emit();

    // Local directories and offline starts have nothing to fetch; serve's own
    // preparation is the right path for them.
    if (!needsPrepare) {
      return this.spawnServe(model, options);
    }

    this.prepareActive = true;
    void this.prepareAfterDeviceCheck(token, model, options);
    return { ok: true };
  }

  /** Mirrors the launcher's own ordering: refuse an unsupported device before downloading. */
  private async prepareAfterDeviceCheck(token: number, model: string, options: ServeOptions): Promise<void> {
    const deviceError = await this.deviceCheck();
    if (token !== this.prepareToken) return;
    if (deviceError) {
      this.prepareActive = false;
      this.pending = null;
      this.state.next = null;
      this.state.phase = 'failed';
      this.state.step = 'Failed';
      this.state.failMessage = deviceError;
      this.state.since = Date.now();
      this.emit();
      return;
    }
    // A switch requested while the device check was running takes over here.
    const next = this.pending;
    if (next) {
      this.pending = null;
      this.state.next = null;
      this.beginPrepare(next.model, next.options);
      return;
    }
    this.startPrepareProcess(token, model, options);
  }

  private startPrepareProcess(token: number, model: string, options: ServeOptions): void {
    const handle = runModelPrepare(this.cfg, model, options, {
      onStart: () => {
        if (token !== this.prepareToken) return;
        this.state.step = 'Downloading';
        this.sink?.setInline(model);
        this.emit();
      },
      onProgress: (done, total) => {
        if (token !== this.prepareToken) return;
        this.sink?.setInlineProgress(done, total);
        this.emit();
      },
    });
    this.prepareCancel = handle.cancel;
    void handle.promise.then((result) => {
      if (token !== this.prepareToken) return;
      this.prepareCancel = null;
      this.prepareActive = false;

      const next = this.pending;
      if (next) {
        this.pending = null;
        this.state.next = null;
        this.sink?.setInline(null);
        this.beginPrepare(next.model, next.options);
        return;
      }

      this.sink?.setInline(null);
      if (!result.ok) {
        this.state.phase = 'failed';
        this.state.step = 'Failed';
        this.state.failMessage = result.error ?? 'Preparation failed.';
        this.state.since = Date.now();
        this.emit();
        return;
      }
      this.spawnServe(model, options);
    });
  }

  private shouldPrepare(model: string, options: ServeOptions): boolean {
    // Without a built engine, `serve` must run first-run build/device setup;
    // preparing here would bypass it.
    if (!this.cfg.enginePath) return false;
    if (options.modelDir || options.offline) return false;
    return !(model.startsWith('/') || model.startsWith('~') || model.startsWith('.'));
  }

  /** Spawns a new engine process. Assumes preparation has completed. */
  private spawnServe(model: string, options: ServeOptions): { ok: boolean; pid?: number; error?: string } {
    if (!this.cfg.splashRoot) return { ok: false, error: 'Splash runtime not found' };
    this.state.model = model;
    this.state.next = null;
    this.state.phase = 'starting';
    this.state.step = 'Loading';
    this.state.serving = 'running';
    this.state.since = Date.now();
    this.state.stepSince = Date.now();
    this.state.startTime = Date.now();
    this.state.failMessage = null;
    this.state.healthBadStreak = 0;
    this.state.memBytes = null;
    this.state.acceptsImages = !options.languageOnly;
    this.state.reasoning = null;
    this.inlineFetchSeen = false;
    this.lastInline = null;
    this.inlineTotalBytes = null;
    this.inlineDoneBytes = null;

    const args = buildServeArgs(model, options);
    const launcherPy = path.join(this.cfg.splashRoot, 'install', 'launcher.py');
    const cmd = [this.cfg.pythonBin, '-I', '-B', '-u', launcherPy, ...args];

    const env: Record<string, string | undefined> = { ...process.env, PYTHONNOUSERSITE: '1' };
    delete env.SPLASH_API_KEY;
    delete env.SPLASH_RUNTIME;
    if (options.apiKey?.trim()) env.SPLASH_API_KEY = options.apiKey.trim();
    else if (this.cfg.splashApiKey) env.SPLASH_API_KEY = this.cfg.splashApiKey;

    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: this.cfg.splashRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.state.process = child;
    this.state.stderrTail = [];

    child.stdout?.on('data', (d: Buffer) => {
      this.handleStdoutLine(d.toString());
    });

    child.stderr?.on('data', (d: Buffer) => {
      // Split by both \n and \r — tqdm redraws with carriage-return,
      // producing many segments per physical line.
      const chunks = d.toString().split(/[\r\n]/);
      for (const seg of chunks) {
        const trimmed = seg.trim();
        if (!trimmed) continue;
        this.state.stderrTail.push(trimmed);
        if (this.state.stderrTail.length > ENGINE.stderrTailLimit) this.state.stderrTail.shift();
        // Attempt to extract download progress from stderr
        // (tqdf/huggingface_hub writes progress bars here).
        if (this.inlineFetchSeen && this.inlineTotalBytes) {
          if (this.tryParseInlineProgress(trimmed)) this.emit();
        }
      }
    });

    child.on('error', (e) => {
      this.state.phase = 'failed';
      this.state.failMessage = e.message;
      this.state.next = null;
      this.pending = null;
      this.inlineFetchSeen = false;
      this.inlineTotalBytes = null;
      this.inlineDoneBytes = null;
      this.state.process = null;
      this.stopProbing();
      this.emit();
    });

    child.on('exit', (code) => {
      this.state.process = null;
      this.inlineFetchSeen = false;
      this.inlineTotalBytes = null;
      this.inlineDoneBytes = null;
      this.stopProbing();

      // A queued switch: start the next model instead of settling into stopped.
      const next = this.pending;
      if (next) {
        this.pending = null;
        this.state.next = null;
        this.beginPrepare(next.model, next.options);
        return;
      }

      this.state.next = null;
      if (this.state.phase !== 'stopping') {
        this.state.phase = code === 0 ? 'stopped' : 'failed';
        if (code !== 0) {
          this.state.failMessage = this.state.stderrTail.slice(-8).join('\n') || `Exited with code ${code}.`;
        }
      } else {
        this.state.phase = 'stopped';
      }
      this.state.serving = 'running';
      this.emit();
    });

    this.emit();
    return { ok: true, pid: child.pid };
  }

  stop(): { ok: boolean; error?: string } {
    if (!this.state.process) {
      if (this.prepareActive) {
        // Invalidate the completion handler, then stop the prepare process.
        this.prepareToken++;
        const cancel = this.prepareCancel;
        this.prepareCancel = null;
        this.prepareActive = false;
        this.pending = null;
        this.state.next = null;
        this.state.phase = 'stopped';
        this.state.step = 'Loading';
        this.state.since = Date.now();
        this.stopProbing();
        this.sink?.setInline(null);
        cancel?.();
        this.emit();
        return { ok: true };
      }
      if (this.pending) {
        this.pending = null;
        this.state.next = null;
        this.state.phase = 'stopped';
        this.emit();
        return { ok: true };
      }
      return { ok: false, error: 'Nothing running' };
    }
    this.pending = null;
    this.state.next = null;
    this.state.phase = 'stopping';
    this.inlineFetchSeen = false;
    this.state.since = Date.now();
    this.stopProbing();
    const p = this.state.process;
    this.state.process = null;
    try { p.kill('SIGINT'); } catch { /* ignore */ }
    setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } }, ENGINE.stopGraceMs);
    this.emit();
    return { ok: true };
  }

  /** Tear down the current process and cancel any queued switch (dispose path). */
  private teardownCurrent(): void {
    this.pending = null;
    this.state.next = null;
    if (!this.state.process) return;
    const p = this.state.process;
    this.state.process = null;
    this.inlineFetchSeen = false;
    try { p.kill('SIGINT'); } catch { /* ignore */ }
    setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } }, ENGINE.stopGraceMs);
  }

  // ── Stdout Interpretation ─────────────────────────────────────────────────

  private buffer = '';
  private handleStdoutLine(raw: string): void {
    this.buffer += raw;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      process.stdout.write(`[splash] ${line}\n`);
      this.interpretLine(line);
    }
  }

  private interpretLine(line: string): void {
    if (this.state.phase !== 'starting') return;

    if (/warming|warm.?up|compil/i.test(line)) {
      if (this.state.step !== 'Warming') {
        this.state.step = 'Warming';
        this.state.stepSince = Date.now();
      }
    }

    // The runtime sometimes discovers missing pieces (e.g. a vision mmproj) for
    // an already-installed model and fetches them inline as part of `serve`.
    // Surface that as a download so the UI shows the progress card instead of
    // leaving the caller staring at the bare "Loading…" spinner. Gate on a
    // positive file count so pure local assembly (everything cached) is skipped.
    const fm = line.match(/fetching\s+(\d+)\s+file/i);
    if (fm && parseInt(fm[1], 10) > 0) {
      if (!this.inlineFetchSeen) {
        this.inlineFetchSeen = true;
        // Try to extract total size: "Fetching 1 file(s), 0.93 GB, from ..."
        const szMatch = line.match(/([\d.]+)\s*(TB|GB|MB|KB)/i);
        if (szMatch) {
          const units: Record<string, number> = { kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
          const mult = units[szMatch[2].toLowerCase()] ?? 1;
          this.inlineTotalBytes = Math.round(parseFloat(szMatch[1]) * mult);
        }
        this.inlineDoneBytes = 0;
        this.emit();
        // Immediately report initial state (0/N) to the sink
        if (this.inlineTotalBytes) {
          this.sink?.setInlineProgress(0, this.inlineTotalBytes);
        }
      }
    }

    // Track ongoing inline download progress from stdout.
    // Splash typically emits percentage or byte-ratio lines while fetching.
    if (this.inlineFetchSeen && this.inlineTotalBytes) {
      const progUpdated = this.tryParseInlineProgress(line);
      if (progUpdated) this.emit();
    }

    const ready = line.match(
      /Ready\s*·\s*(.+?)\s*·\s*context\s*([\d,.]+[KM]?).*?·\s*(https?:\/\/[\d.:]+)/i,
    );
    if (ready) {
      this.state.phase = 'ready';
      this.state.serving = 'running';
      this.inlineFetchSeen = false;
      this.inlineTotalBytes = null;
      this.inlineDoneBytes = null;
      this.state.since = Date.now();
      this.state.context = parseContextTokens(ready[2]);
      const pm = ready[3].match(/:(\d+)$/);
      if (pm) this.state.port = parseInt(pm[1], 10);
      this.state.acceptsImages = true;
      console.log(`[state] READY · ${ready[1]} · context ${ready[2]} · port ${this.state.port}`);
      this.scheduleProbing();
      this.emit();
    }
  }

  /**
   * Attempt to extract download progress from a line (stdout or stderr)
   * during inline fetch. Handles patterns from:
   *   - tqdm:  " 45%|████▌     | 420M/930M [00:12<00:15]"
   *   - huggingface_hub: "45%" or "420.5MB of 930.2MB"
   *   - Generic: "12345678 / 987654321"
   * Returns true if progress was updated.
   */
  private tryParseInlineProgress(line: string): boolean {
    if (this.inlineTotalBytes == null) return false;

    // Unit multiplier table (covers tqdm short-form and standard SI/binary).
    const UNITS: Record<string, number> = {
      b: 1, k: 1e3, kb: 1e3, kib: 1024,
      m: 1e6, mb: 1e6, mib: 1 << 20,
      g: 1e9, gb: 1e9, gib: 1 << 30,
      t: 1e12, tb: 1e12, tib: 1 << 40,
    };

    // Pattern 1: byte ratio "N[U] / M[U]" or "N[U] of M[U]"
    // Covers: "420M/930M", "420.5MB of 930.2MB", "12345678/987654321"
    const ratio = line.match(/([\d][\d.,]*)\s*([a-zA-Z]{0,3})\s*[/]\s*([\d][\d.,]*)\s*([a-zA-Z]{0,3})/)
      || line.match(/([\d][\d.,]*)\s*([a-zA-Z]{0,3})\s+of\s+([\d][\d.,]*)\s*([a-zA-Z]{0,3})/i);
    if (ratio) {
      const parseQty = (numStr: string, unitStr: string): number => {
        const n = parseFloat(numStr.replace(/,/g, ''));
        if (isNaN(n)) return NaN;
        const u = unitStr.trim().toLowerCase();
        const mult = u ? (UNITS[u] ?? 1) : 1;
        return Math.round(n * mult);
      };
      const done = parseQty(ratio[1], ratio[2]);
      // Sanity: done should be plausible (≤ total, ≥ previously reported)
      if (!isNaN(done) && done <= this.inlineTotalBytes && done >= (this.inlineDoneBytes ?? 0)) {
        this.inlineDoneBytes = done;
        this.sink?.setInlineProgress(done, this.inlineTotalBytes);
        return true;
      }
    }

    // Pattern 2: percentage "NN%" (common in tqdm non-TTY mode and huggingface_hub)
    const pct = line.match(/\b(\d{1,3}(?:\.\d+)?)\s*[%％]/);
    if (pct) {
      const frac = parseFloat(pct[1]) / 100;
      if (frac > 0 && frac <= 1) {
        const done = Math.min(this.inlineTotalBytes, Math.round(frac * this.inlineTotalBytes));
        if (done >= (this.inlineDoneBytes ?? 0)) {
          this.inlineDoneBytes = done;
          this.sink?.setInlineProgress(done, this.inlineTotalBytes);
          return true;
        }
      }
    }

    return false;
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  // ── Status Probing ────────────────────────────────────────────────────────

  /** Starts a recurring 2 s health probe once the engine reports Ready. */
  private scheduleProbing(): void {
    this.stopProbing();
    void this.probeLive();
    this.statusTimer = setInterval(() => { void this.probeLive(); }, ENGINE.probeIntervalMs);
  }

  private stopProbing(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  private async probeLive(): Promise<void> {
    if (this.probing) return;
    if (this.state.phase !== 'ready' || !this.state.process) {
      this.stopProbing();
      return;
    }
    this.probing = true;
    try {
      const statusResult = await fetchJson(`http://127.0.0.1:${this.state.port}/status`, this.authHeaders());
      if (statusResult.ok) {
        this.state.healthBadStreak = 0;
        this.applyServerStatus(statusResult.data as Record<string, unknown>);
      } else {
        this.state.healthBadStreak++;
        if (this.state.healthBadStreak >= ENGINE.probeFailureLimit && this.state.phase === 'ready') {
          this.state.phase = 'failed';
          this.state.failMessage = 'The server stopped responding.';
          this.stopProbing();
          this.emit();
          return;
        }
      }

      const modelsResult = await fetchJson(`http://127.0.0.1:${this.state.port}/v1/models`, this.authHeaders());
      if (modelsResult.ok) {
        const jm = modelsResult.data as { data?: Array<Record<string, unknown>> };
        const m = jm.data?.[0];
        if (m) {
          const caps = parseModelCapabilities(m);
          if (caps) {
            this.state.acceptsImages = caps.acceptsImages;
            if (caps.context != null) this.state.context = caps.context;
            this.state.reasoning = caps.reasoning;
          }
        }
      }

      // Sample memory
      if (this.state.process?.pid) {
        const mb = await sampleTreeMemory(this.state.process.pid);
        if (mb) this.state.memBytes = mb;
      }

      this.emit();
    } finally {
      this.probing = false;
    }
  }

  private applyServerStatus(st: Record<string, unknown>): void {
    const inst = st.instance as Record<string, unknown> | undefined;
    if (inst?.port) this.state.port = inst.port as number;
    if (inst?.model) this.state.model = inst.model as string;

    const transport = st.transport as Record<string, unknown> | undefined;
    if (transport?.recovering) this.state.serving = 'recovering';
    else {
      const weights = st.weights as Record<string, unknown> | undefined;
      this.state.serving = weights?.released && !weights?.restoring ? 'sleeping' : 'running';
    }

    // Dig for latency/memory/context values (tolerant of schema drift)
    const dig = (...keys: string[]): unknown => {
      let cur: unknown = st;
      for (const k of keys) {
        if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[k];
        } else return undefined;
      }
      return cur;
    };

    const ctx = dig('context', 'tokens') ?? dig('max_context_tokens') ?? dig('context_window');
    if (typeof ctx === 'number') this.state.context = ctx;

    const mem = dig('memory', 'used_bytes') ?? dig('memory_used_bytes') ?? dig('resident_bytes');
    if (typeof mem === 'number' && mem > 0) this.state.memBytes = mem;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────



  /** Cleanup: kill any leftover process from previous sessions. */
  async stopLeftovers(): Promise<void> {
    if (!this.cfg.locksRoot) return;
    let entries: string[] = [];
    try { entries = fs.readdirSync(this.cfg.locksRoot); } catch { return; }
    for (const name of entries) {
      if (!/^serve-.*\.lock$/.test(name)) continue;
      try {
        const o = JSON.parse(fs.readFileSync(path.join(this.cfg.locksRoot, name), 'utf8'));
        if (typeof o.pid === 'number' && isAlive(o.pid)) {
          try { process.kill(o.pid, 'SIGINT'); } catch { /* ignore */ }
        }
      } catch { /* malformed/stale lock */ }
    }
  }

  /**
   * Check if the device supports Splash. The result is cached for five minutes
   * so bootstrap and a subsequent start do not spawn `device-check` twice.
   */
  deviceCheck(force = false): Promise<string | null> {
    const cached = this.deviceCheckCache;
    if (!force && cached && Date.now() - cached.at < ENGINE.deviceCheckCacheMs) return Promise.resolve(cached.error);
    if (this.deviceCheckPromise) return this.deviceCheckPromise;
    this.deviceCheckPromise = this.runDeviceCheck().then((error) => {
      if (this.cfg.enginePath) this.deviceCheckCache = { at: Date.now(), error };
      this.deviceCheckPromise = null;
      return error;
    });
    return this.deviceCheckPromise;
  }

  private runDeviceCheck(): Promise<string | null> {
    return new Promise((resolve) => {
      const eng = this.cfg.enginePath;
      if (!eng || !fs.existsSync(eng)) return resolve(null);
      const child = spawn(eng, ['device-check'], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
      child.on('error', () => resolve(null));
      child.on('exit', (code) => {
        if (code === 0) return resolve(null);
        resolve(err.trim().replace(/^error:\s*/, ''));
      });
      setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, ENGINE.deviceCheckTimeoutMs);
    });
  }

  /** True while the runtime is preparing (possibly downloading) missing files. */
  isPreparing(): boolean {
    return this.prepareActive;
  }

  /** Cancel only the preparation phase, leaving a serving engine untouched. */
  cancelPreparation(): void {
    if (this.prepareActive) this.stop();
  }

  dispose(): void {
    this.prepareToken++;
    this.prepareCancel?.();
    this.prepareCancel = null;
    this.prepareActive = false;
    this.sink?.setInline(null);
    this.stopProbing();
    this.teardownCurrent();
  }
}

// ─── Module-Level Utilities ─────────────────────────────────────────────────

function servingWord(s: ServingState): string {
  if (s === 'sleeping') return 'Sleeping';
  if (s === 'recovering') return 'Recovering';
  return 'Running';
}

function markLook(phase: EnginePhase, serving: ServingState): MarkLook {
  switch (phase) {
    case 'starting': return 'loading';
    case 'ready': return serving === 'sleeping' ? 'asleep' : serving === 'recovering' ? 'loading' : 'on';
    case 'failed': return 'failed';
    default: return 'off';
  }
}

function parseContextTokens(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  const m = cleaned.match(/^([\d.]+)\s*([KM]?)$/i);
  if (!m) {
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  const n = parseFloat(m[1]);
  const suf = m[2].toUpperCase();
  if (suf === 'K') return Math.round(n * 1000);
  if (suf === 'M') return Math.round(n * 1e6);
  return Math.round(n);
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = HTTP_TIMEOUTS.engineStatusMs): Promise<{ ok: boolean; data?: unknown }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 200) {
      return { ok: true, data: await res.json() };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

function sampleTreeMemory(rootPid: number): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      execFile('ps', ['-axo', 'rss=', '-o', 'pid=', '-o', 'ppid='], (err, out) => {
        if (err) return resolve(null);
        const children = new Map<number, number[]>();
        const rss = new Map<number, number>();
        for (const line of out.split('\n')) {
          const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
          if (!m) continue;
          const [, r, pid, ppid] = m;
          rss.set(Number(pid), Number(r));
          if (!children.has(Number(ppid))) children.set(Number(ppid), []);
          children.get(Number(ppid))!.push(Number(pid));
        }
        let total = 0;
        const seen = new Set<number>();
        const stack = [rootPid];
        while (stack.length) {
          const p = stack.pop()!;
          if (seen.has(p)) continue;
          seen.add(p);
          total += rss.get(p) ?? 0;
          for (const k of children.get(p) ?? []) stack.push(k);
        }
        resolve(total * 1024);
      });
    } catch {
      resolve(null);
    }
  });
}
