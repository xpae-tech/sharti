import { describe, expect, it } from 'vitest';
import { effectiveTuning, isTuningOverride, parseDurationSeconds, TUNING_DEFAULTS } from './tuning.js';

describe('parseDurationSeconds', () => {
  it('parses Splash durations', () => {
    expect(parseDurationSeconds('90s')).toBe(90);
    expect(parseDurationSeconds('5m')).toBe(300);
    expect(parseDurationSeconds('1h')).toBe(3600);
    expect(parseDurationSeconds('0')).toBe(0);
  });

  it('rejects invalid values', () => {
    expect(parseDurationSeconds('')).toBeNull();
    expect(parseDurationSeconds('soon')).toBeNull();
    expect(parseDurationSeconds(-1)).toBeNull();
  });
});

describe('isTuningOverride', () => {
  it('treats any stored value as an explicit override, including defaults', () => {
    expect(isTuningOverride({ temperature: 1 }, 'temperature')).toBe(true);
    expect(isTuningOverride({ temperature: 1.1 }, 'temperature')).toBe(true);
    expect(isTuningOverride({}, 'temperature')).toBe(false);
    expect(isTuningOverride({ temperature: undefined }, 'temperature')).toBe(false);
  });
});

describe('effectiveTuning', () => {
  it('uses reference defaults for an empty profile', () => {
    const t = effectiveTuning({}, {});
    expect(t.customSampling).toBe(false);
    expect(TUNING_DEFAULTS.customSampling).toBe(false);
    expect(t.temperature).toBe(TUNING_DEFAULTS.temperature);
    expect(t.topK).toBe(TUNING_DEFAULTS.topK);
    expect(t.thinkingTokenBudget).toBe(TUNING_DEFAULTS.thinkingTokenBudget);
    expect(t.toolChoice).toBe(true);
    expect(t.toolApproval).toBe(true);
    expect(t.maxRetries).toBe(TUNING_DEFAULTS.maxRetries);
  });

  it('keeps explicit zero and false values', () => {
    const t = effectiveTuning({ temperature: 0, customSampling: false, parallelToolCalls: true, toolApproval: false, timeout: 0 }, {});
    expect(t.temperature).toBe(0);
    expect(t.customSampling).toBe(false);
    expect(t.parallelToolCalls).toBe(true);
    expect(t.toolApproval).toBe(false);
    expect(t.timeout).toBe(0);
  });

  it('inherits global server options when the tuning field is unset', () => {
    const t = effectiveTuning({}, { thinkingTokenBudget: '2048', requestTimeout: '5m' });
    expect(t.thinkingTokenBudget).toBe(2048);
    expect(t.timeout).toBe(300);
  });

  it('lets explicit tuning win over the global server options', () => {
    const t = effectiveTuning({ thinkingTokenBudget: 64, timeout: 30 }, { thinkingTokenBudget: '2048', requestTimeout: '5m' });
    expect(t.thinkingTokenBudget).toBe(64);
    expect(t.timeout).toBe(30);
  });
});
