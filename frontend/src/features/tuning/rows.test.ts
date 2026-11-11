import { describe, expect, it } from 'vitest';
import {
  PLUGIN_RESET_KEYS,
  PRIORITY_OPTIONS,
  REASONING_FIELDS,
  REQUEST_FIELDS,
  SAMPLING_FIELDS,
  SYSTEM_RESET_KEYS,
  TOOL_TOGGLES,
  TUNING_RESET_KEYS,
} from './rows.js';

describe('tuning field definitions', () => {
  it('keeps reset keys in sync with the rendered fields', () => {
    const tuningKeys = [...SAMPLING_FIELDS, ...REASONING_FIELDS].map((def) => def.key);
    expect(TUNING_RESET_KEYS).toEqual(expect.arrayContaining([...tuningKeys, 'customSampling', 'systemPrompt']));
    expect(TUNING_RESET_KEYS).toContain('temperature');
    expect(TUNING_RESET_KEYS).not.toContain('timeout');
  });

  it('maps each page to its own reset scope', () => {
    expect(PLUGIN_RESET_KEYS).toEqual(TOOL_TOGGLES.map((def) => def.key));
    expect(SYSTEM_RESET_KEYS).toEqual(['priority', ...REQUEST_FIELDS.map((def) => def.key)]);
  });

  it('keeps sampling bounds ordered and priority options non-empty', () => {
    for (const def of [...SAMPLING_FIELDS, ...REASONING_FIELDS, ...REQUEST_FIELDS]) {
      expect(def.min).toBeLessThanOrEqual(def.max);
    }
    expect(PRIORITY_OPTIONS.map(([value]) => value)).toEqual(['foreground', 'normal', 'background']);
  });
});
