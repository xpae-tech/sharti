import { describe, expect, it } from 'vitest';
import { readUsage } from './usage.js';

describe('readUsage', () => {
  it('reads the OpenAI usage shape', () => {
    expect(readUsage({
      prompt_tokens: 61,
      completion_tokens: 130,
      total_tokens: 191,
      prompt_tokens_details: { cached_tokens: 12 },
      completion_tokens_details: { reasoning_tokens: 40 },
    })).toEqual({ input: 61, output: 130, total: 191, cached: 12, reasoning: 40 });
  });

  it('accepts the input/output aliases used by other providers', () => {
    expect(readUsage({ input_tokens: 129, output_tokens: 66 })).toEqual({
      input: 129, output: 66, total: 195, cached: null, reasoning: null,
    });
  });

  it('accepts cached and reasoning token aliases', () => {
    expect(readUsage({ prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 4, reasoning_tokens: 3 }))
      .toMatchObject({ cached: 4, reasoning: 3 });
    expect(readUsage({ prompt_tokens: 10, completion_tokens: 5, cached_tokens: 2 }))
      .toMatchObject({ cached: 2 });
  });

  it('derives the total from input and output when the provider omits it', () => {
    expect(readUsage({ prompt_tokens: 129, completion_tokens: 66 })?.total).toBe(195);
  });

  it('prefers the reported total over the sum', () => {
    expect(readUsage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 })?.total).toBe(3);
  });

  it('re-derives the value for each turn instead of reusing a previous one', () => {
    expect(readUsage({ total_tokens: 139 })?.total).toBe(139);
    expect(readUsage({ total_tokens: 191 })?.total).toBe(191);
  });

  it('returns null when usage carries no token counts', () => {
    expect(readUsage(undefined)).toBeNull();
    expect(readUsage({})).toBeNull();
    expect(readUsage({ prompt_tokens: 'many' })).toBeNull();
  });
});
