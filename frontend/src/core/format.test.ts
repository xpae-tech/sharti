import { describe, expect, it } from 'vitest';
import { compactNum, downloadCaption, fmtSize, fmtSpeed, formatTokenBadge, shortUrl } from './format.js';
import type { DownloadState } from '../types';

describe('format helpers', () => {
  it('formats sizes and compact numbers', () => {
    expect(fmtSize(2.5e9)).toBe('2.5 GB');
    expect(fmtSize(1e9)).toBe('1 GB');
    expect(fmtSize(1200)).toBe('1 KB');
    expect(compactNum(1500)).toBe('1.5K');
    expect(fmtSpeed(8_500_000)).toBe('8.5 MB/s');
    expect(fmtSpeed(2_000_000_000)).toBe('2 GB/s');
  });

  it('shortens base URLs', () => {
    expect(shortUrl('http://localhost:11434/v1')).toBe('localhost:11434/v1');
    expect(shortUrl('not a url')).toBe('not a url');
    expect(shortUrl('')).toBe('');
  });

  it('formats context badges by rounding up to the next unit', () => {
    expect(formatTokenBadge(0)).toBe('');
    expect(formatTokenBadge(1)).toBe('1k');
    expect(formatTokenBadge(1000)).toBe('1k');
    expect(formatTokenBadge(1001)).toBe('2k');
    expect(formatTokenBadge(100_000)).toBe('100k');
    expect(formatTokenBadge(100_001)).toBe('101k');
    expect(formatTokenBadge(1_000_000)).toBe('1m');
    expect(formatTokenBadge(1_000_001)).toBe('2m');
  });

  it('describes download progress consistently', () => {
    const download: DownloadState = {
      running: true,
      model: 'm',
      progress: { done: 1e9, total: 2e9, fraction: 0.5 },
      remainingSec: 30,
      speedBps: 8_500_000,
      failure: null,
    };
    expect(downloadCaption(download)).toBe('1 GB of 2 GB · 8.5 MB/s · less than a minute left');
    expect(downloadCaption({ ...download, progress: null })).toBe('Preparing download…');
  });
});
