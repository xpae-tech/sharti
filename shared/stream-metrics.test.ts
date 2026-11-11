import { describe, expect, it } from 'vitest';
import { readTokensPerSecond } from './stream-metrics.js';

describe('readTokensPerSecond', () => {
  it('reads the Splash metrics shape', () => {
    expect(readTokensPerSecond({
      metrics: { request_latency: { stream_tokens_per_second: 42.5 } },
    })).toBe(42.5);
  });

  it('reads llama.cpp timings and other common aliases', () => {
    expect(readTokensPerSecond({ timings: { predicted_per_second: 31 } })).toBe(31);
    expect(readTokensPerSecond({ stats: { tokens_per_second: 22 } })).toBe(22);
    expect(readTokensPerSecond({ usage: { tokens_per_second: 18 } })).toBe(18);
    expect(readTokensPerSecond({ metrics: { tokens_per_second: 12 } })).toBe(12);
  });

  it('ignores missing, zero and invalid values', () => {
    expect(readTokensPerSecond(null)).toBeNull();
    expect(readTokensPerSecond({})).toBeNull();
    expect(readTokensPerSecond({ timings: { predicted_per_second: 0 } })).toBeNull();
    expect(readTokensPerSecond({ metrics: { tokens_per_second: 'fast' } })).toBeNull();
  });
});
