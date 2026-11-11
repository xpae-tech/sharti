import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/index.js';
import { DownloadManager } from './download-manager.js';

const cfg = { splashRoot: null } as unknown as AppConfig;

afterEach(() => {
  vi.useRealTimers();
});

describe('DownloadManager inline speed/ETA', () => {
  it('computes speed and remaining time from JSON progress samples', () => {
    vi.useFakeTimers();
    const dm = new DownloadManager(cfg);
    dm.setInline('org/model');

    dm.setInlineProgress(0, 1000);
    vi.advanceTimersByTime(1000); // baseline sample
    dm.setInlineProgress(500, 1000);
    vi.advanceTimersByTime(1000); // 500 bytes in one second

    const state = dm.getState();
    expect(state.progress?.done).toBe(500);
    expect(state.speedBps).toBe(500);
    expect(state.remainingSec).toBe(1);

    dm.dispose();
  });

  it('does not leak inline state after release', () => {
    const dm = new DownloadManager(cfg);
    dm.setInline('org/model');
    dm.setInlineProgress(10, 20);
    dm.setInline(null);
    const state = dm.getState();
    expect(state.running).toBe(false);
    expect(state.model).toBeNull();
    expect(state.progress).toBeNull();
    dm.dispose();
  });
});
