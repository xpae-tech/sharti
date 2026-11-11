import { DOWNLOAD, type AppConfig } from '../config/index.js';
import type { DownloadState, DownloadProgress } from '../domain/types.js';
import { runModelPrepare } from './model-prepare.js';

export class DownloadManager {
  private running = false;
  private model: string | null = null;
  private progress: DownloadProgress | null = null;
  private remainingSec: number | null = null;
  private speedBps: number | null = null;
  private failure: { model: string; message: string } | null = null;
  private lastTick = { t: 0, done: 0 };
  private etaTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(state: DownloadState) => void> = [];
  // Who currently occupies the single download slot: a spawned 'prepare' process,
  // an engine-driven inline fetch, or nobody. Keeps the two sources mutually
  // exclusive so neither clobbers the other's state.
  private owner: 'process' | 'inline' | null = null;
  private cancelPrepare: (() => void) | null = null;

  constructor(private readonly cfg: AppConfig) {
    this.startEtaTicker();
  }

  // ── Event Subscription ────────────────────────────────────────────────────

  onStateChange(cb: (state: DownloadState) => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    const snap = this.getState();
    for (const cb of this.listeners) {
      try { cb(snap); } catch { /* listener error */ }
    }
  }

  start(model: string): { ok: boolean; error?: string } {
    if (this.running) return { ok: false, error: 'One download at a time' };
    if (!this.cfg.splashRoot) return { ok: false, error: 'Splash runtime not found' };

    this.running = true;
    this.model = model;
    this.progress = null;
    this.remainingSec = null;
    this.speedBps = null;
    this.failure = null;
    this.lastTick = { t: Date.now(), done: 0 };
    this.owner = 'process';

    const handle = runModelPrepare(this.cfg, model, {}, {
      onProgress: (done, total) => {
        if (this.owner !== 'process') return;
        this.progress = {
          done,
          total,
          fraction: total > 0 ? done / total : 0,
        };
        this.emit();
      },
    });
    this.cancelPrepare = handle.cancel;
    void handle.promise.then((result) => this.finish(result.ok, result.error));

    this.emit();
    return { ok: true };
  }

  cancel(): void {
    if (!this.running) return;
    if (this.owner === 'process') this.cancelPrepare?.();
    this.cancelPrepare = null;
    this.running = false;
    this.owner = null;
    this.model = null;
    this.progress = null;
    this.remainingSec = null;
    this.speedBps = null;
    this.emit();
  }

  dismissFailure(): void {
    this.failure = null;
    this.running = false;
    this.owner = null;
    this.cancelPrepare = null;
    this.model = null;
    this.progress = null;
    this.remainingSec = null;
    this.speedBps = null;
    this.emit();
  }

  /**
   * Mirror an engine-driven download onto the shared download channel.
   * Unlike `start()` this does not spawn a process — it only flips the
   * observable state so the UI surfaces the download card. `model === null`
   * releases the inline claim.
   */
  setInline(model: string | null): void {
    if (model) {
      if (this.owner === 'process') return; // a real 'prepare' download is in flight
      this.owner = 'inline';
      this.running = true;
      this.model = model;
      this.progress = null; // indeterminate until the first progress event
      this.failure = null;
      this.remainingSec = null;
      this.speedBps = null;
      this.lastTick = { t: Date.now(), done: 0 };
    } else {
      if (this.owner !== 'inline') return;
      this.owner = null;
      this.running = false;
      this.model = null;
      this.progress = null;
      this.remainingSec = null;
      this.speedBps = null;
    }
    this.emit();
  }

  /** Receive a progress tick for an engine-driven download. */
  setInlineProgress(done: number, total: number): void {
    if (this.owner !== 'inline') return;
    this.progress = {
      done,
      total,
      fraction: total > 0 ? done / total : 0,
    };
    // The ETA ticker owns lastTick: updating it here would make every
    // progress event look like a zero-delta sample and hide speed/ETA.
    this.emit();
  }

  getState(): DownloadState {
    return {
      running: this.running,
      model: this.model,
      progress: this.progress,
      remainingSec: this.remainingSec,
      speedBps: this.speedBps,
      failure: this.failure,
    };
  }

  private finish(ok: boolean, message: string | null): void {
    if (!this.running || this.owner !== 'process') return;
    this.running = false;
    this.owner = null;
    this.cancelPrepare = null;
    this.speedBps = null;
    if (!ok) {
      this.failure = { model: this.model ?? 'unknown', message: message ?? 'Unknown error' };
    }
    this.emit();
  }

  private startEtaTicker(): void {
    this.etaTimer = setInterval(() => {
      if (!this.running || !this.progress) return;
      const now = Date.now();
      const dt = (now - this.lastTick.t) / 1000;
      const dd = this.progress.done - this.lastTick.done;
      this.lastTick = { t: now, done: this.progress.done };
      if (dt > 0) {
        this.speedBps = dd > 0 ? dd / dt : 0;
        if (dd > 0) {
          this.remainingSec = Math.max(0, Math.ceil((this.progress.total - this.progress.done) / this.speedBps));
        }
        this.emit();
      }
    }, DOWNLOAD.etaTickMs);
  }

  dispose(): void {
    if (this.etaTimer) clearInterval(this.etaTimer);
    this.cancelPrepare?.();
    this.cancelPrepare = null;
  }
}
