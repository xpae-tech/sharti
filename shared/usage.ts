/**
 * Normalizes the `usage` object returned by OpenAI-compatible providers.
 *
 * Providers disagree on field names (`prompt_tokens` vs `input_tokens`, etc.)
 * and may omit `total_tokens`, so every consumer reads one shape.
 */
export interface UsageStats {
  /** Prompt (input) tokens reported for this completion. */
  input: number | null;
  /** Completion (output) tokens reported for this completion. */
  output: number | null;
  /** Context occupancy: the provider's total, or input + output as a fallback. */
  total: number | null;
  /** Prompt tokens served from a provider cache. */
  cached: number | null;
  /** Reasoning tokens included in the completion. */
  reasoning: number | null;
}

function tokenNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads a provider `usage` object. Returns null when it carries no token
 * accounting at all, so callers never invent a number.
 */
export function readUsage(usage: unknown): UsageStats | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, any>;

  const input = tokenNumber(u.prompt_tokens) ?? tokenNumber(u.input_tokens);
  const output = tokenNumber(u.completion_tokens) ?? tokenNumber(u.output_tokens);
  const total = tokenNumber(u.total_tokens)
    ?? (input != null && output != null ? input + output : null);
  const cached = tokenNumber(u.prompt_tokens_details?.cached_tokens)
    ?? tokenNumber(u.prompt_cache_hit_tokens)
    ?? tokenNumber(u.cached_tokens);
  const reasoning = tokenNumber(u.completion_tokens_details?.reasoning_tokens)
    ?? tokenNumber(u.reasoning_tokens);

  if (input == null && output == null && total == null && cached == null && reasoning == null) {
    return null;
  }
  return { input, output, total, cached, reasoning };
}
