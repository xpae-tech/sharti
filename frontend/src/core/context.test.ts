import { describe, expect, it } from 'vitest';
import { CONTEXT } from './config.js';
import { contextBadgeInfo } from './context.js';

describe('context badge', () => {
  it('is hidden until a token count is known', () => {
    expect(contextBadgeInfo(0, 32_000)).toBeNull();
    expect(contextBadgeInfo(-1, 32_000)).toBeNull();
  });

  it('formats occupancy and tooltip', () => {
    expect(contextBadgeInfo(1001, 32_000)).toEqual({
      label: '2k',
      critical: false,
      tooltip: 'Context is 3% full (2K of 32K tokens)',
    });
  });

  it('uses the configured critical threshold', () => {
    const limit = 100_000;
    const justBelow = Math.floor(limit * CONTEXT.criticalThreshold) - 1;
    expect(contextBadgeInfo(justBelow, limit)?.critical).toBe(false);
    expect(contextBadgeInfo(limit * CONTEXT.criticalThreshold, limit)?.critical).toBe(true);
    expect(contextBadgeInfo(95_000, limit)?.tooltip).toBe('Context is 95% full (95K of 100K tokens)');
  });

  it('omits the percentage when the provider has no context limit', () => {
    expect(contextBadgeInfo(12_000, null)).toEqual({
      label: '12k',
      critical: false,
      tooltip: 'Context: 12K tokens',
    });
  });
});
