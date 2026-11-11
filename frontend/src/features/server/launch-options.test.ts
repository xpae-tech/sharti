import { describe, expect, it } from 'vitest';
import { OPTION_DEFS } from './launch-options.js';

// Every general `splash serve` option the app exposes, except per-model
// options (--model, --model-dir, --mmproj, --revision, --draft-model).
const EXPECTED = [
  'maxContext', 'maxMemory', 'idleRelease', 'languageOnly',
  'kvFormat', 'stateFormat', 'expertMemory', 'pleMemory', 'sparseKvMemory',
  'maxCacheDisk', 'maxCacheDiskWrites', 'persistentCache', 'cacheDir',
  'port', 'host', 'allowedHost', 'allowedOrigin', 'apiKey', 'noWebui', 'offline',
  'defaultReasoningEffort', 'thinkingTokenBudget', 'thinkingEndText',
  'servedModelName', 'announceServedName',
  'requestTimeout', 'queueSize', 'maxRequestSize', 'maxImagePixels',
  'decodeShare', 'verifyRows', 'disableAne', 'allowIdleSleep',
];

describe('launch option catalog', () => {
  it('covers every supported serve option exactly once', () => {
    const keys = OPTION_DEFS.map((d) => d.key);
    expect([...keys].sort()).toEqual([...EXPECTED].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the main options visible and groups the rest under Advanced', () => {
    expect(OPTION_DEFS.filter((d) => d.section === 'main').map((d) => d.key))
      .toEqual(['maxContext', 'maxMemory', 'idleRelease', 'languageOnly']);
    expect(OPTION_DEFS.some((d) => d.section === 'memory')).toBe(true);
    expect(OPTION_DEFS.some((d) => d.section === 'cache')).toBe(true);
    expect(OPTION_DEFS.some((d) => d.section === 'network')).toBe(true);
    expect(OPTION_DEFS.some((d) => d.section === 'api')).toBe(true);
    expect(OPTION_DEFS.some((d) => d.section === 'requests')).toBe(true);
  });
});
